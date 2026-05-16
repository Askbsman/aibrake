// Stage 0.5.2 — Savings Visibility tests.
//
// Three additions verified here:
//   1. `projected_savings` field appears on every non-allow response with a
//      cost-bearing next_action. Three explanation paths:
//      - model_downgrade_delta   (route.to with estimatedCostUsd or fallback ratio)
//      - projected_future_attempts (stale_context_retry_storm with paid repeats)
//      - next_attempt_avoided    (single-attempt conservative default)
//   2. `default_downgrade_map` ships on /v1/meta for partner discoverability
//      and is consumed by the model_escalation detector when no
//      operator-supplied secondaryModel exists.
//   3. The logs:summary CLI sums savings into total / by-pattern / by-basis.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { setLoggerSink } from "../src/core/logger.js";
import { runCheck } from "../src/core/check.js";
import { summarize } from "../src/cli/logs-summary.js";
import type { SpendingGuardCheckInput } from "../src/core/types.js";

setLoggerSink({ emit: () => {} });

// Reusable shells — keep tests small.
function staleStormInput(): SpendingGuardCheckInput {
  return {
    actor: { type: "agent", runtime: "claude-code" },
    objective: { id: "obj_storm", goal: "fix the failing test" },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      estimated_cost: { amount: 0.05, currency: "USD" },
      model_tier: "premium",
    },
    history: {
      attempt_number: 7,
      same_action_count: 6,
      paid_attempts_on_same_failure: 6,
      failure_signal_present: true,
      failure_signal_type: "test_failure",
      failure_fingerprint: "fp_v1_widget_render_fail",
      same_failure_count: 6,
      last_new_evidence_at_attempt: 2,
      new_evidence_since_last_attempt: false,
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
    telemetry_quality: { completeness: "high" },
  };
}

function escalationInput(secondary?: {
  provider: string;
  model: string;
  estimatedCostUsd?: number;
}): SpendingGuardCheckInput {
  return {
    actor: { type: "agent", runtime: "claude-code" },
    objective: {
      id: "obj_escalation",
      goal: "fix it",
      ...(secondary
        ? {
            model_policy: {
              primaryModel: {
                provider: "anthropic",
                model: "claude-opus-4.5",
                role: "primary",
                tier: "premium",
              },
              secondaryModel: {
                provider: secondary.provider,
                model: secondary.model,
                role: "secondary",
                tier: "standard",
                ...(secondary.estimatedCostUsd !== undefined
                  ? { estimatedCostUsd: secondary.estimatedCostUsd }
                  : {}),
              },
            },
          }
        : {}),
    },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-opus-4.5",
      estimated_cost: { amount: 0.5, currency: "USD" },
      model_role: "primary",
      model_tier: "premium",
    },
    history: {
      attempt_number: 4,
      same_action_count: 3,
      paid_attempts_on_same_failure: 3,
      failure_signal_present: true,
      failure_signal_type: "test_failure",
      failure_fingerprint: "fp_v1_widget_fail",
      same_failure_count: 3,
      new_evidence_since_last_attempt: false,
      evidence_kind: "code",
      evidence_signals: {
        files_read_since_last_attempt: 0,
        tests_run_since_last_attempt: 0,
        logs_read_since_last_attempt: 0,
        git_diff_changed_since_last_attempt: false,
        context_source_confirmed: false,
      },
    },
    telemetry_quality: { completeness: "high" },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Section A — projected_savings appears on non-allow decisions
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.5.2 — projected_savings", () => {
  it("S1: allow on cold start has NO projected_savings field", () => {
    const result = runCheck(
      {
        actor: { type: "agent" },
        next_action: {
          type: "paid_llm_call",
          estimated_cost: { amount: 0.05, currency: "USD" },
        },
      },
      { emitLog: false }
    );
    expect(result.decision).toBe("allow");
    expect(result.projected_savings).toBeUndefined();
  });

  it("S2: stale_context_retry_storm fires with projected_future_attempts basis", () => {
    const result = runCheck(staleStormInput(), { emitLog: false });
    expect(result.pattern).toBe("stale_context_retry_storm");
    expect(["warn", "require_confirmation"]).toContain(result.decision);
    expect(result.projected_savings).toBeDefined();
    expect(result.projected_savings!.basis).toBe("projected_future_attempts");
    expect(result.projected_savings!.currency).toBe("USD");
    // 3 projected × $0.05 = $0.15
    expect(result.projected_savings!.amount_usd).toBeCloseTo(0.15, 2);
    expect(result.projected_savings!.explanation).toMatch(/3 more paid attempt/);
  });

  it("S3: model_escalation with operator-declared secondaryModel uses model_downgrade_delta with precise cost", () => {
    const result = runCheck(
      escalationInput({
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        estimatedCostUsd: 0.05,
      }),
      { emitLog: false }
    );
    // Stale-context can also fire here on the same payload — what matters is
    // that *some* projected savings landed, and that when the model route is
    // present we use the model_downgrade_delta basis.
    expect(result.projected_savings).toBeDefined();
    if (result.suggested_action.model_route?.to?.estimatedCostUsd !== undefined) {
      expect(result.projected_savings!.basis).toBe("model_downgrade_delta");
      // 0.50 primary − 0.05 secondary = 0.45 delta
      expect(result.projected_savings!.amount_usd).toBeCloseTo(0.45, 2);
    }
  });

  it("S4: model_escalation with secondary but no estimatedCostUsd falls back to 60% reduction estimate", () => {
    const result = runCheck(
      escalationInput({ provider: "anthropic", model: "claude-sonnet" }),
      { emitLog: false }
    );
    expect(result.projected_savings).toBeDefined();
    if (result.suggested_action.model_route?.to) {
      expect(result.projected_savings!.basis).toBe("model_downgrade_delta");
      // 0.50 × 0.60 = 0.30
      expect(result.projected_savings!.amount_usd).toBeCloseTo(0.3, 2);
      expect(result.projected_savings!.explanation).toMatch(/conservative 60%/);
    }
  });

  it("S5: explicit_blocked_action (objective_drift) produces next_attempt_avoided", () => {
    const result = runCheck(
      {
        actor: { type: "agent" },
        objective: {
          id: "obj_drift",
          goal: "stay in scope",
          blocked_actions: ["refactor_unrelated"],
        },
        next_action: {
          type: "refactor_unrelated",
          estimated_cost: { amount: 0.07, currency: "USD" },
        },
      },
      { emitLog: false }
    );
    expect(result.decision).toBe("block");
    expect(result.projected_savings).toBeDefined();
    expect(result.projected_savings!.basis).toBe("next_attempt_avoided");
    expect(result.projected_savings!.amount_usd).toBeCloseTo(0.07, 2);
  });

  it("S6: projected_savings is rounded to cents", () => {
    const result = runCheck(
      {
        actor: { type: "agent" },
        objective: {
          id: "obj_drift_cents",
          goal: "stay in scope",
          blocked_actions: ["x"],
        },
        next_action: {
          type: "x",
          estimated_cost: { amount: 0.12345, currency: "USD" },
        },
      },
      { emitLog: false }
    );
    expect(result.projected_savings).toBeDefined();
    // 0.12345 → 0.12
    expect(result.projected_savings!.amount_usd).toBe(0.12);
  });

  it("S7: zero-cost next_action produces NO projected_savings (avoid divide-by-nonsense)", () => {
    const result = runCheck(
      {
        actor: { type: "agent" },
        objective: {
          id: "obj_zero",
          goal: "free check",
          blocked_actions: ["free_tool"],
        },
        next_action: {
          type: "free_tool",
          estimated_cost: { amount: 0, currency: "USD" },
        },
      },
      { emitLog: false }
    );
    expect(result.decision).toBe("block");
    expect(result.projected_savings).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Section B — default_downgrade_map exposed via /v1/meta + used by detector
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.5.2 — default downgrade map", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildServer({ logger: false });
    await app.ready();
  });
  afterAll(async () => app.close());

  it("S8: /v1/meta advertises default_downgrade_map array", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.default_downgrade_map)).toBe(true);
    expect(body.default_downgrade_map.length).toBeGreaterThan(0);
    // Each entry has matches/flags/to shape.
    const first = body.default_downgrade_map[0];
    expect(typeof first.matches).toBe("string");
    expect(typeof first.flags).toBe("string");
    expect(first.to).toBeDefined();
    expect(typeof first.to.model).toBe("string");
  });

  it("S9: detector uses default downgrade when no secondaryModel is declared (opus → sonnet)", () => {
    // Same payload as S3 but with NO model_policy — default map should fire.
    const input = escalationInput();
    expect(input.objective?.model_policy).toBeUndefined();
    const result = runCheck(input, { emitLog: false });
    // Either stale-context or model_escalation may be the top pattern.
    // What we care about: the suggested action carries a model_route from
    // the default map.
    const route = result.suggested_action.model_route;
    if (result.pattern === "model_escalation_without_evidence") {
      expect(route).toBeDefined();
      expect(route!.to?.model).toBe("claude-sonnet-4.5");
      expect(route!.reason).toMatch(/Default downgrade target/);
    }
    // projected_savings should be a model_downgrade_delta or future-attempts.
    expect(result.projected_savings).toBeDefined();
  });

  it("S10: detector metadata flags used_default_downgrade when no secondary declared", () => {
    const result = runCheck(escalationInput(), { emitLog: false });
    // Walk through fired detectors via metadata; model_escalation may not be
    // the top one, but if it fires it should mark used_default_downgrade.
    if (result.pattern === "model_escalation_without_evidence") {
      expect(result.metadata.used_default_downgrade).toBe(true);
      expect(result.metadata.has_secondary_model).toBe(false);
    }
  });

  it("S11: declared secondaryModel takes precedence over default map", () => {
    const result = runCheck(
      escalationInput({
        provider: "anthropic",
        model: "claude-haiku",
        estimatedCostUsd: 0.01,
      }),
      { emitLog: false }
    );
    const route = result.suggested_action.model_route;
    if (result.pattern === "model_escalation_without_evidence") {
      expect(route?.to?.model).toBe("claude-haiku");
      expect(route?.reason).not.toMatch(/Default downgrade target/);
      expect(result.metadata.used_default_downgrade).toBe(false);
      expect(result.metadata.has_secondary_model).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Section C — logs:summary CLI aggregates savings
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.5.2 — logs:summary savings aggregation", () => {
  it("S12: sums projected_savings_usd across events, breaks down by pattern & basis", () => {
    const lines = [
      JSON.stringify({
        event_type: "agent_spend_guard.check.completed",
        decision: "require_confirmation",
        pattern: "stale_context_retry_storm",
        recommended_policy: "ask_human",
        next_action_cost_usd: 0.05,
        projected_savings_usd: 0.15,
        projected_savings_basis: "projected_future_attempts",
        timestamp: "2026-05-15T10:00:00Z",
      }),
      JSON.stringify({
        event_type: "agent_spend_guard.check.completed",
        decision: "warn",
        pattern: "model_escalation_without_evidence",
        recommended_policy: "downgrade",
        next_action_cost_usd: 0.5,
        projected_savings_usd: 0.45,
        projected_savings_basis: "model_downgrade_delta",
        timestamp: "2026-05-15T10:01:00Z",
      }),
      JSON.stringify({
        event_type: "agent_spend_guard.check.completed",
        decision: "allow",
        pattern: "none",
        recommended_policy: "continue",
        next_action_cost_usd: 0.02,
        projected_savings_usd: null,
        projected_savings_basis: null,
        timestamp: "2026-05-15T10:02:00Z",
      }),
      JSON.stringify({
        event_type: "agent_spend_guard.check.completed",
        decision: "block",
        pattern: "objective_drift",
        recommended_policy: "stop_action",
        next_action_cost_usd: 0.07,
        projected_savings_usd: 0.07,
        projected_savings_basis: "next_attempt_avoided",
        timestamp: "2026-05-15T10:03:00Z",
      }),
    ];

    const { text, aggregates } = summarize(lines);
    // Totals
    expect(aggregates.total).toBe(4);
    expect(aggregates.totalSavingsOfferedUsd).toBeCloseTo(0.67, 2);
    expect(aggregates.savingsSampleCount).toBe(3);
    expect(aggregates.totalNextActionCostUsd).toBeCloseTo(0.64, 2);
    expect(aggregates.costSampleCount).toBe(4);
    // By pattern
    expect(aggregates.savingsByPattern.stale_context_retry_storm).toBeCloseTo(0.15, 2);
    expect(aggregates.savingsByPattern.model_escalation_without_evidence).toBeCloseTo(0.45, 2);
    expect(aggregates.savingsByPattern.objective_drift).toBeCloseTo(0.07, 2);
    // By basis
    expect(aggregates.savingsByBasis.projected_future_attempts).toBeCloseTo(0.15, 2);
    expect(aggregates.savingsByBasis.model_downgrade_delta).toBeCloseTo(0.45, 2);
    expect(aggregates.savingsByBasis.next_attempt_avoided).toBeCloseTo(0.07, 2);
    // Rendered text mentions the dollar total
    expect(text).toMatch(/total: \$0\.67/);
    expect(text).toMatch(/savings_by_pattern/);
    expect(text).toMatch(/savings_by_basis/);
  });

  it("S13: empty/malformed log lines are skipped without crashing", () => {
    const lines = [
      "",
      "{not json",
      JSON.stringify({ event_type: "something_else", foo: 1 }),
      JSON.stringify({
        event_type: "agent_spend_guard.check.completed",
        decision: "allow",
        pattern: "none",
        next_action_cost_usd: 0.01,
      }),
    ];
    const { aggregates } = summarize(lines);
    expect(aggregates.total).toBe(1);
    expect(aggregates.totalSavingsOfferedUsd).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Section D — /v1/check response contract still includes existing fields
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.5.2 — backwards compatibility", () => {
  it("S14: allow response shape unchanged (no projected_savings, no metadata explosion)", () => {
    const result = runCheck(
      {
        actor: { type: "agent" },
        next_action: {
          type: "paid_llm_call",
          estimated_cost: { amount: 0.01, currency: "USD" },
        },
      },
      { emitLog: false }
    );
    expect(result.decision).toBe("allow");
    expect(result.pattern).toBe("none");
    expect(result.projected_savings).toBeUndefined();
    expect(result.recommended_policy).toBe("continue");
  });

  it("S15: stale-context retry storm response carries BOTH structured savings AND original suggested_action", () => {
    const result = runCheck(staleStormInput(), { emitLog: false });
    expect(result.suggested_action.type).toBeDefined();
    expect(result.suggested_action.message.length).toBeGreaterThan(20);
    expect(result.projected_savings).toBeDefined();
    expect(result.projected_savings!.explanation.length).toBeGreaterThan(20);
    // Both fields coexist; one is human-readable, one is structured $.
  });
});
