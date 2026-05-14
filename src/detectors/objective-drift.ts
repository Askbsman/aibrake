import type {
  DetectorDefinition,
  DetectorResult,
  SpendingGuardCheckInput,
} from "../core/types.js";

const NAME = "objective_drift";
const VERSION = `${NAME}@0.1.0`;
const EXPLICIT_BLOCKED_RULE = "explicit_blocked_action";

// Rules-only drift detector. Semantic drift is out-of-scope for v0.1 /v1/check.
export const objectiveDriftDetector: DetectorDefinition = {
  name: NAME,
  version: VERSION,
  baseConfidence: 0.7,
  // Deterministic rules-only check. The signals that matter are the policy
  // declarations themselves and the next_action.type field — they are either
  // present (and the rule fires) or absent (and the detector returns null).
  recommendedFields: ["next_action.type"],
  evaluate(input: SpendingGuardCheckInput): DetectorResult | null {
    const obj = input.objective;
    if (!obj) return null;

    const matched: string[] = [];
    let score = 0;
    let deterministic: "block" | undefined;

    const nextType = input.next_action.type;

    if (obj.blocked_actions?.includes(nextType)) {
      matched.push(EXPLICIT_BLOCKED_RULE);
      score += 50;
      deterministic = "block";
    } else if (
      obj.allowed_actions &&
      obj.allowed_actions.length > 0 &&
      !obj.allowed_actions.includes(nextType)
    ) {
      matched.push("action_not_in_allowed_list");
      score += 55;
    } else {
      return null;
    }

    return {
      pattern: NAME,
      detectorVersion: VERSION,
      scoreContribution: score,
      confidence: 0.95, // deterministic policy match; coverage downgrade happens later
      matchedRules: matched,
      suggestedActions: [
        deterministic
          ? {
              type: "stop_action",
              message:
                "Next action is explicitly blocked by operator-defined objective policy.",
            }
          : {
              type: "narrow_scope",
              message:
                "Next action is outside the objective's allowed action list. Confirm it is intentional before spending.",
            },
      ],
      ...(deterministic ? { deterministicDecision: deterministic } : {}),
      metadata: {
        next_action_type: nextType,
        reason: deterministic
          ? `Next action "${nextType}" is explicitly listed in objective.blocked_actions. This is a hard policy violation, not a recommendation.`
          : `Next action "${nextType}" is not in the objective's allowed_actions list ([${(obj.allowed_actions ?? []).join(", ")}]). Confirm before spending — the agent may be drifting away from the original objective.`,
      },
    };
  },
};
