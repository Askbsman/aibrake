import type { SpendingGuardCheckInput } from "../../src/core/types.js";

export function baseInput(
  overrides: Partial<SpendingGuardCheckInput> = {}
): SpendingGuardCheckInput {
  return {
    actor: { type: "agent", runtime: "openclaw", id: "agent_001" },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-sonnet",
      estimated_cost: { amount: 0.05, currency: "USD" },
    },
    ...overrides,
  };
}

export function withCodingFailure(
  attempts: number,
  options: { newEvidence?: boolean; expensiveModel?: boolean } = {}
): SpendingGuardCheckInput {
  return baseInput({
    objective: {
      id: "obj_typescript_fix",
      goal: "Fix failing TypeScript build",
      budget: { amount: 5, currency: "USD", hard_limit: false },
    },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: options.expensiveModel ? "claude-opus" : "claude-sonnet",
      estimated_cost: {
        amount: options.expensiveModel ? 0.42 : 0.08,
        currency: "USD",
      },
      reason: "Retry same TypeScript build fix",
    },
    history: {
      attempt_number: attempts,
      same_action_count: attempts - 1,
      paid_attempts_on_same_failure: attempts - 1,
      failure_signal_present: true,
      failure_signal_type: "build_error",
      failure_fingerprint: "fp_v1_failure_typescript_ts2307",
      same_failure_count: attempts - 1,
      last_new_evidence_at_attempt: 2,
      new_evidence_since_last_attempt: options.newEvidence ?? false,
      evidence_kind: "code",
      evidence_signals: options.newEvidence
        ? {
            files_read_since_last_attempt: 3,
            tests_run_since_last_attempt: 1,
            logs_read_since_last_attempt: 2,
            git_diff_changed_since_last_attempt: true,
            context_source_confirmed: true,
          }
        : {
            files_read_since_last_attempt: 0,
            tests_run_since_last_attempt: 0,
            logs_read_since_last_attempt: 0,
            git_diff_changed_since_last_attempt: false,
            context_source_confirmed: false,
          },
      confidence_delta: 0,
    },
    spend: {
      spent_on_objective: { amount: 0.6 * attempts, currency: "USD" },
    },
    telemetry_quality: { completeness: "high" },
  });
}
