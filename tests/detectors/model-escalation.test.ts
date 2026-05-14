import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/core/check.js";
import { setLoggerSink } from "../../src/core/logger.js";
import { withCodingFailure } from "../helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

describe("model_escalation_without_evidence detector", () => {
  it("fires on opus model + same failure + no evidence", () => {
    const input = withCodingFailure(5, { expensiveModel: true });
    const out = runCheck(input);
    // The detector contributes to matched_rules even if stale_context is the top pattern.
    expect(out.matched_rules).toContain("expensive_next_action");
    expect(out.matched_rules).toContain("no_new_evidence");
  });

  it("does not fire on cheap model + same failure", () => {
    const input = withCodingFailure(5, { expensiveModel: false });
    input.next_action.estimated_cost = { amount: 0.02, currency: "USD" };
    const out = runCheck(input);
    expect(out.matched_rules).not.toContain("expensive_next_action");
  });

  it("does not fire when there is no failure history at all", () => {
    const out = runCheck({
      actor: { type: "agent", runtime: "openclaw" },
      next_action: {
        type: "paid_llm_call",
        provider: "anthropic",
        model: "claude-opus",
        estimated_cost: { amount: 0.42, currency: "USD" },
      },
      objective: { budget: { amount: 10, currency: "USD", hard_limit: false } },
      telemetry_quality: { completeness: "high" },
    });
    expect(out.matched_rules).not.toContain("same_failure_repeated");
  });
});
