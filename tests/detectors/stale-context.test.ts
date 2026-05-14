import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/core/check.js";
import { setLoggerSink } from "../../src/core/logger.js";
import { baseInput, withCodingFailure } from "../helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

describe("stale_context_retry_storm detector", () => {
  it("does not fire when failure_signal_present is false", () => {
    const input = withCodingFailure(8);
    input.history!.failure_signal_present = false;
    const out = runCheck(input);
    expect(out.pattern).not.toBe("stale_context_retry_storm");
  });

  it("does not fire when failure_signal_present is undefined", () => {
    const input = withCodingFailure(8);
    delete input.history!.failure_signal_present;
    const out = runCheck(input);
    expect(out.pattern).not.toBe("stale_context_retry_storm");
  });

  it("fires with high risk when same build error 7x without new evidence", () => {
    const out = runCheck(withCodingFailure(7));
    expect(out.pattern).toBe("stale_context_retry_storm");
    expect(out.risk_score).toBeGreaterThanOrEqual(75);
  });

  it("lowers risk when new_evidence_since_last_attempt is true", () => {
    const dirty = runCheck(withCodingFailure(7));
    const clean = runCheck(withCodingFailure(7, { newEvidence: true }));
    expect(clean.risk_score).toBeLessThan(dirty.risk_score);
    expect(clean.matched_rules).not.toContain("no_new_evidence_since_last_attempt");
  });

  it("lowers risk when files read and git diff changed", () => {
    const input = withCodingFailure(7, { newEvidence: true });
    input.history!.evidence_signals = {
      files_read_since_last_attempt: 3,
      tests_run_since_last_attempt: 1,
      logs_read_since_last_attempt: 2,
      git_diff_changed_since_last_attempt: true,
      context_source_confirmed: true,
    };
    const out = runCheck(input);
    expect(out.matched_rules).not.toContain("no_files_read_since_last_attempt");
    expect(out.matched_rules).not.toContain("git_diff_unchanged");
  });

  it("does not fire when only 2 attempts have happened", () => {
    const input = withCodingFailure(2);
    const out = runCheck(input);
    // Only 1 same_failure repeat — should not produce stale-context warning.
    expect(out.pattern).not.toBe("stale_context_retry_storm");
  });

  it("escalates with expensive model + same failure + no evidence", () => {
    const out = runCheck(withCodingFailure(7, { expensiveModel: true }));
    expect(out.matched_rules.length).toBeGreaterThan(0);
    expect(out.pattern).toBe("stale_context_retry_storm");
    // Model escalation detector should also have contributed.
    expect(out.matched_rules).toContain("failure_signal_present");
  });

  it("non-code evidence kind still allows the detector to fire on deterministic signals", () => {
    const input = withCodingFailure(7);
    input.history!.evidence_kind = "api";
    input.history!.evidence_signals = {
      endpoint: "/api/v1/x",
      status_code: 500,
      response_body_hash: "x",
    };
    const out = runCheck(input);
    expect(out.pattern).toBe("stale_context_retry_storm");
    // Coding-specific rules must NOT fire on non-code evidence.
    expect(out.matched_rules).not.toContain("no_files_read_since_last_attempt");
  });

  it("requires confirmation when same error + near budget + no evidence", () => {
    const input = withCodingFailure(8);
    input.objective!.budget = { amount: 1, currency: "USD", hard_limit: false };
    input.next_action.estimated_cost = { amount: 0.05, currency: "USD" };
    input.spend = { spent_on_objective: { amount: 0.95, currency: "USD" } };
    const out = runCheck(input);
    expect(["warn", "require_confirmation"]).toContain(out.decision);
    expect(out.recommended_policy).toBe("ask_human");
  });

  it("blocks when hard budget exceeded even though stale-context is the top pattern", () => {
    const input = withCodingFailure(10);
    input.objective!.budget = { amount: 5, currency: "USD", hard_limit: true };
    input.spend = { spent_on_objective: { amount: 4.9, currency: "USD" } };
    input.next_action.estimated_cost = { amount: 0.5, currency: "USD" };
    const out = runCheck(input);
    expect(out.decision).toBe("block");
    expect(out.hard_block).toBe(true);
  });
});
