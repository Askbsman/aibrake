import type { FastifyInstance } from "fastify";
import type { EnvConfig } from "../config/env.js";
import { POLICY_VERSION } from "../core/types.js";

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
      ...(config.publicUrl ? { public_url: config.publicUrl } : {}),
    };
  });
}
