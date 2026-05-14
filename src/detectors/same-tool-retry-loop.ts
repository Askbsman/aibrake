import type {
  DetectorDefinition,
  DetectorResult,
  SpendingGuardCheckInput,
} from "../core/types.js";

const NAME = "same_tool_retry_loop";
const VERSION = `${NAME}@0.1.0`;

// Soft loop detector for non-deterministic loops. Does NOT require a failure signal.
// Will never emit deterministic_decision and will not hard-block.
export const sameToolRetryLoopDetector: DetectorDefinition = {
  name: NAME,
  version: VERSION,
  baseConfidence: 0.65,
  recommendedFields: [
    "history.same_action_count",
    "history.confidence_delta",
    "next_action.estimated_cost",
    "objective.budget",
  ],
  evaluate(input: SpendingGuardCheckInput): DetectorResult | null {
    const h = input.history;
    if (!h) return null;
    const sameAction = h.same_action_count ?? 0;
    if (sameAction < 6) return null;

    const matched: string[] = ["same_action_count_high"];
    let score = 10;

    const signals = h.evidence_signals ?? {};
    if (signals.tool_results_changed_since_last_attempt === false) {
      matched.push("tool_results_unchanged");
      score += 10;
    }
    if ((h.confidence_delta ?? 0) <= 0) {
      matched.push("confidence_not_improving");
      score += 5;
    }

    // Cost pressure relative to objective budget.
    const cost = input.next_action.estimated_cost.amount;
    const budget = input.objective?.budget?.amount;
    if (budget && budget > 0 && cost / budget >= 0.15) {
      matched.push("expensive_relative_to_budget");
      score += 10;
    }

    if (sameAction >= 10) {
      matched.push("same_action_count_critical");
      score += 10;
    }

    return {
      pattern: NAME,
      detectorVersion: VERSION,
      scoreContribution: score,
      confidence: 0.65,
      matchedRules: matched,
      suggestedActions: [
        {
          type: "switch_strategy",
          message:
            "Same action repeated many times without changing results. Consider switching tool, model, or approach before spending again.",
        },
      ],
      metadata: {
        same_action_count: sameAction,
        reason:
          `The same action has been performed ${sameAction} times in a row` +
          (matched.includes("tool_results_unchanged")
            ? " without changing the tool's result"
            : "") +
          (matched.includes("confidence_not_improving")
            ? "; agent confidence is not improving"
            : "") +
          ". No deterministic failure is reported, so this is surfaced as a soft signal — consider switching tool, model, or approach before spending again.",
      },
    };
  },
};
