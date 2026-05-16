import { z } from "zod";

const moneyAmountSchema = z.object({
  amount: z.number().finite(),
  currency: z.string().min(1).max(16),
});

const actorSchema = z.object({
  type: z.string().min(1),
  runtime: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
});

const objectiveBudgetSchema = z.object({
  amount: z.number().finite().nonnegative(),
  currency: z.string().min(1).max(16),
  hard_limit: z.boolean().optional(),
});

const modelRoleSchema = z.enum([
  "primary",
  "secondary",
  "fallback",
  "audit",
  "unknown",
]);

const modelTierSchema = z.enum([
  "premium",
  "standard",
  "cheap",
  "free",
  "unknown",
]);

const modelRefSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    role: modelRoleSchema.optional(),
    tier: modelTierSchema.optional(),
    // Stage 0.5.2: optional per-attempt cost on the model ref. When set on
    // `secondaryModel`, downstream computes precise savings delta.
    estimatedCostUsd: z.number().finite().nonnegative().optional(),
  })
  .strict();

const modelPolicySchema = z
  .object({
    primaryModel: modelRefSchema.optional(),
    secondaryModel: modelRefSchema.optional(),
    auditModel: modelRefSchema.optional(),
    maxPremiumRetriesWithoutEvidence: z.number().int().nonnegative().optional(),
  })
  .strict();

const detectorPolicySchema = z
  .object({
    same_tool_retry_threshold: z.number().int().positive().optional(),
    premium_retry_without_evidence_threshold: z.number().int().positive().optional(),
    expensive_action_usd_threshold: z.number().finite().nonnegative().optional(),
    require_confirmation_after_repeats: z.number().int().positive().optional(),
  })
  .strict();

const objectiveSchema = z
  .object({
    id: z.string().optional(),
    goal: z.string().optional(),
    success_criteria: z.array(z.string()).optional(),
    budget: objectiveBudgetSchema.optional(),
    max_paid_attempts: z.number().int().positive().optional(),
    allowed_actions: z.array(z.string()).optional(),
    blocked_actions: z.array(z.string()).optional(),
    model_policy: modelPolicySchema.optional(),
    detector_policy: detectorPolicySchema.optional(),
  })
  .strict();

const nextActionSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().min(1),
    provider: z.string().optional(),
    model: z.string().optional(),
    estimated_cost: moneyAmountSchema,
    reason: z.string().optional(),
    fingerprint: z.string().optional(),
    model_role: modelRoleSchema.optional(),
    model_tier: modelTierSchema.optional(),
  })
  .strict();

const failureSignalTypeSchema = z.enum([
  "test_failure",
  "build_error",
  "exception",
  "http_error",
  "tool_error",
  "command_error",
  "validation_error",
  "payment_error",
  "timeout",
]);

const evidenceKindSchema = z.enum([
  "code",
  "web",
  "api",
  "media",
  "browser",
  "payment",
  "generic",
]);

const evidenceSignalValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.array(z.number()),
  z.record(z.unknown()),
]);

const historySchema = z
  .object({
    attempt_number: z.number().int().nonnegative().optional(),
    same_action_count: z.number().int().nonnegative().optional(),
    paid_attempts_on_same_failure: z.number().int().nonnegative().optional(),
    failure_signal_present: z.boolean().optional(),
    failure_signal_type: failureSignalTypeSchema.optional(),
    failure_fingerprint: z.string().optional(),
    same_failure_count: z.number().int().nonnegative().optional(),
    last_new_evidence_at_attempt: z.number().int().nonnegative().optional(),
    new_evidence_since_last_attempt: z.boolean().nullable().optional(),
    evidence_kind: evidenceKindSchema.optional(),
    evidence_signals: z.record(evidenceSignalValueSchema).optional(),
    confidence_delta: z.number().optional(),
  })
  .strict();

const spendSchema = z
  .object({
    spent_on_objective: moneyAmountSchema.optional(),
    spent_today: moneyAmountSchema.optional(),
    daily_budget: moneyAmountSchema.optional(),
  })
  .strict();

const telemetryQualitySchema = z
  .object({
    completeness: z.enum(["high", "medium", "low", "unknown"]),
    missing_fields: z.array(z.string()).optional(),
  })
  .strict();

export const spendingGuardCheckInputSchema = z
  .object({
    actor: actorSchema,
    objective: objectiveSchema.optional(),
    next_action: nextActionSchema,
    history: historySchema.optional(),
    spend: spendSchema.optional(),
    telemetry_quality: telemetryQualitySchema.optional(),
    enabled_detectors: z.array(z.string()).optional(),
  })
  .strict();

export type SpendingGuardCheckInputParsed = z.infer<
  typeof spendingGuardCheckInputSchema
>;
