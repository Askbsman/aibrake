import type {
  DetectorDefinition,
  DetectorResult,
  SpendingGuardCheckInput,
} from "../core/types.js";

const NAME = "stale_context_retry_storm";
const VERSION = `${NAME}@0.1.0`;

// Hard stale-context retry detector. REQUIRES history.failure_signal_present === true.
//
// Score-piling rule: the count-based and coding-domain penalties only fire
// when we are confident the agent is NOT investigating
// (new_evidence_since_last_attempt === false). With newEvidence=true or null,
// the detector gives a much softer signal — repeat counts alone are not a
// loop pattern if the agent is actively gathering evidence between attempts.
export const staleContextRetryStormDetector: DetectorDefinition = {
  name: NAME,
  version: VERSION,
  baseConfidence: 0.9,
  recommendedFields: [
    "history.failure_signal_present",
    "history.failure_signal_type",
    "history.failure_fingerprint",
    "history.same_failure_count",
    "history.paid_attempts_on_same_failure",
    "history.new_evidence_since_last_attempt",
    "history.evidence_kind",
    "history.evidence_signals",
    "history.confidence_delta",
  ],
  evaluate(input: SpendingGuardCheckInput): DetectorResult | null {
    const h = input.history;
    if (!h) return null;
    if (h.failure_signal_present !== true) return null;

    const sameFailure = h.same_failure_count ?? 0;
    const paidAttempts = h.paid_attempts_on_same_failure ?? 0;
    const newEvidence = h.new_evidence_since_last_attempt;
    const confidenceDelta = h.confidence_delta ?? 0;

    // Minimum-attempts threshold: don't call something a "retry storm" until
    // we have at least 3 same-failure repeats or 3 paid attempts.
    if (sameFailure < 3 && paidAttempts < 3) return null;

    const matched: string[] = ["failure_signal_present"];
    let score = 10;

    const stuckPattern = newEvidence === false;

    if (stuckPattern) {
      // Full loop-pattern signals only when we know the agent is not
      // gathering evidence between attempts.
      if (sameFailure >= 3) {
        matched.push("same_failure_count_low");
        score += 10;
      }
      if (sameFailure >= 5) {
        matched.push("same_failure_count_high");
        score += 10;
      }
      if (sameFailure >= 7) {
        matched.push("same_failure_count_critical");
        score += 10;
      }
      if (paidAttempts >= 5) {
        matched.push("paid_attempts_on_same_failure_high");
        score += 20;
      }
      matched.push("no_new_evidence_since_last_attempt");
      score += 20;
      if (confidenceDelta <= 0 && (sameFailure >= 3 || paidAttempts >= 3)) {
        matched.push("confidence_not_improving");
        score += 10;
      }
      if (h.evidence_kind === "code") {
        const signals = h.evidence_signals ?? {};
        if (signals.files_read_since_last_attempt === 0) {
          matched.push("no_files_read_since_last_attempt");
          score += 8;
        }
        if (signals.tests_run_since_last_attempt === 0) {
          matched.push("no_tests_run_since_last_attempt");
          score += 8;
        }
        if (signals.logs_read_since_last_attempt === 0) {
          matched.push("no_logs_read_since_last_attempt");
          score += 8;
        }
        if (signals.git_diff_changed_since_last_attempt === false) {
          matched.push("git_diff_unchanged");
          score += 8;
        }
        if (signals.context_source_confirmed === false) {
          matched.push("context_source_unconfirmed");
          score += 10;
        }
      }
    } else {
      // newEvidence is true (or unknown). The agent is — or might be —
      // investigating. Soft signal only.
      if (sameFailure >= 7) {
        matched.push("same_failure_repeated_with_evidence");
        score += 10;
      }
      if (newEvidence === null && (sameFailure >= 5 || paidAttempts >= 5)) {
        matched.push("repeats_with_unknown_evidence");
        score += 10;
      }
    }

    // No detector signal beyond the precondition.
    if (matched.length <= 1) return null;

    const failureType = h.failure_signal_type ?? "failure";
    const upcomingAttempt =
      h.attempt_number ?? Math.max(paidAttempts, sameFailure) + 1;
    const lastEvidenceAt = h.last_new_evidence_at_attempt;

    const evidenceClause = stuckPattern
      ? lastEvidenceAt
        ? `${sameFailure} prior repeats with no new files, tests, logs, or state changes since attempt #${lastEvidenceAt}`
        : `${sameFailure} prior repeats with no evidence gathered in any attempt`
      : newEvidence === true
        ? `${sameFailure} prior repeats but the agent did gather new evidence between attempts`
        : `${sameFailure} prior repeats; evidence-gathering between attempts is unknown`;

    const reason =
      `Attempt #${upcomingAttempt} on the same ${failureType}: ${evidenceClause}. ` +
      (stuckPattern
        ? "Another paid retry is unlikely to produce a different result without a context refresh."
        : "Repeat count is high but the agent appears to be investigating; surfacing as a soft warning.");

    return {
      pattern: NAME,
      detectorVersion: VERSION,
      scoreContribution: score,
      confidence: 0.9, // pre-aggregation; coverage downgrade happens in runCheck
      matchedRules: matched,
      suggestedActions: [
        {
          type: "context_refresh",
          message:
            "Before another paid model call, read the actual failing file, run the exact failing test, confirm the current git diff, or downgrade to a cheaper model.",
        },
      ],
      metadata: {
        same_failure_count: sameFailure,
        paid_attempts_on_same_failure: paidAttempts,
        upcoming_attempt: upcomingAttempt,
        last_new_evidence_at_attempt: lastEvidenceAt ?? null,
        new_evidence_missing: stuckPattern,
        reason,
      },
    };
  },
};
