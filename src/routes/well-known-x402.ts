// GET /.well-known/x402 — discovery endpoint for x402 indexers /
// marketplaces (agentic.market, x402 registry, etc.).
//
// Returns the same PaymentRequiredBody shape that a 402 response would,
// but at HTTP 200 — so that crawlers can introspect pricing without
// triggering the paywall first. Always mounted; reports
// enabled=false when X402_ENABLED isn't true.

import type { FastifyInstance } from "fastify";
import type { EnvConfig } from "../config/env.js";
import { buildPaymentRequirements } from "../middleware/x402.js";

export async function registerWellKnownX402Route(
  app: FastifyInstance,
  config: EnvConfig
): Promise<void> {
  app.get("/.well-known/x402", async (request) => {
    const proto = (request.headers["x-forwarded-proto"] as string) ?? "https";
    const host =
      (request.headers["x-forwarded-host"] as string) ??
      (request.headers["host"] as string);
    const resourceUrl = `${proto}://${host}/x402/v1/check`;

    if (!config.x402.enabled) {
      return {
        enabled: false,
        service: config.serviceName,
        version: config.serviceVersion,
        message:
          "x402 paywall is not enabled on this deployment. The free /v1/check route accepts Bearer-auth API keys.",
      };
    }

    const body = buildPaymentRequirements(
      config.x402,
      resourceUrl,
      {
        method: "POST",
        description: "AIBrake check — loop detection + model stop-loss decision",
      }
    );
    return {
      enabled: true,
      service: config.serviceName,
      version: config.serviceVersion,
      ...body,
    };
  });
}
