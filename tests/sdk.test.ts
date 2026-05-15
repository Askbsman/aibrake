import { describe, expect, it } from "vitest";
import { setLoggerSink } from "../src/core/logger.js";
import type {
  Fetcher,
  SpendingGuardClientOptions,
} from "../src/sdk/client.js";
import {
  SpendingGuard,
  SpendingGuardBlockedError,
  SpendingGuardConfirmationDeniedError,
  SpendingGuardTransportError,
} from "../src/sdk/index.js";
import type {
  SpendingGuardCheckInput,
  SpendingGuardCheckOutput,
} from "../src/core/types.js";
import { baseInput, withCodingFailure } from "./helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

function buildGuard(
  fetcher: Fetcher,
  options: Partial<SpendingGuardClientOptions> = {}
): SpendingGuard {
  return new SpendingGuard({ fetcher, timeoutMs: 200, ...options });
}

function fetcherReturning(out: SpendingGuardCheckOutput): Fetcher {
  return async () => out;
}

function fetcherThrowing(err: Error): Fetcher {
  return async () => {
    throw err;
  };
}

// Stage 0.4.2: most failure-mode tests need to throw a transport-class error
// to exercise the failureMode routing. Plain `Error` now propagates (it could
// be a programmer bug); use this helper to simulate "the guard was unreachable".
function fetcherThrowingTransport(message = "network down"): Fetcher {
  return async () => {
    throw new SpendingGuardTransportError(message);
  };
}

function stubOutput(
  decision: SpendingGuardCheckOutput["decision"],
  pattern = "test_pattern",
  extras: Partial<SpendingGuardCheckOutput> = {}
): SpendingGuardCheckOutput {
  return {
    decision,
    risk_score: decision === "block" ? 95 : decision === "allow" ? 10 : 60,
    risk_level:
      decision === "block" ? "critical" : decision === "allow" ? "low" : "elevated",
    confidence: 0.9,
    pattern,
    matched_rules: [],
    reason: "test",
    suggested_action: { type: "noop", message: "noop" },
    recommended_policy:
      decision === "block"
        ? "stop_action"
        : decision === "allow"
          ? "continue"
          : "ask_human",
    hard_block: decision === "block",
    requires_human_confirmation: decision === "require_confirmation",
    metadata: {},
    detector_version: "test_pattern@0.1.0",
    policy_version: "policy@0.1.0",
    ...extras,
  };
}

describe("SDK SpendingGuard", () => {
  const sampleInput: SpendingGuardCheckInput = baseInput();

  it("check() returns the structured result without throwing on block", async () => {
    const guard = buildGuard(fetcherReturning(stubOutput("block")));
    const result = await guard.check(sampleInput);
    expect(result.decision).toBe("block");
  });

  it("checkShadow() returns synthetic allow on guard transport error and never throws", async () => {
    // Stage 0.4.2: must use TransportError to trigger synthesis. A plain
    // Error now propagates (programmer error path).
    const guard = buildGuard(fetcherThrowingTransport("network down"));
    const out = await guard.checkShadow(sampleInput);
    expect(out.decision).toBe("allow");
    expect(out.pattern).toBe("guard_unavailable");
  });

  it("checkOrConfirm() returns allow result transparently", async () => {
    const guard = buildGuard(fetcherReturning(stubOutput("allow")));
    const out = await guard.checkOrConfirm(sampleInput);
    expect(out.decision).toBe("allow");
  });

  it("checkOrConfirm() calls onWarn on warn", async () => {
    const guard = buildGuard(fetcherReturning(stubOutput("warn")));
    let called = false;
    await guard.checkOrConfirm(sampleInput, {
      onWarn: async () => {
        called = true;
        return true;
      },
    });
    expect(called).toBe(true);
  });

  it("checkOrConfirm() throws SpendingGuardBlockedError on block", async () => {
    const guard = buildGuard(fetcherReturning(stubOutput("block")));
    await expect(guard.checkOrConfirm(sampleInput)).rejects.toBeInstanceOf(
      SpendingGuardBlockedError
    );
  });

  it("checkOrConfirm() throws ConfirmationDenied when onWarn returns false", async () => {
    const guard = buildGuard(fetcherReturning(stubOutput("require_confirmation")));
    await expect(
      guard.checkOrConfirm(sampleInput, { onWarn: async () => false })
    ).rejects.toBeInstanceOf(SpendingGuardConfirmationDeniedError);
  });

  it("checkOrDowngrade() returns original action on allow", async () => {
    const guard = buildGuard(fetcherReturning(stubOutput("allow")));
    const { action } = await guard.checkOrDowngrade(sampleInput, {
      downgradeTo: { model: "claude-haiku" },
    });
    expect(action.model).toBe(sampleInput.next_action.model);
  });

  it("checkOrDowngrade() downgrades on model_escalation pattern", async () => {
    const guard = buildGuard(
      fetcherReturning(
        stubOutput("warn", "model_escalation_without_evidence", {
          recommended_policy: "downgrade",
        })
      )
    );
    const { action } = await guard.checkOrDowngrade(sampleInput, {
      downgradeTo: { model: "claude-haiku", estimatedCost: 0.01 },
    });
    expect(action.model).toBe("claude-haiku");
    expect(action.estimated_cost.amount).toBe(0.01);
  });

  it("failureMode 'open' returns synthetic allow on transport error", async () => {
    const guard = buildGuard(fetcherThrowingTransport("boom"), {
      failureMode: "open",
    });
    const out = await guard.check(sampleInput);
    expect(out.decision).toBe("allow");
    expect(out.error?.code).toBe("GUARD_UNAVAILABLE");
  });

  it("failureMode 'closed' returns synthetic block on transport error", async () => {
    const guard = buildGuard(fetcherThrowingTransport("boom"), {
      failureMode: "closed",
    });
    const out = await guard.check(sampleInput);
    expect(out.decision).toBe("block");
    expect(out.hard_block).toBe(true);
  });

  it("failureMode 'throw' propagates transport error", async () => {
    const guard = buildGuard(fetcherThrowingTransport("boom"), {
      failureMode: "throw",
    });
    await expect(guard.check(sampleInput)).rejects.toThrow("boom");
  });

  it("SDK with no fetcher and no baseUrl runs Core in-process", async () => {
    const guard = new SpendingGuard();
    const out = await guard.check(withCodingFailure(7));
    expect(out.pattern).toBe("stale_context_retry_storm");
  });

  it("timeout triggers failureMode behavior", async () => {
    // Stage 0.4.2: a custom fetcher must throw SpendingGuardTransportError
    // (or wrap the abort cause) to opt into failureMode synthesis. The real
    // createHttpFetcher does this wrapping; the mocked fetcher mirrors that.
    const slowFetcher: Fetcher = async (_input, signal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new SpendingGuardTransportError("aborted"))
        );
      });
    };
    const guard = buildGuard(slowFetcher, {
      timeoutMs: 50,
      failureMode: "open",
    });
    const out = await guard.check(sampleInput);
    expect(out.pattern).toBe("guard_unavailable");
  });
});
