# Examples

## 1. The $40 TypeScript Retry Storm

Runnable demo:

```bash
npx tsx examples/40-dollar-retry-storm.ts
```

Source: [`examples/40-dollar-retry-storm.ts`](./examples/40-dollar-retry-storm.ts).

A coding agent has made 6 paid Claude Opus calls trying to fix the same `TS2307: Cannot find module` build error. No files have been read since attempt 2. No test has been rerun. The git diff hasn't moved. The agent is about to make the 7th paid call.

Spending Guard returns a `warn` / `require_confirmation` decision with `recommended_policy: "ask_human"` and suggests refreshing context before another paid retry.

JSON payload: [`examples/the-40-dollar-retry-storm.json`](./examples/the-40-dollar-retry-storm.json).

```bash
curl -s -X POST http://localhost:3000/v1/check \
  -H "content-type: application/json" \
  -d @examples/the-40-dollar-retry-storm.json | jq
```

---

## 2. In-process SDK (no network hop)

```ts
import { SpendingGuard } from "spending-guard";

const guard = new SpendingGuard();   // in-process Core

const result = await guard.check({
  actor: { type: "agent", runtime: "openclaw" },
  next_action: {
    type: "paid_llm_call",
    provider: "anthropic",
    model: "claude-opus",
    estimated_cost: { amount: 0.42, currency: "USD" },
  },
  objective: {
    id: "obj_ts_build",
    budget: { amount: 5, currency: "USD", hard_limit: false },
  },
  history: {
    attempt_number: 7,
    paid_attempts_on_same_failure: 6,
    failure_signal_present: true,
    failure_signal_type: "build_error",
    failure_fingerprint: "fp_v1_failure_ts2307",
    same_failure_count: 6,
    new_evidence_since_last_attempt: false,
    evidence_kind: "code",
    evidence_signals: {
      files_read_since_last_attempt: 0,
      tests_run_since_last_attempt: 0,
      git_diff_changed_since_last_attempt: false,
    },
  },
  spend: { spent_on_objective: { amount: 4.5, currency: "USD" } },
  telemetry_quality: { completeness: "high" },
});

console.log(result.decision, result.pattern, result.reason);
```

---

## 3. Auto-downgrade on model escalation

```ts
import { SpendingGuard, SpendingGuardBlockedError } from "spending-guard";

const guard = new SpendingGuard({ baseUrl: process.env.GUARD_URL });

try {
  const { action } = await guard.checkOrDowngrade(input, {
    downgradeTo: { provider: "anthropic", model: "claude-haiku", estimatedCost: 0.01 },
    onDowngrade: async (result, downgraded) => {
      console.warn(`Downgrading to ${downgraded.model} because ${result.reason}`);
    },
  });
  await runAction(action);  // possibly downgraded
} catch (err) {
  if (err instanceof SpendingGuardBlockedError) {
    console.error("Guard blocked the action:", err.result.reason);
    return;
  }
  throw err;
}
```

---

## 4. Shadow mode for evaluating false positives

```ts
const guard = new SpendingGuard({ baseUrl: process.env.GUARD_URL });

const result = await guard.checkShadow(input);
console.log("would have:", result.decision, result.pattern);

await runAction(input.next_action);  // shadow mode never blocks
```

---

## 5. OpenClaw adapter end-to-end

```ts
import { OpenClawAdapter } from "spending-guard/adapters/openclaw";
import { SpendingGuard } from "spending-guard";

const adapter = new OpenClawAdapter();
const guard = new SpendingGuard();

async function attempt(plannedAction) {
  const input = adapter.buildCheckInput(plannedAction, {
    objective: {
      id: "obj_ts_build",
      budget: { amount: 5, currency: "USD", hardLimit: false },
    },
    spend: { spentOnObjectiveUsd: spentSoFar() },
  });

  await guard.checkOrConfirm(input, {
    onWarn: async (r) => confirmWithHuman(r),
  });

  const outcome = await runAction(plannedAction);
  adapter.record({ ...plannedAction, ...outcome });
}
```

---

## 6. Failure mode (fail-open default)

```ts
const guard = new SpendingGuard({
  baseUrl: "https://spending-guard.example.com",
  failureMode: "open",   // default; synthetic allow on guard errors
  timeoutMs: 500,
  onFailureOpen: (err) => metrics.incr("guard.failure_open"),
});
```

If Spending Guard is unreachable, `guard.check()` returns:

```jsonc
{
  "decision": "allow",
  "pattern": "guard_unavailable",
  "confidence": 0,
  "error": { "code": "GUARD_UNAVAILABLE", "message": "..." }
}
```

The operator's agent keeps working. The failure is logged through both the result error field and the `onFailureOpen` callback.
