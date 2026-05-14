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
}

export interface NextAction {
  id?: string;
  type: string;
  provider?: string;
  model?: string;
  estimated_cost: MoneyAmount;
  reason?: string;
  fingerprint?: string;
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
