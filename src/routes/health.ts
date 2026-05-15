import type { FastifyInstance } from "fastify";
import type { EnvConfig } from "../config/env.js";

export async function registerHealthRoute(
  app: FastifyInstance,
  config: EnvConfig
): Promise<void> {
  app.get("/health", async () => {
    return {
      ok: true,
      service: config.serviceName,
      version: config.serviceVersion,
      mode: "hosted-beta",
    };
  });
}
