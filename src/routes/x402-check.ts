// POST /x402/v1/check — paid mirror of /v1/check.
//
// Same input schema, same Core check, same output — but gated behind
// the x402 micropayment middleware. Calling without an X-Payment header
// returns 402 with payment requirements; with a verified header it
// runs the AIBrake check and returns the decision.
//
// The free /v1/check route remains available for partners using Bearer
// auth (existing contract). x402 is a parallel monetisation path.

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runCheck } from "../core/check.js";
import { spendingGuardCheckInputSchema } from "../core/schemas.js";
import type { X402Config } from "../config/env.js";
import { createX402PreHandler } from "../middleware/x402.js";

export interface RegisterX402CheckRouteDeps {
  x402: X402Config;
}

export async function registerX402CheckRoute(
  app: FastifyInstance,
  deps: RegisterX402CheckRouteDeps
): Promise<void> {
  if (!deps.x402.enabled) {
    // Don't even mount the route when x402 is disabled — keeps the route
    // surface honest. /v1/meta still advertises x402.enabled=false so
    // clients know the paid path isn't available.
    return;
  }

  const x402PreHandler = createX402PreHandler(deps.x402);

  app.post(
    "/x402/v1/check",
    { preHandler: [x402PreHandler] },
    async (request, reply) => {
      const parsed = spendingGuardCheckInputSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
        };
      }
      const requestId = "req_" + randomUUID();
      const payer = (request as any).x402Payer as string | undefined;
      return runCheck(parsed.data, {
        emitLog: true,
        requestId,
        // Use the x402 payer address (lower-cased) as the "apiKeyHash"
        // surrogate so the decision log groups paid checks per payer.
        apiKeyHash: payer ? `x402:${payer.toLowerCase()}` : undefined,
      });
    }
  );

  // GET /x402/v1/check — paid discovery / capability probe. Bazaar
  // crawlers (and x402trace bazaar-check) issue a GET against the
  // resource URL to verify it returns 402 with a valid challenge. We
  // run the same preHandler; when no X-Payment is presented, the
  // preHandler returns 402. When a payment IS presented, we return a
  // small capability document instead of running the Core check (no
  // input body to evaluate on GET).
  app.get(
    "/x402/v1/check",
    { preHandler: [x402PreHandler] },
    async () => ({
      service: "AIBrake check",
      endpoint: "POST https://api.aibrake.dev/x402/v1/check",
      description:
        "Loop detection and model stop-loss for paid AI agents. POST with a SpendingGuardCheckInput payload to get one decision per request.",
      payment: {
        protocol: "x402",
        network: "Base mainnet",
        price: "$0.001 per check decision",
      },
      primary_mode: "stale_context_retry_storm",
      supported_modes: [
        "stale_context_retry_storm",
        "same_tool_retry_loop",
        "model_escalation_without_evidence",
        "objective_drift",
        "task_budget_breach",
        "unverified_success_assertion",
      ],
      docs: "https://aibrake.dev",
      openapi: "https://api.aibrake.dev/v1/meta",
    })
  );
}
