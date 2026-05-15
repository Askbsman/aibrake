import type {
  EvidenceSignals,
  SpendingGuardCheckInput,
} from "../../core/types.js";
import { actionFp, evidenceFp, failureFp } from "./fingerprints.js";
import type {
  AgentActionTelemetry,
  ObjectiveDescriptor,
  SpendDescriptor,
} from "./types.js";

const DEFAULT_OBJECTIVE_KEY = "__default__";

interface RecordedEvent {
  telemetry: AgentActionTelemetry;
  failureFingerprint: string | undefined;
  actionFingerprint: string;
  evidenceFingerprint: string;
}

export interface BuildCheckInputOptions {
  objective?: ObjectiveDescriptor;
  spend?: SpendDescriptor;
  enabledDetectors?: string[];
}

export class OpenClawAdapter {
  private readonly events: Map<string, RecordedEvent[]> = new Map();

  record(event: AgentActionTelemetry): void {
    const key = event.objectiveId ?? DEFAULT_OBJECTIVE_KEY;
    const list = this.events.get(key) ?? [];
    list.push({
      telemetry: event,
      failureFingerprint: failureFp(event),
      actionFingerprint: actionFp(event, event.objectiveId),
      evidenceFingerprint: evidenceFp(event),
    });
    this.events.set(key, list);
  }

  history(objectiveId?: string): readonly RecordedEvent[] {
    return this.events.get(objectiveId ?? DEFAULT_OBJECTIVE_KEY) ?? [];
  }

  reset(objectiveId?: string): void {
    if (objectiveId === undefined) {
      this.events.clear();
      return;
    }
    this.events.delete(objectiveId);
  }

  buildCheckInput(
    nextAction: AgentActionTelemetry,
    options: BuildCheckInputOptions = {}
  ): SpendingGuardCheckInput {
    const key = nextAction.objectiveId ?? DEFAULT_OBJECTIVE_KEY;
    const past = this.events.get(key) ?? [];

    const failureFingerprintNext = failureFp(nextAction);
    const actionFingerprintNext = actionFp(nextAction, nextAction.objectiveId);
    const evidenceFingerprintNext = evidenceFp(nextAction);

    const sameFailureEvents = failureFingerprintNext
      ? past.filter((e) => e.failureFingerprint === failureFingerprintNext)
      : [];
    const sameFailureCount = sameFailureEvents.length;

    const sameActionEvents = past.filter(
      (e) => e.actionFingerprint === actionFingerprintNext
    );
    const sameActionCount = sameActionEvents.length;

    const paidAttemptsOnSameFailure = sameFailureEvents.filter(
      (e) => (e.telemetry.estimatedCostUsd ?? 0) > 0
    ).length;

    const lastSameFailure = sameFailureEvents.at(-1);

    const filesReadSince = lastSameFailure
      ? countSince(past, lastSameFailure, (e) => e.telemetry.filesRead?.length ?? 0)
      : 0;
    const testsRunSince = lastSameFailure
      ? countSince(past, lastSameFailure, (e) => e.telemetry.testsRun?.length ?? 0)
      : 0;
    const logsReadSince = lastSameFailure
      ? countSince(past, lastSameFailure, (e) => e.telemetry.logsRead?.length ?? 0)
      : 0;
    const gitDiffChangedSince = lastSameFailure
      ? sliceSince(past, lastSameFailure).some(
          (e) => e.telemetry.gitDiffChanged === true
        )
      : false;
    const toolResultsChangedSince = lastSameFailure
      ? sliceSince(past, lastSameFailure).some(
          (e) => e.telemetry.toolResultsChanged === true
        )
      : false;

    const newEvidence =
      lastSameFailure === undefined
        ? null
        : filesReadSince > 0 ||
          testsRunSince > 0 ||
          logsReadSince > 0 ||
          gitDiffChangedSince ||
          toolResultsChangedSince;

    // Scan past events from newest to oldest; the most recent one that
    // actually gathered any evidence is the "last_new_evidence_at_attempt"
    // we report. Undefined when no past event has gathered anything.
    let lastNewEvidenceAtAttempt: number | undefined;
    for (let i = past.length - 1; i >= 0; i -= 1) {
      const e = past[i]!.telemetry;
      if (
        (e.filesRead?.length ?? 0) > 0 ||
        (e.testsRun?.length ?? 0) > 0 ||
        (e.logsRead?.length ?? 0) > 0 ||
        e.gitDiffChanged === true ||
        e.toolResultsChanged === true
      ) {
        lastNewEvidenceAtAttempt = i + 1;
        break;
      }
    }

    const confidenceDelta =
      typeof nextAction.confidenceBefore === "number" &&
      typeof nextAction.confidenceAfter === "number"
        ? nextAction.confidenceAfter - nextAction.confidenceBefore
        : 0;

    const evidenceSignals: EvidenceSignals = {
      files_read_since_last_attempt: filesReadSince,
      tests_run_since_last_attempt: testsRunSince,
      logs_read_since_last_attempt: logsReadSince,
      git_diff_changed_since_last_attempt: gitDiffChangedSince,
      tool_results_changed_since_last_attempt: toolResultsChangedSince,
      context_source_confirmed: nextAction.contextSourceConfirmed ?? false,
      evidence_fingerprint: evidenceFingerprintNext,
    };

    const cost = nextAction.estimatedCostUsd ?? 0;
    const completeness =
      nextAction.failureSignalPresent === undefined && sameActionCount === 0
        ? "high"
        : "high";

    const input: SpendingGuardCheckInput = {
      actor: {
        type: "agent",
        runtime: nextAction.runtime ?? "openclaw",
        id: nextAction.runId ?? nextAction.actionId,
      },
      next_action: {
        id: nextAction.actionId,
        type: nextAction.actionType,
        ...(nextAction.provider !== undefined
          ? { provider: nextAction.provider }
          : {}),
        ...(nextAction.model !== undefined ? { model: nextAction.model } : {}),
        estimated_cost: { amount: cost, currency: "USD" },
        ...(nextAction.reason !== undefined ? { reason: nextAction.reason } : {}),
        fingerprint: actionFingerprintNext,
        ...(nextAction.modelRole !== undefined ? { model_role: nextAction.modelRole } : {}),
        ...(nextAction.modelTier !== undefined ? { model_tier: nextAction.modelTier } : {}),
      },
      history: {
        attempt_number: sameActionCount + 1,
        same_action_count: sameActionCount,
        paid_attempts_on_same_failure: paidAttemptsOnSameFailure,
        ...(nextAction.failureSignalPresent !== undefined
          ? { failure_signal_present: nextAction.failureSignalPresent }
          : {}),
        ...(nextAction.failureSignalType !== undefined
          ? { failure_signal_type: nextAction.failureSignalType }
          : {}),
        ...(failureFingerprintNext !== undefined
          ? { failure_fingerprint: failureFingerprintNext }
          : {}),
        same_failure_count: sameFailureCount,
        ...(lastNewEvidenceAtAttempt !== undefined
          ? { last_new_evidence_at_attempt: lastNewEvidenceAtAttempt }
          : {}),
        new_evidence_since_last_attempt: newEvidence,
        evidence_kind: "code",
        evidence_signals: evidenceSignals,
        confidence_delta: confidenceDelta,
      },
      telemetry_quality: { completeness },
    };

    if (options.objective) {
      input.objective = {
        ...(options.objective.id !== undefined ? { id: options.objective.id } : {}),
        ...(options.objective.goal !== undefined
          ? { goal: options.objective.goal }
          : {}),
        ...(options.objective.successCriteria !== undefined
          ? { success_criteria: options.objective.successCriteria }
          : {}),
        ...(options.objective.budget !== undefined
          ? {
              budget: {
                amount: options.objective.budget.amount,
                currency: options.objective.budget.currency,
                ...(options.objective.budget.hardLimit !== undefined
                  ? { hard_limit: options.objective.budget.hardLimit }
                  : {}),
              },
            }
          : {}),
        ...(options.objective.maxPaidAttempts !== undefined
          ? { max_paid_attempts: options.objective.maxPaidAttempts }
          : {}),
        ...(options.objective.allowedActions !== undefined
          ? { allowed_actions: options.objective.allowedActions }
          : {}),
        ...(options.objective.blockedActions !== undefined
          ? { blocked_actions: options.objective.blockedActions }
          : {}),
        ...(options.objective.modelPolicy !== undefined
          ? { model_policy: options.objective.modelPolicy }
          : {}),
        ...(options.objective.detectorPolicy !== undefined
          ? { detector_policy: options.objective.detectorPolicy }
          : {}),
      };
    }

    if (options.spend) {
      input.spend = {
        ...(options.spend.spentOnObjectiveUsd !== undefined
          ? {
              spent_on_objective: {
                amount: options.spend.spentOnObjectiveUsd,
                currency: "USD",
              },
            }
          : {}),
        ...(options.spend.spentTodayUsd !== undefined
          ? {
              spent_today: {
                amount: options.spend.spentTodayUsd,
                currency: "USD",
              },
            }
          : {}),
        ...(options.spend.dailyBudgetUsd !== undefined
          ? {
              daily_budget: {
                amount: options.spend.dailyBudgetUsd,
                currency: "USD",
              },
            }
          : {}),
      };
    }

    if (options.enabledDetectors) {
      input.enabled_detectors = options.enabledDetectors;
    }

    return input;
  }
}

// Inclusive slice from the marker forward.
// Rationale: the files/tests/logs read DURING the last same-failure attempt
// represent "evidence gathered between attempts." If attempt N read files and
// attempt N+1 is about to fire on the same failure, those reads count as new
// evidence for the upcoming check — otherwise the detector cannot tell the
// difference between a stale loop and an attempt that did investigate.
function sliceSince(
  past: readonly RecordedEvent[],
  marker: RecordedEvent
): RecordedEvent[] {
  const idx = past.indexOf(marker);
  if (idx === -1) return [];
  return past.slice(idx);
}

function countSince(
  past: readonly RecordedEvent[],
  marker: RecordedEvent,
  pick: (e: RecordedEvent) => number
): number {
  return sliceSince(past, marker).reduce((acc, e) => acc + pick(e), 0);
}
