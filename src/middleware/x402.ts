// x402 micropayment middleware for Fastify routes.
//
// Pattern adapted from Bsman-ai's src/middleware/x402.ts (which uses
// @x402/hono) — we re-implement the minimal server-side protocol on top
// of fetch() so we don't need to add @x402/* as deps (server only needs
// 402-response formatting and a facilitator call; all the crypto is
// off-server).
//
// Flow:
//   1. Client sends POST /x402/v1/check WITHOUT X-Payment header
//   2. We return 402 with PaymentRequiredBody describing price + payee
//   3. Client constructs a signed payment, retries with X-Payment header
//   4. We POST { paymentPayload, paymentRequirements } to
//      ${facilitatorUrl}/verify
//   5. If verify returns isValid: true, we let the request through
//   6. Optionally call /settle to finalize the on-chain settlement
//
// All env config lives in X402Config (src/config/env.ts).

import type { FastifyReply, FastifyRequest } from "fastify";
import type { X402Config } from "../config/env.js";

// ─────────────────────────────────────────────────────────────────────────
// Types — mirror the x402 protocol (https://x402.org/spec)
// ─────────────────────────────────────────────────────────────────────────

export interface PaymentRequirement {
  scheme: "exact";
  network: "base" | "base-sepolia";
  maxAmountRequired: string;        // smallest unit (wei/microUSDC)
  resource: string;                  // canonical URL of the paid resource
  description: string;
  mimeType: string;
  outputSchema: Record<string, unknown> | null;
  payTo: string;                     // 0x... receiver
  maxTimeoutSeconds: number;
  asset: string;                     // 0x... USDC contract address
  extra: { name: string; version: string };
}

export interface PaymentRequiredBody {
  x402Version: number;
  accepts: PaymentRequirement[];
  error: string;
}

// USDC contract addresses per network (canonical, from official USDC docs).
const USDC_CONTRACTS: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// ─────────────────────────────────────────────────────────────────────────
// Build a PaymentRequiredBody from config + the actual resource URL.
// ─────────────────────────────────────────────────────────────────────────

export function buildPaymentRequirements(
  config: X402Config,
  resourceUrl: string,
  description = "AIBrake /v1/check decision"
): PaymentRequiredBody {
  // USDC has 6 decimals — convert dollars to microUSDC.
  const microUsdc = Math.round(config.priceCheckUsd * 1_000_000);
  const requirement: PaymentRequirement = {
    scheme: "exact",
    network: config.network,
    maxAmountRequired: String(microUsdc),
    resource: resourceUrl,
    description,
    mimeType: "application/json",
    outputSchema: null,
    payTo: config.payTo,
    maxTimeoutSeconds: 60,
    asset: USDC_CONTRACTS[config.network] ?? USDC_CONTRACTS.base!,
    extra: { name: "USDC", version: "2" },
  };
  return {
    x402Version: 1,
    accepts: [requirement],
    error: "X-PAYMENT header is required",
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
  paymentRequirements: PaymentRequirement,
  abortSignal?: AbortSignal
): Promise<FacilitatorVerifyResponse> {
  const url = `${facilitatorUrl.replace(/\/$/, "")}/verify`;
  let payload: unknown;
  try {
    // X-Payment is base64-encoded JSON of the signed payment.
    const decoded = Buffer.from(paymentPayloadB64, "base64").toString("utf8");
    payload = JSON.parse(decoded);
  } catch (err) {
    return {
      isValid: false,
      invalidReason: `Invalid X-Payment header: ${(err as Error).message}`,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      x402Version: 1,
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
    // Defensive: if x402 is disabled, this preHandler shouldn't be wired
    // up — but if it is, refuse to validate and 503 loudly.
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
      resourceUrl
    );

    // No X-Payment header → return 402 with requirements.
    const xPayment = (req.headers["x-payment"] ?? req.headers["X-Payment"]) as
      | string
      | undefined;
    if (!xPayment) {
      reply
        .code(402)
        .header("content-type", "application/json")
        .send(paymentRequirementsBody);
      return;
    }

    // Verify via facilitator.
    const requirement = paymentRequirementsBody.accepts[0]!;
    let verifyResult: FacilitatorVerifyResponse;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      verifyResult = await verifyPaymentWithFacilitator(
        config.facilitatorUrl,
        xPayment,
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

    // Verified — annotate request and let it through.
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
