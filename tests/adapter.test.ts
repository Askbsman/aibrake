import { describe, expect, it } from "vitest";
import { OpenClawAdapter } from "../src/adapters/openclaw/index.js";
import { runCheck } from "../src/core/check.js";
import { setLoggerSink } from "../src/core/logger.js";
import { spendingGuardCheckInputSchema } from "../src/core/schemas.js";
import type { AgentActionTelemetry } from "../src/adapters/openclaw/types.js";

setLoggerSink({ emit: () => {} });

function evt(overrides: Partial<AgentActionTelemetry> = {}): AgentActionTelemetry {
  return {
    actionId: "act_" + Math.random().toString(16).slice(2, 10),
    objectiveId: "obj_ts_build",
    runtime: "openclaw",
    actionType: "paid_llm_call",
    toolName: "claude",
    provider: "anthropic",
    model: "claude-opus",
    estimatedCostUsd: 0.42,
    reason: "fix typescript build error",
    errorFingerprint: "ts2307",
    failureSignalPresent: true,
    failureSignalType: "build_error",
    errorCode: "TS2307",
    errorMessage: "Cannot find module '../payments/payment-guard'",
    failingFile: "src/core/check.ts",
    filesRead: [],
    testsRun: [],
    logsRead: [],
    gitDiffChanged: false,
    toolResultsChanged: false,
    contextSourceConfirmed: false,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("OpenClawAdapter", () => {
  it("computes same_failure_count from recorded events", () => {
    const a = new OpenClawAdapter();
    for (let i = 0; i < 5; i += 1) a.record(evt());
    const input = a.buildCheckInput(evt());
    expect(input.history?.same_failure_count).toBe(5);
  });

  it("flags new_evidence_since_last_attempt = false when no files/tests/logs touched", () => {
    const a = new OpenClawAdapter();
    for (let i = 0; i < 3; i += 1) a.record(evt());
    const input = a.buildCheckInput(evt());
    expect(input.history?.new_evidence_since_last_attempt).toBe(false);
  });

  it("flags new_evidence_since_last_attempt = true after files were read between attempts", () => {
    const a = new OpenClawAdapter();
    a.record(evt());
    a.record(evt({ filesRead: ["src/foo.ts"] }));
    const input = a.buildCheckInput(evt());
    expect(input.history?.new_evidence_since_last_attempt).toBe(true);
  });

  it("flags new_evidence_since_last_attempt = true after git diff changed", () => {
    const a = new OpenClawAdapter();
    a.record(evt());
    a.record(evt({ gitDiffChanged: true }));
    const input = a.buildCheckInput(evt());
    expect(input.history?.new_evidence_since_last_attempt).toBe(true);
  });

  it("produces a valid /v1/check payload that passes Zod validation", () => {
    const a = new OpenClawAdapter();
    a.record(evt());
    const input = a.buildCheckInput(evt(), {
      objective: {
        id: "obj_ts_build",
        budget: { amount: 5, currency: "USD", hardLimit: false },
      },
      spend: { spentOnObjectiveUsd: 0.42 },
    });
    const parsed = spendingGuardCheckInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it("keeps coding-specific signals inside evidence_signals (not as top-level Core fields)", () => {
    const a = new OpenClawAdapter();
    a.record(evt());
    const input = a.buildCheckInput(evt({ filesRead: [] }));
    // None of these are top-level keys.
    expect((input.history as Record<string, unknown>).files_read_since_last_attempt).toBeUndefined();
    expect((input.history as Record<string, unknown>).tests_run_since_last_attempt).toBeUndefined();
    expect((input.history as Record<string, unknown>).git_diff_changed_since_last_attempt).toBeUndefined();
    expect(input.history?.evidence_kind).toBe("code");
    expect(input.history?.evidence_signals?.files_read_since_last_attempt).toBe(0);
  });

  it("end-to-end: 7 paid attempts on same build error → runCheck returns warn/require_confirmation", () => {
    const a = new OpenClawAdapter();
    for (let i = 0; i < 6; i += 1) a.record(evt());
    const input = a.buildCheckInput(evt(), {
      objective: {
        id: "obj_ts_build",
        budget: { amount: 5, currency: "USD", hardLimit: false },
      },
      spend: { spentOnObjectiveUsd: 4.5 },
    });
    const out = runCheck(input);
    expect(out.pattern).toBe("stale_context_retry_storm");
    expect(["warn", "require_confirmation"]).toContain(out.decision);
  });

  it("reset() clears in-memory history for an objective", () => {
    const a = new OpenClawAdapter();
    a.record(evt());
    a.record(evt());
    expect(a.history("obj_ts_build").length).toBe(2);
    a.reset("obj_ts_build");
    expect(a.history("obj_ts_build").length).toBe(0);
  });
});
