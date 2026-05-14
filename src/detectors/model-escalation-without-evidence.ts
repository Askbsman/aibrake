import type {
  DetectorDefinition,
  DetectorResult,
  SpendingGuardCheckInput,
} from "../core/types.js";

const NAME = "model_escalation_without_evidence";
const VERSION = `${NAME}@0.1.0`;

// Heuristic: if next action targets an "expensive" model AND the same failure
// keeps repeating without new evidence, that's an escalation-without-evidence
// pattern worth flagging.
const EXPENSIVE_MODEL_PATTERNS: RegExp[] = [
  /opus/i,
  /gpt-?4/i,
  /gpt-?5/i,
  /o[1-9]/i,
  /sonnet-?4/i,
  /ultra/i,
];

function looksExpensive(model: string | undefined, cost: number): boolean {
  if (cost >= 0.1) return true;
  if (!model) return false;
  return EXPENSIVE_MODEL_PATTERNS.some((re) => re.test(model));
}

export const modelEscalationWithoutEvidenceDetector: DetectorDefinition = {
  name: NAME,
  version: VERSION,
  baseConfidence: 0.75,
  recommendedFields: [
    "next_action.model",
    "next_action.estimated_cost",
    "history.same_failure_count",
    "history.new_evidence_since_last_attempt",
  ],
  evaluate(input: SpendingGuardCheckInput): DetectorResult | null {
    const h = input.history;
    if (!h) return null;
    const expensive = looksExpensive(
      input.next_action.model,
      input.next_action.estimated_cost.amount
    );
    if (!expensive) return null;

    const matched: string[] = ["expensive_next_action"];
    let score = 10;

    if ((h.same_failure_count ?? 0) >= 3) {
      matched.push("same_failure_repeated");
      score += 10;
    }
    if (h.new_evidence_since_last_attempt === false) {
      matched.push("no_new_evidence");
      score += 15;
    }
    if (matched.length === 1) return null;

    return {
      pattern: NAME,
      detectorVersion: VERSION,
      scoreContribution: score,
      confidence: 0.75,
      matchedRules: matched,
      suggestedActions: [
        {
          type: "downgrade_model",
          message:
            "Escalating to a more expensive model on the same failure without new evidence rarely produces a different answer. Try a cheaper model with refreshed context first.",
        },
      ],
      metadata: {
        model: input.next_action.model ?? null,
        reason:
          `Next action escalates to ${input.next_action.model ?? "a more expensive model"} ` +
          `($${input.next_action.estimated_cost.amount.toFixed(2)})` +
          (matched.includes("same_failure_repeated")
            ? ` while the same failure has repeated ${h.same_failure_count ?? 0} times`
            : "") +
          (matched.includes("no_new_evidence")
            ? " and no new evidence has been gathered between attempts"
            : "") +
          ". Escalating without new input rarely produces a different answer — try the cheaper model with refreshed context first.",
      },
    };
  },
};
