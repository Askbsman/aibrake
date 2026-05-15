import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runCheck } from "../core/check.js";
import { spendingGuardCheckInputSchema } from "../core/schemas.js";
import type { AuthMiddleware } from "../middleware/auth.js";
import { getAuthState } from "../middleware/auth.js";
import type { RateLimitMiddleware } from "../middleware/rate-limit.js";

export interface RegisterCheckRouteDeps {
  authMiddleware: AuthMiddleware;
  rateLimitMiddleware: RateLimitMiddleware;
}

export async function registerCheckRoute(
  app: FastifyInstance,
  deps: RegisterCheckRouteDeps
): Promise<void> {
  app.post(
    "/v1/check",
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
      return runCheck(parsed.data, {
        emitLog: true,
        requestId,
        apiKeyHash: auth.apiKeyHash,
      });
    }
  );
}
