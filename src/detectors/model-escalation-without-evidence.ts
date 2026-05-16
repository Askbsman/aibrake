import type {
  DetectorDefinition,
  DetectorResult,
  ModelPolicy,
  ModelRef,
  ModelRoute,
  NextAction,
  SpendingGuardCheckInput,
  SuggestedAction,
} from "../core/types.js";

const NAME = "model_escalation_without_evidence";
const VERSION = `${NAME}@0.3.0`;

// Stage 0.5.2: default downgrade map used ONLY when the operator did NOT
// declare `objective.model_policy.secondaryModel`. The map is a heuristic and
// will go stale as providers re-price; partners who care about precision
// should declare their own `secondaryModel` with `estimatedCostUsd`.
//
// Exported so /v1/meta can advertise it for discoverability.
export const DEFAULT_DOWNGRADE_MAP: ReadonlyArray<{
  matches: RegExp;
  to: { provider?: string; model: string; tier: "standard" | "cheap"; estimatedCostUsd?: number };
}> = [
  // Anthropic premium → cheaper tier
  { matches: /opus/i,        to: { provider: "anthropic", model: "claude-sonnet-4.5", tier: "standard", estimatedCostUsd: 0.05 } },
  { matches: /sonnet-?4\.5/i, to: { provider: "anthropic", model: "claude-haiku",      tier: "cheap",    estimatedCostUsd: 0.01 } },
  { matches: /sonnet-?4/i,    to: { provider: "anthropic", model: "claude-haiku",      tier: "cheap",    estimatedCostUsd: 0.01 } },
  { matches: /claude-?4\.\d/i, to: { provider: "anthropic", model: "claude-sonnet",    tier: "standard", estimatedCostUsd: 0.03 } },
  // OpenAI premium → cheaper tier
  { matches: /gpt-?5/i,       to: { provider: "openai",    model: "gpt-4o-mini",       tier: "cheap",    estimatedCostUsd: 0.01 } },
  { matches: /gpt-?4o/i,      to: { provider: "openai",    model: "gpt-4o-mini",       tier: "cheap",    estimatedCostUsd: 0.01 } },
  { matches: /gpt-?4/i,       to: { provider: "openai",    model: "gpt-4o-mini",       tier: "cheap",    estimatedCostUsd: 0.01 } },
  { matches: /^o[1-9]/i,      to: { provider: "openai",    model: "gpt-4o-mini",       tier: "cheap",    estimatedCostUsd: 0.01 } },
  // Generic "ultra" tier → unknown cheaper
  { matches: /ultra/i,        to: { provider: undefined,   model: "standard-tier",     tier: "standard" } },
];

function lookupDefaultDowngrade(model: string | undefined): {
  provider?: string;
  model: string;
  tier: "standard" | "cheap";
  estimatedCostUsd?: number;
} | undefined {
  if (!model) return undefined;
  for (const entry of DEFAULT_DOWNGRADE_MAP) {
    if (entry.matches.test(model)) return entry.to;
  }
  return undefined;
}

// Heuristic for "expensive" when no explicit model_policy or model_role/tier
// is provided. Used as a fallback so existing 0.1.x callers keep working.
const EXPENSIVE_MODEL_PATTERNS: RegExp[] = [
  /opus/i,
  /gpt-?4/i,
  /gpt-?5/i,
  /o[1-9]/i,
  /sonnet-?4/i,
  /ultra/i,
  /claude-?4\.\d/i,
];

function describeModel(ref: ModelRef | undefined, fallback: NextAction): string {
  const provider = ref?.provider ?? fallback.provider ?? "";
  const model = ref?.model ?? fallback.model ?? "an expensive model";
  return [provider, model].filter(Boolean).join("/");
}

function matchesConfiguredPrimary(
  action: NextAction,
  policy: ModelPolicy | undefined
): boolean {
  const primary = policy?.primaryModel;
  if (!primary) return false;
  const providerOk = !primary.provider || primary.provider === action.provider;
  const modelOk = !primary.model || primary.model === action.model;
  if (providerOk && modelOk && (primary.provider || primary.model)) return true;
  return false;
}

function looksExpensive(
  action: NextAction,
  policy: ModelPolicy | undefined
): { expensive: boolean; reasonTag: "role" | "tier" | "policy" | "heuristic" | "none" } {
  // 1. Explicit role / tier from telemetry — strongest signal.
  if (action.model_role === "primary") return { expensive: true, reasonTag: "role" };
  if (action.model_tier === "premium") return { expensive: true, reasonTag: "tier" };
  // 2. Configured primary model match — strong signal, comes from operator policy.
  if (matchesConfiguredPrimary(action, policy)) {
    return { expensive: true, reasonTag: "policy" };
  }
  // 3. Regex on a known premium-model name. Stage 0.3.1: cost alone is no
  //    longer enough to qualify as "model escalation" — Partner A surfaced a
  //    false positive when a $0.50 paid scrape (no model at all) tripped the
  //    detector. Operators with an LLM call should either provide a model name
  //    matching one of the regex patterns, declare model_tier: "premium" /
  //    model_role: "primary", or supply objective.model_policy.primaryModel.
  if (!action.model) return { expensive: false, reasonTag: "none" };
  if (EXPENSIVE_MODEL_PATTERNS.some((re) => re.test(action.model!))) {
    return { expensive: true, reasonTag: "heuristic" };
  }
  return { expensive: false, reasonTag: "none" };
}

export const modelEscalationWithoutEvidenceDetector: DetectorDefinition = {
  name: NAME,
  version: VERSION,
  baseConfidence: 0.75,
  // Stage 0.3.1 calibration: 4 recommended fields (dropped objective.model_policy).
  //
  // Why: with 5 fields, operators who did NOT declare model_policy hit
  // coverage 4/5 = 0.80 → confidence 0.60 → at score 25 (warn band threshold
  // is conf >= 0.70) → decision: allow, but suggested_action: downgrade.
  // Partner B in simulated validation flagged this dissonance: response says
  // "feel free to proceed" while suggesting a model downgrade in the same
  // payload. Dropping model_policy from recommended fields makes coverage
  // ~1.0 for both shapes (with/without policy), confidence 0.75, decision
  // warn — aligned with the calibrated philosophy "warn when suspicious".
  //
  // Operators who declare model_policy still get the structured model_route
  // in suggested_action — that is the actual reward, not a confidence bonus.
  recommendedFields: [
    "next_action.model",
    "next_action.estimated_cost",
    "history.same_failure_count",
    "history.new_evidence_since_last_attempt",
  ],
  evaluate(input: SpendingGuardCheckInput): DetectorResult | null {
    const h = input.history;
    if (!h) return null;
    const policy = input.objective?.model_policy;
    const { expensive, reasonTag } = looksExpensive(input.next_action, policy);
    if (!expensive) return null;

    const matched: string[] = ["expensive_next_action"];
    let score = 10;

    // Stage 0.4: per-request override via objective.detector_policy. Default 3.
    const premiumRetryThreshold =
      input.objective?.detector_policy
        ?.premium_retry_without_evidence_threshold ?? 3;
    if ((h.same_failure_count ?? 0) >= premiumRetryThreshold) {
      matched.push("same_failure_repeated");
      score += 10;
    }
    // Stage 0.3.1: gate the "no new evidence" penalty on the existence of
    // some history. Partner A surfaced the cold-start false positive: a
    // first-call request with no prior attempts at all (same_failure_count=0,
    // paid_attempts_on_same_failure=0, same_action_count=0) but
    // new_evidence_since_last_attempt=false should not be punished — there's
    // no previous attempt to have gathered evidence between.
    const hasHistoryOfAttempts =
      (h.same_failure_count ?? 0) >= 1 ||
      (h.paid_attempts_on_same_failure ?? 0) >= 1 ||
      (h.same_action_count ?? 0) >= 1;
    if (hasHistoryOfAttempts && h.new_evidence_since_last_attempt === false) {
      matched.push("no_new_evidence");
      score += 15;
    }
    if (matched.length === 1) return null;

    // 0.2-minimal: when an operator-supplied secondary model exists, recommend
    // a structured switch to it.
    // 0.5.2: when no secondary is declared, fall back to DEFAULT_DOWNGRADE_MAP
    //   so partners who haven't yet declared model_policy still get an
    //   actionable target (marked as "default" in route.reason so they know
    //   it's heuristic, not their own choice).
    const declaredSecondary = policy?.secondaryModel;
    const defaultTarget = declaredSecondary
      ? undefined
      : lookupDefaultDowngrade(input.next_action.model);

    const routeTarget: ModelRef | undefined = declaredSecondary ?? (defaultTarget
      ? {
          ...(defaultTarget.provider !== undefined ? { provider: defaultTarget.provider } : {}),
          model: defaultTarget.model,
          role: "secondary" as const,
          tier: defaultTarget.tier,
          ...(defaultTarget.estimatedCostUsd !== undefined
            ? { estimatedCostUsd: defaultTarget.estimatedCostUsd }
            : {}),
        }
      : undefined);

    const route: ModelRoute | undefined = routeTarget
      ? {
          from: {
            ...(input.next_action.provider !== undefined
              ? { provider: input.next_action.provider }
              : {}),
            ...(input.next_action.model !== undefined
              ? { model: input.next_action.model }
              : {}),
            ...(input.next_action.model_role !== undefined
              ? { role: input.next_action.model_role }
              : {}),
            ...(input.next_action.model_tier !== undefined
              ? { tier: input.next_action.model_tier }
              : {}),
          },
          to: routeTarget,
          reason: declaredSecondary
            ? "Secondary model is safer for summary / audit while the primary model is stuck without new evidence."
            : "Default downgrade target (no objective.model_policy.secondaryModel declared). Override by declaring your own secondaryModel for precise routing.",
        }
      : undefined;

    const suggested: SuggestedAction = route
      ? {
          type: "switch_model",
          message:
            `Switch to ${describeModel(route.to, input.next_action)} ` +
            `for summary or audit before another ${describeModel(route.from, input.next_action)} call. ` +
            `Same failure has repeated without new evidence — escalating to a more expensive model rarely changes the outcome.`,
          model_route: route,
        }
      : {
          type: "downgrade_model",
          message:
            "Escalating to a more expensive model on the same failure without new evidence rarely produces a different answer. Try a cheaper model with refreshed context first.",
        };

    const reason = route
      ? `Primary model ${describeModel(route.from, input.next_action)} has been used on the same ${h.failure_signal_type ?? "failure"} ` +
        `with ${h.same_failure_count ?? 0} repeats and no new evidence between attempts. ` +
        `A configured secondary model (${describeModel(route.to, input.next_action)}) is available — switching there for summary or audit is cheaper and likelier to surface what is missing.`
      : `Next action escalates to ${describeModel(undefined, input.next_action)} ` +
        `($${input.next_action.estimated_cost.amount.toFixed(2)})` +
        (matched.includes("same_failure_repeated")
          ? ` while the same failure has repeated ${h.same_failure_count ?? 0} times`
          : "") +
        (matched.includes("no_new_evidence")
          ? " and no new evidence has been gathered between attempts"
          : "") +
        ". Escalating without new input rarely produces a different answer — try the cheaper model with refreshed context first.";

    return {
      pattern: NAME,
      detectorVersion: VERSION,
      scoreContribution: score,
      confidence: 0.75,
      matchedRules: matched,
      suggestedActions: [suggested],
      metadata: {
        model: input.next_action.model ?? null,
        expensive_reason: reasonTag,
        has_model_policy: Boolean(policy),
        has_secondary_model: Boolean(declaredSecondary),
        used_default_downgrade: Boolean(defaultTarget) && !declaredSecondary,
        reason,
      },
    };
  },
};
