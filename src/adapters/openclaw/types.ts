import type {
  DetectorPolicy,
  FailureSignalType,
  ModelPolicy,
  ModelRole,
  ModelTier,
} from "../../core/types.js";

// Universal telemetry payload accepted by the OpenClaw/Hermes-style adapter.
// Adapters are stateful (per-process). Core remains stateless.
export interface AgentActionTelemetry {
  actionId: string;
  runId?: string;
  objectiveId?: string;
  runtime?: "openclaw" | "hermes" | "custom" | string;
  actionType: string;
  toolName?: string;
  provider?: string;
  model?: string;
  estimatedCostUsd?: number;
  reason?: string;
  // Stage 0.2-minimal: optional explicit role/tier declarations.
  modelRole?: ModelRole;
  modelTier?: ModelTier;
  inputFingerprint?: string;
  outputFingerprint?: string;
  errorFingerprint?: string;
  failureSignalPresent?: boolean;
  failureSignalType?: FailureSignalType;
  failingFile?: string;
  failingTest?: string;
  errorCode?: string;
  errorMessage?: string;
  filesRead?: string[];
  testsRun?: string[];
  logsRead?: string[];
  toolResultsChanged?: boolean;
  gitDiffChanged?: boolean;
  contextSourceConfirmed?: boolean;
  confidenceBefore?: number;
  confidenceAfter?: number;
  timestamp: string;
}

export interface ObjectiveDescriptor {
  id?: string;
  goal?: string;
  budget?: { amount: number; currency: string; hardLimit?: boolean };
  maxPaidAttempts?: number;
  allowedActions?: string[];
  blockedActions?: string[];
  successCriteria?: string[];
  // Stage 0.2-minimal: optional model-routing policy that the adapter forwards
  // unchanged into `input.objective.model_policy` for the Core check.
  modelPolicy?: ModelPolicy;
  // Stage 0.4: per-request detector threshold overrides. Forwarded into
  // `input.objective.detector_policy` unchanged.
  detectorPolicy?: DetectorPolicy;
}

export interface SpendDescriptor {
  spentOnObjectiveUsd?: number;
  spentTodayUsd?: number;
  dailyBudgetUsd?: number;
}
