// Coding-agent integration example (Stage 0.4).
//
// Shows how to wire ANY coding-agent runtime — Claude Code, Codex, Cursor,
// custom wrapper — into AIBrake's shadow mode in two steps:
//
//   1. Translate the runtime's lifecycle events into AgentActionTelemetry.
//   2. Feed events into CodingAgentAdapter; call SpendingGuard.checkShadow()
//      before each paid LLM call.
//
// The translator is what differs between Claude Code and Codex (and Cursor,
// and any other coding-agent surface). The adapter and the SDK are the same.
//
// Run:
//   AGENT_SPEND_GUARD_URL=http://localhost:8080 \
//   AGENT_SPEND_GUARD_API_KEY=asg_v1_demo \
//   npx tsx examples/coding-agent-integration.ts

import { CodingAgentAdapter, SpendingGuard } from "../src/index.js";
import type { AgentActionTelemetry } from "../src/adapters/openclaw/types.js";

// ────────────────────────────────────────────────────────────────────────
// Translators — one per runtime. Pick the one for your stack.
// ────────────────────────────────────────────────────────────────────────

// Claude Code emits tool_use events plus error_output records. A real wrapper
// would subscribe to its SDK events; here we accept a shape that mirrors what
// the runtime would yield.
interface ClaudeCodeToolEvent {
  tool: "read_file" | "edit_file" | "run_bash" | "run_test" | "model_call";
  args?: { command?: string; file?: string; model?: string };
  exit_code?: number;
  stderr?: string;
  timestamp: string;
}

export function translateClaudeCodeEvent(
  event: ClaudeCodeToolEvent,
  objectiveId: string
): AgentActionTelemetry {
  const isModelCall = event.tool === "model_call";
  const failed = (event.exit_code ?? 0) !== 0;
  return {
    actionId: `cc_${event.timestamp}`,
    objectiveId,
    runtime: "claude-code",
    actionType: isModelCall ? "paid_llm_call" : "tool_call",
    toolName: isModelCall ? event.args?.model ?? "claude" : event.tool,
    provider: isModelCall ? "anthropic" : undefined,
    model: isModelCall ? event.args?.model : undefined,
    modelRole: isModelCall ? "primary" : undefined,
    modelTier: isModelCall ? "premium" : undefined,
    estimatedCostUsd: isModelCall ? 0.42 : 0,
    reason: event.args?.command ?? event.tool,
    failureSignalPresent: failed,
    failureSignalType: failed ? "command_error" : undefined,
    errorCode: failed ? `exit_${event.exit_code}` : undefined,
    errorMessage: event.stderr,
    filesRead: event.tool === "read_file" && event.args?.file ? [event.args.file] : [],
    testsRun: event.tool === "run_test" ? [event.args?.command ?? "test"] : [],
    logsRead: [],
    gitDiffChanged: false,
    toolResultsChanged: false,
    contextSourceConfirmed: event.tool === "read_file",
    timestamp: event.timestamp,
  };
}

// Codex / generic OpenAI tool-use events have a slightly different shape;
// translator pattern is the same.
interface CodexToolUseEvent {
  type: "tool_use" | "model_call" | "error";
  name?: string;
  input?: Record<string, unknown>;
  error?: string;
  timestamp: string;
}

export function translateCodexEvent(
  event: CodexToolUseEvent,
  objectiveId: string
): AgentActionTelemetry {
  const isModelCall = event.type === "model_call";
  const failed = event.type === "error";
  return {
    actionId: `cx_${event.timestamp}`,
    objectiveId,
    runtime: "codex",
    actionType: isModelCall ? "paid_llm_call" : "tool_call",
    toolName: event.name ?? "unknown",
    provider: isModelCall ? "openai" : undefined,
    model: isModelCall ? "gpt-4" : undefined,
    modelRole: isModelCall ? "primary" : undefined,
    modelTier: isModelCall ? "premium" : undefined,
    estimatedCostUsd: isModelCall ? 0.30 : 0,
    reason: typeof event.input?.["query"] === "string" ? (event.input["query"] as string) : event.name,
    failureSignalPresent: failed,
    failureSignalType: failed ? "tool_error" : undefined,
    errorMessage: event.error,
    timestamp: event.timestamp,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Wire it together
// ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const adapter = new CodingAgentAdapter();
  const guard = new SpendingGuard({
    baseUrl: process.env.AGENT_SPEND_GUARD_URL ?? "http://localhost:8080",
    apiKey: process.env.AGENT_SPEND_GUARD_API_KEY ?? "asg_v1_demo",
    failureMode: "open",
    timeoutMs: 1000,
  });

  // Canonical Claude-Code-style retry storm: agent keeps making paid Claude
  // Opus calls trying to fix the same failing test, WITHOUT reading new
  // files, running tests, or refreshing context between attempts.
  //
  // CRITICAL integration pattern: each planned paid model call carries the
  // FULL failure context (failure_fingerprint inputs) of the failure it is
  // addressing. The adapter uses that to count same_failure_count across
  // attempts. Without this, the agent looks like it is making isolated paid
  // calls with no shared failure, and no retry-storm detector fires.
  const objectiveId = "obj_fix_failing_test";
  for (let i = 1; i <= 6; i += 1) {
    const planned: AgentActionTelemetry = {
      actionId: `act_model_call_${i}`,
      objectiveId,
      runtime: "claude-code",
      actionType: "paid_llm_call",
      toolName: "claude",
      provider: "anthropic",
      model: "claude-opus",
      modelRole: "primary",
      modelTier: "premium",
      estimatedCostUsd: 0.42,
      reason: "fix failing test",
      // The failure context the model call is trying to address — used by
      // failureFp() to compute a stable fingerprint across attempts.
      failureSignalPresent: true,
      failureSignalType: "test_failure",
      errorCode: "ASSERT_FAIL",
      errorMessage: "expected 42 received undefined",
      failingFile: "src/service.ts",
      failingTest: "service.spec.ts > computes total",
      // No investigation between attempts — this is the retry-storm pattern.
      filesRead: [],
      testsRun: [],
      logsRead: [],
      gitDiffChanged: false,
      toolResultsChanged: false,
      contextSourceConfirmed: false,
      timestamp: new Date(Date.now() - (7 - i) * 60_000).toISOString(),
    };

    const input = adapter.buildCheckInput(planned, {
      objective: {
        id: objectiveId,
        goal: "Fix the failing 'computes total' test",
        budget: { amount: 5, currency: "USD", hardLimit: false },
        // Per-request threshold tuning (Stage 0.4). Default is 3; uncomment
        // to surface the loop earlier for a high-cost setup.
        // detectorPolicy: { premium_retry_without_evidence_threshold: 2 },
      },
      spend: { spentOnObjectiveUsd: 0.42 * (i - 1) },
    });

    const result = await guard.checkShadow(input);
    // eslint-disable-next-line no-console
    console.log(
      `[planned call #${i}] decision=${result.decision} pattern=${result.pattern} reason="${result.reason.slice(0, 140)}"`
    );

    // Shadow mode: execute the planned call regardless of the guard verdict.
    adapter.record(planned);
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /coding-agent-integration\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
