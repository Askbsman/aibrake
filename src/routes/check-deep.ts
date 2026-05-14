import type { FastifyInstance } from "fastify";
import { runCheck } from "../core/check.js";
import { spendingGuardCheckInputSchema } from "../core/schemas.js";

// Stage 0.1: stub. Falls through to runCheck but marks deep_check_used.
// LLM-based semantic judgment is out-of-scope for v0.1; this endpoint exists so
// SDK helpers can issue `run_deep_check` actions without 404'ing.
export async function registerCheckDeepRoute(app: FastifyInstance): Promise<void> {
  app.post("/v1/check-deep", async (request, reply) => {
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
    const result = runCheck(parsed.data);
    // Honesty contract: no real LLM/semantic deep check ran in Stage 0.1.
    // We return the same rules-only result and clearly mark `deep_check_used:
    // false` plus `deep_check_stub: true` so operators cannot mistake this
    // for the v0.2 behavior.
    return {
      ...result,
      deep_check_used: false,
      deep_check_stub: true,
    };
  });
}
