# Agent Spend Guard — x402 Marketplace Listing Draft

**Status:** draft listing copy for `agentic.market` (and other x402 marketplaces). Not yet published.
**Category:** Infra
**Implementation:** Spending Guard Stage 0.2-minimal RC (tag `spending-guard-v0.2.0-rc`).

---

## Listing — short form

> **Agent Spend Guard**
> Loop detection and model stop-loss for paid AI agents.

**One-paragraph description:**

> Agent Spend Guard is a pre-flight risk check for paid AI agent actions. It detects wasteful retry loops, stale-context failures, same-tool loops, objective drift, and premium-model burn before the next expensive step. Unlike prompt-quality preflight tools, Agent Spend Guard uses action history, objective state, evidence signals, and model policy to decide whether the next paid action is real progress — or another costly retry.

---

## Why this differs from existing preflight services

The agentic.market catalog already lists preflight-style services: PQS, Boundary Guard, x402station, Fia Signals, AzurSafe, ShieldAPI. Each is good at a different question.

```
PQS              → Is this single prompt worth paying for?    (8-dim rubric)
Boundary Guard   → Did the output pass schema / safety?       (boundary validation)
x402station      → Is this x402 endpoint trustworthy?         (endpoint risk)
Fia Signals      → Is this token / contract safe?             (onchain risk)
AzurSafe / etc.  → Is this wallet / domain safe?              (security risk)

Agent Spend Guard → Is the agent already stuck in a paid retry loop?
                    Is the same failure repeating without new evidence?
                    Is the operator about to burn the premium model
                    when a configured secondary would do?
```

> **Prompt preflight is not enough. Agents fail in loops.**
>
> **PQS checks the prompt. Agent Spend Guard checks the loop.**

History-based loop detection + structured `primary → secondary` model routing are not in any other listing. That gap is the wedge.

---

## API surface (Stage 0.2-minimal RC)

| Endpoint | Description | Status |
| --- | --- | --- |
| `GET /health` | Free liveness probe | active |
| `POST /v1/check` | Rules-only pre-flight judgment. Sub-300ms target. **Paid in production via x402 (price TBD, target sub-cent).** | active |
| `POST /v1/check-deep` | Optional LLM-judgment endpoint. **Stub** in Stage 0.2 — returns `deep_check_used: false`. | stub |

---

## Detectors that fire (Stage 0.2-minimal)

| Detector | What it catches |
| --- | --- |
| `stale_context_retry_storm` | Same deterministic failure repeats; no new files / tests / logs / git diff between attempts; agent is about to spend again. Requires `failure_signal_present: true`. |
| `model_escalation_without_evidence` | Agent is about to call the configured `primaryModel` (or any expensive model) on a repeated failure without new evidence. With `objective.model_policy.secondaryModel` declared, emits a structured `model_route.to` so the SDK auto-downgrades. |
| `task_budget_breach` | Projected spend would exceed `objective.budget`. Hard block only when `hard_limit: true`. |
| `same_tool_retry_loop` | Same paid tool / search / scrape called repeatedly without changing results, even without a deterministic failure signal. Soft warn, never hard-blocks. |
| `objective_drift` | Next action is in `blocked_actions` or outside `allowed_actions`. Deterministic block on explicit policy violation. |

---

## Key output fields

```jsonc
{
  "decision":             "allow | warn | require_confirmation | delay | block | uncertain",
  "recommended_policy":   "continue | log_only | shadow_log | downgrade | ask_human |
                           delay_action | stop_action | run_deep_check | request_more_telemetry",
  "risk_score":           0-100,
  "risk_level":           "low | moderate | elevated | high | critical",
  "confidence":           0.0-1.0,
  "pattern":              "stale_context_retry_storm | model_escalation_without_evidence | ...",
  "matched_rules":        [...],
  "reason":               "human-readable summary",
  "suggested_action": {
    "type":               "switch_model | context_refresh | downgrade_model | ...",
    "message":            "actionable text",
    "model_route": {                 // present when secondaryModel is configured
      "from": { "provider": "anthropic", "model": "claude-4.7",   "role": "primary",   "tier": "premium"  },
      "to":   { "provider": "anthropic", "model": "claude-sonnet", "role": "secondary", "tier": "standard" },
      "reason": "..."
    }
  },
  "detector_version":     "stale_context_retry_storm@0.1.0",  // pin or compare
  "policy_version":       "policy@0.1.0"
}
```

---

## SDK — five-line middleware

```bash
npm install spending-guard
```

```ts
import { SpendingGuard } from "spending-guard";

const guard = new SpendingGuard({
  baseUrl: "https://agent-spend-guard.example.com",
  timeoutMs: 500,
  failureMode: "open",   // never takes your agent offline on guard outage
});

// shadow mode — log only, never block
await guard.checkShadow(input);
```

Three integration patterns; each is one method call.

| Method | Behavior |
| --- | --- |
| `check(input)` | Returns the structured result. Never throws on a guard decision. |
| `checkShadow(input)` | Same, but synthesizes `allow` on outage. Useful for first-week deployments. |
| `checkOrConfirm(input, { onWarn })` | Throws `SpendingGuardBlockedError` on `block`; calls `onWarn` on `warn` / `require_confirmation`. |
| `checkOrDowngrade(input, { downgradeTo })` | Auto-applies `model_route.to` from the guard response (operator's configured secondary), falling back to static `downgradeTo`. |

---

## Use cases

- **Coding-agent runtimes** (Claude Code / Cursor / Codex / OpenClaw / Hermes): catch retry storms on the same build / test / lint error.
- **Crypto / x402 agents** (scrapers, research bots, swap routers): catch repeated paid tool calls on unchanged results.
- **Browser-automation agents** (Browserbase / Hyperbrowser / Anchor): catch repeated paid sessions on the same target.
- **Image / media agents** (fal.ai / Magnific): catch repeated generation calls with unchanged prompts/results.
- **Any agent with a configured `primaryModel` + `secondaryModel`**: catch premium-model burn and auto-route to secondary.

---

## What it does NOT do

- Score a single prompt (use **PQS** for that).
- Validate output schema or generate receipts (use **Boundary Guard**).
- Check x402 endpoint trust before payment (use **x402station**).
- Screen wallets / tokens / contracts for onchain risk (use **Fia Signals**, **AzurSafe**, **BlackSwan**).
- Provide a dashboard, accounts, billing, or analytics UI.
- Block the agent globally — `checkShadow` is the integration entry point; hard block fires only on deterministic budget breach or explicit policy violation.

Agent Spend Guard composes with all of the above. A serious agent stack will use 2–3 preflight services in sequence: prompt quality (PQS) → loop detection (Agent Spend Guard) → output validation (Boundary Guard). We are the middle step.

---

## Pricing model (target)

| Endpoint | Target price | Rationale |
| --- | --- | --- |
| `GET /health` | free | x402 norm |
| `POST /v1/check` (rules-only) | **sub-cent** (e.g. $0.001 USDC, target band $0.001–$0.005) | Must not be a meaningful tax over a $0.001–$0.05 paid LLM/tool call it is guarding. |
| `POST /v1/check-deep` (LLM judgment) | TBD when stub is replaced | More expensive; recommended only when `/v1/check` returns `uncertain`. |

Stage 0.2-minimal RC ships free for first integration partners. Hosted paid endpoint goes live only after **2 of 3 builders** complete a one-week `checkShadow` integration. See `PARTNER_VALIDATION_SCRIPT.md` in the repo.

---

## Networks

```
Base
Solana (planned, post-validation)
```

---

## Tagline candidates (pick one before publishing)

| Tagline | Notes |
| --- | --- |
| *Stop paying for useless agent loops.* | Used in the GitHub README. Direct. |
| *PQS checks the prompt. We check the loop.* | Sharpest positioning against the closest competitor. Use on marketplace card. |
| *Loop detection and model stop-loss for paid AI agents.* | Most descriptive. Use as the subtitle. |
| *Don't pay for the 7th guess.* | Memorable, narrative. Use in pitch decks / demo intros. |

Recommended pairing: **subtitle** = *"Loop detection and model stop-loss for paid AI agents"*; **first paragraph** = *"PQS checks the prompt. We check the loop."*

---

## Versions in production

| Item | Version |
| --- | --- |
| Policy | `policy@0.1.0` |
| Detector — stale context | `stale_context_retry_storm@0.1.0` |
| Detector — model escalation | `model_escalation_without_evidence@0.2.0` |
| Detector — same-tool loop | `same_tool_retry_loop@0.1.0` |
| Detector — task budget | `task_budget_breach@0.1.0` |
| Detector — objective drift | `objective_drift@0.1.0` |
| Fingerprint format | `fp_v1_*` / `input_v1_*` |
| Repository tag | `spending-guard-v0.2.0-rc` |

Operators can pin these in production. Every `/v1/check` response carries `detector_version` and `policy_version` so silent behavior drift is detectable.

---

## Publishing checklist (when 2 of 3 partner-validation pass condition is met)

1. Replace `https://agent-spend-guard.example.com` placeholder with the real hosted endpoint.
2. Pick one tagline + one description from the candidates above.
3. Add the repository link.
4. Confirm pricing tier on `/v1/check` (start at $0.001 USDC).
5. Submit to `agentic.market` listing form (category: **Infra**).
6. Update this file with the live listing URL once approved.

Do NOT publish before:
- 2 of 3 partner validation calls return "yes, integrating this week."
- Hosted `/v1/check` has been running for >7 days with <5% false-positive rate on shadow-mode logs from at least one partner.
- A `CHANGELOG.md` exists in the repo (currently missing — required before any external listing).
