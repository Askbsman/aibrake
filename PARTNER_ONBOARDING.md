# Partner Onboarding — AIBrake Hosted Beta

Welcome. You are one of 2–3 first partners trying AIBrake against a real paid agent workflow. The whole onboarding is designed to take **under 30 minutes** — if it takes longer, that is a bug in this document and we want to hear it.

---

## Pick your path

AIBrake is **one product**, but the canonical demo and payload shape that will resonate fastest depend on what your agent actually does. Pick the tile that matches your stack — read that section first, the others are reference.

### 🛠️  Coding-agent operator

> *You run paid LLM calls inside a coding agent — Claude Code, Cursor, Codex, a custom wrapper.*

- **Canonical demo:** `npm run demo:retry-storm` (in `openclaw-harness/`)
- **Your pain:** the agent keeps making expensive LLM calls on the same failing build / test / lint error without refreshing context. ~$30+ /day burned on doomed retries.
- **Detector you'll see most:** `stale_context_retry_storm` once `same_failure_count >= 3` and `new_evidence_since_last_attempt: false`.
- **Sample payload:** [`examples/payloads/retry-storm.json`](./examples/payloads/retry-storm.json)
- **Telemetry shape:** `failure_signal_present: true`, `failure_signal_type: "build_error" | "test_failure" | "command_error"`, `failure_fingerprint`, `same_failure_count`, `paid_attempts_on_same_failure`, `new_evidence_since_last_attempt`, `evidence_kind: "code"`, `evidence_signals.{files_read_since_last_attempt, tests_run_since_last_attempt, git_diff_changed_since_last_attempt}`.

### 🌐  Scraper / research-agent operator

> *You run paid web scrapers / search APIs / browser agents — Anchor, Browserbase, Exa, Firecrawl, Hyperbrowser, custom.*

- **Canonical demo:** `npm run demo:scraper-loop` (in `openclaw-harness/`)
- **Your pain:** the agent keeps hitting the same paid endpoint / running the same paid search with unchanged results. No deterministic failure, but cost adds up — $5–$50 /day per stuck agent.
- **Detector you'll see most:** `same_tool_retry_loop` once `same_action_count >= 6` and `tool_results_changed_since_last_attempt: false`.
- **Sample payload:** [`examples/payloads/scraper-loop.json`](./examples/payloads/scraper-loop.json)
- **Telemetry shape:** `failure_signal_present: false` (no error — the API answered, results just didn't help), `same_action_count`, `evidence_kind: "web" | "api"`, `evidence_signals.tool_results_changed_since_last_attempt`. **You do NOT need to send `failure_fingerprint` or `same_failure_count`.**
- **Critical note for Stage 0.3.1:** on your first paid call, set `new_evidence_since_last_attempt: null` (not `false`). `false` means "I had a chance to gather evidence and didn't" — on attempt #1 there has been no chance. Sending `false` from attempt #1 used to false-trigger in 0.3.0; fixed in 0.3.1.

### ⚡  Primary / secondary model operator

> *You run a multi-model agent — primary expensive (GPT-4 / Claude Opus / Claude 4.x), secondary cheap (GPT-3.5 / Haiku / Sonnet). LangChain, AutoGen, CrewAI, custom orchestrator.*

- **Canonical demo:** `npm run demo:premium-model-loop` (in `openclaw-harness/`)
- **Your pain:** the agent keeps retrying the expensive primary model when it could switch to the secondary for summary / audit / cheaper continuation. $50–$200 /day burnt per stuck objective.
- **Detector you'll see most:** `model_escalation_without_evidence` once `same_failure_count >= 3` with a primary model declared. Returns a structured `suggested_action.model_route.to` so the SDK auto-routes via `checkOrDowngrade`.
- **Sample payload:** [`examples/payloads/premium-model-loop.json`](./examples/payloads/premium-model-loop.json)
- **Telemetry shape:** declare `objective.model_policy.primaryModel` and `secondaryModel` (and optionally `auditModel`) on every call. Set `next_action.model_role: "primary"` and `model_tier: "premium"` on the primary calls. The detector reads either signal to identify "this is a primary call."
- **Promotion path:** start with `guard.checkShadow()`; after a week of clean logs, switch to `guard.checkOrDowngrade({ downgradeTo: { provider, model } })` — the SDK reads `model_route.to` from the response and auto-applies the operator's configured secondary.

> **If you do not fit any of the three:** send the maintainer your workflow description. The Core schema is universal (`evidence_kind` is a free field); the canonical demos are starting points, not constraints.

---

## What AIBrake does

Pre-flight check for paid AI agent actions. Detects loops, stale-context retries, model escalation without evidence, and objective drift **before** the next expensive call.

> **PQS checks the prompt. AIBrake checks the loop.**

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

The npm package is named `spending-guard` (historical); the product brand is **AIBrake**. See `IMPLEMENTATION_NOTES.md § 13` for why.

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

## Choosing detector_policy thresholds

`detector_policy` is a per-request knob set you ship in `objective.detector_policy`. `/v1/meta` returns the schema and an example block so you can paste it without grepping the source. Quick guidance:

For **scraper / search agents** (each call costs $0.10+):

```json
"detector_policy": {
  "same_tool_retry_threshold": 3,
  "expensive_action_usd_threshold": 0.10
}
```

Lower `same_tool_retry_threshold` because expensive actions don't deserve the default 6 retries before warn.

For **coding agents** (each call costs ~$0.01–0.05):

```json
"detector_policy": { "same_tool_retry_threshold": 6 }
```

Default is usually fine. Use `failure_fingerprint` and `evidence_signals.{files_read_since_last_attempt,tests_run_since_last_attempt,git_diff_changed_since_last_attempt}` so the stale-context detector has the universal evidence model populated.

For **premium-model routing** (you want primary → secondary downgrade):

```json
"detector_policy": { "premium_retry_without_evidence_threshold": 2 },
"model_policy": {
  "primaryModel":   { "provider": "anthropic", "model": "claude-opus",  "tier": "premium" },
  "secondaryModel": { "provider": "anthropic", "model": "claude-haiku", "tier": "cheap"  }
}
```

Two retries of an expensive call without new evidence is plenty for most workloads. Pair with `checkOrDowngrade` in the TS SDK or `check_or_downgrade` in Python — the SDK will read `suggested_action.model_route.to` from the response and switch to `secondaryModel` automatically.

Full schema (`type`, `default`, `min`, `recommended_range`, `description` for each of the four knobs) is available at `GET /v1/meta` under `detector_policy.supported_fields`.

---

## SDK error behavior

AIBrake SDKs **fail open only on transport / service-availability failures**. They do NOT fail open on:

- malformed payloads (e.g. BigInt or circular reference passed to `JSON.stringify`)
- JSON serialization errors
- server-side validation errors (HTTP 400)
- authentication / authorization errors (HTTP 401 / 403)
- missing required fields
- any other programmer error

If your payload is invalid, the SDK raises — your agent should NOT silently keep going. This is intentional and was hardened in Stage 0.4.1 / 0.4.2.

**Stage 0.5: structured error details.** Both SDKs now expose a `details` block on every error (TS) / structured attributes (Python) so you can write one handler and branch on a discriminator instead of importing every subclass.

TypeScript:

```ts
try {
  await guard.check(input);
} catch (err) {
  const d = (err as { details?: { kind?: string; retryable?: boolean } }).details;
  if (d?.kind === "transport" || d?.kind === "http_5xx") {
    // retry — guard was unreachable / temporarily down
  } else if (d?.kind === "validation") {
    // fix your payload (HTTP 400)
  } else if (d?.kind === "http_4xx" && d.statusCode === 401) {
    // bad / missing API key
  } else if (d?.kind === "blocked") {
    // SpendingGuardBlockedError — read err.result for the structured decision
  } else {
    throw err;
  }
}
```

Python:

```py
from agent_spend_guard import AgentSpendGuard, SpendingGuardError

try:
    guard.check(payload)
except SpendingGuardError as err:
    if err.kind in ("transport", "http_5xx"):
        ...  # retry
    elif err.kind == "validation":
        ...  # HTTP 400 — fix payload
    elif err.kind == "http_4xx" and err.status_code == 401:
        ...  # bad / missing API key
    elif err.kind == "blocked":
        ...  # err.result is the structured decision
```

`err.details.retryable` (TS) / `err.retryable` (Python) is a hint: `true` for transport / 5xx / 429, `false` otherwise.

---

## After 7 days

Open `BETA_FEEDBACK_TEMPLATE.md`, fill it in, send it to the maintainer. Three things matter most:

1. **Did AIBrake catch a real loop you would have otherwise spent money on?** If yes, paste the situation.
2. **Did it warn about something that was actually fine?** If yes, paste it too — false positives are the most important early signal.
3. **Would you keep it enabled past the beta?** Honest answers only. "Not yet" is a useful answer.

---

## Things you may safely ignore in Stage 0.3

- The package name `spending-guard` vs. product name `AIBrake` — see § 13 of IMPLEMENTATION_NOTES if curious; doesn't affect integration.
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
