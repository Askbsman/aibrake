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

---

## 7. Branching on structured error kinds (Stage 0.5)

Every SDK error now carries a `details` block (TS) or structured attributes (Python) so you can branch on a discriminator instead of importing every subclass.

**TypeScript:**

```ts
import { SpendingGuard, SpendingGuardBlockedError } from "spending-guard/sdk";

const guard = new SpendingGuard({
  baseUrl: "https://spending-guard.example.com",
  apiKey: process.env.ASG_KEY,
  failureMode: "throw",  // propagate so we can branch
});

try {
  await guard.check(input);
} catch (err) {
  const d = (err as { details?: { kind?: string; statusCode?: number; retryable?: boolean } }).details;
  switch (d?.kind) {
    case "transport":
    case "http_5xx":
      metrics.incr("guard.transient");        // retry candidate
      break;
    case "validation":
      logger.error({ status: d.statusCode }, "bad payload — fix integration");
      throw err;                              // surface to dev
    case "http_4xx":
      if (d.statusCode === 401) rotateApiKey();
      else throw err;
      break;
    case "blocked":
      const { result } = err as SpendingGuardBlockedError;
      pageOperator(result);
      break;
    case "confirmation_denied":
      logger.warn("operator denied confirmation");
      break;
    default:
      throw err;
  }
}
```

**Python:**

```py
from agent_spend_guard import AgentSpendGuard, SpendingGuardError

guard = AgentSpendGuard(base_url="...", api_key="...", failure_mode="throw")

try:
    guard.check(payload)
except SpendingGuardError as err:
    if err.kind in ("transport", "http_5xx"):
        metrics.incr("guard.transient")          # retry candidate
    elif err.kind == "validation":
        log.error("bad payload (HTTP %s) — fix integration", err.status_code)
        raise
    elif err.kind == "http_4xx" and err.status_code == 401:
        rotate_api_key()
    elif err.kind == "blocked":
        page_operator(err.result)                # err.result is the structured response
    elif err.kind == "confirmation_denied":
        log.warning("operator denied confirmation")
    else:
        raise
```

`err.details?.retryable` (TS) / `err.retryable` (Python) is a hint for retry loops: it is `true` for transport, 5xx, and 429 (rate limit) — `false` for everything else.
