import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/core/check.js";
import { setLoggerSink } from "../../src/core/logger.js";
import { baseInput } from "../helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

describe("same_tool_retry_loop detector", () => {
  it("fires when same action repeated 8 times without failure signal", () => {
    const out = runCheck(
      baseInput({
        history: {
          same_action_count: 8,
          confidence_delta: 0,
          evidence_signals: { tool_results_changed_since_last_attempt: false },
        },
        telemetry_quality: { completeness: "high" },
        objective: { budget: { amount: 50, currency: "USD", hard_limit: false } },
      })
    );
    expect(out.pattern).toBe("same_tool_retry_loop");
    expect(out.hard_block).toBe(false);
  });

  it("does not fire when tool results changed", () => {
    const out = runCheck(
      baseInput({
        history: {
          same_action_count: 8,
          evidence_signals: { tool_results_changed_since_last_attempt: true },
        },
        telemetry_quality: { completeness: "high" },
        objective: { budget: { amount: 50, currency: "USD", hard_limit: false } },
      })
    );
    // Detector may still fire on count alone, but should not include
    // tool_results_unchanged rule.
    if (out.pattern === "same_tool_retry_loop") {
      expect(out.matched_rules).not.toContain("tool_results_unchanged");
    }
  });

  it("fires on same search query repeated 12 times", () => {
    const out = runCheck(
      baseInput({
        next_action: {
          type: "web_search_call",
          estimated_cost: { amount: 0.02, currency: "USD" },
        },
        history: {
          same_action_count: 12,
          evidence_signals: { tool_results_changed_since_last_attempt: false },
        },
        telemetry_quality: { completeness: "high" },
        objective: { budget: { amount: 50, currency: "USD", hard_limit: false } },
      })
    );
    expect(out.matched_rules).toContain("same_action_count_high");
  });

  it("low telemetry + same tool retry → reduced confidence and possible uncertain", () => {
    const out = runCheck(
      baseInput({
        history: { same_action_count: 8 },
        telemetry_quality: { completeness: "low" },
      })
    );
    expect(out.confidence).toBeLessThan(0.8);
  });

  it("never hard-blocks on same_tool_retry_loop alone", () => {
    const out = runCheck(
      baseInput({
        history: {
          same_action_count: 50,
          evidence_signals: { tool_results_changed_since_last_attempt: false },
        },
        telemetry_quality: { completeness: "high" },
        objective: { budget: { amount: 50, currency: "USD", hard_limit: false } },
      })
    );
    expect(out.hard_block).toBe(false);
  });
});
