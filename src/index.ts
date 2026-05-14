// Public Core surface.
export { runCheck, type RunCheckOptions } from "./core/check.js";
export {
  spendingGuardCheckInputSchema,
  type SpendingGuardCheckInputParsed,
} from "./core/schemas.js";
export type {
  Actor,
  DetectorDefinition,
  DetectorResult,
  EvidenceKind,
  EvidenceSignalValue,
  EvidenceSignals,
  FailureSignalType,
  History,
  MoneyAmount,
  NextAction,
  Objective,
  ObjectiveBudget,
  RecommendedPolicy,
  RiskLevel,
  Spend,
  SpendingGuardCheckInput,
  SpendingGuardCheckOutput,
  SpendingGuardDecision,
  SuggestedAction,
  TelemetryCompleteness,
  TelemetryQuality,
  UncertainPolicy,
} from "./core/types.js";
export { POLICY_VERSION } from "./core/types.js";

export {
  DEFAULT_DETECTORS,
  selectDetectors,
  staleContextRetryStormDetector,
  taskBudgetBreachDetector,
  sameToolRetryLoopDetector,
  modelEscalationWithoutEvidenceDetector,
  objectiveDriftDetector,
} from "./detectors/index.js";

export { buildServer } from "./server.js";
export { setLoggerSink, getLoggerSink, type LoggerSink } from "./core/logger.js";

export {
  actionFingerprint,
  evidenceFingerprint,
  failureFingerprint,
  inputHash,
  canonicalJson,
  sha256Hex16,
  normalizeString,
  normalizePath,
  normalizeErrorMessage,
} from "./core/fingerprints.js";

export {
  isLegalPair,
  riskLevelFromScore,
  scoreToDecision,
  pickRecommendedPolicy,
} from "./core/policy.js";

// SDK
export {
  SpendingGuard,
  SpendingGuardBlockedError,
  SpendingGuardConfirmationDeniedError,
  type CheckOrConfirmOptions,
  type CheckOrDowngradeOptions,
  type FailureMode,
  type Fetcher,
  type SpendingGuardClientOptions,
} from "./sdk/index.js";

// Adapter (OpenClaw / Hermes-style)
export {
  OpenClawAdapter,
  actionFp,
  evidenceFp,
  failureFp,
  type AgentActionTelemetry,
  type ObjectiveDescriptor,
  type SpendDescriptor,
} from "./adapters/openclaw/index.js";

// Payments
export {
  MockPaymentGuard,
  X402PaymentGuardStub,
  type PaidResource,
  type PaymentGuard,
  type PaymentResult,
} from "./payments/index.js";
