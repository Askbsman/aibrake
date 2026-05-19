// Monkey-patch logic for `aibrake/auto`.
//
// We patch the prototype of OpenAI's `Completions` and Anthropic's
// `Messages` classes. All client instances share these prototypes, so
// one patch covers every `new OpenAI()` / `new Anthropic()` in the
// process — including instances created BEFORE `import 'aibrake/auto'`.

import { getGuard, modeFromEnv } from "./guard.js";
import {
  hashError,
  hashObjective,
  lastError,
  recentForObjective,
  recordAttempt,
  type LoggedAttempt,
} from "./history.js";
import { estimateCostUsd } from "./pricing.js";
import type { SpendingGuardCheckInput } from "../core/types.js";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function colorForDecision(d: string): string {
  if (d === "allow") return C.green;
  if (d === "warn") return C.yellow;
  if (d === "require_confirm" || d === "require_confirmation") return C.cyan;
  if (d === "block") return C.red;
  return C.reset;
}

function logDecision(provider: string, model: string, decision: any): void {
  const color = colorForDecision(decision.decision);
  const reason = (decision.reason ?? "").slice(0, 100);
  const ps = decision.projected_savings;
  // Single-line summary to stderr — visible but not noisy.
  process.stderr.write(
    `${C.dim}[aibrake]${C.reset} ${provider}/${model} ` +
    `${color}${decision.decision}${C.reset}` +
    ` ${C.dim}risk=${decision.risk_score?.toFixed?.(0) ?? "?"} ` +
    `pattern=${decision.pattern ?? "—"}${C.reset}` +
    (ps ? ` ${C.green}savings=$${ps.amount_usd?.toFixed?.(2) ?? "?"}${C.reset}` : "") +
    (reason ? `\n${C.dim}[aibrake]   reason: ${reason}${C.reset}` : "") +
    "\n"
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Build a check-input from intercepted call args + history.
// ─────────────────────────────────────────────────────────────────────────
function buildCheckInput(args: {
  provider: "openai" | "anthropic";
  model: string;
  systemPrompt: string;
  firstUserMessage: string;
  totalInputChars: number;
  maxOutputTokens?: number;
}): SpendingGuardCheckInput {
  const objectiveHash = hashObjective([
    args.provider,
    args.systemPrompt,
    args.firstUserMessage.slice(0, 200),
  ]);
  const recent = recentForObjective(objectiveHash);
  const cost = estimateCostUsd(args.model, args.totalInputChars, args.maxOutputTokens);
  const lastErr = lastError(objectiveHash);

  return {
    actor: {
      type: "agent",
      runtime: "aibrake-auto",
      id: `auto-${process.pid}`,
    },
    objective: {
      id: objectiveHash,
      goal: args.firstUserMessage.slice(0, 120) || "(no user message)",
      budget: { amount: 50, currency: "USD", hard_limit: false },
      success_criteria: [],
      max_paid_attempts: 20,
      allowed_actions: ["paid_llm_call"],
      blocked_actions: [],
    },
    next_action: {
      id: `auto_act_${Date.now()}`,
      type: "paid_llm_call",
      provider: args.provider,
      model: args.model,
      estimated_cost: { amount: cost, currency: "USD" },
      reason: "auto-intercepted LLM call",
    },
    history: {
      attempt_number: recent.length + 1,
      same_action_count: recent.filter((r) => r.model === args.model).length,
      paid_attempts_on_same_failure: lastErr
        ? recent.filter(
            (r) =>
              r.succeeded === false &&
              r.error_signature === lastErr.error_signature
          ).length
        : 0,
      failure_signal_present: !!lastErr,
      failure_signal_type: lastErr ? "exception" : undefined,
      failure_fingerprint: lastErr
        ? `fp_v1_${lastErr.error_signature}`
        : undefined,
      same_failure_count: lastErr
        ? recent.filter((r) => r.error_signature === lastErr.error_signature).length
        : 0,
      last_new_evidence_at_attempt: undefined,
      new_evidence_since_last_attempt: recent.length === 0 ? null : false,
      evidence_kind: "code",
      // auto-patch can't see file reads / tests / logs — best-effort defaults.
      evidence_signals: {
        files_read_since_last_attempt: 0,
        tests_run_since_last_attempt: 0,
        logs_read_since_last_attempt: 0,
        git_diff_changed_since_last_attempt: false,
        context_source_confirmed: false,
      },
      confidence_delta: 0,
    },
    spend: {
      spent_on_objective: {
        amount: recent.reduce((sum, r) => sum + r.estimated_cost_usd, 0),
        currency: "USD",
      },
    },
    telemetry_quality: {
      // Honest disclosure: auto-patch sees only API-call telemetry, not the
      // surrounding agent context. Calibration treats this as "medium".
      completeness: "medium",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Call AIBrake. In shadow mode → never block. In hard mode → throw on
// block / require_confirmation.
// ─────────────────────────────────────────────────────────────────────────
async function preCheck(input: SpendingGuardCheckInput, providerLabel: string, model: string): Promise<{
  objectiveHash: string;
  attempt: LoggedAttempt;
  decision: any;
}> {
  const guard = getGuard();
  const mode = modeFromEnv();
  // Always use check_shadow for the wire-call (don't mutate user's response);
  // we handle hard-mode by raising client-side after the decision.
  let decision: any;
  try {
    decision = mode === "hard"
      ? await guard.check(input)
      : await guard.checkShadow(input);
  } catch (err) {
    // Guard outage → fail open. Synthesize a neutral "allow" so logging still works.
    decision = {
      decision: "allow",
      risk_score: 0,
      pattern: "none",
      reason: `aibrake guard unreachable: ${(err as Error).message}`,
    };
  }

  logDecision(providerLabel, model, decision);

  if (mode === "hard" && (decision.decision === "block" || decision.decision === "require_confirmation")) {
    throw new Error(
      `[aibrake] ${decision.decision} — ${decision.reason ?? "loop detected"}. ` +
      `Set AIBRAKE_MODE=shadow to override, or pass new evidence between attempts.`
    );
  }

  const attempt: LoggedAttempt = {
    objective_hash: input.objective!.id!,
    model,
    provider: providerLabel === "openai" ? "openai" : providerLabel === "anthropic" ? "anthropic" : "other",
    ts_ms: Date.now(),
    estimated_cost_usd: input.next_action.estimated_cost!.amount,
  };

  return { objectiveHash: input.objective!.id!, attempt, decision };
}

function recordSuccess(attempt: LoggedAttempt): void {
  recordAttempt({ ...attempt, succeeded: true });
}

function recordFailure(attempt: LoggedAttempt, err: any): void {
  const msg = err instanceof Error ? err.message : String(err);
  recordAttempt({
    ...attempt,
    succeeded: false,
    error_signature: hashError(msg),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// OpenAI patch
// ─────────────────────────────────────────────────────────────────────────
export async function patchOpenAI(): Promise<boolean> {
  let mod: any;
  try {
    mod = await import("openai/resources/chat/completions.js" as any);
  } catch {
    try {
      mod = await import("openai/resources/chat/completions" as any);
    } catch {
      return false;
    }
  }

  const Completions = mod?.Completions ?? mod?.default?.Completions;
  if (!Completions?.prototype?.create) return false;
  if ((Completions.prototype as any).__aibrake_patched__) return true;

  const original = Completions.prototype.create;
  Completions.prototype.create = async function patchedCreate(this: any, params: any, options?: any) {
    const messages = Array.isArray(params?.messages) ? params.messages : [];
    const systemMsg = messages.find((m: any) => m?.role === "system");
    const firstUserMsg = messages.find((m: any) => m?.role === "user");

    const systemPrompt = typeof systemMsg?.content === "string"
      ? systemMsg.content
      : JSON.stringify(systemMsg?.content ?? "");
    const firstUserMessage = typeof firstUserMsg?.content === "string"
      ? firstUserMsg.content
      : JSON.stringify(firstUserMsg?.content ?? "");
    const totalInputChars = JSON.stringify(messages).length;

    const input = buildCheckInput({
      provider: "openai",
      model: params?.model ?? "unknown",
      systemPrompt,
      firstUserMessage,
      totalInputChars,
      maxOutputTokens: params?.max_tokens,
    });

    const { attempt } = await preCheck(input, "openai", params?.model ?? "unknown");

    try {
      const result = await original.call(this, params, options);
      recordSuccess(attempt);
      return result;
    } catch (err) {
      recordFailure(attempt, err);
      throw err;
    }
  };
  (Completions.prototype as any).__aibrake_patched__ = true;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Anthropic patch
// ─────────────────────────────────────────────────────────────────────────
export async function patchAnthropic(): Promise<boolean> {
  let mod: any;
  try {
    mod = await import("@anthropic-ai/sdk/resources/messages.js" as any);
  } catch {
    try {
      mod = await import("@anthropic-ai/sdk/resources/messages" as any);
    } catch {
      return false;
    }
  }

  const Messages = mod?.Messages ?? mod?.default?.Messages;
  if (!Messages?.prototype?.create) return false;
  if ((Messages.prototype as any).__aibrake_patched__) return true;

  const original = Messages.prototype.create;
  Messages.prototype.create = async function patchedCreate(this: any, params: any, options?: any) {
    const messages = Array.isArray(params?.messages) ? params.messages : [];
    const firstUserMsg = messages.find((m: any) => m?.role === "user");

    const systemPrompt = typeof params?.system === "string"
      ? params.system
      : Array.isArray(params?.system)
        ? params.system.map((b: any) => b?.text ?? "").join("")
        : "";
    const firstUserMessage = typeof firstUserMsg?.content === "string"
      ? firstUserMsg.content
      : JSON.stringify(firstUserMsg?.content ?? "");
    const totalInputChars =
      systemPrompt.length + JSON.stringify(messages).length;

    const input = buildCheckInput({
      provider: "anthropic",
      model: params?.model ?? "unknown",
      systemPrompt,
      firstUserMessage,
      totalInputChars,
      maxOutputTokens: params?.max_tokens,
    });

    const { attempt } = await preCheck(input, "anthropic", params?.model ?? "unknown");

    try {
      const result = await original.call(this, params, options);
      recordSuccess(attempt);
      return result;
    } catch (err) {
      recordFailure(attempt, err);
      throw err;
    }
  };
  (Messages.prototype as any).__aibrake_patched__ = true;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level boot — what `import 'aibrake/auto'` triggers.
// ─────────────────────────────────────────────────────────────────────────
export async function bootstrap(): Promise<{ openai: boolean; anthropic: boolean }> {
  const [openai, anthropic] = await Promise.all([
    patchOpenAI(),
    patchAnthropic(),
  ]);

  const patched: string[] = [];
  if (openai) patched.push("openai");
  if (anthropic) patched.push("@anthropic-ai/sdk");

  if (patched.length === 0) {
    process.stderr.write(
      `${C.dim}[aibrake] No supported LLM SDK detected in this process. ` +
      `Install \`openai\` or \`@anthropic-ai/sdk\` to enable auto-guard.${C.reset}\n`
    );
  } else {
    process.stderr.write(
      `${C.dim}[aibrake] auto-guard active — patched: ${patched.join(", ")} ` +
      `(mode: ${modeFromEnv()})${C.reset}\n`
    );
  }

  return { openai, anthropic };
}
