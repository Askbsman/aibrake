// Public Core surface.
export { runCheck, type RunCheckOptions } from "./core/check.js";
export {
  spendingGuardCheckInputSchema,
  type SpendingGuardCheckInputParsed,
} from "./core/schemas.js";
export type {
  Actor,
  DetectorDefinition,
  DetectorPolicy,
  DetectorResult,
  EvidenceKind,
  EvidenceSignalValue,
  EvidenceSignals,
  FailureSignalType,
  History,
  ModelPolicy,
  ModelRef,
  ModelRole,
  ModelRoute,
  ModelTier,
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
  unverifiedSuccessAssertionDetector,
} from "./detectors/index.js";

// NOTE: buildServer moved to a separate entry point in 0.5.7-beta to
// keep the client-only install free of fastify (~50 MB of transitive
// deps). Import it from "aibrake/server" instead:
//
//   import { buildServer } from "aibrake/server";
//
// You also need to install fastify yourself: `npm install fastify`.
// See CHANGELOG.md 0.5.7-beta for the full rationale.
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
  SpendingGuardTransportError,
  SpendingGuardValidationError,
  type CheckOrConfirmOptions,
  type CheckOrDowngradeOptions,
  type FailureMode,
  type Fetcher,
  type SpendingGuardClientOptions,
} from "./sdk/index.js";

// Adapter (OpenClaw / Hermes-style, aliased as CodingAgentAdapter in 0.4)
export {
  OpenClawAdapter,
  actionFp,
  evidenceFp,
  failureFp,
  type AgentActionTelemetry,
  type ObjectiveDescriptor,
  type SpendDescriptor,
} from "./adapters/openclaw/index.js";
// Stage 0.4: friendly alias for partners running Claude Code / Codex / Cursor /
// custom coding-agent wrappers. Same class as OpenClawAdapter.
export { CodingAgentAdapter } from "./adapters/coding-agent/index.js";

// Payments
export {
  MockPaymentGuard,
  X402PaymentGuardStub,
  type PaidResource,
  type PaymentGuard,
  type PaymentResult,
} from "./payments/index.js";
