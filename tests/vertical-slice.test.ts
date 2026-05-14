import { describe, expect, it } from "vitest";
import { runCheck } from "../src/core/check.js";
import { failureFingerprint } from "../src/core/fingerprints.js";
import { isLegalPair } from "../src/core/policy.js";
import { setLoggerSink } from "../src/core/logger.js";
import { baseInput, withCodingFailure } from "./helpers/fixtures.js";

// Silence structured logs in tests.
setLoggerSink({ emit: () => {} });

describe("Vertical slice — Spending Guard Stage 0.1 first 10 tests", () => {
  it("01. budget well under limit and no risk signals → allow", () => {
    const input = baseInput({
      objective: {
        budget: { amount: 50, currency: "USD", hard_limit: false },
      },
      spend: { spent_on_objective: { amount: 0.5, currency: "USD" } },
      telemetry_quality: { completeness: "high" },
    });
    const out = runCheck(input);
    expect(out.decision).toBe("allow");
    expect(out.recommended_policy).toBe("continue");
    expect(out.hard_block).toBe(false);
  });

  it("02. hard budget exceeded → block + stop_action + deterministic", () => {
    const input = baseInput({
      objective: {
        budget: { amount: 1, currency: "USD", hard_limit: true },
      },
      next_action: {
        type: "paid_llm_call",
        provider: "anthropic",
        model: "claude-sonnet",
        estimated_cost: { amount: 0.6, currency: "USD" },
      },
      spend: { spent_on_objective: { amount: 0.5, currency: "USD" } },
      telemetry_quality: { completeness: "high" },
    });
    const out = runCheck(input);
    expect(out.decision).toBe("block");
    expect(out.recommended_policy).toBe("stop_action");
    expect(out.hard_block).toBe(true);
    expect(out.pattern).toBe("task_budget_breach");
  });

  it("03. same deterministic build failure, 7th paid attempt, no new evidence → warn/require_confirmation, never allow, never block", () => {
    const out = runCheck(withCodingFailure(7));
    expect(["warn", "require_confirmation"]).toContain(out.decision);
    expect(out.pattern).toBe("stale_context_retry_storm");
    expect(out.hard_block).toBe(false);
    expect(["ask_human", "downgrade", "run_deep_check"]).toContain(
      out.recommended_policy
    );
    expect(out.matched_rules).toContain("failure_signal_present");
  });

  it("04. same build failure 10x + hard budget exceeded → deterministic block wins", () => {
    const input = withCodingFailure(10);
    input.objective = {
      ...input.objective!,
      budget: { amount: 5, currency: "USD", hard_limit: true },
    };
    input.spend = { spent_on_objective: { amount: 4.8, currency: "USD" } };
    input.next_action = {
      ...input.next_action,
      estimated_cost: { amount: 0.5, currency: "USD" },
    };
    const out = runCheck(input);
    expect(out.decision).toBe("block");
    expect(out.recommended_policy).toBe("stop_action");
    expect(out.hard_block).toBe(true);
  });

  it("05. creative writing iteration 10x without failure_signal_present → stale_context_retry_storm does NOT fire", () => {
    const input = baseInput({
      objective: {
        id: "obj_writing",
        goal: "Refine paragraph style",
        budget: { amount: 50, currency: "USD", hard_limit: false },
      },
      history: {
        attempt_number: 10,
        same_action_count: 9,
        // failure_signal_present omitted (undefined) — must not trigger stale-context
        evidence_kind: "generic",
        new_evidence_since_last_attempt: true,
      },
      telemetry_quality: { completeness: "high" },
    });
    const out = runCheck(input);
    expect(out.pattern).not.toBe("stale_context_retry_storm");
    expect(out.decision).not.toBe("block");
    expect(out.matched_rules).not.toContain("failure_signal_present");
  });

  it("06. repeated paid attempts but incomplete telemetry → uncertain, not block", () => {
    const input = baseInput({
      objective: {
        budget: { amount: 5, currency: "USD", hard_limit: false },
      },
      history: {
        attempt_number: 7,
        paid_attempts_on_same_failure: 6,
        failure_signal_present: true,
        failure_signal_type: "build_error",
        same_failure_count: 6,
        new_evidence_since_last_attempt: false,
        // No evidence_kind, no evidence_signals, no confidence_delta — sparse telemetry.
      },
      // No telemetry_quality field → unknown completeness → 0.6 multiplier
    });
    const out = runCheck(input);
    expect(out.decision).toBe("uncertain");
    expect(out.hard_block).toBe(false);
    expect(["run_deep_check", "request_more_telemetry"]).toContain(
      out.recommended_policy
    );
    expect(out.confidence).toBeLessThan(0.5);
  });

  it("07. confidence < 0.50 with non-deterministic risk → uncertain regardless of score", () => {
    const input = withCodingFailure(7);
    input.telemetry_quality = { completeness: "low" };
    // Strip recommended fields to drag coverage_ratio down.
    input.history = {
      ...input.history!,
      // remove evidence_kind, evidence_signals, confidence_delta
      evidence_kind: undefined,
      evidence_signals: undefined,
      confidence_delta: undefined,
    };
    const out = runCheck(input);
    expect(out.confidence).toBeLessThan(0.5);
    expect(out.decision).toBe("uncertain");
  });

  it("08. fingerprint stable across Windows/Unix paths and whitespace", () => {
    const fpA = failureFingerprint({
      failure_signal_type: "build_error",
      failing_file: "C:\\Users\\x\\src\\foo.ts",
      normalized_error_message: "  TS2307:  Cannot   find module   \n",
    });
    const fpB = failureFingerprint({
      failure_signal_type: "build_error",
      failing_file: "C:/Users/x/src/foo.ts",
      normalized_error_message: "ts2307: cannot find module",
    });
    expect(fpA).toBe(fpB);
    expect(fpA.startsWith("fp_v1_failure_")).toBe(true);
  });

  it("09. output includes detector_version, policy_version, and risk_level mapping", () => {
    const out = runCheck(withCodingFailure(7));
    expect(out.detector_version).toMatch(/@\d+\.\d+\.\d+$/);
    expect(out.policy_version).toBe("policy@0.1.0");
    expect(["low", "moderate", "elevated", "high", "critical"]).toContain(
      out.risk_level
    );
  });

  it("10. every emitted output has a legal (decision, recommended_policy) pair", () => {
    const cases = [
      baseInput({
        objective: { budget: { amount: 50, currency: "USD" } },
        spend: { spent_on_objective: { amount: 0.5, currency: "USD" } },
        telemetry_quality: { completeness: "high" },
      }),
      withCodingFailure(7),
      withCodingFailure(10),
      baseInput({
        objective: {
          budget: { amount: 1, currency: "USD", hard_limit: true },
        },
        next_action: {
          type: "paid_llm_call",
          estimated_cost: { amount: 2, currency: "USD" },
        },
      }),
    ];
    for (const input of cases) {
      const out = runCheck(input);
      expect(
        isLegalPair(out.decision, out.recommended_policy),
        `illegal pair ${out.decision}/${out.recommended_policy}`
      ).toBe(true);
    }
  });
});
