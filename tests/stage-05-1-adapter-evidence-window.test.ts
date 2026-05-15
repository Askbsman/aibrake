// Stage 0.5.1 — Adapter evidence-window calibration regression tests.
//
// Pins the fix for self-trial Finding 1 (SELF_TRIAL_CLAUDE_CODE_REPORT.md
// § 4.1, E2). The CodingAgentAdapter's `newEvidence` computation must
// include evidence annotated on the CURRENT attempt, not only evidence
// gathered BETWEEN prior same-failure events. A read-edit-rerun on the
// same failing test is the canonical case: filesRead, testsRun,
// gitDiffChanged, toolResultsChanged, and contextSourceConfirmed all
// belong to the current attempt's annotation and should count.

import { describe, expect, it } from "vitest";
import { OpenClawAdapter } from "../src/adapters/openclaw/index.js";
import { runCheck } from "../src/core/check.js";
import { setLoggerSink } from "../src/core/logger.js";
import type { AgentActionTelemetry } from "../src/adapters/openclaw/types.js";

setLoggerSink({ emit: () => {} });

function failingTestEvt(
  overrides: Partial<AgentActionTelemetry> = {}
): AgentActionTelemetry {
  return {
    actionId: "act_" + Math.random().toString(16).slice(2, 10),
    objectiveId: "obj_python_pytest_green",
    runtime: "claude-code",
    actionType: "tool_call",
    toolName: "bash:pytest",
    provider: "anthropic",
    model: "claude-sonnet-4.5",
    estimatedCostUsd: 0.05,
    reason: "Re-run pytest on the same failing test",
    failureSignalPresent: true,
    failureSignalType: "test_failure",
    failingTest:
      "tests/test_client.py::test_06_check_shadow_swallows_transport_error",
    errorCode: "ASSERTION_ERROR",
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

describe("Stage 0.5.1 — adapter evidence window includes current attempt", () => {
  it("R1: current-attempt filesRead alone makes new_evidence_since_last_attempt = true", () => {
    const a = new OpenClawAdapter();
    // Prior attempt has no evidence — pre-0.5.1 this would have made the
    // window strictly empty and tripped `no_new_evidence` rules.
    a.record(failingTestEvt());
    const input = a.buildCheckInput(
      failingTestEvt({
        filesRead: ["python/agent_spend_guard/client.py"],
      })
    );
    expect(input.history?.new_evidence_since_last_attempt).toBe(true);
    expect(input.history?.evidence_signals?.files_read_since_last_attempt).toBe(1);
  });

  it("R2: current-attempt testsRun alone makes new_evidence_since_last_attempt = true", () => {
    const a = new OpenClawAdapter();
    a.record(failingTestEvt());
    const input = a.buildCheckInput(
      failingTestEvt({ testsRun: ["tests/test_client.py::test_06"] })
    );
    expect(input.history?.new_evidence_since_last_attempt).toBe(true);
    expect(input.history?.evidence_signals?.tests_run_since_last_attempt).toBe(1);
  });

  it("R3: current-attempt gitDiffChanged alone makes new_evidence_since_last_attempt = true", () => {
    const a = new OpenClawAdapter();
    a.record(failingTestEvt());
    const input = a.buildCheckInput(failingTestEvt({ gitDiffChanged: true }));
    expect(input.history?.new_evidence_since_last_attempt).toBe(true);
    expect(input.history?.evidence_signals?.git_diff_changed_since_last_attempt).toBe(
      true
    );
  });

  it("R4: current-attempt toolResultsChanged alone makes new_evidence_since_last_attempt = true", () => {
    const a = new OpenClawAdapter();
    a.record(failingTestEvt());
    const input = a.buildCheckInput(
      failingTestEvt({ toolResultsChanged: true })
    );
    expect(input.history?.new_evidence_since_last_attempt).toBe(true);
    expect(
      input.history?.evidence_signals?.tool_results_changed_since_last_attempt
    ).toBe(true);
  });

  it("R5: current-attempt contextSourceConfirmed alone makes new_evidence_since_last_attempt = true", () => {
    const a = new OpenClawAdapter();
    a.record(failingTestEvt());
    const input = a.buildCheckInput(
      failingTestEvt({ contextSourceConfirmed: true })
    );
    expect(input.history?.new_evidence_since_last_attempt).toBe(true);
    expect(input.history?.evidence_signals?.context_source_confirmed).toBe(true);
  });

  it("R6: current-attempt logsRead alone makes new_evidence_since_last_attempt = true", () => {
    const a = new OpenClawAdapter();
    a.record(failingTestEvt());
    const input = a.buildCheckInput(
      failingTestEvt({ logsRead: ["pytest output"] })
    );
    expect(input.history?.new_evidence_since_last_attempt).toBe(true);
    expect(input.history?.evidence_signals?.logs_read_since_last_attempt).toBe(1);
  });

  it("R7: NO current-attempt evidence AND no between-attempt evidence → false (regression unchanged)", () => {
    const a = new OpenClawAdapter();
    a.record(failingTestEvt());
    const input = a.buildCheckInput(failingTestEvt());
    expect(input.history?.new_evidence_since_last_attempt).toBe(false);
  });

  it("R8: end-to-end E2 reproduction — same failure with rich current-attempt evidence flips warn → allow", () => {
    // Reproduces the E2 self-trial scenario:
    // Prior: pytest run that surfaced test_06 failing.
    // Now:   pytest re-run AFTER reading the file and editing the source.
    // Expected (pre-0.5.1): warn (model_escalation_without_evidence)
    // Expected (post-0.5.1): allow, pattern none — because the current
    // attempt declares filesRead, testsRun, gitDiffChanged, toolResultsChanged,
    // and contextSourceConfirmed.
    const a = new OpenClawAdapter();
    a.record(failingTestEvt()); // Initial run, no evidence yet
    const input = a.buildCheckInput(
      failingTestEvt({
        // Annotated on the current attempt — the realistic "I just read
        // the failing test and edited the source" surface.
        filesRead: [
          "python/agent_spend_guard/client.py",
          "python/tests/test_client.py",
        ],
        testsRun: ["tests/test_client.py::test_06"],
        logsRead: ["pytest stderr"],
        toolResultsChanged: true,
        gitDiffChanged: true,
        contextSourceConfirmed: true,
        confidenceBefore: 0.5,
        confidenceAfter: 0.85,
      }),
      {
        objective: {
          id: "obj_python_pytest_green",
          goal: "Get 35/35 Python tests passing on Python 3.14",
          successCriteria: ["pytest exits 0"],
        },
      }
    );

    expect(input.history?.new_evidence_since_last_attempt).toBe(true);

    const out = runCheck(input);
    expect(out.decision).toBe("allow");
    expect(out.pattern).toBe("none");
  });

  it("R9: between-attempt evidence still works (no regression on pre-0.5.1 path)", () => {
    // Evidence annotated on an event BETWEEN two same-failure events
    // must still count, even though the current attempt is empty.
    const a = new OpenClawAdapter();
    a.record(failingTestEvt());
    a.record(failingTestEvt({ filesRead: ["src/foo.ts"] })); // between event
    const input = a.buildCheckInput(failingTestEvt());
    expect(input.history?.new_evidence_since_last_attempt).toBe(true);
  });

  it("R10: cold-start (no prior history) stays null (semantics preserved)", () => {
    const a = new OpenClawAdapter();
    const input = a.buildCheckInput(
      failingTestEvt({ filesRead: ["src/foo.ts"] })
    );
    // No prior same-failure event → window is undefined → newEvidence is null,
    // not true. The "did anything happen since the last attempt" question
    // doesn't apply when there was no last attempt.
    expect(input.history?.new_evidence_since_last_attempt).toBeNull();
  });
});
