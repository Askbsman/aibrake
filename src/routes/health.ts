import type { FastifyInstance } from "fastify";

const SERVICE_VERSION = "0.1.0";

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return {
      ok: true,
      service: "spending-guard",
      version: SERVICE_VERSION,
    };
  });
}
