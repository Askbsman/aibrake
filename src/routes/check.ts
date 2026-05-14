import type { FastifyInstance } from "fastify";
import { runCheck } from "../core/check.js";
import { spendingGuardCheckInputSchema } from "../core/schemas.js";

export async function registerCheckRoute(app: FastifyInstance): Promise<void> {
  app.post("/v1/check", async (request, reply) => {
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
    return runCheck(parsed.data);
  });
}
