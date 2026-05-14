import type {
  DetectorDefinition,
  DetectorResult,
  SpendingGuardCheckInput,
} from "../core/types.js";

const NAME = "task_budget_breach";
const VERSION = `${NAME}@0.1.0`;

// Deterministic detector. Sums spent_on_objective + next_action.estimated_cost
// and compares to objective.budget. Emits deterministic_decision: "block"
// when hard_limit budget is breached.
export const taskBudgetBreachDetector: DetectorDefinition = {
  name: NAME,
  version: VERSION,
  baseConfidence: 0.98,
  recommendedFields: [
    "objective.budget",
    "next_action.estimated_cost",
    "spend.spent_on_objective",
  ],
  evaluate(input: SpendingGuardCheckInput): DetectorResult | null {
    const budget = input.objective?.budget;
    if (!budget) return null;

    const spent = input.spend?.spent_on_objective?.amount ?? 0;
    const next = input.next_action.estimated_cost.amount;
    const projected = spent + next;

    const matched: string[] = [];
    let score = 0;
    let deterministic: "block" | undefined;
    const hard = budget.hard_limit === true;

    const ratio = budget.amount > 0 ? projected / budget.amount : Number.POSITIVE_INFINITY;

    if (ratio >= 1) {
      matched.push("task_budget_exceeded");
      score += 35;
      if (hard) {
        matched.push("hard_budget_breach");
        deterministic = "block";
      }
    } else if (ratio >= 0.9) {
      matched.push("near_task_budget");
      score += 15;
    } else if (ratio >= 0.75) {
      matched.push("approaching_task_budget");
      score += 8;
    } else {
      return null;
    }

    return {
      pattern: NAME,
      detectorVersion: VERSION,
      scoreContribution: score,
      confidence: 0.98,
      matchedRules: matched,
      suggestedActions: [
        deterministic
          ? {
              type: "stop_session",
              message:
                "Hard task budget would be breached by this action. Stop and re-scope the objective or raise the budget explicitly.",
            }
          : {
              type: "narrow_scope",
              message:
                "Task budget is nearly exhausted. Narrow scope, downgrade model, or confirm continuation before spending further.",
            },
      ],
      ...(deterministic ? { deterministicDecision: deterministic } : {}),
      metadata: {
        projected_spend: projected,
        budget_amount: budget.amount,
        budget_currency: budget.currency,
        ratio,
        hard_limit: hard,
        reason: deterministic
          ? `Hard task budget would be breached: planned spend ${projected.toFixed(2)} ${budget.currency} > budget ${budget.amount} ${budget.currency}. Stop the action or raise the budget explicitly.`
          : ratio >= 1
            ? `Soft task budget exceeded: planned spend ${projected.toFixed(2)} ${budget.currency} > budget ${budget.amount} ${budget.currency}. Narrow scope, downgrade model, or confirm continuation.`
            : ratio >= 0.9
              ? `Near task budget: planned spend ${projected.toFixed(2)} / ${budget.amount} ${budget.currency} (${Math.round(ratio * 100)}%). Be careful with the next paid action.`
              : `Approaching task budget: ${Math.round(ratio * 100)}% of ${budget.amount} ${budget.currency} planned.`,
      },
    };
  },
};
