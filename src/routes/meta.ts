import type { FastifyInstance } from "fastify";
import type { EnvConfig } from "../config/env.js";
import { POLICY_VERSION } from "../core/types.js";

// Stage 0.5: discoverable detector_policy schema. Partners need to know which
// knobs they can tune without grepping the source tree. This block is
// DISCOVERY-ONLY metadata — the runtime is still driven by the request
// payload's `objective.detector_policy`. `/v1/meta` MUST NOT become an
// authoritative server-side config surface; Core stays stateless.
const DETECTOR_POLICY_SUPPORTED_FIELDS = {
  same_tool_retry_threshold: {
    type: "number" as const,
    default: 6,
    min: 2,
    recommended_range: [3, 10] as const,
    description:
      "How many repeated same-tool actions before same_tool_retry_loop can warn.",
  },
  premium_retry_without_evidence_threshold: {
    type: "number" as const,
    default: 3,
    min: 1,
    recommended_range: [2, 6] as const,
    description:
      "How many premium retries without new evidence before model escalation warnings become stronger.",
  },
  expensive_action_usd_threshold: {
    type: "number" as const,
    default: 0.1,
    min: 0,
    recommended_range: [0.01, 1.0] as const,
    description:
      "Cost threshold used by partner policy to classify an action as expensive.",
  },
  require_confirmation_after_repeats: {
    type: "number" as const,
    default: 5,
    min: 2,
    recommended_range: [3, 10] as const,
    description:
      "How many suspicious repeats before require_confirmation becomes likely.",
  },
} as const;

const DETECTOR_POLICY_EXAMPLE = {
  same_tool_retry_threshold: 3,
  premium_retry_without_evidence_threshold: 2,
  expensive_action_usd_threshold: 0.5,
  require_confirmation_after_repeats: 4,
} as const;

export async function registerMetaRoute(
  app: FastifyInstance,
  config: EnvConfig
): Promise<void> {
  app.get("/v1/meta", async () => {
    return {
      name: "Agent Spend Guard",
      version: config.serviceVersion,
      description: "Loop detection and model stop-loss for paid AI agents.",
      positioning: "PQS checks the prompt. Agent Spend Guard checks the loop.",
      endpoints: {
        check: "/v1/check",
        check_deep: "/v1/check-deep",
      },
      supported_patterns: [
        "stale_context_retry_storm",
        "same_tool_retry_loop",
        "model_escalation_without_evidence",
        "objective_drift",
        "task_budget_breach",
      ],
      modes: ["check", "shadow", "confirm", "downgrade"],
      policy_version: POLICY_VERSION,
      // Stage 0.5: detector_policy discovery — see PARTNER_ONBOARDING.md
      // "Choosing detector_policy thresholds" for guidance.
      detector_policy: {
        supported_fields: DETECTOR_POLICY_SUPPORTED_FIELDS,
        example: DETECTOR_POLICY_EXAMPLE,
      },
      ...(config.publicUrl ? { public_url: config.publicUrl } : {}),
    };
  });
}
