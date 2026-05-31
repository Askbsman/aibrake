// Bazaar / x402 discovery metadata for AIBrake.
//
// Mirrors the bsman-ai (callbsman.com) pattern at src/config/discovery.ts —
// same shape, AIBrake-specific values. Surfaces this metadata through:
//
//   - PaymentRequiredBody.metadata in 402 responses
//   - GET /.well-known/x402 discovery manifest
//
// Goal: bazaar / agentic.market crawlers can introspect price, network,
// payee, schemas, examples without making a paid call.

const checkUrl = "https://api.aibrake.dev/x402/v1/check";
const fallbackCheckUrl = "https://agent-spend-guard.onrender.com/x402/v1/check";

export const bazaarIndexingLimitationNote =
  "AIBrake exposes Bazaar-compatible metadata for x402 discovery. The current production endpoint uses the same facilitator as callbsman.com (xpay on Base mainnet) because CDP onboarding integration is staged for a follow-up release.";

export const bazaarTags = [
  "x402",
  "AI agents",
  "agent safety",
  "loop detection",
  "retry storm",
  "model stop-loss",
  "cost control",
  "guardrail",
  "MCP",
  "Base mainnet",
  "AgentCash",
] as const;

export const checkRequestExample = {
  actor: {
    type: "agent",
    runtime: "openclaw",
    id: "agent_001",
    name: "OpenClaw Coding Agent",
  },
  objective: {
    id: "obj_ts_build",
    goal: "Fix failing TypeScript build",
    budget: { amount: 5, currency: "USD", hard_limit: false },
  },
  next_action: {
    type: "paid_llm_call",
    provider: "anthropic",
    model: "claude-opus-4.7",
    estimated_cost: { amount: 0.42, currency: "USD" },
    reason: "Retry the same TypeScript build fix",
  },
  history: {
    attempt_number: 7,
    paid_attempts_on_same_failure: 6,
    failure_signal_present: true,
    failure_fingerprint: "fp_v1_failure_ts2307",
    new_evidence_since_last_attempt: false,
  },
  spend: {
    spent_on_objective: { amount: 2.52, currency: "USD" },
  },
  telemetry_quality: { completeness: "high" },
} as const;

export const checkResponseExample = {
  decision: "require_confirmation",
  risk_score: 100,
  risk_level: "critical",
  confidence: 0.9,
  pattern: "stale_context_retry_storm",
  reason:
    "Attempt #7 on the same exception: 6 prior repeats with no evidence gathered in any attempt. Another paid retry is unlikely to produce a different result without a context refresh.",
  matched_rules: [
    "failure_signal_present",
    "same_failure_count_high",
    "no_new_evidence_since_last_attempt",
  ],
  suggested_action: { type: "context_refresh" },
  recommended_policy: "ask_human",
  projected_savings: {
    amount_usd: 1.26,
    currency: "USD",
    basis: "projected_future_attempts",
  },
  detector_version: "stale_context_retry_storm@0.1.0",
  policy_version: "policy@0.1.0",
} as const;

export const checkRequestDiscoverySchema = {
  type: "object",
  required: ["actor", "next_action"],
  properties: {
    actor: {
      type: "object",
      required: ["type"],
      properties: {
        type: { type: "string" },
        runtime: { type: "string" },
        id: { type: "string" },
        name: { type: "string" },
      },
    },
    objective: {
      type: "object",
      properties: {
        id: { type: "string" },
        goal: { type: "string" },
        budget: {
          type: "object",
          properties: {
            amount: { type: "number" },
            currency: { type: "string" },
            hard_limit: { type: "boolean" },
          },
        },
      },
      additionalProperties: true,
    },
    next_action: {
      type: "object",
      required: ["type", "estimated_cost"],
      properties: {
        type: { type: "string" },
        provider: { type: "string" },
        model: { type: "string" },
        estimated_cost: {
          type: "object",
          required: ["amount", "currency"],
          properties: {
            amount: { type: "number" },
            currency: { type: "string" },
          },
        },
        reason: { type: "string" },
      },
      additionalProperties: true,
    },
    history: { type: "object", additionalProperties: true },
    spend: { type: "object", additionalProperties: true },
    telemetry_quality: { type: "object", additionalProperties: true },
  },
  additionalProperties: true,
} as const;

export const checkResponseDiscoverySchema = {
  type: "object",
  required: [
    "decision",
    "risk_score",
    "pattern",
    "reason",
    "suggested_action",
  ],
  properties: {
    decision: {
      type: "string",
      enum: ["allow", "warn", "require_confirmation", "block", "uncertain"],
    },
    risk_score: { type: "number", minimum: 0, maximum: 100 },
    risk_level: { type: "string" },
    confidence: { type: "number" },
    pattern: { type: "string" },
    reason: { type: "string" },
    matched_rules: { type: "array", items: { type: "string" } },
    suggested_action: {
      type: "object",
      properties: { type: { type: "string" } },
    },
    recommended_policy: { type: "string" },
    projected_savings: {
      type: "object",
      properties: {
        amount_usd: { type: "number" },
        currency: { type: "string" },
        basis: { type: "string" },
      },
    },
    detector_version: { type: "string" },
    policy_version: { type: "string" },
  },
  additionalProperties: true,
} as const;

export const bazaarDiscoveryMetadata = {
  name: "AIBrake — Agent safety for paid AI agents",
  provider: "AIBrake",
  category: "Agent Infrastructure",
  shortDescription:
    "Agent safety: loop detection and model stop-loss for paid AI agents.",
  description:
    "Agent safety for paid AI agents — loop detection, model stop-loss, retry-storm catch, unverified-deploy block, premium-model-burn guard. AIBrake returns a decision (allow / warn / require_confirmation / block) for a proposed paid agent action — paid LLM call, deployment assertion, model escalation. Catches retry storms, unverified deploys, premium-model burn, objective drift, and budget breaches before the next expensive step. 98.0% LCR on published synthetic corpus, p50 0.004 ms.",
  endpoint: checkUrl,
  resourceUrl: checkUrl,
  fallbackUrl: fallbackCheckUrl,
  docsUrl: "https://aibrake.dev",
  openApiUrl: "https://api.aibrake.dev/v1/meta",
  githubUrl: "https://github.com/Askbsman/aibrake",
  mimeType: "application/json",
  mainMode: "stale_context_retry_storm",
  supportedModes: [
    "stale_context_retry_storm",
    "same_tool_retry_loop",
    "model_escalation_without_evidence",
    "objective_drift",
    "task_budget_breach",
    "unverified_success_assertion",
  ],
  tags: bazaarTags,
  payment: {
    protocol: "x402",
    network: "Base mainnet",
    priceUsd: "0.005",
    unit: "per check decision",
  },
  cdpIndexingLimitation: bazaarIndexingLimitationNote as string,
  request: {
    example: checkRequestExample,
    schema: checkRequestDiscoverySchema,
  },
  response: {
    example: checkResponseExample,
    schema: checkResponseDiscoverySchema,
  },
} as const;

export const checkCapabilityResponse = {
  service: "AIBrake — Agent safety for paid AI agents",
  endpoint: "POST https://api.aibrake.dev/x402/v1/check",
  description:
    "Agent safety for paid AI agents — loop detection and model stop-loss. One decision per check.",
  payment: {
    protocol: "x402",
    network: "Base mainnet",
    price: "$0.005 per check decision",
  },
  primary_mode: "stale_context_retry_storm",
  supported_modes: bazaarDiscoveryMetadata.supportedModes,
  docs: "https://aibrake.dev",
  openapi: "https://api.aibrake.dev/v1/meta",
} as const;
