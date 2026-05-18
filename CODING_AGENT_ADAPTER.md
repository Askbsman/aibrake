# CODING_AGENT_ADAPTER.md

> **For: operators integrating AIBrake into Claude Code, Codex, Cursor, or any coding-agent runtime.**

The coding-agent adapter is `src/adapters/coding-agent/`. It is intentionally a thin re-export of `OpenClawAdapter` (the Stage 0.1 reference adapter) — the universal evidence model means the adapter logic is the same across coding-agent runtimes. **What differs between runtimes is the event translator**, not the adapter.

This document covers (1) the adapter surface, (2) the translator pattern, and (3) two ready translators (Claude Code, Codex) you can copy and adapt.

---

## 1. Adapter surface

```ts
import { CodingAgentAdapter } from "spending-guard";
// or, equivalently:
import { OpenClawAdapter } from "spending-guard";

const adapter = new CodingAgentAdapter();
```

Three methods:

| Method | Purpose |
| --- | --- |
| `adapter.record(event: AgentActionTelemetry)` | Append a completed action to per-objective history. |
| `adapter.buildCheckInput(plannedEvent, { objective, spend, enabledDetectors? })` | Produce the universal `SpendingGuardCheckInput` payload for the planned action, using accumulated history. |
| `adapter.history(objectiveId?)` / `adapter.reset(objectiveId?)` | Inspect or clear in-memory history (single-process). |

The adapter is **stateful per process** in 0.4. For multi-process deploys, recompute history on each request from your own session store and feed the resulting payload directly to `runCheck` / `/v1/check` without going through the adapter.

---

## 2. The translator pattern

Every coding-agent runtime emits its own shape of lifecycle events. The translator is a single function that maps a runtime event to an `AgentActionTelemetry`:

```ts
function translate<RuntimeEvent>(event: RuntimeEvent, objectiveId: string): AgentActionTelemetry {
  // 1. Decide whether this event is a paid action or an investigation step
  // 2. Extract failure signal if present (test failure, build error, exception)
  // 3. Populate filesRead / testsRun / logsRead / gitDiffChanged from the event
  // 4. Return a universal AgentActionTelemetry shape
}
```

You write a translator per runtime. The adapter and the SDK never change.

See `examples/coding-agent-integration.ts` for two reference translators (Claude Code, Codex) and a runnable retry-storm demo.

---

## 3. Wiring (5-step pattern)

```ts
import { CodingAgentAdapter, SpendingGuard } from "spending-guard";

const adapter = new CodingAgentAdapter();
const guard = new SpendingGuard({
  baseUrl: process.env.AGENT_SPEND_GUARD_URL!,
  apiKey: process.env.AGENT_SPEND_GUARD_API_KEY!,
  failureMode: "open",       // CRITICAL
});

// 1. Subscribe to your runtime's lifecycle events.
runtime.on("event", async (event) => {
  // 2. Translate the event.
  const telemetry = translateMyRuntimeEvent(event, currentObjectiveId);

  // 3. For non-paid events (test runs, file reads), record into history.
  if (event.type !== "model_call") {
    adapter.record(telemetry);
    return;
  }

  // 4. For paid model calls, BUILD the check input first.
  const input = adapter.buildCheckInput(telemetry, {
    objective: { id: currentObjectiveId, goal: ..., budget: ... },
    spend: { spentOnObjectiveUsd: ... },
  });

  // 5. Call the guard before the model call fires.
  const result = await guard.checkShadow(input);
  logDecision(result);

  // Shadow mode: proceed regardless. After 7 days of clean logs, promote to
  // guard.checkOrDowngrade(...) for auto-routing.
  adapter.record(telemetry);
});
```

---

## 4. Carrying failure context onto planned model calls

**Critical pattern.** When the agent plans a paid model call to address a failure, the planned `AgentActionTelemetry` must carry the failure signal of what it is fixing — not just the model call's own fields. Otherwise the adapter cannot link the model call to the recurring failure:

```ts
const plannedModelCall: AgentActionTelemetry = {
  actionId: ...,
  actionType: "paid_llm_call",
  provider: "anthropic",
  model: "claude-opus",
  modelRole: "primary",
  modelTier: "premium",
  estimatedCostUsd: 0.42,

  // ← these come from the failure the agent is trying to fix,
  //   NOT from the model call itself (which hasn't run yet):
  failureSignalPresent: true,
  failureSignalType: "test_failure",
  errorCode: "ASSERT_FAIL",
  errorMessage: "expected 42 received undefined",
  failingFile: "src/service.ts",
  failingTest: "service.spec.ts > computes total",

  // Investigation done since the last attempt — empty arrays here mean
  // the agent did NOT investigate between attempts (retry-storm pattern).
  filesRead: [],
  testsRun: [],
  logsRead: [],
  gitDiffChanged: false,
  contextSourceConfirmed: false,
  timestamp: new Date().toISOString(),
};
```

Without this enrichment, the planned model call has no failure fingerprint, and `same_failure_count` never increments across attempts. `stale_context_retry_storm` will not fire.

---

## 5. Cold-start convention

The first `buildCheckInput()` call on a fresh objective with no recorded events produces `new_evidence_since_last_attempt: null` (not `false`). This is correct — there is no prior attempt to compare against.

If you bypass the adapter and hand-roll payloads, follow the same convention: send `null` on attempt 1, `false` only after at least one prior attempt has been recorded.

---

## 6. Runtime-specific translator hints

### Claude Code

Subscribe to `tool_use` events plus exit codes. Failed `run_bash` / `run_test` actions have `exit_code !== 0`. Read the per-event `files_read` field if your wrapper exposes it; otherwise infer from `tool === "read_file"`.

Model calls in Claude Code typically look like `tool: "model_call"` with the model name in args. Set `modelRole: "primary"` and `modelTier: "premium"` if the operator has configured Claude 4.x / Opus as their primary.

### Codex (OpenAI Assistants / Responses API tool use)

The event shape is `{ type: "tool_use" | "model_call" | "error" }` with structured `input`. Model calls are explicit; failures are signaled via `type: "error"` events with an `error` string. The translator pattern is identical to Claude Code — just different event field names.

### Cursor

Cursor's agent emits commands via a JSON-RPC-style channel. The translator subscribes to the same lifecycle (file-read, run-command, run-test, model-call) and emits universal `AgentActionTelemetry`.

### Custom wrappers

If your wrapper does not emit events, recompute the telemetry shape from your session log at integration time. Send it to `adapter.record()` retroactively before the first `buildCheckInput()`. The adapter's history is just a list of past events.

---

## 7. Two patterns from the simulated 3-partner validation

These came up in `validation-log/` and shaped the 0.3.1 / 0.4 work. Worth knowing before integration:

1. **Don't double-count "investigation" if the agent only re-runs the same failing test.** The detector treats `testsRun.length > 0` as "evidence gathered" — but if the agent runs the same test that's been failing for 6 attempts, it has not learned anything. Translators should set `testsRun: []` for "ran the same failing test again," and only populate when the agent ran a DIFFERENT test or a refreshed suite.

2. **Carry `failure_fingerprint` consistently.** The fingerprint is computed from `failureSignalType + errorCode + normalizedMessage + failingFile + failingTest`. If your translator normalizes any of these differently across events, `same_failure_count` will reset silently. Use the same normalization function across all events from the same runtime.

---

## 8. Tests

The adapter is exercised by:

- `tests/adapter.test.ts` — 8 unit tests covering history tracking, fingerprint stability, Zod-valid payload generation.
- `examples/coding-agent-integration.ts` — runnable retry-storm demo against a live server.
- `openclaw-harness/` — 5 demo scenarios (retry-storm, healthy-debug, web-search-loop, cold-start, premium-model-loop, scraper-loop) all wired through `CodingAgentAdapter`.

Run the live demo:

```bash
cd openclaw-harness
AGENT_SPEND_GUARD_URL=http://localhost:8080 \
AGENT_SPEND_GUARD_API_KEY=asg_v1_demo \
npm run demo:retry-storm
```

---

## 9. What this adapter does NOT do

- Multi-process history sharing (Redis/DB). Stage 0.4 is single-process in-memory only.
- Automatic translator generation for new runtimes. You write the translator; we maintain the adapter.
- Decision logging (the server writes JSONL).
- Retry / backoff on transport failure (the SDK does that via `failureMode`).
- LLM-based semantic analysis (`/v1/check-deep` is still a stub).
