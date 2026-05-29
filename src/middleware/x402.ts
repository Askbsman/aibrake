// x402 micropayment middleware for Fastify routes — bazar-compatible.
//
// Pattern + protocol shape mirrored from bsman-ai (callbsman.com)
// `src/middleware/x402.ts`. Same x402Version (2), same CAIP-2 network
// identifiers, same PaymentRequiredBody structure. Bsman-ai uses the
// official @x402 SDK; we re-implement the server-side primitives on
// top of fetch() to keep AIBrake free of @x402 deps. Wire-compatibility
// is what matters for the bazar crawler — we match that.
//
// Bsman-ai PaymentRequiredBody fields covered:
//   - x402Version: 2
//   - error
//   - resource { url, description, mimeType }
//   - accepts[]: { scheme, network (CAIP-2), amount, asset, payTo, maxTimeoutSeconds, extra }
//   - extensions (bazaar discovery payload — schema, examples)
//   - compatibility { paymentRequiredHeader, headerIsCanonical, hint }
//   - resourceUrl, method, endpoint
//   - payment { protocol, network, networkId, price, facilitator }
//   - metadata (bazaar listing fields)
//
// USDC contract addresses per network are inlined from the canonical
// Coinbase USDC deployment list; the facilitator will reject any payment
// to a wrong contract so the bazar crawler can rely on these as ground
// truth.

import type { FastifyReply, FastifyRequest } from "fastify";
import type { X402Config } from "../config/env.js";
import {
  bazaarDiscoveryMetadata,
  bazaarTags,
  checkRequestExample,
  checkRequestDiscoverySchema,
  checkResponseExample,
  checkResponseDiscoverySchema,
} from "../config/discovery.js";

// ─────────────────────────────────────────────────────────────────────────
// Network mapping — same as bsman-ai/src/config/x402.ts
// ─────────────────────────────────────────────────────────────────────────

const NETWORK_ALIASES: Record<string, `${string}:${string}`> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

const USDC_CONTRACTS: Record<string, string> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",       // Base mainnet
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",      // Base Sepolia
};

export function normalizeNetwork(value: string): `${string}:${string}` {
  if (NETWORK_ALIASES[value]) return NETWORK_ALIASES[value]!;
  if (value.includes(":")) return value as `${string}:${string}`;
  throw new Error(
    `X402_NETWORK must be a CAIP-2 identifier or known alias. Got: ${value}`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Types — x402 v2 wire shape (bazar-compatible)
// ─────────────────────────────────────────────────────────────────────────

export interface PaymentAccept {
  scheme: "exact";
  network: `${string}:${string}`;     // CAIP-2 e.g. eip155:8453
  amount: string;                       // smallest unit (microUSDC)
  asset: string;                        // 0x... contract
  payTo: string;                        // 0x... receiver
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface PaymentRequiredBody {
  x402Version: 2;
  error: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: PaymentAccept[];
  extensions: Record<string, unknown>;
  compatibility: {
    paymentRequiredHeader: "PAYMENT-REQUIRED";
    headerIsCanonical: true;
    hint: string;
  };
  resourceUrl: string;
  method: string;
  endpoint: string;
  payment: {
    protocol: "x402";
    network: string;                    // human-readable e.g. "Base mainnet"
    networkId: string;                  // CAIP-2 e.g. "eip155:8453"
    price: string;                      // "$0.001 per check decision"
    facilitator: string;                // "configured x402 facilitator"
  };
  metadata: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────
// Build a v2 PaymentRequiredBody (bazar-compatible).
// ─────────────────────────────────────────────────────────────────────────

export function buildPaymentRequirements(
  config: X402Config,
  resourceUrl: string,
  options: {
    method?: "GET" | "POST";
    description?: string;
  } = {}
): PaymentRequiredBody {
  const network = normalizeNetwork(config.network);
  const microUsdc = Math.round(config.priceCheckUsd * 1_000_000);
  const method = (options.method ?? "POST").toUpperCase();
  const description =
    options.description ?? bazaarDiscoveryMetadata.description;
  const mimeType = bazaarDiscoveryMetadata.mimeType;

  const accept: PaymentAccept = {
    scheme: "exact",
    network,
    amount: String(microUsdc),
    asset:
      USDC_CONTRACTS[network] ?? USDC_CONTRACTS["eip155:8453"]!,
    payTo: config.payTo,
    maxTimeoutSeconds: 60,
    extra: {
      name: "USDC",
      version: "2",
      aibrake: {
        name: bazaarDiscoveryMetadata.name,
        provider: bazaarDiscoveryMetadata.provider,
        category: bazaarDiscoveryMetadata.category,
        tags: [...bazaarTags],
        docsUrl: bazaarDiscoveryMetadata.docsUrl,
        openApiUrl: bazaarDiscoveryMetadata.openApiUrl,
        githubUrl: bazaarDiscoveryMetadata.githubUrl,
        mainMode: bazaarDiscoveryMetadata.mainMode,
        supportedModes: [...bazaarDiscoveryMetadata.supportedModes],
        fallbackUrl: bazaarDiscoveryMetadata.fallbackUrl,
      },
    },
  };

  // Discovery extensions — mirror the shape that
  // @x402/extensions declareDiscoveryExtension produces.
  const extensions: Record<string, unknown> = {
    "x402.discovery": {
      bodyType: "json",
      input:
        method === "GET" ? undefined : checkRequestExample,
      inputSchema:
        method === "GET" ? undefined : checkRequestDiscoverySchema,
      output: {
        example: checkResponseExample,
        schema: checkResponseDiscoverySchema,
      },
    },
  };

  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: resourceUrl,
      description,
      mimeType,
    },
    accepts: [accept],
    extensions,
    compatibility: {
      paymentRequiredHeader: "PAYMENT-REQUIRED",
      headerIsCanonical: true,
      hint:
        "The PAYMENT-REQUIRED header is canonical. This JSON body mirrors the same PaymentRequired payload for clients that read the body.",
    },
    resourceUrl,
    method,
    endpoint: `${method} ${resourceUrl}`,
    payment: {
      protocol: "x402",
      network: network === "eip155:8453" ? "Base mainnet" : "Base Sepolia",
      networkId: network,
      price: `$${config.priceCheckUsd.toFixed(3)} ${bazaarDiscoveryMetadata.payment.unit}`,
      facilitator: "configured x402 facilitator",
    },
    metadata: {
      name: bazaarDiscoveryMetadata.name,
      provider: bazaarDiscoveryMetadata.provider,
      category: bazaarDiscoveryMetadata.category,
      description: bazaarDiscoveryMetadata.shortDescription,
      mimeType,
      docsUrl: bazaarDiscoveryMetadata.docsUrl,
      openApiUrl: bazaarDiscoveryMetadata.openApiUrl,
      githubUrl: bazaarDiscoveryMetadata.githubUrl,
      mainMode: bazaarDiscoveryMetadata.mainMode,
      supportedModes: [...bazaarDiscoveryMetadata.supportedModes],
      tags: [...bazaarTags],
      fallbackUrl: bazaarDiscoveryMetadata.fallbackUrl,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Verify a payment by calling the facilitator's /verify endpoint.
// ─────────────────────────────────────────────────────────────────────────

interface FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export async function verifyPaymentWithFacilitator(
  facilitatorUrl: string,
  paymentPayloadB64: string,
  paymentRequirements: PaymentAccept,
  abortSignal?: AbortSignal
): Promise<FacilitatorVerifyResponse> {
  const url = `${facilitatorUrl.replace(/\/$/, "")}/verify`;
  let payload: unknown;
  try {
    const decoded = Buffer.from(paymentPayloadB64, "base64").toString("utf8");
    payload = JSON.parse(decoded);
  } catch (err) {
    return {
      isValid: false,
      invalidReason: `Invalid X-Payment / PAYMENT-REQUIRED header: ${(err as Error).message}`,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements,
    }),
    signal: abortSignal,
  });

  if (!res.ok) {
    return {
      isValid: false,
      invalidReason: `facilitator returned HTTP ${res.status}`,
    };
  }

  return (await res.json()) as FacilitatorVerifyResponse;
}

// ─────────────────────────────────────────────────────────────────────────
// Fastify preHandler — apply to any route that needs x402 paywall.
// ─────────────────────────────────────────────────────────────────────────

export function createX402PreHandler(config: X402Config) {
  return async function x402PreHandler(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!config.enabled) {
      reply.code(503).send({
        error: "x402_disabled",
        message: "x402 paywall is not enabled on this deployment.",
      });
      return;
    }
    if (!config.payTo) {
      reply.code(500).send({
        error: "x402_misconfigured",
        message: "X402_PAY_TO env var is not set.",
      });
      return;
    }

    const resourceUrl = `${getOrigin(req)}${req.url}`;
    const paymentRequirementsBody = buildPaymentRequirements(
      config,
      resourceUrl,
      {
        method: req.method.toUpperCase() as "GET" | "POST",
        description: bazaarDiscoveryMetadata.description,
      }
    );

    // x402 canonical: clients read either PAYMENT-REQUIRED header (preferred)
    // or the body. We accept X-Payment (legacy) and PAYMENT-REQUIRED header
    // names for forwards-compat.
    const paymentHeaderRaw =
      req.headers["x-payment"] ??
      req.headers["X-Payment"] ??
      req.headers["payment-required"] ??
      req.headers["PAYMENT-REQUIRED"];
    const paymentHeader = Array.isArray(paymentHeaderRaw)
      ? paymentHeaderRaw[0]
      : paymentHeaderRaw;

    if (!paymentHeader) {
      reply
        .code(402)
        .header("content-type", "application/json")
        .header("payment-required", "true")
        .send(paymentRequirementsBody);
      return;
    }

    const requirement = paymentRequirementsBody.accepts[0]!;
    let verifyResult: FacilitatorVerifyResponse;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      verifyResult = await verifyPaymentWithFacilitator(
        config.facilitatorUrl,
        paymentHeader,
        requirement,
        controller.signal
      );
    } catch (err) {
      reply.code(402).send({
        ...paymentRequirementsBody,
        error: `Payment verification failed: ${(err as Error).message}`,
      });
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!verifyResult.isValid) {
      reply.code(402).send({
        ...paymentRequirementsBody,
        error: verifyResult.invalidReason ?? "Payment verification failed",
      });
      return;
    }

    (req as any).x402Payer = verifyResult.payer;
    return;
  };
}

function getOrigin(req: FastifyRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ??
    (req.headers["host"] as string);
  return `${proto}://${host}`;
}
