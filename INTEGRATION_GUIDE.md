# INTEGRATION_GUIDE.md

> **For: anyone integrating Agent Spend Guard into a real paid agent workflow.**
>
> This is the meta-document. It points you at the right runtime-specific guide and explains the integration model. For onboarding flow and "pick your path" tiles, see [`PARTNER_ONBOARDING.md`](./PARTNER_ONBOARDING.md).

---

## 1. The three layers

```
   your runtime / wrapper
            │
            ▼
   ┌────────────────────┐
   │  Adapter (optional) │   translates lifecycle events → universal payload
   │  CodingAgentAdapter │   stateful per-process history tracker
   └────────────────────┘
            │
            ▼
   ┌────────────────────┐
   │       SDK           │   thin HTTP client, 4 helpers
   │  TS or Python       │   handles auth, timeout, failure modes
   └────────────────────┘
            │
            ▼
       /v1/check         ← stateless Core: detectors + aggregation + scoring
```

Pick what you need:

- **Just want to call /v1/check from anywhere?** Use the SDK. No adapter required.
- **Have a coding-agent runtime (Claude Code / Codex / Cursor)?** Use `CodingAgentAdapter` + SDK. See [`CODING_AGENT_ADAPTER.md`](./CODING_AGENT_ADAPTER.md).
- **Python-based (LangChain / AutoGen / scraper / research agent)?** Use the Python SDK. See [`PYTHON_SDK.md`](./PYTHON_SDK.md).
- **None of the above?** Hand-roll the payload yourself; the schema is in [`src/core/schemas.ts`](./src/core/schemas.ts) (or read it off `GET /v1/meta`).

---

## 2. The three integration modes

Pick one based on how aggressively you want the guard to participate:

### Mode A — Shadow (recommended for first 7 days)

```ts
const result = await guard.checkShadow(payload);
// Never blocks. Always returns a result. Even on guard outage.
log("[guard]", result.decision, result.pattern, result.reason);
await runYourAction(payload.next_action);
```

Use this until you trust the warnings. Your agent runs every action regardless of what the guard says. You collect 7 days of decision logs and review them.

### Mode B — Confirm

```ts
await guard.checkOrConfirm(payload, {
  onWarn: async (result) => askHumanForConfirmation(result),
});
await runYourAction(payload.next_action);
```

Used after shadow data confirms warnings are mostly useful. `block` decisions throw `SpendingGuardBlockedError`; `warn`/`require_confirmation` decisions call `onWarn` and you decide whether to proceed.

### Mode C — Downgrade

```ts
const { action, result } = await guard.checkOrDowngrade(payload, {
  downgradeTo: { provider: "anthropic", model: "claude-sonnet", estimatedCost: 0.04 },
});
await runYourAction(action);   // action is possibly downgraded
```

Best for primary/secondary model workflows. On `model_escalation_without_evidence`, the SDK swaps your `next_action` to the secondary model (from `objective.model_policy.secondaryModel` if declared, else the static `downgradeTo`).

---

## 3. Failure-mode discipline

The single most important constructor option:

```ts
new SpendingGuard({
  baseUrl: ...,
  apiKey: ...,
  failureMode: "open",     // ← default; use this in production
});
```

`failureMode: "open"` means: if Spending Guard is unreachable for any reason — network, timeout, 5xx — the SDK returns a synthetic `{decision: "allow", pattern: "guard_unavailable"}` and your agent keeps working.

**This is non-negotiable.** A preflight guardrail that takes your agent offline when it has problems is a worse outcome than no guardrail. Operators have ripped middleware out for this exact reason elsewhere; do not be that operator.

You can opt to `failureMode: "closed"` (synthetic block on outage) only when you've already lived with `"open"` for 30+ days and have monitoring on the synthetic-allow rate.

---

## 4. Minimum useful payload

The schema allows almost everything to be optional, but the detectors need at least:

```json
{
  "actor": { "type": "agent", "runtime": "your-runtime-name" },
  "objective": {
    "id": "obj_stable_string",
    "goal": "what the agent is trying to do",
    "budget": { "amount": 10, "currency": "USD", "hard_limit": false }
  },
  "next_action": {
    "type": "paid_llm_call",
    "provider": "...",
    "model": "...",
    "estimated_cost": { "amount": 0.42, "currency": "USD" }
  },
  "history": {
    "attempt_number": 1,
    "same_action_count": 0,
    "failure_signal_present": false,
    "new_evidence_since_last_attempt": null,
    "evidence_kind": "code"
  },
  "telemetry_quality": { "completeness": "high" }
}
```

For meaningful warnings, populate as much of `history.*` as your runtime tracks. See [`PARTNER_ONBOARDING.md`](./PARTNER_ONBOARDING.md) "Pick your path" tiles for the minimum-useful telemetry per runtime profile.

---

## 5. Per-request detector policy

Stage 0.4 adds optional per-request threshold overrides under `objective.detector_policy`. Useful when your cost-per-call differs from the defaults the detectors are tuned for ($0.10ish LLM calls):

```json
{
  "objective": {
    "detector_policy": {
      "same_tool_retry_threshold": 3,
      "premium_retry_without_evidence_threshold": 2
    }
  }
}
```

- **High-cost scrape / browser** ($0.50+): set `same_tool_retry_threshold: 3`.
- **High-cost premium model** ($1+): set `premium_retry_without_evidence_threshold: 2`.
- **Default LLM workflows** ($0.02–$0.05): keep defaults.

Policies are **per-request**, never server-side state. Each call may carry different policy. This keeps Core stateless and lets each objective tune independently.

---

## 6. Decision logging

The server writes one redacted JSON line per `/v1/check` to its log path. No client-side action required.

What's logged:

```
event_type, request_id, input_hash, api_key_hash, decision,
recommended_policy, pattern, risk_score, confidence,
detector_version, policy_version, matched_rules_count, matched_rules,
timestamp
```

What's NEVER logged:

```
raw API key
raw prompts
raw file contents
raw error messages (only the failure fingerprint hash)
your customers' data
```

If your partner agreement requires you to host the server in your own infra (rather than calling a vendor-hosted instance), you control where the JSONL goes. See [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## 7. Common integration mistakes

These came out of the simulated 3-partner validation (validation-log/ in this repo, gitignored). All are partner-facing in the sense that operators hit them naturally:

1. **Setting `new_evidence_since_last_attempt: false` on attempt 1.** `false` means "I had a chance to gather evidence and didn't." On attempt 1 there has been no chance. Use `null`. (Fixed at server side in 0.3.1, but still confusing copy.)

2. **Forgetting to carry failure context onto planned model calls.** A planned paid LLM call must include the failure signal it is trying to address (`failure_signal_present: true` + `failure_fingerprint` inputs), not just its own model name and cost. Otherwise `same_failure_count` never increments. See [`CODING_AGENT_ADAPTER.md` § 4](./CODING_AGENT_ADAPTER.md).

3. **Declaring `model_policy.primaryModel` but forgetting `secondaryModel`.** Without a secondary, the structured `model_route.to` is empty, and `checkOrDowngrade` falls back to the static argument. Declare both.

4. **Reading `result.decision` only.** The pattern + matched_rules + reason carry useful signal even when decision is `allow`. Log all four; trust comes from reading reasons that match your own intuition.

5. **Picking the wrong detector for your workflow.** Scraper loops fire on `same_tool_retry_loop`, not on `stale_context_retry_storm`. The latter requires `failure_signal_present: true`. If your scraper returns 200 with stale content, set `failure_signal_present: false` and rely on the tool-retry detector.

---

## 8. Promotion path (shadow → confirm → downgrade)

Recommended timeline for a real partner integration:

| Day | Mode | What you do | What you collect |
| --- | --- | --- | --- |
| 0 | — | Hit `/health` and `/v1/meta` from your stack | Service is reachable |
| 0 | — | Read `PARTNER_ONBOARDING.md` "Pick your path" tile for your runtime | Minimum payload shape |
| 0-1 | A (shadow) | Wire `checkShadow` before every paid action | Decisions in your own JSONL |
| 1-7 | A (shadow) | Run your normal workload | 7 days of decision data |
| 7 | — | Review the JSONL. Eyeball false-positive rate. Send the maintainer your `BETA_FEEDBACK_TEMPLATE.md` | A go/no-go signal |
| 7+ | B (confirm) — if false-positives < 5% | Switch to `checkOrConfirm` with a human-in-the-loop for warn/require_confirmation | Confidence the human catches false positives |
| 14+ | C (downgrade) — if you have primary/secondary | Switch to `checkOrDowngrade` for auto-routing | Real $ saved on premium-retry storms |

Skip ahead at your risk. Operators who go straight to enforcing mode and hit one false positive tend to rip the middleware out.

---

## 9. Where to find things

| You want to … | File |
| --- | --- |
| 30-min integration walkthrough | [`PARTNER_ONBOARDING.md`](./PARTNER_ONBOARDING.md) |
| Python-specific docs | [`PYTHON_SDK.md`](./PYTHON_SDK.md) |
| Coding-agent adapter docs | [`CODING_AGENT_ADAPTER.md`](./CODING_AGENT_ADAPTER.md) |
| Send feedback after 7 days | [`BETA_FEEDBACK_TEMPLATE.md`](./BETA_FEEDBACK_TEMPLATE.md) |
| Self-host the server | [`DEPLOYMENT.md`](./DEPLOYMENT.md) |
| Product positioning + competitor comparison | [`PRODUCT.md`](./PRODUCT.md), [`X402_LISTING.md`](./X402_LISTING.md) |
| Architecture rationale | [`IMPLEMENTATION_NOTES.md`](./IMPLEMENTATION_NOTES.md) |
| What changed in each release | [`CHANGELOG.md`](./CHANGELOG.md) |
