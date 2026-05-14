import {
  actionFingerprint,
  evidenceFingerprint,
  failureFingerprint,
} from "../../core/fingerprints.js";
import type { AgentActionTelemetry } from "./types.js";

export function actionFp(t: AgentActionTelemetry, objectiveId?: string): string {
  return actionFingerprint({
    action_type: t.actionType,
    tool_name: t.toolName,
    provider: t.provider,
    model: t.model,
    normalized_reason: t.reason,
    objective_id: objectiveId,
  });
}

export function failureFp(t: AgentActionTelemetry): string | undefined {
  if (!t.failureSignalPresent) return undefined;
  return failureFingerprint({
    failure_signal_type: t.failureSignalType,
    error_code: t.errorCode,
    normalized_error_message: t.errorMessage,
    failing_file: t.failingFile,
    failing_test: t.failingTest,
    tool_name: t.toolName,
  });
}

export function evidenceFp(t: AgentActionTelemetry): string {
  return evidenceFingerprint({
    evidence_kind: "code",
    signals: {
      files_read: (t.filesRead ?? []).slice().sort(),
      tests_run: (t.testsRun ?? []).slice().sort(),
      logs_read: (t.logsRead ?? []).slice().sort(),
      git_diff_changed: t.gitDiffChanged ?? null,
      tool_results_changed: t.toolResultsChanged ?? null,
      context_source_confirmed: t.contextSourceConfirmed ?? null,
    },
  });
}
