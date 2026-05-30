// GET /openapi.json + GET /openapi.yaml — OpenAPI 3.1 spec.
//
// agentcash + other x402 marketplaces look for /openapi.json first
// (then fall back to /.well-known/x402). Without an OpenAPI doc,
// `discover_api_endpoints` returns "No OpenAPI spec found" and
// auto-payment routes can't be picked up by their fetch flow.
//
// We mirror callbsman.com's shape: x-bazaar-metadata on info, plus
// per-path x-x402 + x-payment-info extensions so agentcash sees the
// price, currency, and protocol without probing.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { EnvConfig } from "../config/env.js";
import {
  bazaarDiscoveryMetadata,
  bazaarTags,
  checkRequestExample,
  checkRequestDiscoverySchema,
  checkResponseExample,
  checkResponseDiscoverySchema,
} from "../config/discovery.js";

function buildOpenApi(config: EnvConfig, serverUrl: string): Record<string, unknown> {
  const x402Enabled = config.x402.enabled;
  const priceUsd = config.x402.priceCheckUsd.toFixed(6);
  const formattedPrice = `$${config.x402.priceCheckUsd.toFixed(3)}`;
  const paidPath = "/x402/v1/check";

  const x402Extension = x402Enabled
    ? {
        "x-x402": {
          payment: "x402",
          network: "Base mainnet",
          price: formattedPrice,
          resource: `${serverUrl}${paidPath}`,
          mimeType: "application/json",
          mainMode: bazaarDiscoveryMetadata.mainMode,
          supportedModes: [...bazaarDiscoveryMetadata.supportedModes],
        },
        "x-payment-info": {
          price: {
            mode: "fixed",
            currency: "USD",
            amount: priceUsd,
          },
          protocols: [{ x402: {} }],
        },
      }
    : {};

  const paidEndpointShared = {
    summary: "Run AIBrake check on a proposed AI-agent action",
    description:
      "Runs loop detection + model stop-loss on a proposed paid agent action. Returns decision (allow / warn / require_confirmation / block) with risk score and reason.",
    ...x402Extension,
    responses: {
      "200": {
        description: "Decision returned",
        content: {
          "application/json": {
            schema: checkResponseDiscoverySchema,
            example: checkResponseExample,
          },
        },
      },
      "400": { description: "Invalid request body" },
      "402": { description: "Payment Required (x402 challenge)" },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: bazaarDiscoveryMetadata.name,
      version: config.serviceVersion,
      description: bazaarDiscoveryMetadata.description,
      "x-bazaar-metadata": {
        name: bazaarDiscoveryMetadata.name,
        provider: bazaarDiscoveryMetadata.provider,
        category: bazaarDiscoveryMetadata.category,
        resourceUrl: `${serverUrl}${paidPath}`,
        docsUrl: bazaarDiscoveryMetadata.docsUrl,
        githubUrl: bazaarDiscoveryMetadata.githubUrl,
        openApiUrl: `${serverUrl}/openapi.json`,
        iconUrl: "https://aibrake.dev/favicon.ico",
        tags: [...bazaarTags],
        mainMode: bazaarDiscoveryMetadata.mainMode,
        supportedModes: [...bazaarDiscoveryMetadata.supportedModes],
        cdpIndexingLimitation: bazaarDiscoveryMetadata.cdpIndexingLimitation,
      },
    },
    servers: [
      { url: serverUrl, description: "Primary production API" },
      {
        url: "https://agent-spend-guard.onrender.com",
        description: "Render fallback endpoint",
      },
    ],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          operationId: "getHealth",
          responses: { "200": { description: "Service health status" } },
        },
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI JSON",
          operationId: "getOpenApiJson",
          responses: { "200": { description: "OpenAPI document (JSON)" } },
        },
      },
      "/.well-known/x402": {
        get: {
          summary: "x402 discovery manifest",
          operationId: "getWellKnownX402",
          responses: {
            "200": {
              description: "x402 PaymentRequiredBody (HTTP 200 mirror)",
            },
          },
        },
      },
      "/v1/meta": {
        get: {
          summary: "Service metadata + detector_policy schema",
          operationId: "getMeta",
          responses: { "200": { description: "Service metadata" } },
        },
      },
      "/v1/check": {
        post: {
          summary: "Run AIBrake check (Bearer-auth, free for partners)",
          operationId: "postCheckFree",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: checkRequestDiscoverySchema,
                example: checkRequestExample,
              },
            },
          },
          responses: {
            "200": {
              description: "Decision returned",
              content: {
                "application/json": {
                  schema: checkResponseDiscoverySchema,
                  example: checkResponseExample,
                },
              },
            },
            "401": { description: "Missing or invalid Bearer token" },
            "400": { description: "Invalid request body" },
          },
        },
      },
      [paidPath]: {
        post: {
          ...paidEndpointShared,
          operationId: "postX402Check",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: checkRequestDiscoverySchema,
                example: checkRequestExample,
              },
            },
          },
        },
        get: {
          ...paidEndpointShared,
          summary: "Paid x402 discovery/capability probe",
          operationId: "getX402Check",
        },
      },
    },
  };
}

function toYaml(obj: unknown, indent = 0): string {
  // Minimal JSON→YAML serializer. Avoids pulling js-yaml as a server-side
  // dep for a single OpenAPI doc. Sufficient for openapi 3.1: emits scalar,
  // array, object — no anchors, no tags, no multi-doc.
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") {
    if (/[:#\-\?\&\*\!\|\>\'\"%@`\n]/.test(obj) || /^\s|\s$/.test(obj))
      return JSON.stringify(obj);
    return obj;
  }
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const sub = toYaml(item, indent + 1);
          return `${pad}-\n${sub}`;
        }
        return `${pad}- ${toYaml(item, indent + 1)}`;
      })
      .join("\n");
  }
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return entries
    .map(([k, v]) => {
      if (v && typeof v === "object" && !(Array.isArray(v) && v.length === 0)) {
        const sub = toYaml(v, indent + 1);
        return `${pad}${k}:\n${sub}`;
      }
      return `${pad}${k}: ${toYaml(v, indent + 1)}`;
    })
    .join("\n");
}

export async function registerOpenApiRoute(
  app: FastifyInstance,
  config: EnvConfig
): Promise<void> {
  function originFrom(request: FastifyRequest): string {
    const proto = (request.headers["x-forwarded-proto"] as string) ?? "https";
    const host =
      (request.headers["x-forwarded-host"] as string) ??
      (request.headers["host"] as string);
    return `${proto}://${host}`;
  }

  app.get("/openapi.json", async (request, reply) => {
    const spec = buildOpenApi(config, originFrom(request));
    reply.header("content-type", "application/json; charset=utf-8");
    return spec;
  });

  app.get("/openapi.yaml", async (request, reply) => {
    const spec = buildOpenApi(config, originFrom(request));
    reply.header("content-type", "application/yaml; charset=utf-8");
    return toYaml(spec);
  });

  // Some indexers probe /docs/openapi.{json,yaml} per the bsman-ai layout.
  // Mirror those paths so we appear in both crawlers' default paths.
  app.get("/docs/openapi.json", async (request, reply) => {
    const spec = buildOpenApi(config, originFrom(request));
    reply.header("content-type", "application/json; charset=utf-8");
    return spec;
  });
  app.get("/docs/openapi.yaml", async (request, reply) => {
    const spec = buildOpenApi(config, originFrom(request));
    reply.header("content-type", "application/yaml; charset=utf-8");
    return toYaml(spec);
  });
}
