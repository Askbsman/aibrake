// Stage 0.4.2 TS SDK fail-open scope regression tests.
//
// Mirrors `python/tests/test_client.py` test_17 / test_18 (Stage 0.4.1).
// Partner D (validation-log/partner-D-real-eval.md) found the same broad-catch
// bug in the TypeScript SDK that 0.4.1 fixed in Python: programmer errors
// (BigInt / circular refs) and server-side 4xx validation errors were silently
// converted to `decision: allow, pattern: guard_unavailable` instead of
// propagating to the caller. These tests pin the new contract.

import { describe, expect, it } from "vitest";
import { setLoggerSink } from "../src/core/logger.js";
import type { Fetcher } from "../src/sdk/client.js";
import {
  SpendingGuard,
  SpendingGuardTransportError,
  SpendingGuardValidationError,
} from "../src/sdk/index.js";
import type { SpendingGuardCheckInput } from "../src/core/types.js";

setLoggerSink({ emit: () => {} });

const SAMPLE_INPUT: SpendingGuardCheckInput = {
  actor: { type: "agent" },
  next_action: {
    type: "paid_llm_call",
    estimated_cost: { amount: 0.05, currency: "USD" },
  },
};

// ────────────────────────────────────────────────────────────────────────
// Programmer-error path: TypeError from JSON.stringify must propagate.
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.4.2 — programmer errors propagate (do NOT silently become allow)", () => {
  // We reach into the real createHttpFetcher path (no custom fetcher) so the
  // JSON.stringify(input) call inside it actually runs.

  it("R1: check() with a BigInt in the payload rejects with TypeError, not synthetic allow", async () => {
    const guard = new SpendingGuard({
      baseUrl: "http://localhost:1",
      apiKey: "asg_v1_demo",
      failureMode: "open",
      timeoutMs: 100,
    });
    // BigInt is the realistic Partner D case (cost stored as BigInt).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = {
      ...SAMPLE_INPUT,
      next_action: { ...SAMPLE_INPUT.next_action, weird: 10n },
    };
    await expect(guard.check(bad)).rejects.toThrow(TypeError);
  });

  it("R2: checkShadow() with a BigInt also rejects (does NOT swallow programmer errors)", async () => {
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
    await expect(guard.checkShadow(bad)).rejects.toThrow(TypeError);
  });

  it("R3: check() with a circular reference rejects with TypeError", async () => {
    const guard = new SpendingGuard({
      baseUrl: "http://localhost:1",
      apiKey: "asg_v1_demo",
      failureMode: "open",
      timeoutMs: 100,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: any = { ...SAMPLE_INPUT };
    bad.self = bad;
    await expect(guard.check(bad)).rejects.toThrow(TypeError);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Server-side 4xx validation: ValidationError must propagate.
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.4.2 — server-side 4xx propagates as SpendingGuardValidationError", () => {
  function fetcherReturning4xx(body: unknown = {
    error: { code: "VALIDATION_ERROR", message: "Invalid request body", details: [] },
  }): Fetcher {
    return async () => {
      throw new SpendingGuardValidationError(400, body);
    };
  }

  it("R4: check() throws SpendingGuardValidationError on simulated 400 (does NOT synthesize allow)", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherReturning4xx(),
      failureMode: "open",
    });
    await expect(guard.check(SAMPLE_INPUT)).rejects.toBeInstanceOf(SpendingGuardValidationError);
  });

  it("R5: checkShadow() also propagates the validation error (does NOT swallow)", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherReturning4xx(),
      failureMode: "open",
    });
    await expect(guard.checkShadow(SAMPLE_INPUT)).rejects.toBeInstanceOf(
      SpendingGuardValidationError
    );
  });

  it("R6: ValidationError carries the parsed server body so the caller can read the error code", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherReturning4xx({
        error: { code: "VALIDATION_ERROR", message: "next_action is required", details: [] },
      }),
      failureMode: "open",
    });
    try {
      await guard.check(SAMPLE_INPUT);
      expect.fail("expected SpendingGuardValidationError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingGuardValidationError);
      const validationErr = err as SpendingGuardValidationError;
      expect(validationErr.status).toBe(400);
      const body = validationErr.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toBe("next_action is required");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5xx server-side: transport class (synthesizes allow).
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.4.2 — 5xx is transport class (synthesizes via failureMode)", () => {
  function fetcherReturning5xx(): Fetcher {
    return async () => {
      throw new SpendingGuardTransportError("Spending Guard server error 503", { status: 503 });
    };
  }

  it("R7: 5xx with failureMode='open' returns synthetic allow", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherReturning5xx(),
      failureMode: "open",
    });
    const result = await guard.check(SAMPLE_INPUT);
    expect(result.decision).toBe("allow");
    expect(result.pattern).toBe("guard_unavailable");
    expect(result.error?.code).toBe("GUARD_UNAVAILABLE");
  });

  it("R8: 5xx with failureMode='closed' returns synthetic block", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherReturning5xx(),
      failureMode: "closed",
    });
    const result = await guard.check(SAMPLE_INPUT);
    expect(result.decision).toBe("block");
    expect(result.hard_block).toBe(true);
  });

  it("R9: 5xx with failureMode='throw' propagates the TransportError", async () => {
    const guard = new SpendingGuard({
      fetcher: fetcherReturning5xx(),
      failureMode: "throw",
    });
    await expect(guard.check(SAMPLE_INPUT)).rejects.toBeInstanceOf(SpendingGuardTransportError);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Custom fetcher contract: plain Error is no longer treated as transport.
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.4.2 — plain Error from a custom fetcher propagates (no longer treated as transport)", () => {
  it("R10: a fetcher that throws plain Error must NOT be silently synthesized", async () => {
    const guard = new SpendingGuard({
      fetcher: async () => {
        throw new Error("I am a generic error and might be a programmer bug");
      },
      failureMode: "open",
    });
    await expect(guard.check(SAMPLE_INPUT)).rejects.toThrow("generic error");
  });

  it("R11: a fetcher that throws SpendingGuardTransportError IS synthesized (opt-in)", async () => {
    const guard = new SpendingGuard({
      fetcher: async () => {
        throw new SpendingGuardTransportError("DNS failed");
      },
      failureMode: "open",
    });
    const result = await guard.check(SAMPLE_INPUT);
    expect(result.decision).toBe("allow");
    expect(result.pattern).toBe("guard_unavailable");
  });
});
