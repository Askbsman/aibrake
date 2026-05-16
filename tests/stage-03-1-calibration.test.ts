// Stage 0.3.1 pre-partner calibration regression tests.
//
// Two findings from the simulated 3-partner validation (validation-log/):
//   1. model_escalation_without_evidence fired on cold start (Partner A).
//   2. The same detector produced `decision: allow` + `suggested_action:
//      downgrade_model` in the same response (Partner B dissonance).
// Both are fixed here. These tests pin the behavior so future calibration
// does not silently regress them.

import { describe, expect, it } from "vitest";
import { runCheck } from "../src/core/check.js";
import { setLoggerSink } from "../src/core/logger.js";
import { modelEscalationWithoutEvidenceDetector } from "../src/detectors/model-escalation-without-evidence.js";
import type { SpendingGuardCheckInput } from "../src/core/types.js";

setLoggerSink({ emit: () => {} });

// ────────────────────────────────────────────────────────────────────────
// Fix 1 — cold-start false-positive on model_escalation_without_evidence
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.3.1 — cold-start false positive (Partner A reproduction)", () => {
  function coldStartScraperPayload(): SpendingGuardCheckInput {
    // Exactly the shape Partner A hand-rolled when reading
    // PARTNER_ONBOARDING.md: a paid scraper at $0.50/call, no LLM model,
    // no failure history, sending new_evidence_since_last_attempt=false on
    // the first call because the operator's natural mental model says
    // "I haven't gathered evidence yet."
    return {
      actor: { type: "agent", runtime: "custom-scraper", id: "scraper" },
      objective: {
        id: "obj_scrape",
        goal: "Pull pricing data",
        budget: { amount: 20, currency: "USD", hard_limit: false },
      },
      next_action: {
        type: "paid_scrape_call",
        provider: "anchor",
        model: "browser-v1",
        estimated_cost: { amount: 0.5, currency: "USD" },
        reason: "scrape pricing page",
      },
      history: {
        attempt_number: 1,
        same_action_count: 0,
        paid_attempts_on_same_failure: 0,
        failure_signal_present: false,
        new_evidence_since_last_attempt: false,
        evidence_kind: "web",
        evidence_signals: { tool_results_changed_since_last_attempt: false },
        confidence_delta: 0,
      },
      spend: { spent_on_objective: { amount: 0, currency: "USD" } },
      telemetry_quality: { completeness: "high" },
    };
  }

  it("01. detector returns null on a cold-start scraper payload (no model name, no history)", () => {
    const result = modelEscalationWithoutEvidenceDetector.evaluate(
      coldStartScraperPayload()
    );
    expect(result).toBeNull();
  });

  it("02. runCheck of the cold-start payload returns decision: allow + pattern: none", () => {
    const out = runCheck(coldStartScraperPayload());
    expect(out.decision).toBe("allow");
    expect(out.pattern).toBe("none");
    expect(out.hard_block).toBe(false);
  });

  it("03. cold-start with an expensive LLM model name but no history also stays clean (no_new_evidence does not fire on its own)", () => {
    // Even when the model name matches the regex (claude-opus), if there is
    // no prior failure history, the detector should not pile the
    // no_new_evidence penalty on. With score = 10 (expensive_next_action only)
    // and matched.length === 1, the detector returns null.
    const input = coldStartScraperPayload();
    input.next_action.provider = "anthropic";
    input.next_action.model = "claude-opus";
    input.next_action.estimated_cost.amount = 0.42;
    const result = modelEscalationWithoutEvidenceDetector.evaluate(input);
    expect(result).toBeNull();
  });

  it("04. cold-start uncertain false positive is gone (Partner A reproduction case)", () => {
    // Exact reproduction of Partner A's observed output before the fix:
    //   decision: uncertain, pattern: model_escalation_without_evidence,
    //   suggested_action.type: downgrade_model.
    // After the fix this becomes a clean allow / none.
    const out = runCheck(coldStartScraperPayload());
    expect(out.decision).not.toBe("uncertain");
    expect(out.pattern).not.toBe("model_escalation_without_evidence");
    expect(out.suggested_action.type).not.toBe("downgrade_model");
    expect(out.suggested_action.type).not.toBe("switch_model");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fix 2 — allow + downgrade dissonance (Partner B reproduction)
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.3.1 — no allow + downgrade dissonance (Partner B reproduction)", () => {
  function secondAttemptOpusPayload(): SpendingGuardCheckInput {
    // Partner B (coding-agent operator, Claude Code wrapper) at attempt #2
    // of a failing lint workflow. No model_policy declared. Before the fix
    // this returned decision: allow + suggested_action.type: downgrade_model
    // because coverage_ratio was 4/5 → confidence 0.60 → fell below the
    // warn-band threshold of 0.70.
    return {
      actor: { type: "agent", runtime: "claude-code-wrapper" },
      objective: {
        id: "obj_lint_fix",
        goal: "Fix lint errors",
        budget: { amount: 5, currency: "USD", hard_limit: false },
      },
      next_action: {
        type: "paid_llm_call",
        provider: "anthropic",
        model: "claude-opus",
        estimated_cost: { amount: 0.42, currency: "USD" },
        reason: "fix lint errors",
      },
      history: {
        attempt_number: 2,
        same_action_count: 1,
        paid_attempts_on_same_failure: 1,
        failure_signal_present: true,
        failure_signal_type: "command_error",
        failure_fingerprint: "fp_v1_failure_lint",
        same_failure_count: 1,
        new_evidence_since_last_attempt: false,
        evidence_kind: "code",
        evidence_signals: {
          files_read_since_last_attempt: 0,
          tests_run_since_last_attempt: 0,
        },
        confidence_delta: 0,
      },
      spend: { spent_on_objective: { amount: 0.42, currency: "USD" } },
      telemetry_quality: { completeness: "high" },
    };
  }

  it("05. attempt #2 without model_policy now returns decision: warn (not allow)", () => {
    const out = runCheck(secondAttemptOpusPayload());
    expect(out.pattern).toBe("model_escalation_without_evidence");
    expect(out.decision).toBe("warn");
    expect(out.recommended_policy).toBe("downgrade");
    // Stage 0.5.2: detector now consults DEFAULT_DOWNGRADE_MAP when no
    // operator-supplied secondaryModel exists. opus → sonnet-4.5 by default,
    // so suggested_action.type is now `switch_model` (with route) instead
    // of the old plain `downgrade_model`. Both are "downgrade-class"
    // suggestions; § 06 below pins that property.
    expect(out.suggested_action.type).toBe("switch_model");
    expect(out.suggested_action.model_route?.to?.model).toBe("claude-sonnet-4.5");
    expect(out.suggested_action.model_route?.reason).toMatch(/Default downgrade target/);
  });

  it("06. response must never have decision: allow + a downgrade-class suggestion", () => {
    // Property-style assertion: for every pattern that fires
    // model_escalation_without_evidence, decision and suggested_action must be
    // self-consistent.
    const cases: Array<SpendingGuardCheckInput> = [
      secondAttemptOpusPayload(),
      (() => {
        const c = secondAttemptOpusPayload();
        c.history!.same_failure_count = 3;
        c.history!.paid_attempts_on_same_failure = 3;
        c.history!.same_action_count = 3;
        return c;
      })(),
      (() => {
        const c = secondAttemptOpusPayload();
        c.next_action.model_role = "primary";
        c.next_action.model_tier = "premium";
        c.next_action.estimated_cost.amount = 0.05;
        return c;
      })(),
    ];
    for (const input of cases) {
      const out = runCheck(input);
      const isDowngradeSuggestion =
        out.suggested_action.type === "downgrade_model" ||
        out.suggested_action.type === "switch_model";
      if (isDowngradeSuggestion) {
        expect(out.decision).not.toBe("allow");
      }
    }
  });
});
