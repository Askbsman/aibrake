# Agent Spend Guard

> **Loop detection and model stop-loss for paid AI agents.**
>
> **PQS checks the prompt. Agent Spend Guard checks the loop.**

> **Status:** Stage 0.4.2 TypeScript SDK fail-open scope hotfix
> **Base:** `spending-guard-v0.4.1-beta`
> **Tag:** `spending-guard-v0.4.2-beta`
> **Primary value:** loop detection + structured `primary → secondary` model stop-loss for paid AI agents — both SDKs now propagate programmer errors instead of silent-allowing
> **Mode:** shadow-first
> **Tests:** 148 TS unit + 14 audit + 36 harness actions; 18 Python unit (run via pytest or Docker)
> **SDKs:** TypeScript (`spending-guard`) + Python (`python/agent_spend_guard`)
> **Next step:** hosted beta with first users — see [`INTEGRATION_GUIDE.md`](./INTEGRATION_GUIDE.md), [`PARTNER_ONBOARDING.md`](./PARTNER_ONBOARDING.md), [`PYTHON_SDK.md`](./PYTHON_SDK.md), [`CODING_AGENT_ADAPTER.md`](./CODING_AGENT_ADAPTER.md), [`DEPLOYMENT.md`](./DEPLOYMENT.md)
> **npm package name:** `spending-guard` (historical; product brand is "Agent Spend Guard" — see [`IMPLEMENTATION_NOTES.md § 13`](./IMPLEMENTATION_NOTES.md))

Spending Guard is a provider-agnostic, x402-ready pre-flight judgment middleware for expensive AI agent actions. It checks paid LLM calls, tool retries, model escalations and objective drift **before** execution and tells the operator whether to allow, warn, ask for confirmation, downgrade, delay or block.

This is **not** a budget counter. The product value is judgment:

- Is the agent retrying the same deterministic failure without new evidence?
- Is it escalating to a more expensive model without learning anything new?
- Is it drifting away from the original objective?
- Is another paid call likely to produce real progress, or is it just the 7th guess?

**Don't pay for the 7th guess.**

---

## Stage 0.1 scope

This repository is the **Stage 0.1 MVP**:

- Universal stateless Core API (`/v1/check`, `/v1/check-deep` stub, `/health`)
- TypeScript SDK with three integration patterns (`checkOrConfirm`, `checkOrDowngrade`, `checkShadow`)
- First runtime adapter — `OpenClawAdapter` (also re-exported as `HermesAdapter`)
- First detector — `stale_context_retry_storm`
- Supporting detectors — `task_budget_breach`, `same_tool_retry_loop`, `model_escalation_without_evidence`, `objective_drift`
- Versioned deterministic fingerprints (`fp_v1_*`, `input_v1_*`)
- Structured decision logging
- x402-ready payment abstraction (stub)
- 96+ tests

What is intentionally NOT in this repo:

- Frontend dashboard, auth, database, user accounts
- Full x402 integration (stub only)
- Family Mode, Builder Mode, Sober Builder consumer app
- LLM-based semantic judgment (the deep-check endpoint is a stub)

See [`IMPLEMENTATION_NOTES.md`](./IMPLEMENTATION_NOTES.md) for implementation decisions and [`PRODUCT.md`](./PRODUCT.md) for product positioning.

---

## Quickstart

```bash
npm install
npm run dev         # start Fastify dev server on :3000
npm test            # run 96-test suite
npm run typecheck   # strict typecheck
```

### Call the API directly

```bash
curl -s -X POST http://localhost:3000/v1/check \
  -H "content-type: application/json" \
  -d @examples/the-40-dollar-retry-storm.json | jq
```

### Use the SDK in-process

```ts
import { SpendingGuard } from "spending-guard";

const guard = new SpendingGuard();   // in-process Core; no network hop

const result = await guard.check({
  actor: { type: "agent", runtime: "openclaw", id: "agent_001" },
  next_action: {
    type: "paid_llm_call",
    provider: "anthropic",
    model: "claude-opus",
    estimated_cost: { amount: 0.42, currency: "USD" },
  },
  // ... history + objective + spend
});

console.log(result.decision, result.recommended_policy, result.reason);
```

### Use the SDK against a remote server

```ts
import { SpendingGuard } from "spending-guard";

const guard = new SpendingGuard({
  baseUrl: "https://spending-guard.example.com",
  apiKey: process.env.SPENDING_GUARD_API_KEY,
  timeoutMs: 500,
  failureMode: "open",   // fail-open by default — see below
});
```

### Three SDK helpers (warnings must be actionable)

```ts
// Returns the structured result; never throws on a guard decision.
const result = await guard.check(input);

// Throws SpendingGuardBlockedError on block; calls onWarn on warn/require_confirmation.
await guard.checkOrConfirm(input, {
  onWarn: async (r) => askHumanForConfirmation(r),
});

// Downgrades the model on model-escalation warnings; throws on block.
await guard.checkOrDowngrade(input, {
  downgradeTo: { model: "claude-haiku", estimatedCost: 0.01 },
});

// Never blocks. Logs the decision and returns the result. Use in shadow mode.
await guard.checkShadow(input);
```

### SDK failure modes

If the Spending Guard API is unavailable, the SDK does **not** silently take production agents offline. The default behavior is **fail-open** — a synthetic `allow` result is returned with `pattern: "guard_unavailable"` and `error: { code: "GUARD_UNAVAILABLE" }`.

| `failureMode` | Behavior on guard error |
| --- | --- |
| `"open"` (default) | Synthetic `allow` + telemetry |
| `"closed"` | Synthetic `block` + telemetry |
| `"throw"` | Propagate the error |

Default timeouts: `/v1/check` → 500 ms, `/v1/check-deep` → 5000 ms.

---

## Architecture

```
Runtime telemetry  ──►  Adapter  ──►  Universal Core Input  ──►  Stateless Core
                                                                    │
                                                                    ▼
                                                       Detectors → Aggregation
                                                                    │
                                                                    ▼
                                                       Decision + Policy + Logging
```

- **Core is stateless.** Adapters track history, Core only judges. See `src/core/check.ts`.
- **Adapters are per-runtime.** OpenClaw/Hermes-style coding adapter ships in this repo. Future adapters (LiteLLM, Codex, Cursor, x402, custom) plug into the same Core input shape.
- **Universal evidence model.** Coding-specific telemetry (files read, tests run, git diff) lives under `history.evidence_signals`. The Core schema never bakes in coding-domain assumptions. See [`PRODUCT.md § Evidence model`](./PRODUCT.md).

---

## Project layout

```
src/
  core/                stateless judgment engine
    types.ts             public TypeScript surface
    schemas.ts           Zod input validation
    check.ts             runCheck() — the only thing routes call
    policy.ts            aggregation, legal pairs, score→decision
    confidence.ts        coverage × signal_quality × base
    fingerprints.ts      fp_v1_* / input_v1_* helpers
    logger.ts            pluggable structured log sink
  detectors/
    stale-context-retry-storm.ts   ← first detector
    task-budget-breach.ts          ← deterministic blocker
    same-tool-retry-loop.ts
    model-escalation-without-evidence.ts
    objective-drift.ts
  routes/
    health.ts
    check.ts             POST /v1/check
    check-deep.ts        POST /v1/check-deep (stub)
  sdk/
    client.ts            SpendingGuard class + 3 helpers + failure modes
    errors.ts            SpendingGuardBlockedError / ConfirmationDeniedError
  adapters/
    openclaw/            stateful per-objective history tracker → Core input
    hermes/              alias of openclaw in Stage 0.1
  payments/              x402-ready stubs
tests/                   96 vitest specs
examples/                demo payloads & runnable scripts
```

---

## Demo: the $40 TypeScript Retry Storm

```bash
npx tsx examples/40-dollar-retry-storm.ts
```

A coding agent is about to make the **7th paid Claude Opus call** on the same `TS2307: Cannot find module` error. No files have been read since attempt 2. No test has been rerun. The git diff hasn't moved. Spending Guard catches this before the agent pays again.

Expected output:

```
decision:            warn  (escalates to require_confirmation at higher score)
recommended_policy:  ask_human
pattern:             stale_context_retry_storm
risk_score:          100
reason:              7+ paid attempts observed on the same build_error
                     (6 repeats) without new evidence since attempt 2.
suggested_action:    Before another paid model call, read the actual failing
                     file, run the exact failing test, confirm the current
                     git diff, or downgrade to a cheaper model.
```

---

## Tests

```bash
npm test                  # full suite (96 tests)
npm run typecheck         # strict TS, noUncheckedIndexedAccess
```

Coverage groups:

- Vertical slice (10 tests) — first acceptance bar
- Detectors — stale-context (10), budget (4), objective-drift (4), same-tool-retry (5), model-escalation (3)
- SDK — 13 tests covering all three helpers, failure modes, and timeout
- Adapter — 8 tests covering fingerprint stability, history tracking, Zod-valid payload
- Core — fingerprints (9), aggregation (9), confidence (5), policy/legal-pair (7), logging (5)
- HTTP — health, /v1/check, /v1/check-deep, validation (4)

---

## Versions

- `policy_version`: `policy@0.1.0` (stable)
- `stale_context_retry_storm@0.1.0`
- Fingerprint format: `fp_v1_*` and `input_v1_*`

Pin these in production. They are returned in every `/v1/check` response so operators can detect silent behavior drift.

---

## Roadmap

- **Stage 0.2** — second adapter (LiteLLM or x402), deep-check LLM judgment, decision-log → analytics export, policy versioning UX.
- **Stage 0.3** — paid `/v1/check` via x402, marketplace listing, threshold tuning from decision logs.

Family Mode, Builder Mode and the Sober Builder consumer app are explicitly out of scope until the Spending Guard wedge has validated paying customers.
