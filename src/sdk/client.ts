import { runCheck } from "../core/check.js";
import { POLICY_VERSION } from "../core/types.js";
import type {
  NextAction,
  SpendingGuardCheckInput,
  SpendingGuardCheckOutput,
  UncertainPolicy,
} from "../core/types.js";
import {
  SpendingGuardBlockedError,
  SpendingGuardConfirmationDeniedError,
} from "./errors.js";

export type Fetcher = (
  input: SpendingGuardCheckInput,
  signal: AbortSignal
) => Promise<SpendingGuardCheckOutput>;

export type FailureMode = "open" | "closed" | "throw";

export interface SpendingGuardClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  failureMode?: FailureMode;
  uncertainPolicy?: UncertainPolicy;
  // Inject a fetcher for tests or in-process use. If absent and baseUrl is set,
  // the SDK uses globalThis.fetch. If neither is set, the SDK runs the Core
  // check function in-process (useful for embedded usage).
  fetcher?: Fetcher;
  // Allows test code to substitute logger sink or other hooks.
  onFailureOpen?: (error: unknown) => void;
}

export interface CheckOrConfirmOptions {
  onWarn?: (
    result: SpendingGuardCheckOutput
  ) => Promise<boolean> | boolean;
}

export interface CheckOrDowngradeOptions {
  downgradeTo: { provider?: string; model: string; estimatedCost?: number };
  onDowngrade?: (
    result: SpendingGuardCheckOutput,
    downgraded: NextAction
  ) => Promise<void> | void;
  // If a warn/require_confirmation result is not a model-escalation pattern,
  // fall back to ask_human via this callback. If absent, the helper returns
  // the downgraded action anyway.
  onWarn?: (
    result: SpendingGuardCheckOutput
  ) => Promise<boolean> | boolean;
}

export class SpendingGuard {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly failureMode: FailureMode;
  private readonly uncertainPolicy: UncertainPolicy;
  private readonly onFailureOpen?: (error: unknown) => void;

  constructor(options: SpendingGuardClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 500;
    this.failureMode = options.failureMode ?? "open";
    this.uncertainPolicy = options.uncertainPolicy ?? "allow_with_log";
    this.onFailureOpen = options.onFailureOpen;

    if (options.fetcher) {
      this.fetcher = options.fetcher;
    } else if (options.baseUrl) {
      this.fetcher = createHttpFetcher(options.baseUrl, options.apiKey);
    } else {
      this.fetcher = createInProcessFetcher();
    }
  }

  async check(input: SpendingGuardCheckInput): Promise<SpendingGuardCheckOutput> {
    return this.invoke(input, this.timeoutMs);
  }

  async checkShadow(
    input: SpendingGuardCheckInput
  ): Promise<SpendingGuardCheckOutput> {
    try {
      return await this.invoke(input, this.timeoutMs);
    } catch (err) {
      // checkShadow never throws because of a guard decision; only programmer
      // errors propagate. We swallow guard-related failures and synthesize.
      return synthesizeFailureOpen(err);
    }
  }

  async checkOrConfirm(
    input: SpendingGuardCheckInput,
    options: CheckOrConfirmOptions = {}
  ): Promise<SpendingGuardCheckOutput> {
    const result = await this.invoke(input, this.timeoutMs);
    switch (result.decision) {
      case "allow":
        return result;
      case "warn":
      case "require_confirmation": {
        if (!options.onWarn) return result;
        const ok = await options.onWarn(result);
        if (!ok) throw new SpendingGuardConfirmationDeniedError(result);
        return result;
      }
      case "delay":
        return result;
      case "block":
        throw new SpendingGuardBlockedError(result);
      case "uncertain":
        return this.applyUncertainPolicy(result, options.onWarn);
    }
  }

  async checkOrDowngrade(
    input: SpendingGuardCheckInput,
    options: CheckOrDowngradeOptions
  ): Promise<{ action: NextAction; result: SpendingGuardCheckOutput }> {
    const result = await this.invoke(input, this.timeoutMs);
    switch (result.decision) {
      case "allow":
        return { action: input.next_action, result };
      case "warn":
      case "require_confirmation": {
        const isModelEscalation =
          result.pattern === "model_escalation_without_evidence" ||
          result.recommended_policy === "downgrade" ||
          result.suggested_action.type === "switch_model";
        if (isModelEscalation) {
          // Stage 0.2-minimal: prefer the structured model_route.to from the
          // guard response over the operator's static downgradeTo. The route
          // comes from the operator's own model_policy.secondaryModel, so it
          // is more authoritative than the local SDK fallback.
          const routeTo = result.suggested_action.model_route?.to;
          const target = {
            provider: routeTo?.provider ?? options.downgradeTo.provider,
            model: routeTo?.model ?? options.downgradeTo.model,
            estimatedCost: options.downgradeTo.estimatedCost,
          };
          const downgraded = applyDowngrade(input.next_action, target);
          await options.onDowngrade?.(result, downgraded);
          return { action: downgraded, result };
        }
        if (options.onWarn) {
          const ok = await options.onWarn(result);
          if (!ok) throw new SpendingGuardConfirmationDeniedError(result);
        }
        return { action: input.next_action, result };
      }
      case "delay":
        return { action: input.next_action, result };
      case "block":
        throw new SpendingGuardBlockedError(result);
      case "uncertain":
        await this.applyUncertainPolicy(result, options.onWarn);
        return { action: input.next_action, result };
    }
  }

  private async applyUncertainPolicy(
    result: SpendingGuardCheckOutput,
    onWarn?: (
      result: SpendingGuardCheckOutput
    ) => Promise<boolean> | boolean
  ): Promise<SpendingGuardCheckOutput> {
    switch (this.uncertainPolicy) {
      case "allow_with_log":
        return result;
      case "ask_human": {
        if (!onWarn) return result;
        const ok = await onWarn(result);
        if (!ok) throw new SpendingGuardConfirmationDeniedError(result);
        return result;
      }
      case "run_deep_check":
        // Deep check is a server-side concern; SDK falls back to allow_with_log
        // when no deep_check endpoint is wired in v0.1.
        return result;
      case "throw":
        throw new SpendingGuardConfirmationDeniedError(result);
    }
  }

  private async invoke(
    input: SpendingGuardCheckInput,
    timeoutMs: number
  ): Promise<SpendingGuardCheckOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetcher(input, controller.signal);
    } catch (err) {
      return this.handleFailure(err);
    } finally {
      clearTimeout(timer);
    }
  }

  private handleFailure(err: unknown): SpendingGuardCheckOutput {
    if (this.failureMode === "throw") {
      throw err instanceof Error ? err : new Error(String(err));
    }
    this.onFailureOpen?.(err);
    if (this.failureMode === "closed") {
      return synthesizeFailureClosed(err);
    }
    return synthesizeFailureOpen(err);
  }
}

function applyDowngrade(
  original: NextAction,
  to: CheckOrDowngradeOptions["downgradeTo"]
): NextAction {
  return {
    ...original,
    provider: to.provider ?? original.provider,
    model: to.model,
    estimated_cost: {
      amount: to.estimatedCost ?? original.estimated_cost.amount,
      currency: original.estimated_cost.currency,
    },
  };
}

function synthesizeFailureOpen(err: unknown): SpendingGuardCheckOutput {
  return {
    decision: "allow",
    risk_score: 0,
    risk_level: "low",
    confidence: 0,
    pattern: "guard_unavailable",
    matched_rules: [],
    reason: "Spending Guard was unavailable. Failing open by default.",
    suggested_action: {
      type: "continue_with_log",
      message: "Guard unavailable; the SDK is failing open. Log this event.",
    },
    recommended_policy: "log_only",
    hard_block: false,
    requires_human_confirmation: false,
    metadata: { failure_mode: "open" },
    detector_version: "guard_unavailable@0.1.0",
    policy_version: POLICY_VERSION,
    error: {
      code: "GUARD_UNAVAILABLE",
      message: err instanceof Error ? err.message : String(err),
    },
  };
}

function synthesizeFailureClosed(err: unknown): SpendingGuardCheckOutput {
  return {
    decision: "block",
    risk_score: 100,
    risk_level: "critical",
    confidence: 0,
    pattern: "guard_unavailable",
    matched_rules: [],
    reason: "Spending Guard was unavailable. Failing closed by configuration.",
    suggested_action: {
      type: "stop_action",
      message: "Guard unavailable; SDK configured to fail closed. Stop the action.",
    },
    recommended_policy: "stop_action",
    hard_block: true,
    requires_human_confirmation: false,
    metadata: { failure_mode: "closed" },
    detector_version: "guard_unavailable@0.1.0",
    policy_version: POLICY_VERSION,
    error: {
      code: "GUARD_UNAVAILABLE",
      message: err instanceof Error ? err.message : String(err),
    },
  };
}

function createInProcessFetcher(): Fetcher {
  return async (input) => runCheck(input);
}

function createHttpFetcher(baseUrl: string, apiKey?: string): Fetcher {
  const url = baseUrl.replace(/\/+$/, "") + "/v1/check";
  return async (input, signal) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal,
    });
    if (!res.ok) {
      throw new Error(`Spending Guard HTTP error: ${res.status}`);
    }
    return (await res.json()) as SpendingGuardCheckOutput;
  };
}
