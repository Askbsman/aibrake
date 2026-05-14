import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/core/check.js";
import { setLoggerSink } from "../../src/core/logger.js";
import { baseInput } from "../helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

describe("objective_drift detector", () => {
  it("emits deterministic block when next action is in blocked_actions", () => {
    const out = runCheck(
      baseInput({
        objective: {
          blocked_actions: ["buy_subscription"],
          budget: { amount: 50, currency: "USD", hard_limit: false },
        },
        next_action: {
          type: "buy_subscription",
          estimated_cost: { amount: 19, currency: "USD" },
        },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.decision).toBe("block");
    expect(out.matched_rules).toContain("explicit_blocked_action");
  });

  it("warns when next action is not in allowed_actions list", () => {
    const out = runCheck(
      baseInput({
        objective: {
          allowed_actions: ["read_file", "run_test"],
          budget: { amount: 50, currency: "USD", hard_limit: false },
        },
        next_action: {
          type: "paid_llm_call",
          estimated_cost: { amount: 0.1, currency: "USD" },
        },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.matched_rules).toContain("action_not_in_allowed_list");
    expect(["warn", "require_confirmation"]).toContain(out.decision);
  });

  it("does not fire when neither list constrains the action", () => {
    const out = runCheck(
      baseInput({
        objective: { budget: { amount: 50, currency: "USD", hard_limit: false } },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.pattern).not.toBe("objective_drift");
  });

  it("requires confirmation rather than allow when action is outside allowed list", () => {
    const out = runCheck(
      baseInput({
        objective: {
          allowed_actions: ["read_file"],
          budget: { amount: 50, currency: "USD", hard_limit: false },
        },
        next_action: {
          type: "rewrite_architecture",
          estimated_cost: { amount: 0.5, currency: "USD" },
        },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.decision).not.toBe("allow");
    expect(out.recommended_policy).not.toBe("continue");
  });
});
