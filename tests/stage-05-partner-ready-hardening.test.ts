// Stage 0.5 Partner-Ready Hardening tests.
//
// Two themes:
//   A. /v1/meta exposes `detector_policy.supported_fields` so partners can
//      discover tunable knobs without grepping the source tree.
//   B. Every SDK error exposes a structured `details` block with a
//      discriminator `kind` and a `retryable` flag.
//
// The 0.4.2 contract (fail-open only catches transport-class errors) is
// preserved; these tests pin the new `details` shape on top of it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { setLoggerSink } from "../src/core/logger.js";
import {
  SpendingGuard,
  SpendingGuardBlockedError,
  SpendingGuardConfirmationDeniedError,
  SpendingGuardTransportError,
  SpendingGuardValidationError,
} from "../src/sdk/index.js";
import type { Fetcher } from "../src/sdk/client.js";
import type {
  SpendingGuardCheckInput,
  SpendingGuardCheckOutput,
} from "../src/core/types.js";

setLoggerSink({ emit: () => {} });

const SAMPLE_INPUT: SpendingGuardCheckInput = {
  actor: { type: "agent" },
  next_action: {
    type: "paid_llm_call",
    estimated_cost: { amount: 0.05, currency: "USD" },
  },
};

// ────────────────────────────────────────────────────────────────────────
// A. /v1/meta exposes detector_policy.supported_fields
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.5 — /v1/meta exposes detector_policy.supported_fields", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("R1: /v1/meta includes detector_policy.supported_fields object", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.detector_policy).toBeDefined();
    expect(body.detector_policy.supported_fields).toBeDefined();
    expect(typeof body.detector_policy.supported_fields).toBe("object");
  });

  it("R2: supported_fields includes same_tool_retry_threshold with type/default/min/recommended_range/description", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    const body = res.json();
    const f = body.detector_policy.supported_fields.same_tool_retry_threshold;
    expect(f).toBeDefined();
    expect(f.type).toBe("number");
    expect(f.default).toBe(6);
    expect(f.min).toBe(2);
    expect(Array.isArray(f.recommended_range)).toBe(true);
    expect(f.recommended_range).toEqual([3, 10]);
    expect(typeof f.description).toBe("string");
    expect(f.description.length).toBeGreaterThan(10);
  });

  it("R3: supported_fields includes premium_retry_without_evidence_threshold", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    const body = res.json();
    const f =
      body.detector_policy.supported_fields.premium_retry_without_evidence_threshold;
    expect(f).toBeDefined();
    expect(f.default).toBe(3);
    expect(f.min).toBe(1);
    expect(f.recommended_range).toEqual([2, 6]);
  });

  it("R4: supported_fields includes expensive_action_usd_threshold", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    const body = res.json();
    const f = body.detector_policy.supported_fields.expensive_action_usd_threshold;
    expect(f).toBeDefined();
    expect(f.default).toBe(0.1);
    expect(f.min).toBe(0);
    expect(f.recommended_range).toEqual([0.01, 1.0]);
  });

  it("R5: supported_fields includes require_confirmation_after_repeats", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    const body = res.json();
    const f = body.detector_policy.supported_fields.require_confirmation_after_repeats;
    expect(f).toBeDefined();
    expect(f.default).toBe(5);
    expect(f.min).toBe(2);
    expect(f.recommended_range).toEqual([3, 10]);
  });

  it("R6: /v1/meta includes a worked example block under detector_policy.example", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    const body = res.json();
    const ex = body.detector_policy.example;
    expect(ex).toBeDefined();
    // The example uses tighter thresholds — a partner running expensive
    // actions per call. All four knobs must appear so partners can paste it.
    expect(ex.same_tool_retry_threshold).toBe(3);
    expect(ex.premium_retry_without_evidence_threshold).toBe(2);
    expect(ex.expensive_action_usd_threshold).toBe(0.5);
    expect(ex.require_confirmation_after_repeats).toBe(4);
  });
});

// ────────────────────────────────────────────────────────────────────────
// B. SDK errors expose structured `details`
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.5 — structured error details (kind / statusCode / retryable)", () => {
  function fetcherThrowingTransport(): Fetcher {
    return async () => {
      throw new SpendingGuardTransportError("DNS failed");
    };
  }

  function fetcherThrowingTransport5xx(): Fetcher {
    return async () => {
      throw new SpendingGuardTransportError("Spending Guard server error 503", {
        status: 503,
      });
    };
  }

  function fetcherThrowingValidation(status: number, body: unknown): Fetcher {
    return async () => {
      throw new SpendingGuardValidationError(status, body);
    };
  }

  it("R7: SpendingGuardTransportError (network) has details.kind = 'transport' and retryable = true", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherThrowingTransport(),
      failureMode: "throw",
    });
    try {
      await guard.check(SAMPLE_INPUT);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingGuardTransportError);
      const e = err as SpendingGuardTransportError;
      expect(e.details.kind).toBe("transport");
      expect(e.details.retryable).toBe(true);
      expect(e.details.statusCode).toBeUndefined();
    }
  });

  it("R8: HTTP 400 validation error has details.kind = 'validation', statusCode = 400, retryable = false", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherThrowingValidation(400, {
        error: { code: "VALIDATION_ERROR", message: "next_action is required", details: [] },
      }),
      failureMode: "open",
    });
    try {
      await guard.check(SAMPLE_INPUT);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingGuardValidationError);
      const e = err as SpendingGuardValidationError;
      expect(e.details.kind).toBe("validation");
      expect(e.details.statusCode).toBe(400);
      expect(e.details.retryable).toBe(false);
      expect(e.details.code).toBe("VALIDATION_ERROR");
    }
  });

  it("R9: HTTP 401 has details.kind = 'http_4xx' and retryable = false", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherThrowingValidation(401, {
        error: { code: "UNAUTHORIZED", message: "missing api key", details: [] },
      }),
      failureMode: "open",
    });
    try {
      await guard.check(SAMPLE_INPUT);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingGuardValidationError);
      const e = err as SpendingGuardValidationError;
      expect(e.details.kind).toBe("http_4xx");
      expect(e.details.statusCode).toBe(401);
      expect(e.details.retryable).toBe(false);
    }
  });

  it("R10: HTTP 429 has details.kind = 'http_4xx' and retryable = true (rate limit is a retry signal)", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherThrowingValidation(429, {
        error: { code: "RATE_LIMIT", message: "too many requests", details: [] },
      }),
      failureMode: "open",
    });
    try {
      await guard.check(SAMPLE_INPUT);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingGuardValidationError);
      const e = err as SpendingGuardValidationError;
      expect(e.details.kind).toBe("http_4xx");
      expect(e.details.statusCode).toBe(429);
      expect(e.details.retryable).toBe(true);
    }
  });

  it("R11: HTTP 503 has details.kind = 'http_5xx', retryable = true, AND is fail-open eligible", async () => {
    const guardThrow = new SpendingGuard({
      fetcher: fetcherThrowingTransport5xx(),
      failureMode: "throw",
    });
    try {
      await guardThrow.check(SAMPLE_INPUT);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingGuardTransportError);
      const e = err as SpendingGuardTransportError;
      expect(e.details.kind).toBe("http_5xx");
      expect(e.details.statusCode).toBe(503);
      expect(e.details.retryable).toBe(true);
    }

    // Same condition, failureMode=open → synthetic allow (fail-open eligibility).
    const guardOpen = new SpendingGuard({
      fetcher: fetcherThrowingTransport5xx(),
      failureMode: "open",
    });
    const result = await guardOpen.check(SAMPLE_INPUT);
    expect(result.decision).toBe("allow");
    expect(result.pattern).toBe("guard_unavailable");
  });

  it("R12: BigInt programmer error propagates and does NOT carry a details.kind 'transport' (it's NOT a transport class)", async () => {
    // We don't pre-wrap programmer errors in a custom Error class — they
    // come out as the native TypeError from JSON.stringify. The point of
    // this test is to PIN the contract: serialization errors are NOT
    // routed through the SDK error hierarchy, they propagate raw.
    const guard = new SpendingGuard({
      baseUrl: "http://localhost:1",
      apiKey: "asg_v1_demo",
      failureMode: "open",
      timeoutMs: 100,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = {
      ...SAMPLE_INPUT,
      next_action: { ...SAMPLE_INPUT.next_action, weird: 10n },
    };
    await expect(guard.check(bad)).rejects.toThrow(TypeError);
    // Critically, it must NOT be a SpendingGuardTransportError so failureMode
    // does NOT swallow it.
    try {
      await guard.check(bad);
    } catch (err) {
      expect(err).not.toBeInstanceOf(SpendingGuardTransportError);
      expect(err).not.toBeInstanceOf(SpendingGuardValidationError);
    }
  });

  it("R13: SpendingGuardBlockedError exposes details.kind = 'blocked' and retryable = false", () => {
    const blockedResult: SpendingGuardCheckOutput = {
      decision: "block",
      risk_score: 100,
      risk_level: "critical",
      confidence: 0.9,
      pattern: "task_budget_breach",
      matched_rules: ["budget_exceeded"],
      reason: "Hard budget exceeded",
      suggested_action: { type: "stop_action", message: "Stop." },
      recommended_policy: "stop_action",
      hard_block: true,
      requires_human_confirmation: false,
      metadata: {},
      detector_version: "task_budget_breach@0.1.0",
      policy_version: "policy@0.1.0",
    };
    const err = new SpendingGuardBlockedError(blockedResult);
    expect(err.details.kind).toBe("blocked");
    expect(err.details.retryable).toBe(false);
  });

  it("R14: SpendingGuardConfirmationDeniedError exposes details.kind = 'confirmation_denied'", () => {
    const warnResult: SpendingGuardCheckOutput = {
      decision: "warn",
      risk_score: 60,
      risk_level: "elevated",
      confidence: 0.7,
      pattern: "stale_context_retry_storm",
      matched_rules: ["repeats_without_new_evidence"],
      reason: "Repeating without new evidence",
      suggested_action: { type: "ask_human", message: "Ask first." },
      recommended_policy: "ask_human",
      hard_block: false,
      requires_human_confirmation: true,
      metadata: {},
      detector_version: "stale_context_retry_storm@0.1.0",
      policy_version: "policy@0.1.0",
    };
    const err = new SpendingGuardConfirmationDeniedError(warnResult);
    expect(err.details.kind).toBe("confirmation_denied");
    expect(err.details.retryable).toBe(false);
  });
});
