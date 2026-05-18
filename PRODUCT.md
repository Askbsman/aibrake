# AIBrake — Product

> **Status:** Stage 0.3 Hosted Beta Candidate
> **Tag:** `spending-guard-v0.3.0-beta`
> **Primary detector:** `stale_context_retry_storm`
> **Primary demo:** The $40 TypeScript Retry Storm
> **Brand vs. package:** npm package is `spending-guard`; product brand is **AIBrake** (see [`IMPLEMENTATION_NOTES.md § 13`](./IMPLEMENTATION_NOTES.md))
> **Next step:** hosted beta — see [`PARTNER_ONBOARDING.md`](./PARTNER_ONBOARDING.md)

## Positioning

**Spending Guard** is a provider-agnostic, runtime-agnostic, x402-ready pre-flight judgment layer for expensive AI agent actions.

It is **not**:

- a therapy / mental-health / addiction product
- a parental-control product
- a productivity app
- a dashboard
- a simple budget counter
- a generic logging layer

It **is**:

- middleware that checks paid LLM calls, tool retries, and model escalations before execution
- a judgment engine that detects waste patterns (stale-context loops, model escalation without evidence, objective drift)
- infrastructure for x402 agents, AI wallets, coding agents and any paid AI workflow

Tagline: **Stop paying for useless agent loops.**

Public phrase that captures the wedge:

> **Don't pay for the 7th guess.**

---

## Why this is not a budget counter

Budget caps are table stakes. Every LLM provider dashboard and every framework (Helicone, Langfuse, Portkey) ships them. They don't differentiate.

The defensible product is *judgment*:

- **Loop detection** — the agent has retried the same failing subtask 6 times with no new evidence. Stop.
- **Stale context** — repeated paid attempts with no file read, no test rerun, no log refresh between them. Refresh context before spending.
- **Model escalation without evidence** — agent jumped to Opus on a problem it failed 6 times on Sonnet. Same input → same output. Downgrade or stop.
- **Objective drift** — the original objective was "fix the build"; the next action is "refactor the entire architecture." That's drift.

A budget counter prevents the *amount* of waste. Spending Guard prevents the *occurrence* of waste — earlier, with cheaper guardrails, against patterns budget caps will never detect.

---

## First detector — `stale_context_retry_storm`

**What it catches:** an AI coding agent is about to perform another paid action while recent history shows the same deterministic failure repeating without new evidence.

**Required precondition:**

```
history.failure_signal_present === true
```

Without an objective failure signal (test failure, build error, exception, http error, validation error, etc.), this detector does not fire. Creative iteration, writing, planning and analysis loops do **not** trigger it.

**Strong signals:**

```
same_failure_count >= 5
paid_attempts_on_same_failure >= 5
new_evidence_since_last_attempt === false
no files read, no tests run, no logs refreshed
git diff unchanged
context source unconfirmed
model escalation to a more expensive model
```

**Decision policy:**

- `>=3` same-failure repeats with no evidence → `warn`
- `>=5` repeats near/exceeded budget → `require_confirmation`
- `>=10` repeats with hard budget breached → `block` (deterministic)

---

## Decision philosophy

```
allow by default
warn when suspicious
require_confirmation when high-risk but not deterministic
block only when deterministic or extremely high-confidence
```

**Why this asymmetry:** a false `block` makes the operator rip the middleware out. A false `allow` is forgiven because the operator still has the warning and the logs. The most useful output is usually an actionable warning, not a prohibition.

If confidence is below `0.50` and no deterministic blocker fires, the decision is `uncertain` regardless of the raw score. Operators can route uncertain results through a `/v1/check-deep` semantic pass or fall back to telemetry collection.

---

## Universal evidence model

Coding-specific telemetry never lives at the top of the Core schema. The Core consumes:

- `evidence_kind: "code" | "web" | "api" | "media" | "browser" | "payment" | "generic"`
- `evidence_signals: Record<string, EvidenceSignalValue>` (adapter-defined)
- `new_evidence_since_last_attempt: boolean | null` (the universal contract)

Adapters decide what counts as evidence for their domain:

| Adapter | "New evidence" means |
| --- | --- |
| OpenClaw / Hermes (code) | files read, tests run, logs inspected, git diff changed |
| LiteLLM / OpenRouter (api) | response body changed, status changed, cache key changed |
| Browser / scraper (web) | new URLs, new source domains, page hash changed |
| Media generation | prompt changed meaningfully, output hash changed |

The detector only consumes the universal boolean. Adding a runtime never requires a Core change.

---

## Stateless Core

The Core is a pure function:

```ts
runCheck(input: SpendingGuardCheckInput): SpendingGuardCheckOutput
```

No database. No persisted objective state. No idempotency keys. No multi-tenancy in v0.1.

Adapters track history. Operators send the resulting universal payload. The Core judges.

This is what keeps `/v1/check` cheap enough for the hot path.

---

## Output contract

Every response includes:

```jsonc
{
  "decision": "warn",                                      // assessment
  "recommended_policy": "ask_human",                       // SDK action hint
  "risk_score": 87,                                        // 0–100, capped
  "risk_level": "high",                                    // bucket
  "confidence": 0.88,                                      // base × coverage × signal_quality
  "pattern": "stale_context_retry_storm",                  // top-contribution detector
  "matched_rules": ["...", "..."],                         // union across detectors
  "reason": "7+ paid attempts on the same build_error...", // human-readable
  "suggested_action": { "type": "context_refresh", "message": "..." },
  "hard_block": false,
  "requires_human_confirmation": true,
  "metadata": { ... },
  "detector_version": "stale_context_retry_storm@0.1.0",   // pin or compare
  "policy_version": "policy@0.1.0"                         // pin or compare
}
```

Legal `(decision, recommended_policy)` pairs are validated inside Core. Illegal combinations throw — they cannot be emitted.

---

## False-positive fence

`stale_context_retry_storm` must not fire on legitimate iteration. The required `failure_signal_present === true` precondition exists exactly for this.

Examples that **must not** trigger:

- writer rewriting a paragraph 7 times
- planner refining a strategy
- analyst doing multiple reasoning passes
- designer iterating on prompt variants
- brainstorming agent iterating without a deterministic failure

This is enforced in the detector code and asserted by tests.

---

## What's next (not in Stage 0.1)

| Stage | Theme |
| --- | --- |
| 0.2 | Second adapter (LiteLLM or x402), deep-check LLM judgment, decision-log analytics |
| 0.3 | Paid `/v1/check` via x402, marketplace listing, threshold tuning UI |
| 1.0 | Hosted SaaS, decision-log dashboards, policy versioning UX |

Sober Builder (the human-facing brand), Builder Mode, Family Mode and Stop Ritual are downstream of paying customers on Spending Guard.
