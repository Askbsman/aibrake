// Stage 0.4 — per-request detector_policy threshold overrides.
//
// Operators with very high-cost paid actions (paid scrapes at $0.50, premium
// media generation at $1+) can tune the loop-trigger thresholds DOWN so the
// guard surfaces patterns earlier. Operators with low-cost LLM workflows keep
// the defaults. No server state; everything is per-request via
// objective.detector_policy.

import { describe, expect, it } from "vitest";
import { runCheck } from "../src/core/check.js";
import { setLoggerSink } from "../src/core/logger.js";
import { sameToolRetryLoopDetector } from "../src/detectors/same-tool-retry-loop.js";
import { staleContextRetryStormDetector } from "../src/detectors/stale-context-retry-storm.js";
import { modelEscalationWithoutEvidenceDetector } from "../src/detectors/model-escalation-without-evidence.js";
import type { SpendingGuardCheckInput } from "../src/core/types.js";

setLoggerSink({ emit: () => {} });

function scraperInput(
  sameAction: number,
  overrides: Partial<SpendingGuardCheckInput["objective"]> = {}
): SpendingGuardCheckInput {
  return {
    actor: { type: "agent" },
    objective: {
      id: "obj_scrape",
      goal: "scrape",
      budget: { amount: 10, currency: "USD", hard_limit: false },
      ...overrides,
    },
    next_action: {
      type: "paid_scrape_call",
      provider: "anchor",
      model: "browser-v1",
      estimated_cost: { amount: 0.5, currency: "USD" },
      reason: "scrape page",
    },
    history: {
      attempt_number: sameAction + 1,
      same_action_count: sameAction,
      paid_attempts_on_same_failure: 0,
      failure_signal_present: false,
      evidence_kind: "web",
      evidence_signals: { tool_results_changed_since_last_attempt: false },
      confidence_delta: 0,
    },
    spend: { spent_on_objective: { amount: 0.5 * sameAction, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
}

function codingFailureInput(
  sameFailure: number,
  overrides: Partial<SpendingGuardCheckInput["objective"]> = {}
): SpendingGuardCheckInput {
  return {
    actor: { type: "agent" },
    objective: {
      id: "obj_fix",
      goal: "fix lint",
      budget: { amount: 5, currency: "USD", hard_limit: false },
      ...overrides,
    },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-opus",
      estimated_cost: { amount: 0.42, currency: "USD" },
      reason: "fix lint",
    },
    history: {
      attempt_number: sameFailure + 1,
      same_action_count: sameFailure,
      paid_attempts_on_same_failure: sameFailure,
      failure_signal_present: true,
      failure_signal_type: "command_error",
      failure_fingerprint: "fp_v1_test",
      same_failure_count: sameFailure,
      new_evidence_since_last_attempt: false,
      evidence_kind: "code",
      evidence_signals: {
        files_read_since_last_attempt: 0,
        tests_run_since_last_attempt: 0,
      },
      confidence_delta: 0,
    },
    spend: { spent_on_objective: { amount: 0.42 * sameFailure, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
}

describe("Stage 0.4 — detector_policy.same_tool_retry_threshold", () => {
  it("01. default threshold (6) — same_tool_retry_loop does NOT fire at sameAction=4", () => {
    const result = sameToolRetryLoopDetector.evaluate(scraperInput(4));
    expect(result).toBeNull();
  });

  it("02. override threshold to 3 — same_tool_retry_loop DOES fire at sameAction=4", () => {
    const result = sameToolRetryLoopDetector.evaluate(
      scraperInput(4, { detector_policy: { same_tool_retry_threshold: 3 } })
    );
    expect(result).not.toBeNull();
    expect(result?.matchedRules).toContain("same_action_count_high");
  });

  it("03. override threshold to 3 — runCheck output surfaces warn earlier", () => {
    const out = runCheck(
      scraperInput(4, { detector_policy: { same_tool_retry_threshold: 3 } })
    );
    expect(out.pattern).toBe("same_tool_retry_loop");
    expect(out.decision).toBe("warn");
  });

  it("04. raising threshold suppresses the detector entirely", () => {
    // With same_action=6 (which would trip the default), raise threshold to 10.
    const result = sameToolRetryLoopDetector.evaluate(
      scraperInput(6, { detector_policy: { same_tool_retry_threshold: 10 } })
    );
    expect(result).toBeNull();
  });
});

describe("Stage 0.4 — detector_policy.premium_retry_without_evidence_threshold", () => {
  it("05. default threshold (3) — stale_context_retry_storm does NOT fire at sameFailure=2", () => {
    const result = staleContextRetryStormDetector.evaluate(codingFailureInput(2));
    expect(result).toBeNull();
  });

  it("06. override threshold to 2 — stale_context_retry_storm DOES fire at sameFailure=2", () => {
    const result = staleContextRetryStormDetector.evaluate(
      codingFailureInput(2, {
        detector_policy: { premium_retry_without_evidence_threshold: 2 },
      })
    );
    expect(result).not.toBeNull();
    expect(result?.matchedRules).toContain("failure_signal_present");
  });

  it("07. same threshold also tunes model_escalation_without_evidence", () => {
    // sameFailure=2 normally below the 3 threshold for same_failure_repeated.
    // Override to 2 → same_failure_repeated rule fires.
    const result = modelEscalationWithoutEvidenceDetector.evaluate(
      codingFailureInput(2, {
        detector_policy: { premium_retry_without_evidence_threshold: 2 },
      })
    );
    expect(result).not.toBeNull();
    expect(result?.matchedRules).toContain("same_failure_repeated");
  });
});

describe("Stage 0.4 — detector_policy is per-request, never server-state", () => {
  it("08. setting policy on one request does not affect a subsequent request without policy", () => {
    const withOverride = runCheck(
      scraperInput(4, { detector_policy: { same_tool_retry_threshold: 3 } })
    );
    const withoutOverride = runCheck(scraperInput(4));
    // First call triggers warn (threshold 3); second uses default 6 → no fire.
    expect(withOverride.pattern).toBe("same_tool_retry_loop");
    expect(withoutOverride.pattern).not.toBe("same_tool_retry_loop");
  });
});
