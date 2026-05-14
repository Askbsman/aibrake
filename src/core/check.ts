// Stateless Core check function.
// Spending Guard Stage 0.1.

import { selectDetectors } from "../detectors/index.js";
import { detectorConfidence } from "./confidence.js";
import { inputHash } from "./fingerprints.js";
import { log } from "./logger.js";
import {
  assertLegalPair,
  findDeterministicBlock,
  pickRecommendedPolicy,
  pickTopPattern,
  riskLevelFromScore,
  scoreToDecision,
  summedScore,
  unionMatchedRules,
} from "./policy.js";
import {
  POLICY_VERSION,
  type DetectorDefinition,
  type DetectorResult,
  type SpendingGuardCheckInput,
  type SpendingGuardCheckOutput,
  type SpendingGuardDecision,
  type SuggestedAction,
} from "./types.js";

const UNCERTAIN_CONFIDENCE_THRESHOLD = 0.5;

export interface RunCheckOptions {
  emitLog?: boolean;
}

export function runCheck(
  input: SpendingGuardCheckInput,
  options: RunCheckOptions = {}
): SpendingGuardCheckOutput {
  const emitLog = options.emitLog !== false;

  const detectors = selectDetectors(input.enabled_detectors);
  const fired: Array<{ detector: DetectorDefinition; result: DetectorResult }> = [];

  for (const detector of detectors) {
    const result = detector.evaluate(input);
    if (result && result.matchedRules.length > 0) {
      fired.push({ detector, result });
    }
  }

  const results = fired.map((f) => f.result);
  const deterministicBlocker = findDeterministicBlock(results);

  const top = pickTopPattern(results);
  const score = summedScore(results);
  const matchedRules = unionMatchedRules(results);

  const confidence = top
    ? detectorConfidence(
        fired.find((f) => f.result === top)!.detector,
        input
      )
    : 1.0;

  let decision: SpendingGuardDecision;
  let suggested: SuggestedAction;

  if (deterministicBlocker) {
    decision = "block";
    suggested = deterministicBlocker.suggestedActions[0] ?? {
      type: "stop_action",
      message: "Deterministic blocker fired.",
    };
  } else if (results.length === 0) {
    decision = "allow";
    suggested = { type: "continue", message: "No risk patterns matched." };
  } else if (confidence < UNCERTAIN_CONFIDENCE_THRESHOLD) {
    decision = "uncertain";
    suggested = top!.suggestedActions[0] ?? {
      type: "improve_telemetry",
      message:
        "Possible loop signals were detected but telemetry confidence is too low for a decision.",
    };
  } else {
    decision = scoreToDecision(score, confidence);
    suggested = top!.suggestedActions[0] ?? {
      type: "review",
      message: "Detector matched without an explicit suggested action.",
    };
  }

  // Telemetry-uncertain helper for picking recommended policy.
  const telemetryUncertain =
    decision === "uncertain" &&
    (input.telemetry_quality?.completeness === "low" ||
      input.telemetry_quality?.completeness === "unknown" ||
      input.telemetry_quality === undefined);

  const recommendedPolicy = pickRecommendedPolicy(decision, top, {
    telemetryUncertain,
  });
  assertLegalPair(decision, recommendedPolicy);

  const finalScore = deterministicBlocker ? Math.max(score, 90) : score;
  const detectorVersion = top?.detectorVersion ?? "none@0.1.0";

  const reason = buildReason(decision, top, deterministicBlocker, results);

  const output: SpendingGuardCheckOutput = {
    decision,
    risk_score: finalScore,
    risk_level: riskLevelFromScore(finalScore),
    confidence,
    pattern: top?.pattern ?? "none",
    matched_rules: matchedRules,
    reason,
    suggested_action: suggested,
    recommended_policy: recommendedPolicy,
    hard_block: decision === "block",
    requires_human_confirmation:
      decision === "require_confirmation" || recommendedPolicy === "ask_human",
    metadata: top?.metadata ?? {},
    detector_version: detectorVersion,
    policy_version: POLICY_VERSION,
  };

  if (emitLog) {
    log({
      event_type: "spending_guard.check.completed",
      input_hash: inputHash(input),
      objective_id: input.objective?.id ?? null,
      actor_runtime: input.actor.runtime ?? null,
      decision: output.decision,
      recommended_policy: output.recommended_policy,
      pattern: output.pattern,
      risk_score: output.risk_score,
      confidence: output.confidence,
      detector_version: output.detector_version,
      policy_version: output.policy_version,
      matched_rules: output.matched_rules,
      timestamp: new Date().toISOString(),
    });
  }

  return output;
}

function buildReason(
  decision: SpendingGuardDecision,
  top: DetectorResult | null,
  blocker: DetectorResult | null,
  results: DetectorResult[]
): string {
  if (blocker) {
    return (
      (blocker.metadata as { reason?: string } | undefined)?.reason ??
      `Deterministic block from ${blocker.pattern}.`
    );
  }
  if (results.length === 0) {
    return "No risk patterns matched.";
  }
  if (decision === "uncertain") {
    return `Possible ${top!.pattern} signals detected but telemetry confidence is below the decision threshold.`;
  }
  const explicit =
    (top?.metadata as { reason?: string } | undefined)?.reason ?? null;
  if (explicit) return explicit;
  return `${top!.pattern} matched rules: ${top!.matchedRules.join(", ")}.`;
}
