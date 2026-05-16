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
  type ProjectedSavings,
  type ProjectedSavingsBasis,
  type RecommendedPolicy,
  type SpendingGuardCheckInput,
  type SpendingGuardCheckOutput,
  type SpendingGuardDecision,
  type SuggestedAction,
} from "./types.js";

const UNCERTAIN_CONFIDENCE_THRESHOLD = 0.5;

export interface RunCheckOptions {
  emitLog?: boolean;
  // Stage 0.3: hosted-beta context — these flow into the log payload but
  // never into the response body. Callers from inside Core (tests, in-process
  // SDK) leave them undefined.
  requestId?: string;
  apiKeyHash?: string | null;
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

  const projectedSavings = computeProjectedSavings(
    decision,
    recommendedPolicy,
    top,
    suggested,
    input
  );

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
    ...(projectedSavings ? { projected_savings: projectedSavings } : {}),
  };

  if (emitLog) {
    log({
      // Stage 0.3: event_type uses the product brand namespace.
      event_type: "agent_spend_guard.check.completed",
      ...(options.requestId !== undefined ? { request_id: options.requestId } : {}),
      input_hash: inputHash(input),
      ...(options.apiKeyHash !== undefined
        ? { api_key_hash: options.apiKeyHash }
        : {}),
      objective_id: input.objective?.id ?? null,
      actor_runtime: input.actor.runtime ?? null,
      decision: output.decision,
      recommended_policy: output.recommended_policy,
      pattern: output.pattern,
      risk_score: output.risk_score,
      confidence: output.confidence,
      detector_version: output.detector_version,
      policy_version: output.policy_version,
      matched_rules_count: output.matched_rules.length,
      matched_rules: output.matched_rules,
      // Stage 0.5.2: $-cost + projected savings on the log line so the
      // logs:summary CLI can compute "guard caught $X this week" without
      // replaying every decision. Both are partner-supplied or derived from
      // partner-supplied numbers — no PII / no model content is added here.
      next_action_cost_usd: input.next_action.estimated_cost?.amount ?? null,
      projected_savings_usd: output.projected_savings?.amount_usd ?? null,
      projected_savings_basis: output.projected_savings?.basis ?? null,
      timestamp: new Date().toISOString(),
    });
  }

  return output;
}

// ─────────────────────────────────────────────────────────────────────────
// Stage 0.5.2 — projected savings computation
// ─────────────────────────────────────────────────────────────────────────
//
// Heuristic but explainable. Three paths:
//   (1) suggested_action.model_route.to.estimated_cost present → cost delta
//   (2) stale_context_retry_storm pattern → projected forward attempts
//   (3) decision is warn/req_confirm/block/delay → next single attempt cost
// On `allow`, returns undefined.
//
// All values come from partner-supplied `next_action.estimated_cost` and
// `history.paid_attempts_on_same_failure`. The Core never invents a price.

function computeProjectedSavings(
  decision: SpendingGuardDecision,
  recommendedPolicy: RecommendedPolicy,
  top: DetectorResult | null,
  suggested: SuggestedAction,
  input: SpendingGuardCheckInput
): ProjectedSavings | undefined {
  const cost = input.next_action.estimated_cost?.amount;
  if (typeof cost !== "number" || cost <= 0) return undefined;
  if (decision === "allow") return undefined;
  if (decision === "uncertain") return undefined;

  // Path 1 — explicit model route with a target cost the operator declared.
  // We compute the *delta* between the current model and the recommended
  // secondary. If the secondary has no cost annotation, fall back to a
  // conservative 60% reduction estimate (industry-typical premium-vs-cheap
  // ratio: opus/sonnet → haiku, gpt-4 → gpt-4o-mini, ~5-10x cheaper).
  const route = suggested.model_route;
  if (route?.to) {
    const toCost = route.to.estimatedCostUsd;
    const delta =
      typeof toCost === "number" && toCost >= 0 ? Math.max(0, cost - toCost) : cost * 0.6;
    return {
      amount_usd: roundCents(delta),
      currency: "USD",
      basis: "model_downgrade_delta",
      explanation: routeExplanation(cost, delta, route.to),
    };
  }

  const paidRepeats = input.history?.paid_attempts_on_same_failure ?? 0;
  const sameFailure = input.history?.same_failure_count ?? 0;

  // Path 2 — stale_context_retry_storm: assume the agent would have made
  // up to min(3, repeats so far) more attempts at the current burn rate
  // before giving up. The "3" is a deliberate cap — past 3 we're guessing.
  if (
    top?.pattern === "stale_context_retry_storm" &&
    (paidRepeats >= 1 || sameFailure >= 1)
  ) {
    const projectedAttempts = Math.min(3, Math.max(1, paidRepeats || sameFailure));
    const total = cost * projectedAttempts;
    return {
      amount_usd: roundCents(total),
      currency: "USD",
      basis: "projected_future_attempts",
      explanation: stormExplanation(cost, projectedAttempts),
    };
  }

  // Path 3 — single next attempt avoided. Conservative default for
  // warn / require_confirmation / delay / block without a stronger signal.
  const basis: ProjectedSavingsBasis = "next_attempt_avoided";
  return {
    amount_usd: roundCents(cost),
    currency: "USD",
    basis,
    explanation: singleAttemptExplanation(decision, recommendedPolicy, cost),
  };
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function routeExplanation(
  fromCost: number,
  delta: number,
  to: { model?: string; provider?: string }
): string {
  const name = [to.provider, to.model].filter(Boolean).join("/") || "the secondary model";
  if (delta === fromCost * 0.6) {
    return (
      `Switching to ${name} for this attempt avoids ~$${delta.toFixed(2)} ` +
      `(conservative 60% premium-vs-cheap estimate; declare estimatedCostUsd ` +
      `on secondaryModel for a precise number).`
    );
  }
  return (
    `Switching to ${name} avoids the cost delta of $${delta.toFixed(2)} ` +
    `between primary ($${fromCost.toFixed(2)}) and secondary on this attempt.`
  );
}

function stormExplanation(perAttempt: number, attempts: number): string {
  return (
    `Stopping this stale_context_retry_storm avoids an estimated ${attempts} ` +
    `more paid attempt(s) at $${perAttempt.toFixed(2)} each ` +
    `($${roundCents(perAttempt * attempts).toFixed(2)} total) ` +
    `until the agent gathers new evidence.`
  );
}

function singleAttemptExplanation(
  decision: SpendingGuardDecision,
  policy: RecommendedPolicy,
  cost: number
): string {
  const verb =
    decision === "block"
      ? "blocking"
      : decision === "delay"
      ? "delaying"
      : policy === "ask_human"
      ? "pausing for confirmation on"
      : "skipping";
  return `${verb[0]?.toUpperCase()}${verb.slice(1)} this $${cost.toFixed(2)} call avoids that single paid attempt.`;
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
