// Tests for the x402 paywall integration.
//
// We test 3 layers:
//   1. buildPaymentRequirements — pure shape, no network
//   2. createX402PreHandler — Fastify-injected requests, facilitator mocked
//   3. X402PaymentGuard — abstract guard used by partners

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { loadEnvConfig } from "../src/config/env.js";
import { setLoggerSink } from "../src/core/logger.js";
import {
  buildPaymentRequirements,
  verifyPaymentWithFacilitator,
} from "../src/middleware/x402.js";
import { X402PaymentGuard } from "../src/payments/x402-payment-guard.js";

setLoggerSink({ emit: () => {} });

const TEST_PAYEE = "0x1234567890abcdef1234567890abcdef12345678";

// ─────────────────────────────────────────────────────────────────────────
// Layer 1 — pure shape
// ─────────────────────────────────────────────────────────────────────────

describe("x402 buildPaymentRequirements", () => {
  it("produces a valid PaymentRequiredBody for base-sepolia at $0.001", () => {
    const body = buildPaymentRequirements(
      {
        enabled: true,
        network: "base-sepolia",
        facilitatorUrl: "https://x402.org/facilitator",
        payTo: TEST_PAYEE,
        priceCheckUsd: 0.001,
      },
      "https://api.example.com/x402/v1/check",
      "test description"
    );
    expect(body.x402Version).toBe(2);
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]!.scheme).toBe("exact");
    expect(body.accepts[0]!.network).toBe("eip155:84532"); // CAIP-2 for Base Sepolia
    expect(body.accepts[0]!.payTo).toBe(TEST_PAYEE);
    expect(body.accepts[0]!.amount).toBe("1000"); // 0.001 * 1e6
    expect(body.resource.url).toBe("https://api.example.com/x402/v1/check");
    expect(body.accepts[0]!.extra.name).toBe("USD Coin");
  });

  it("uses base mainnet USDC contract for network=base", () => {
    const body = buildPaymentRequirements(
      {
        enabled: true,
        network: "base",
        facilitatorUrl: "https://x402.org/facilitator",
        payTo: TEST_PAYEE,
        priceCheckUsd: 0.005,
      },
      "https://api.example.com/x402/v1/check"
    );
    expect(body.accepts[0]!.asset.toLowerCase()).toBe(
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
    );
    expect(body.accepts[0]!.amount).toBe("5000"); // 0.005 * 1e6
    expect(body.accepts[0]!.network).toBe("eip155:8453"); // CAIP-2 for Base mainnet
  });

  it("scales maxAmountRequired correctly across orders of magnitude", () => {
    const config = {
      enabled: true,
      network: "base-sepolia" as const,
      facilitatorUrl: "https://x402.org/facilitator",
      payTo: TEST_PAYEE,
      priceCheckUsd: 0.001,
    };
    const cases: Array<[number, string]> = [
      [0.001, "1000"],
      [0.01, "10000"],
      [0.1, "100000"],
      [1.0, "1000000"],
    ];
    for (const [price, expected] of cases) {
      const body = buildPaymentRequirements(
        { ...config, priceCheckUsd: price },
        "https://api.example.com/x402/v1/check"
      );
      expect(body.accepts[0]!.amount).toBe(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer 2 — Fastify routing
// ─────────────────────────────────────────────────────────────────────────

describe("POST /x402/v1/check route behaviour", () => {
  describe("x402 disabled (default)", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildServer({ logger: false, installLogSink: false });
      await app.ready();
    });
    afterAll(async () => app.close());

    it("does NOT mount /x402/v1/check when X402_ENABLED is false", async () => {
      const res = await app.inject({ method: "POST", url: "/x402/v1/check" });
      expect(res.statusCode).toBe(404);
    });

    it("GET /.well-known/x402 reports enabled=false", async () => {
      const res = await app.inject({ method: "GET", url: "/.well-known/x402" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.enabled).toBe(false);
    });

    it("/v1/meta omits the x402 endpoints when disabled", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/meta" });
      const body = res.json();
      expect(body.x402.enabled).toBe(false);
      expect(body.endpoints.x402_check).toBeUndefined();
    });
  });

  describe("x402 enabled — testnet config", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      const config = loadEnvConfig({
        ...process.env,
        X402_ENABLED: "true",
        X402_NETWORK: "base-sepolia",
        X402_PAY_TO: TEST_PAYEE,
        X402_PRICE_CHECK_USD: "0.001",
      });
      app = await buildServer({ logger: false, installLogSink: false, config });
      await app.ready();
    });
    afterAll(async () => app.close());

    it("returns 402 with PaymentRequiredBody when X-Payment is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/x402/v1/check",
        payload: { actor: { type: "agent" }, next_action: { type: "paid_llm_call", estimated_cost: { amount: 0.42, currency: "USD" } } },
      });
      expect(res.statusCode).toBe(402);
      const body = res.json();
      expect(body.x402Version).toBe(2);
      expect(body.accepts[0]!.payTo).toBe(TEST_PAYEE);
      expect(body.accepts[0]!.network).toBe("eip155:84532");
      expect(body.accepts[0]!.amount).toBe("1000");
      expect(body.error).toMatch(/required/i);
    });

    it("GET /.well-known/x402 returns the full requirements when enabled", async () => {
      const res = await app.inject({ method: "GET", url: "/.well-known/x402" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.enabled).toBe(true);
      expect(body.x402Version).toBe(2);
      expect(body.accepts[0]!.payTo).toBe(TEST_PAYEE);
    });

    it("/v1/meta includes x402 endpoints when enabled", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/meta" });
      const body = res.json();
      expect(body.x402.enabled).toBe(true);
      expect(body.x402.network).toBe("base-sepolia");
      expect(body.endpoints.x402_check).toBe("/x402/v1/check");
      expect(body.endpoints.x402_discovery).toBe("/.well-known/x402");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer 3 — X402PaymentGuard (abstract guard for partner use)
// ─────────────────────────────────────────────────────────────────────────

describe("X402PaymentGuard", () => {
  it("returns x402_disabled when config.enabled is false", async () => {
    const guard = new X402PaymentGuard({
      enabled: false,
      network: "base-sepolia",
      facilitatorUrl: "https://x402.org/facilitator",
      payTo: TEST_PAYEE,
      priceCheckUsd: 0.001,
    });
    const result = await guard.requirePayment(
      { endpoint: "/test", priceUsd: 0.001 },
      { headers: {} }
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("x402_disabled");
  });

  it("returns x402_misconfigured when payTo is empty", async () => {
    const guard = new X402PaymentGuard({
      enabled: true,
      network: "base-sepolia",
      facilitatorUrl: "https://x402.org/facilitator",
      payTo: "",
      priceCheckUsd: 0.001,
    });
    const result = await guard.requirePayment(
      { endpoint: "/test", priceUsd: 0.001 },
      { headers: {} }
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("x402_misconfigured");
  });

  it("returns payment_required when X-Payment header is missing", async () => {
    const guard = new X402PaymentGuard({
      enabled: true,
      network: "base-sepolia",
      facilitatorUrl: "https://x402.org/facilitator",
      payTo: TEST_PAYEE,
      priceCheckUsd: 0.001,
    });
    const result = await guard.requirePayment(
      { endpoint: "/x402/v1/check", priceUsd: 0.001 },
      { headers: {} }
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("payment_required");
    expect(result.error?.message).toMatch(/X-Payment header/);
  });

  it("calls facilitator when X-Payment is present (mocked)", async () => {
    // Mock global fetch to return a successful verify result.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ isValid: true, payer: "0xaaa...bbb" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as any;

    try {
      const guard = new X402PaymentGuard({
        enabled: true,
        network: "base-sepolia",
        facilitatorUrl: "https://x402.org/facilitator",
        payTo: TEST_PAYEE,
        priceCheckUsd: 0.001,
      });
      const dummyPayment = Buffer.from(
        JSON.stringify({ scheme: "exact", payload: {} })
      ).toString("base64");
      const result = await guard.requirePayment(
        { endpoint: "/x402/v1/check", priceUsd: 0.001 },
        { headers: { "x-payment": dummyPayment } }
      );
      expect(result.ok).toBe(true);
      expect(result.receipt).toBe("0xaaa...bbb");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns payment_invalid when facilitator says isValid: false", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ isValid: false, invalidReason: "signature mismatch" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as any;

    try {
      const guard = new X402PaymentGuard({
        enabled: true,
        network: "base-sepolia",
        facilitatorUrl: "https://x402.org/facilitator",
        payTo: TEST_PAYEE,
        priceCheckUsd: 0.001,
      });
      const dummyPayment = Buffer.from('{"x":1}').toString("base64");
      const result = await guard.requirePayment(
        { endpoint: "/x402/v1/check", priceUsd: 0.001 },
        { headers: { "x-payment": dummyPayment } }
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("payment_invalid");
      expect(result.error?.message).toMatch(/signature/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns facilitator_unreachable when fetch throws", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;

    try {
      const guard = new X402PaymentGuard({
        enabled: true,
        network: "base-sepolia",
        facilitatorUrl: "https://x402.org/facilitator",
        payTo: TEST_PAYEE,
        priceCheckUsd: 0.001,
      });
      const dummyPayment = Buffer.from('{"x":1}').toString("base64");
      const result = await guard.requirePayment(
        { endpoint: "/x402/v1/check", priceUsd: 0.001 },
        { headers: { "x-payment": dummyPayment } }
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("facilitator_unreachable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer 2.5 — verifyPaymentWithFacilitator low-level
// ─────────────────────────────────────────────────────────────────────────

describe("verifyPaymentWithFacilitator", () => {
  it("returns isValid: false when X-Payment header is not valid base64+JSON", async () => {
    const result = await verifyPaymentWithFacilitator(
      "https://x402.org/facilitator",
      "not-valid-base64!@#",
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: "1000",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: TEST_PAYEE,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      }
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/Invalid X-Payment/);
  });
});
