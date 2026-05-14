// Decision policy: map (decision, top pattern) → recommended_policy with legal-pair enforcement,
// and produce the final SpendingGuardCheckOutput shape from aggregated detector results.

import { clamp } from "./confidence.js";
import type {
  DetectorResult,
  RecommendedPolicy,
  RiskLevel,
  SpendingGuardDecision,
} from "./types.js";

const LEGAL_PAIRS: Record<SpendingGuardDecision, ReadonlySet<RecommendedPolicy>> = {
  allow: new Set<RecommendedPolicy>(["continue", "log_only"]),
  warn: new Set<RecommendedPolicy>([
    "log_only",
    "shadow_log",
    "downgrade",
    "ask_human",
    "run_deep_check",
  ]),
  require_confirmation: new Set<RecommendedPolicy>([
    "ask_human",
    "run_deep_check",
    "downgrade",
  ]),
  delay: new Set<RecommendedPolicy>(["delay_action", "ask_human", "run_deep_check"]),
  block: new Set<RecommendedPolicy>(["stop_action"]),
  uncertain: new Set<RecommendedPolicy>([
    "run_deep_check",
    "log_only",
    "shadow_log",
    "ask_human",
    "request_more_telemetry",
  ]),
};

export function isLegalPair(
  decision: SpendingGuardDecision,
  policy: RecommendedPolicy
): boolean {
  return LEGAL_PAIRS[decision].has(policy);
}

export function assertLegalPair(
  decision: SpendingGuardDecision,
  policy: RecommendedPolicy
): void {
  if (!isLegalPair(decision, policy)) {
    throw new Error(
      `Illegal decision/recommended_policy pair: ${decision} + ${policy}`
    );
  }
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score < 25) return "low";
  if (score < 50) return "moderate";
  if (score < 75) return "elevated";
  if (score < 90) return "high";
  return "critical";
}

// Score → decision band, concretizing v0.1.1 § 6 ranges with explicit thresholds
// (see IMPLEMENTATION_NOTES.md § 8).
export function scoreToDecision(
  score: number,
  confidence: number
): SpendingGuardDecision {
  if (score < 25) return "allow";
  if (score < 50) {
    return confidence >= 0.7 ? "warn" : "allow";
  }
  if (score < 75) return "warn";
  if (score < 90) return "require_confirmation";
  return "require_confirmation";
}

// Decide recommended_policy from (decision, top_pattern). Result is guaranteed legal.
export function pickRecommendedPolicy(
  decision: SpendingGuardDecision,
  top: DetectorResult | null,
  options?: { telemetryUncertain?: boolean }
): RecommendedPolicy {
  switch (decision) {
    case "allow":
      return "continue";
    case "warn": {
      const pattern = top?.pattern ?? "";
      if (pattern === "model_escalation_without_evidence") return "downgrade";
      if (pattern === "stale_context_retry_storm") return "ask_human";
      if (pattern === "same_tool_retry_loop") return "shadow_log";
      return "ask_human";
    }
    case "require_confirmation":
      return "ask_human";
    case "delay":
      return "delay_action";
    case "block":
      return "stop_action";
    case "uncertain":
      return options?.telemetryUncertain ? "request_more_telemetry" : "run_deep_check";
  }
}

export const DETECTOR_TIE_BREAKER_PRIORITY: string[] = [
  "task_budget_breach",
  "explicit_blocked_action",
  "objective_drift",
  "stale_context_retry_storm",
  "model_escalation_without_evidence",
  "same_tool_retry_loop",
];

export function pickTopPattern(results: DetectorResult[]): DetectorResult | null {
  if (results.length === 0) return null;
  let best: DetectorResult | null = null;
  for (const r of results) {
    if (best === null) {
      best = r;
      continue;
    }
    if (r.scoreContribution > best.scoreContribution) {
      best = r;
      continue;
    }
    if (r.scoreContribution === best.scoreContribution) {
      const a = DETECTOR_TIE_BREAKER_PRIORITY.indexOf(r.pattern);
      const b = DETECTOR_TIE_BREAKER_PRIORITY.indexOf(best.pattern);
      const ra = a === -1 ? Number.POSITIVE_INFINITY : a;
      const rb = b === -1 ? Number.POSITIVE_INFINITY : b;
      if (ra < rb) best = r;
    }
  }
  return best;
}

export function summedScore(results: DetectorResult[]): number {
  let total = 0;
  for (const r of results) total += r.scoreContribution;
  return clamp(total, 0, 100);
}

export function unionMatchedRules(results: DetectorResult[]): string[] {
  const set = new Set<string>();
  for (const r of results) for (const rule of r.matchedRules) set.add(rule);
  return Array.from(set);
}

export function findDeterministicBlock(
  results: DetectorResult[]
): DetectorResult | null {
  for (const r of results) {
    if (r.deterministicDecision === "block") return r;
  }
  return null;
}
