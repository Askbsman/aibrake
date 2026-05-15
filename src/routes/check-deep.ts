import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runCheck } from "../core/check.js";
import { spendingGuardCheckInputSchema } from "../core/schemas.js";
import type { AuthMiddleware } from "../middleware/auth.js";
import { getAuthState } from "../middleware/auth.js";
import type { RateLimitMiddleware } from "../middleware/rate-limit.js";

export interface RegisterCheckDeepRouteDeps {
  authMiddleware: AuthMiddleware;
  rateLimitMiddleware: RateLimitMiddleware;
}

// Stage 0.3: still a stub.
// Returns the same rules-only result and honestly marks deep_check_used=false +
// deep_check_stub=true. LLM-based semantic judgment is out of scope for v0.3.
export async function registerCheckDeepRoute(
  app: FastifyInstance,
  deps: RegisterCheckDeepRouteDeps
): Promise<void> {
  app.post(
    "/v1/check-deep",
    {
      preHandler: [deps.authMiddleware, deps.rateLimitMiddleware],
    },
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
      const auth = getAuthState(request);
      const requestId = "req_" + randomUUID();
      const result = runCheck(parsed.data, {
        emitLog: true,
        requestId,
        apiKeyHash: auth.apiKeyHash,
      });
      return {
        ...result,
        deep_check_used: false,
        deep_check_stub: true,
      };
    }
  );
}
