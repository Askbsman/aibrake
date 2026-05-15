# Partner Onboarding — Agent Spend Guard Hosted Beta

Welcome. You are one of 2–3 first partners trying Agent Spend Guard against a real paid agent workflow. The whole onboarding is designed to take **under 30 minutes** — if it takes longer, that is a bug in this document and we want to hear it.

---

## What Agent Spend Guard does

Pre-flight check for paid AI agent actions. Detects loops, stale-context retries, model escalation without evidence, and objective drift **before** the next expensive call.

> **PQS checks the prompt. Agent Spend Guard checks the loop.**

It does not score one prompt. It looks at the action history, the failure fingerprint, the evidence signals between attempts, and the operator's model policy.

## What it does NOT do

- It does not block your agent. The recommended integration is `checkShadow()`: log the decision, run the action anyway. Promotion to `checkOrConfirm` or `checkOrDowngrade` is your call after you trust the warnings.
- It does not score prompts (use PQS).
- It does not validate JSON output (use Boundary Guard).
- It does not check x402 endpoint trust (use x402station).

---

## Before you start

You should have received from the maintainer:

- A **hosted URL** (e.g. `https://agent-spend-guard.example.com`)
- An **API key** in the format `asg_v1_...` — this is YOUR key, do not share it
- A link to this document

If you do not have these, stop here and ask.

---

## 30-minute integration

### Step 1 (2 min) — confirm the server is up

```bash
curl https://agent-spend-guard.example.com/health
```

Expect:

```json
{ "ok": true, "service": "agent-spend-guard", "version": "0.3.0-beta", "mode": "hosted-beta" }
```

If you get anything else, ping the maintainer before going further.

### Step 2 (5 min) — install the SDK

```bash
npm install spending-guard
```

The npm package is named `spending-guard` (historical); the product brand is **Agent Spend Guard**. See `IMPLEMENTATION_NOTES.md § 13` for why.

### Step 3 (5 min) — first call

```ts
import { SpendingGuard } from "spending-guard";

const guard = new SpendingGuard({
  baseUrl: process.env.AGENT_SPEND_GUARD_URL!,
  apiKey:  process.env.AGENT_SPEND_GUARD_API_KEY!,
  timeoutMs: 1000,
  failureMode: "open",    // CRITICAL: guard outages must NOT take your agent offline
});

// Drop this in BEFORE each expensive action. It never blocks.
const result = await guard.checkShadow({
  actor: { type: "agent", runtime: "your-runtime-name", id: "agent-1" },
  next_action: {
    type: "paid_llm_call",
    provider: "anthropic",
    model: "claude-opus",
    estimated_cost: { amount: 0.42, currency: "USD" },
    reason: "retry build fix",
  },
  // The richer the history, the better the judgment.
  history: { /* ... see below ... */ },
  objective: { /* ... */ },
});

console.log("[guard]", result.decision, result.pattern, result.reason);
```

That is it. Your agent runs the action no matter what — `checkShadow` is observe-only.

### Step 4 (10 min) — fill in history

The detector is only as good as the telemetry you send. Minimum useful fields:

```ts
history: {
  attempt_number: <int>,
  same_action_count: <int>,             // how many times this exact action has fired
  failure_signal_present: <boolean>,    // did the previous attempt fail deterministically?
  failure_signal_type: "build_error" | "test_failure" | "exception" | "tool_error" | ...,
  failure_fingerprint: "<stable hash of the failure>",
  same_failure_count: <int>,            // how many times this exact failure has repeated
  paid_attempts_on_same_failure: <int>,
  new_evidence_since_last_attempt: <boolean>,  // did the agent read files, run tests, etc?
  evidence_kind: "code" | "web" | "api" | ...,
  evidence_signals: {
    files_read_since_last_attempt: <int>,
    tests_run_since_last_attempt: <int>,
    git_diff_changed_since_last_attempt: <boolean>,
    tool_results_changed_since_last_attempt: <boolean>,
    // any other adapter-specific signals — we read what you send
  },
}
```

If you have a coding-agent runtime, see `OPENCLAW_ADAPTER.md` for a reference adapter that computes most of these from event telemetry. If you have a different runtime (research, scraper, browser, image), the adapter is yours to write — Core is universal.

### Step 5 (5 min) — sanity check with a known loop

Hit your agent against a known stuck task — a failing test you can't fix yet, or a paid scrape that has been returning the same content. Run for 7–8 attempts. You should start seeing `decision: "warn"` or `"require_confirmation"` from around attempt 4–7.

If you don't, the telemetry is probably too sparse. Recheck `failure_signal_present`, `same_failure_count`, and `new_evidence_since_last_attempt`.

### Step 6 (3 min) — review one log line

If the hosted server is configured with JSONL logging and the maintainer can read your logs (or has given you remote log access), confirm:

- Decisions appear in `decisions.jsonl`
- `api_key_hash` is `key_v1_...` (your raw key never appears)
- `input_hash` is `input_v1_...`
- No raw prompts, no raw file contents in the log lines

If anything is leaking, stop and tell the maintainer immediately.

---

## After 7 days

Open `BETA_FEEDBACK_TEMPLATE.md`, fill it in, send it to the maintainer. Three things matter most:

1. **Did Agent Spend Guard catch a real loop you would have otherwise spent money on?** If yes, paste the situation.
2. **Did it warn about something that was actually fine?** If yes, paste it too — false positives are the most important early signal.
3. **Would you keep it enabled past the beta?** Honest answers only. "Not yet" is a useful answer.

---

## Things you may safely ignore in Stage 0.3

- The package name `spending-guard` vs. product name `Agent Spend Guard` — see § 13 of IMPLEMENTATION_NOTES if curious; doesn't affect integration.
- `/v1/check-deep` — it's a documented stub. You will see `deep_check_used: false`. That's correct.
- The `model_route` field in responses if you do not use `checkOrDowngrade` — read-only output, safe to ignore.
- The `policy_version` and `detector_version` fields — pin them only if you care about deterministic behavior across server updates. We will announce any threshold change in `CHANGELOG.md`.

---

## When to escalate to the maintainer

- Health endpoint stops returning 200
- 401 / 403 responses that you cannot explain
- 429 happening at a rate you did not expect (you probably need a higher limit)
- Any case where `decision: "block"` fires unexpectedly — Stage 0.3 should only block on (a) hard budget breach or (b) explicit `blocked_actions` policy. Anything else is a bug.
- Any sign that raw payload content leaks into logs

For each, include: the `request_id` from the response (it is also in the log line), the approximate timestamp, and what you expected.
