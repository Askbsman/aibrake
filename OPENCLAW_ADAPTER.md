# OpenClaw / Hermes-style Adapter

## What it does

The adapter translates **runtime telemetry** (one event per agent action) into the **universal Spending Guard Core input**.

```
record(event1)
record(event2)
record(event3)
...
buildCheckInput(nextEvent, { objective, spend }) ─► SpendingGuardCheckInput
                                                       │
                                                       ▼
                                                  Core.runCheck() / SDK
```

The adapter is **stateful** at the adapter layer. The Core remains stateless. This separation is non-negotiable.

In Stage 0.1, history is stored in memory per process. Production-grade persistence is a later concern; the adapter API does not need to change for it.

---

## Telemetry shape

```ts
interface AgentActionTelemetry {
  actionId: string;
  runId?: string;
  objectiveId?: string;             // history is keyed on this
  runtime?: "openclaw" | "hermes" | "custom" | string;
  actionType: string;               // e.g. "paid_llm_call"
  toolName?: string;
  provider?: string;
  model?: string;
  estimatedCostUsd?: number;
  reason?: string;
  inputFingerprint?: string;
  outputFingerprint?: string;
  errorFingerprint?: string;        // adapter computes one if absent
  failureSignalPresent?: boolean;
  failureSignalType?: FailureSignalType;
  failingFile?: string;
  failingTest?: string;
  errorCode?: string;
  errorMessage?: string;
  filesRead?: string[];
  testsRun?: string[];
  logsRead?: string[];
  toolResultsChanged?: boolean;
  gitDiffChanged?: boolean;
  contextSourceConfirmed?: boolean;
  confidenceBefore?: number;
  confidenceAfter?: number;
  timestamp: string;
}
```

Every field except `actionId`, `actionType` and `timestamp` is optional. Missing fields lower confidence in the resulting Core check; they do **not** make the adapter throw.

---

## Mapping to Core

The adapter produces a universal Core input by:

1. **Counting same-action attempts.** Same `actionFingerprint` (action_type + tool + provider + model + reason + objective_id) → `same_action_count`.
2. **Counting same-failure attempts.** Same `failureFingerprint` → `same_failure_count`. Subset with non-zero cost → `paid_attempts_on_same_failure`.
3. **Computing `new_evidence_since_last_attempt`.** From the last same-failure event onward (inclusive), did the agent read files, run tests, refresh logs, or change git diff/tool results?
4. **Setting `evidence_kind: "code"`** and packing coding-specific signals under `history.evidence_signals` (files_read_since_last_attempt, tests_run_since_last_attempt, etc.).
5. **Carrying `confidence_delta = confidenceAfter - confidenceBefore`** when available.

The resulting payload validates cleanly against `spendingGuardCheckInputSchema` (Zod). The Core never sees coding-domain fields as top-level keys.

---

## Why "inclusive slice"

When computing `new_evidence_since_last_attempt`, the adapter looks at events **starting at and including** the last same-failure event, not strictly after.

Rationale: the activities of the last same-failure attempt (the files it read, the tests it ran) are the evidence the agent gathered *for the next attempt*. Excluding them would mean: agent reads files in attempt N, fails again, attempt N+1 is judged as if attempt N did nothing. That breaks intuition and the demo case.

See `src/adapters/openclaw/adapter.ts` `sliceSince()`.

---

## Example

```ts
import { OpenClawAdapter } from "spending-guard/adapters/openclaw";
import { runCheck } from "spending-guard";

const adapter = new OpenClawAdapter();

// Record completed actions
adapter.record({
  actionId: "act_1",
  objectiveId: "obj_ts_build",
  actionType: "paid_llm_call",
  provider: "anthropic",
  model: "claude-opus",
  estimatedCostUsd: 0.4,
  failureSignalPresent: true,
  failureSignalType: "build_error",
  errorCode: "TS2307",
  errorMessage: "Cannot find module '../payments/payment-guard'",
  failingFile: "src/core/check.ts",
  filesRead: [],
  testsRun: [],
  gitDiffChanged: false,
  timestamp: new Date().toISOString(),
});
// ... 5 more identical attempts ...

// Build the pre-flight check for the next planned attempt
const input = adapter.buildCheckInput(
  {
    actionId: "act_7",
    objectiveId: "obj_ts_build",
    actionType: "paid_llm_call",
    provider: "anthropic",
    model: "claude-opus",
    estimatedCostUsd: 0.42,
    failureSignalPresent: true,
    failureSignalType: "build_error",
    errorCode: "TS2307",
    errorMessage: "Cannot find module '../payments/payment-guard'",
    timestamp: new Date().toISOString(),
  },
  {
    objective: {
      id: "obj_ts_build",
      goal: "Fix failing TypeScript build",
      budget: { amount: 5, currency: "USD", hardLimit: false },
    },
    spend: { spentOnObjectiveUsd: 4.5 },
  }
);

const result = runCheck(input);
// → decision: "warn" or "require_confirmation", pattern: "stale_context_retry_storm"
```

---

## Missing telemetry behavior

Sparse telemetry is normal in early integrations.

- `null` and `undefined` count as *missing* (never zero).
- Each missing recommended field lowers `coverage_ratio` for the matched detector.
- Missing `telemetry_quality` defaults `signal_quality_multiplier` to `0.6`.
- The product of these factors can push detector `confidence` below `0.50`, at which point the decision is `uncertain` regardless of risk score.

Operators who want stronger decisions should send more signals. Operators who can't should accept `decision: "uncertain"` and route through `/v1/check-deep` or human review.

---

## Integration checklist

- [ ] Wire `adapter.record(event)` at the end of every paid action.
- [ ] Wire `const input = adapter.buildCheckInput(plannedNext, descriptors)` immediately before the next paid action.
- [ ] Call `guard.checkOrConfirm(input, { onWarn })` (recommended) or `guard.check(input)` (raw).
- [ ] On `decision: "block"`, abort the next paid action and surface the reason to the operator/user.
- [ ] On `decision: "warn"` or `"require_confirmation"`, present `result.suggested_action.message` and await human confirmation (or downgrade automatically with `checkOrDowngrade`).
- [ ] Persist the recommendation outcome (followed / overridden) for offline tuning.

---

## What is NOT in the OpenClaw adapter (Stage 0.1)

- Cross-process history (single-process in-memory only)
- LLM-based semantic objective-drift judgment
- Domain-specific telemetry for browser, API, media or research agents — those land in their own adapters
- Hermes-specific telemetry shape — `HermesAdapter` is currently an alias of `OpenClawAdapter`; it gains its own surface when Hermes telemetry diverges
