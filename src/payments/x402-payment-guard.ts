// Real x402 PaymentGuard — replaces the Stage 0.1 stub.
//
// Conforms to the PaymentGuard interface in src/payments/payment-guard.ts.
// Wraps the verification logic from src/middleware/x402.ts.
//
// Note: the Fastify-level x402 middleware (createX402PreHandler) is the
// canonical paywall for POST /x402/v1/check — it owns the 402 response
// shaping (PaymentRequiredBody). This guard exists for partners doing
// custom integrations who want a PaymentGuard handle they can call from
// arbitrary code paths.

import type { X402Config } from "../config/env.js";
import {
  buildPaymentRequirements,
  verifyPaymentWithFacilitator,
} from "../middleware/x402.js";
import type {
  PaidResource,
  PaymentGuard,
  PaymentResult,
} from "./payment-guard.js";

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  url?: string;
}

export class X402PaymentGuard implements PaymentGuard {
  constructor(private readonly config: X402Config) {}

  async requirePayment(
    resource: PaidResource,
    req: unknown
  ): Promise<PaymentResult> {
    if (!this.config.enabled) {
      return {
        ok: false,
        error: {
          code: "x402_disabled",
          message: "x402 paywall is not enabled on this deployment.",
        },
      };
    }
    if (!this.config.payTo) {
      return {
        ok: false,
        error: {
          code: "x402_misconfigured",
          message: "X402_PAY_TO env var is not set.",
        },
      };
    }

    const r = (req ?? {}) as RequestLike;
    const headers = r.headers ?? {};
    const xPaymentRaw = headers["x-payment"] ?? headers["X-Payment"];
    const xPayment = Array.isArray(xPaymentRaw) ? xPaymentRaw[0] : xPaymentRaw;

    if (!xPayment) {
      return {
        ok: false,
        error: {
          code: "payment_required",
          message: `X-Payment header is required. Resource: ${resource.endpoint}, price: $${this.config.priceCheckUsd} USDC on ${this.config.network}.`,
        },
      };
    }

    const requirementsBody = buildPaymentRequirements(
      this.config,
      resource.endpoint,
      { description: resource.description ?? "AIBrake check decision" }
    );
    const requirement = requirementsBody.accepts[0]!;

    let verifyResult;
    try {
      verifyResult = await verifyPaymentWithFacilitator(
        this.config.facilitatorUrl,
        xPayment,
        requirement
      );
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "facilitator_unreachable",
          message: `Payment verification failed: ${(err as Error).message}`,
        },
      };
    }

    if (!verifyResult.isValid) {
      return {
        ok: false,
        error: {
          code: "payment_invalid",
          message:
            verifyResult.invalidReason ?? "Payment signature did not verify.",
        },
      };
    }

    return {
      ok: true,
      receipt: verifyResult.payer ?? "verified",
    };
  }
}
