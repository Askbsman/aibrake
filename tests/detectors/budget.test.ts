import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/core/check.js";
import { setLoggerSink } from "../../src/core/logger.js";
import { baseInput } from "../helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

describe("task_budget_breach detector", () => {
  it("warns when soft budget exceeded", () => {
    const out = runCheck(
      baseInput({
        objective: { budget: { amount: 1, currency: "USD", hard_limit: false } },
        next_action: {
          type: "paid_llm_call",
          estimated_cost: { amount: 0.6, currency: "USD" },
        },
        spend: { spent_on_objective: { amount: 0.5, currency: "USD" } },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.decision).not.toBe("block");
    expect(out.matched_rules).toContain("task_budget_exceeded");
  });

  it("blocks when hard budget exceeded", () => {
    const out = runCheck(
      baseInput({
        objective: { budget: { amount: 1, currency: "USD", hard_limit: true } },
        next_action: {
          type: "paid_llm_call",
          estimated_cost: { amount: 0.6, currency: "USD" },
        },
        spend: { spent_on_objective: { amount: 0.5, currency: "USD" } },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.decision).toBe("block");
    expect(out.matched_rules).toContain("hard_budget_breach");
  });

  it("warns near budget but does not block", () => {
    const out = runCheck(
      baseInput({
        objective: { budget: { amount: 1, currency: "USD", hard_limit: true } },
        next_action: {
          type: "paid_llm_call",
          estimated_cost: { amount: 0.05, currency: "USD" },
        },
        spend: { spent_on_objective: { amount: 0.9, currency: "USD" } },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.decision).not.toBe("block");
    expect(out.matched_rules).toContain("near_task_budget");
  });

  it("allows under-budget normal progress", () => {
    const out = runCheck(
      baseInput({
        objective: { budget: { amount: 10, currency: "USD", hard_limit: true } },
        spend: { spent_on_objective: { amount: 1, currency: "USD" } },
        telemetry_quality: { completeness: "high" },
      })
    );
    expect(out.decision).toBe("allow");
  });
});
