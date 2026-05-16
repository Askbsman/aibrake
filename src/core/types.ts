// Spending Guard Core — universal types.
// Stateless. Runtime-agnostic. Provider-agnostic.
// Coding-specific signals belong in `history.evidence_signals`, not as top-level fields.

export const POLICY_VERSION = "policy@0.1.0";

export type SpendingGuardDecision =
  | "allow"
  | "warn"
  | "require_confirmation"
  | "delay"
  | "block"
  | "uncertain";

export type RecommendedPolicy =
  | "continue"
  | "log_only"
  | "shadow_log"
  | "downgrade"
  | "ask_human"
  | "delay_action"
  | "stop_action"
  | "run_deep_check"
  | "request_more_telemetry";

// SDK-only. Never emitted by the API.
export type UncertainPolicy =
  | "allow_with_log"
  | "ask_human"
  | "run_deep_check"
  | "throw";

export type RiskLevel = "low" | "moderate" | "elevated" | "high" | "critical";

export type EvidenceKind =
  | "code"
  | "web"
  | "api"
  | "media"
  | "browser"
  | "payment"
  | "generic";

export type FailureSignalType =
  | "test_failure"
  | "build_error"
  | "exception"
  | "http_error"
  | "tool_error"
  | "command_error"
  | "validation_error"
  | "payment_error"
  | "timeout";

export type TelemetryCompleteness = "high" | "medium" | "low" | "unknown";

// Stage 0.2-minimal additions: model role / tier / policy. All optional;
// existing 0.1.x callers do not need to set them. When set, model_policy
// gives the escalation detector a structured target to recommend switching
// to (instead of a regex-based heuristic).

export type ModelRole = "primary" | "secondary" | "fallback" | "audit" | "unknown";

export type ModelTier = "premium" | "standard" | "cheap" | "free" | "unknown";

export interface ModelRef {
  provider?: string;
  model?: string;
  role?: ModelRole;
  tier?: ModelTier;
  // Stage 0.5.2: optional per-attempt cost. When set on `secondaryModel`, the
  // model_escalation detector's `model_route.to` carries this value through so
  // the Core can compute a precise `projected_savings.amount_usd` (delta of
  // primary vs secondary). Omit for "I don't have a number" — the Core falls
  // back to a conservative 60% reduction heuristic and labels it accordingly.
  estimatedCostUsd?: number;
}

export interface ModelPolicy {
  primaryModel?: ModelRef;
  secondaryModel?: ModelRef;
  auditModel?: ModelRef;
  // Soft hint only — never produces a hard block in 0.2-minimal. The detector
  // may use this to escalate decision from `warn` to `require_confirmation`
  // but will not emit `block`. Hard limits live in `objective.budget`.
  maxPremiumRetriesWithoutEvidence?: number;
}

export interface ModelRoute {
  from?: ModelRef;
  to?: ModelRef;
  reason?: string;
}

// Stage 0.4: per-request detector policy overrides. All optional; absent fields
// fall back to the detector's hard-coded defaults. Lives under `objective` so
// it travels per-objective (not per-key, not per-server) — keeps Core stateless.
//
// Operators set these in their wrapper based on their own cost sensitivity:
//   - $0.50/scrape  → lower same_tool_retry_threshold (e.g. 3)
//   - $0.02/LLM     → keep default 6
//   - Premium-model wrappers → tune premium_retry_without_evidence_threshold
export interface DetectorPolicy {
  // Triggers same_tool_retry_loop matched rules. Default 6.
  same_tool_retry_threshold?: number;
  // Triggers same_failure_repeated in model_escalation. Default 3.
  premium_retry_without_evidence_threshold?: number;
  // Min cost (USD) at which a non-policy-declared next_action counts as
  // "expensive" for model_escalation regex fallback. Currently the regex is
  // the only fallback; this field is reserved for future use when we let
  // operators opt back in to a cost-only heuristic per their own policy.
  expensive_action_usd_threshold?: number;
  // Bumps stale_context_retry_storm from warn into require_confirmation
  // territory. Default 5.
  require_confirmation_after_repeats?: number;
}

export type EvidenceSignalValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | Record<string, unknown>;

export type EvidenceSignals = Record<string, EvidenceSignalValue>;

export interface MoneyAmount {
  amount: number;
  currency: string;
}

export interface Actor {
  type: string;
  runtime?: string;
  id?: string;
  name?: string;
}

export interface ObjectiveBudget {
  amount: number;
  currency: string;
  hard_limit?: boolean;
}

export interface Objective {
  id?: string;
  goal?: string;
  success_criteria?: string[];
  budget?: ObjectiveBudget;
  max_paid_attempts?: number;
  allowed_actions?: string[];
  blocked_actions?: string[];
  // Stage 0.2-minimal: optional model-routing policy.
  model_policy?: ModelPolicy;
  // Stage 0.4: optional per-request detector threshold overrides.
  detector_policy?: DetectorPolicy;
}

export interface NextAction {
  id?: string;
  type: string;
  provider?: string;
  model?: string;
  estimated_cost: MoneyAmount;
  reason?: string;
  fingerprint?: string;
  // Stage 0.2-minimal: optional explicit role/tier. When `model_role` or
  // `model_tier` indicate premium/primary, the escalation detector treats
  // the action as expensive regardless of the regex heuristic.
  model_role?: ModelRole;
  model_tier?: ModelTier;
}

export interface History {
  attempt_number?: number;
  same_action_count?: number;
  paid_attempts_on_same_failure?: number;
  failure_signal_present?: boolean;
  failure_signal_type?: FailureSignalType;
  failure_fingerprint?: string;
  same_failure_count?: number;
  last_new_evidence_at_attempt?: number;
  new_evidence_since_last_attempt?: boolean | null;
  evidence_kind?: EvidenceKind;
  evidence_signals?: EvidenceSignals;
  confidence_delta?: number;
}

export interface Spend {
  spent_on_objective?: MoneyAmount;
  spent_today?: MoneyAmount;
  daily_budget?: MoneyAmount;
}

export interface TelemetryQuality {
  completeness: TelemetryCompleteness;
  missing_fields?: string[];
}

export interface SpendingGuardCheckInput {
  actor: Actor;
  objective?: Objective;
  next_action: NextAction;
  history?: History;
  spend?: Spend;
  telemetry_quality?: TelemetryQuality;
  // Operator-supplied detector enable list. If omitted, all registered detectors run.
  enabled_detectors?: string[];
}

export interface SuggestedAction {
  type: string;
  message: string;
  // Stage 0.2-minimal: optional structured route when the suggested action is
  // a model switch / downgrade. The SDK helper `checkOrDowngrade` prefers
  // `model_route.to` over its static `downgradeTo` option when present.
  model_route?: ModelRoute;
}

export interface DetectorResult {
  pattern: string;
  detectorVersion: string;
  scoreContribution: number;
  confidence: number;
  matchedRules: string[];
  suggestedActions: SuggestedAction[];
  deterministicDecision?: SpendingGuardDecision;
  metadata?: Record<string, unknown>;
}

export interface DetectorDefinition {
  name: string;
  version: string;
  recommendedFields: string[];
  baseConfidence: number;
  evaluate(input: SpendingGuardCheckInput): DetectorResult | null;
}

// Stage 0.5.2: $-denominated savings estimate. Optional on every response.
// Present when the decision implies the operator will skip / downgrade /
// pause the action. Absent on plain allow.
//
// The number is *projected savings if the operator heeds the recommendation*
// — it is not a refund, not a debit, not a paid quantity. It exists so the
// partner can answer "did the guard save me money this week" without doing
// their own math against the decision log.
export type ProjectedSavingsBasis =
  // The single next paid attempt would not fire.
  | "next_attempt_avoided"
  // The retry pattern is likely to repeat N more times at current burn rate.
  | "projected_future_attempts"
  // Switching to the recommended cheaper model saves the cost delta.
  | "model_downgrade_delta";

export interface ProjectedSavings {
  amount_usd: number;
  currency: "USD";
  basis: ProjectedSavingsBasis;
  // Human-readable explanation, e.g. "Stopping this stale_context_retry_storm
  // avoids the next paid_llm_call ($0.42)."
  explanation: string;
}

export interface SpendingGuardCheckOutput {
  decision: SpendingGuardDecision;
  risk_score: number;
  risk_level: RiskLevel;
  confidence: number;
  pattern: string;
  matched_rules: string[];
  reason: string;
  suggested_action: SuggestedAction;
  recommended_policy: RecommendedPolicy;
  hard_block: boolean;
  requires_human_confirmation: boolean;
  metadata: Record<string, unknown>;
  detector_version: string;
  policy_version: string;
  // Stage 0.5.2: $-savings the operator captures by heeding the recommendation.
  // Omitted on plain `allow`. Present whenever decision is warn /
  // require_confirmation / delay / block, or when suggested_action.type
  // indicates a downgrade / context_refresh / stop_action.
  projected_savings?: ProjectedSavings;
  alternative_actions?: SuggestedAction[];
  error?: {
    code: string;
    message: string;
  };
}

export interface ValidationError {
  error: {
    code: "VALIDATION_ERROR";
    message: string;
    details: Array<{ path: string; message: string }>;
  };
}
