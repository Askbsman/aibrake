// Stage 0.2-minimal tests.
//
// Verifies that:
//  1. The model_escalation_without_evidence detector reads operator-supplied
//     model_policy and emits a structured model_route.to when a secondaryModel
//     is configured.
//  2. The SDK checkOrDowngrade helper prefers model_route.to from the response
//     over its static downgradeTo argument.
//  3. Zod schemas accept the new fields and remain backward-compatible.

import { describe, expect, it } from "vitest";
import { runCheck } from "../src/core/check.js";
import { setLoggerSink } from "../src/core/logger.js";
import { spendingGuardCheckInputSchema } from "../src/core/schemas.js";
import { modelEscalationWithoutEvidenceDetector } from "../src/detectors/model-escalation-without-evidence.js";
import { SpendingGuard } from "../src/sdk/index.js";
import type {
  Fetcher,
  SpendingGuardClientOptions,
} from "../src/sdk/client.js";
import type {
  ModelPolicy,
  SpendingGuardCheckInput,
  SpendingGuardCheckOutput,
} from "../src/core/types.js";
import { baseInput, withCodingFailure } from "./helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

const policy: ModelPolicy = {
  primaryModel: {
    provider: "anthropic",
    model: "claude-4.7",
    role: "primary",
    tier: "premium",
  },
  secondaryModel: {
    provider: "anthropic",
    model: "claude-sonnet",
    role: "secondary",
    tier: "standard",
  },
  auditModel: {
    provider: "anthropic",
    model: "claude-sonnet",
    role: "audit",
    tier: "standard",
  },
};

function premiumRetryInput(
  options: { sameFailure?: number; newEvidence?: boolean | null } = {}
): SpendingGuardCheckInput {
  const same = options.sameFailure ?? 5;
  return {
    actor: { type: "agent", runtime: "openclaw", id: "premium-agent" },
    objective: {
      id: "obj_premium_stuck",
      goal: "Fix failing deployment",
      budget: { amount: 30, currency: "USD", hard_limit: false },
      model_policy: policy,
    },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-4.7",
      estimated_cost: { amount: 0.05, currency: "USD" }, // cheap by regex; expensive by policy
      reason: "retry deployment fix",
      model_role: "primary",
      model_tier: "premium",
    },
    history: {
      attempt_number: same + 1,
      same_action_count: same,
      paid_attempts_on_same_failure: same,
      failure_signal_present: true,
      failure_signal_type: "build_error",
      failure_fingerprint: "fp_v1_failure_deploy",
      same_failure_count: same,
      new_evidence_since_last_attempt: options.newEvidence ?? false,
      evidence_kind: "code",
      evidence_signals: {
        files_read_since_last_attempt: 0,
        tests_run_since_last_attempt: 0,
        logs_read_since_last_attempt: 0,
        git_diff_changed_since_last_attempt: false,
        context_source_confirmed: false,
      },
      confidence_delta: 0,
    },
    spend: { spent_on_objective: { amount: 0.05 * same, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
}

describe("Stage 0.2-minimal — model_policy enrichment", () => {
  it("01. detector fires when model_role=primary even with a low-cost model and a model name the regex would miss", () => {
    const input = premiumRetryInput();
    const out = runCheck(input);
    expect(out.matched_rules).toContain("expensive_next_action");
  });

  it("02. detector fires when model_tier=premium even without model_policy", () => {
    const input = baseInput({
      objective: { budget: { amount: 10, currency: "USD", hard_limit: false } },
      next_action: {
        type: "paid_llm_call",
        model: "obscure-model-name", // wouldn't match regex
        estimated_cost: { amount: 0.04, currency: "USD" }, // below cost threshold
        model_tier: "premium",
      },
      history: {
        attempt_number: 5,
        same_failure_count: 4,
        failure_signal_present: true,
        failure_signal_type: "build_error",
        new_evidence_since_last_attempt: false,
      },
      telemetry_quality: { completeness: "high" },
    });
    const out = runCheck(input);
    expect(out.matched_rules).toContain("expensive_next_action");
  });

  it("03. detector fires when next_action matches objective.model_policy.primaryModel by provider+model", () => {
    const input = premiumRetryInput();
    delete input.next_action.model_role;
    delete input.next_action.model_tier;
    // Only the policy match should trigger the expensive classification now.
    const result = modelEscalationWithoutEvidenceDetector.evaluate(input);
    expect(result).not.toBeNull();
    expect(result?.matchedRules).toContain("expensive_next_action");
    expect(result?.metadata?.expensive_reason).toBe("policy");
  });

  it("04. detector does NOT fire on a secondary-model action even when same failure repeats", () => {
    const input = premiumRetryInput();
    input.next_action.provider = "anthropic";
    input.next_action.model = "claude-sonnet";
    input.next_action.model_role = "secondary";
    input.next_action.model_tier = "standard";
    input.next_action.estimated_cost.amount = 0.02;
    const result = modelEscalationWithoutEvidenceDetector.evaluate(input);
    expect(result).toBeNull();
  });

  it("05. emits a structured model_route.to pointing at the configured secondaryModel", () => {
    // Test the detector directly because at sameFailure>=3 the aggregator
    // selects stale_context_retry_storm as the top pattern (higher score).
    // The escalation detector still fires and contributes matched rules; we
    // care about its model_route here.
    const result = modelEscalationWithoutEvidenceDetector.evaluate(premiumRetryInput());
    expect(result).not.toBeNull();
    expect(result?.suggestedActions[0]?.type).toBe("switch_model");
    expect(result?.suggestedActions[0]?.model_route).toBeDefined();
    expect(result?.suggestedActions[0]?.model_route?.to?.model).toBe("claude-sonnet");
    expect(result?.suggestedActions[0]?.model_route?.from?.model).toBe("claude-4.7");
  });

  it("05b. when escalation IS the top pattern (no stale_context), the aggregated output exposes switch_model + model_route", () => {
    // sameFailure=2 keeps stale_context below its min threshold (3), so the
    // escalation detector dominates the aggregated output.
    const out = runCheck(premiumRetryInput({ sameFailure: 2 }));
    expect(out.pattern).toBe("model_escalation_without_evidence");
    expect(out.suggested_action.type).toBe("switch_model");
    expect(out.suggested_action.model_route?.to?.model).toBe("claude-sonnet");
  });

  it("06. omits model_route when no secondaryModel is configured (falls back to plain downgrade_model)", () => {
    const input = premiumRetryInput();
    input.objective!.model_policy = { primaryModel: policy.primaryModel };
    const result = modelEscalationWithoutEvidenceDetector.evaluate(input);
    expect(result).not.toBeNull();
    expect(result?.suggestedActions[0]?.type).toBe("downgrade_model");
    expect(result?.suggestedActions[0]?.model_route).toBeUndefined();
  });

  it("07. detector reason text names both the primary and secondary model when route is present", () => {
    const result = modelEscalationWithoutEvidenceDetector.evaluate(premiumRetryInput());
    expect(result).not.toBeNull();
    const reason = (result?.metadata as { reason?: string } | undefined)?.reason ?? "";
    expect(reason).toContain("claude-4.7");
    expect(reason).toContain("claude-sonnet");
  });

  it("08. backward compat: existing opus-based escalation case still fires without model_policy", () => {
    // No model_policy, no model_role/tier — regex + cost heuristic must still trigger.
    const out = runCheck(withCodingFailure(7, { expensiveModel: true }));
    expect(out.matched_rules).toContain("expensive_next_action");
    expect(out.matched_rules).toContain("same_failure_repeated");
  });

  it("09. Zod schema accepts model_policy + model_role + model_tier", () => {
    const parsed = spendingGuardCheckInputSchema.safeParse(premiumRetryInput());
    expect(parsed.success).toBe(true);
  });

  it("10. Zod schema still accepts payloads without any of the new fields", () => {
    const parsed = spendingGuardCheckInputSchema.safeParse(withCodingFailure(7));
    expect(parsed.success).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// SDK checkOrDowngrade — prefers model_route.to over static downgradeTo
// ────────────────────────────────────────────────────────────────────────

function buildGuard(
  fetcher: Fetcher,
  options: Partial<SpendingGuardClientOptions> = {}
): SpendingGuard {
  return new SpendingGuard({ fetcher, timeoutMs: 200, ...options });
}

function stubResult(
  decision: SpendingGuardCheckOutput["decision"],
  options: {
    pattern?: string;
    recommendedPolicy?: SpendingGuardCheckOutput["recommended_policy"];
    suggestedActionType?: string;
    modelRouteTo?: { provider?: string; model?: string };
  }
): SpendingGuardCheckOutput {
  return {
    decision,
    risk_score: decision === "allow" ? 10 : 60,
    risk_level: decision === "allow" ? "low" : "elevated",
    confidence: 0.85,
    pattern: options.pattern ?? "test_pattern",
    matched_rules: [],
    reason: "test",
    suggested_action: {
      type: options.suggestedActionType ?? "downgrade_model",
      message: "noop",
      ...(options.modelRouteTo
        ? { model_route: { to: options.modelRouteTo } }
        : {}),
    },
    recommended_policy: options.recommendedPolicy ?? "downgrade",
    hard_block: false,
    requires_human_confirmation: false,
    metadata: {},
    detector_version: "test@0.2.0",
    policy_version: "policy@0.1.0",
  };
}

describe("Stage 0.2-minimal — SDK checkOrDowngrade uses model_route.to", () => {
  const sampleInput: SpendingGuardCheckInput = {
    actor: { type: "agent" },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-4.7",
      estimated_cost: { amount: 0.05, currency: "USD" },
    },
  };

  it("11. when response includes model_route.to, checkOrDowngrade uses it instead of static downgradeTo.model", async () => {
    const fetcher: Fetcher = async () =>
      stubResult("warn", {
        pattern: "model_escalation_without_evidence",
        suggestedActionType: "switch_model",
        recommendedPolicy: "downgrade",
        modelRouteTo: { provider: "anthropic", model: "claude-sonnet" },
      });
    const guard = buildGuard(fetcher);
    const { action } = await guard.checkOrDowngrade(sampleInput, {
      downgradeTo: { provider: "anthropic", model: "claude-haiku", estimatedCost: 0.01 },
    });
    // Route.to wins over the static downgradeTo.
    expect(action.model).toBe("claude-sonnet");
    // estimatedCost has no equivalent in route → falls back to static.
    expect(action.estimated_cost.amount).toBe(0.01);
  });

  it("12. when response has no model_route, checkOrDowngrade falls back to static downgradeTo", async () => {
    const fetcher: Fetcher = async () =>
      stubResult("warn", {
        pattern: "model_escalation_without_evidence",
        suggestedActionType: "downgrade_model",
        recommendedPolicy: "downgrade",
      });
    const guard = buildGuard(fetcher);
    const { action } = await guard.checkOrDowngrade(sampleInput, {
      downgradeTo: { model: "claude-haiku", estimatedCost: 0.01 },
    });
    expect(action.model).toBe("claude-haiku");
    expect(action.estimated_cost.amount).toBe(0.01);
  });
});
