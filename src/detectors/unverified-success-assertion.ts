import type {
  DetectorDefinition,
  DetectorResult,
  SpendingGuardCheckInput,
} from "../core/types.js";

const NAME = "unverified_success_assertion";
const VERSION = `${NAME}@0.1.0`;

// ─────────────────────────────────────────────────────────────────────────
// Unverified success-assertion detector.
//
// Catches the pattern where an agent confidently declares an operational
// outcome ("deployed", "fixed", "installed", "restarted") without running
// ANY verification action — no health check, no endpoint curl, no log
// read, no `pm2 status`, no test run, no file re-read.
//
// Motivated by a real failure observed 2026-05-19: an agent reported
// "✅ Готово! aibrake/auto added, deployed, PM2 restarted" on a Node
// import path that didn't exist in the installed package version. The
// Node process was crash-looping, but the agent asserted success because
// it had never `pm2 status`-ed or curled the endpoint after the deploy.
//
// This detector is INTENTIONALLY separate from the retry-storm family.
// Those detectors reason about LLM call patterns; this one reasons about
// agent-claim patterns. They share the evidence-signals model — partners
// don't need to learn new telemetry shapes.
// ─────────────────────────────────────────────────────────────────────────

const ASSERTION_ACTION_TYPES = new Set([
  "success_assertion",
  "deployment_assertion",
  "install_assertion",
  "restart_assertion",
  "fix_assertion",
  "claim_success",
  "task_complete",
]);

const VERIFICATION_KEYS = [
  "health_check_run",
  "endpoint_curled",
  "process_status_checked",
  "logs_read_after_action",
  "tests_run_after_action",
  "file_re_read_after_edit",
  "git_diff_verified",
  "smoke_test_passed",
] as const;

function isTruthyEvidence(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v === true;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") return v.length > 0;
  return false;
}

export const unverifiedSuccessAssertionDetector: DetectorDefinition = {
  name: NAME,
  version: VERSION,
  baseConfidence: 0.9,
  // Only fields that must be PRESENT for the detector to fire. Absence
  // of verification signals is itself the pattern we're detecting, so
  // listing them as "recommended" would penalise the confidence score
  // exactly when we want it to fire confidently.
  recommendedFields: ["next_action.type"],
  evaluate(input: SpendingGuardCheckInput): DetectorResult | null {
    const actionType = input.next_action?.type;
    if (!actionType) return null;
    if (!ASSERTION_ACTION_TYPES.has(actionType)) return null;

    const signals = input.history?.evidence_signals ?? {};
    const verificationsFound: string[] = [];
    for (const key of VERIFICATION_KEYS) {
      if (isTruthyEvidence(signals[key])) verificationsFound.push(key);
    }

    const matched: string[] = ["success_assertion_action_type"];
    let score = 20; // base — we have an assertion, that alone is worth noting
    let deterministic: "block" | undefined;

    if (verificationsFound.length === 0) {
      matched.push("zero_verification_signals");
      score += 50;

      if (!isTruthyEvidence(signals["process_status_checked"])) {
        matched.push("no_process_status_check");
        score += 10;
      }
      if (!isTruthyEvidence(signals["endpoint_curled"])) {
        matched.push("no_endpoint_curl");
        score += 10;
      }
      if (!isTruthyEvidence(signals["logs_read_after_action"])) {
        matched.push("no_logs_read");
        score += 5;
      }
    } else if (verificationsFound.length === 1) {
      matched.push("only_one_verification_signal");
      score += 20;
    } else {
      // 2+ verifications — properly checked, let it pass.
      return null;
    }

    if (score > 100) score = 100;

    // Deterministic block when literally zero verifications AND the action
    // type is a high-stakes operational one (deploy / restart).
    if (
      verificationsFound.length === 0 &&
      (actionType === "deployment_assertion" || actionType === "restart_assertion")
    ) {
      matched.push("hard_deploy_unverified");
      deterministic = "block";
    }

    const missing = VERIFICATION_KEYS.filter(
      (k) => !isTruthyEvidence(signals[k])
    );
    const reasonParts = [
      `Agent is about to claim success on a "${actionType}" action`,
      verificationsFound.length === 0
        ? " without running any verification step"
        : ` with only one verification step (${verificationsFound[0]})`,
      ".",
    ];
    if (missing.length > 0 && missing.length <= 4) {
      reasonParts.push(
        ` Recommended before asserting success: ${missing.join(", ")}.`
      );
    } else if (missing.length > 0) {
      reasonParts.push(
        ` Recommended before asserting success: ${missing.slice(0, 3).join(", ")}, and ${missing.length - 3} more.`
      );
    }
    const reasonText = reasonParts.join("").trim();

    return {
      pattern: NAME,
      detectorVersion: VERSION,
      scoreContribution: score,
      confidence: 0.9,
      matchedRules: matched,
      suggestedActions: [
        deterministic
          ? {
              type: "stop_action",
              message:
                "Run at least one verification step (process status check, endpoint curl, log read) before asserting that the deploy succeeded.",
            }
          : {
              type: "ask_human",
              message:
                "Confirm the agent has actually verified the outcome — at minimum, check the process status and curl the endpoint.",
            },
      ],
      ...(deterministic ? { deterministicDecision: deterministic } : {}),
      metadata: {
        verifications_found: verificationsFound,
        verifications_missing: missing,
        action_type: actionType,
        reason: reasonText,
      },
    };
  },
};
