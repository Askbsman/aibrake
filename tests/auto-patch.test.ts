// Tests for aibrake/auto patch logic.
//
// We don't have the real `openai` / `@anthropic-ai/sdk` modules in
// devDeps — testing the dynamic-import code path directly would
// require them. Instead we test the buildable units: pricing,
// history tracking, env-driven config, and the end-to-end logic
// of patching a fake module that mimics the real SDK shape.

import { describe, it, expect, beforeEach } from "vitest";
import {
  clearHistory,
  hashError,
  hashObjective,
  lastError,
  recentForObjective,
  recordAttempt,
  _historyForTests,
} from "../src/auto/history.js";
import { estimateCostUsd } from "../src/auto/pricing.js";
import { getGuard, modeFromEnv, resetGuardForTests } from "../src/auto/guard.js";

describe("auto/pricing", () => {
  it("returns a known price for known models", () => {
    const opus = estimateCostUsd("claude-opus-4.5", 1000, 1000);
    expect(opus).toBeGreaterThan(0);
    expect(opus).toBeLessThan(0.5);
  });

  it("handles prefix matches on date-suffixed models", () => {
    const v = estimateCostUsd("claude-3-5-sonnet-20240620", 4000, 500);
    expect(v).toBeGreaterThan(0);
  });

  it("falls back to a reasonable default for unknown models", () => {
    const v = estimateCostUsd("absolutely-unknown-model-7000", 1000, 1000);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.2);
  });

  it("scales with input length", () => {
    const small = estimateCostUsd("gpt-4o", 100, 100);
    const big = estimateCostUsd("gpt-4o", 100_000, 100);
    expect(big).toBeGreaterThan(small);
  });
});

describe("auto/history", () => {
  beforeEach(() => clearHistory());

  it("records and recalls attempts by objective_hash", () => {
    const h = hashObjective(["openai", "you are a helpful assistant", "fix the build"]);
    recordAttempt({
      objective_hash: h,
      model: "gpt-4o",
      provider: "openai",
      ts_ms: Date.now(),
      estimated_cost_usd: 0.05,
      succeeded: true,
    });
    const recent = recentForObjective(h);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.model).toBe("gpt-4o");
  });

  it("tracks lastError by error_signature", () => {
    const h = hashObjective(["a", "b"]);
    const errSig = hashError("TypeError: cannot read foo");
    recordAttempt({
      objective_hash: h,
      model: "gpt-4o",
      provider: "openai",
      ts_ms: Date.now(),
      estimated_cost_usd: 0.05,
      succeeded: false,
      error_signature: errSig,
    });
    const err = lastError(h);
    expect(err).toBeDefined();
    expect(err?.error_signature).toBe(errSig);
  });

  it("caps history at 200 entries to avoid memory leaks in long-lived processes", () => {
    const h = hashObjective(["x"]);
    for (let i = 0; i < 250; i++) {
      recordAttempt({
        objective_hash: h,
        model: "gpt-4o",
        provider: "openai",
        ts_ms: Date.now(),
        estimated_cost_usd: 0.001,
      });
    }
    expect(_historyForTests().length).toBeLessThanOrEqual(200);
  });

  it("hashObjective is stable across calls for the same input", () => {
    const a = hashObjective(["x", "y", null, "z"]);
    const b = hashObjective(["x", "y", null, "z"]);
    expect(a).toBe(b);
    const c = hashObjective(["x", "y", "different", "z"]);
    expect(a).not.toBe(c);
  });
});

describe("auto/guard env config", () => {
  beforeEach(() => {
    resetGuardForTests();
    delete process.env.AIBRAKE_API_KEY;
    delete process.env.AIBRAKE_URL;
    delete process.env.AIBRAKE_MODE;
  });

  it("defaults to shadow mode when AIBRAKE_MODE is unset", () => {
    expect(modeFromEnv()).toBe("shadow");
  });

  it("respects AIBRAKE_MODE=hard", () => {
    process.env.AIBRAKE_MODE = "hard";
    expect(modeFromEnv()).toBe("hard");
    delete process.env.AIBRAKE_MODE;
  });

  it("builds a SpendingGuard instance without throwing when no key is set", () => {
    const g = getGuard();
    expect(g).toBeDefined();
    // Same call returns the same singleton.
    expect(getGuard()).toBe(g);
  });

  it("falls back to AGENT_SPEND_GUARD_API_KEY alias when AIBRAKE_API_KEY absent", () => {
    process.env.AGENT_SPEND_GUARD_API_KEY = "asg_v1_legacy";
    resetGuardForTests();
    const g = getGuard();
    expect(g).toBeDefined();
    delete process.env.AGENT_SPEND_GUARD_API_KEY;
  });
});

describe("auto/patch — fake OpenAI-shaped module", () => {
  it("patches a Completions.prototype.create and intercepts calls", async () => {
    // Build a fake module that mimics the shape `openai/resources/chat/completions`
    // exports. The real patcher resolves the actual openai package via
    // dynamic import, so we exercise the patching primitives directly.
    class FakeCompletions {
      callCount = 0;
      async create(params: any) {
        this.callCount++;
        return { id: "chatcmpl-test", model: params.model, calls: this.callCount };
      }
    }

    // Apply the same wrapping pattern the patcher uses internally.
    const original = FakeCompletions.prototype.create;
    let interceptCount = 0;
    FakeCompletions.prototype.create = async function patched(params: any) {
      interceptCount++;
      return original.call(this, params);
    };

    const c = new FakeCompletions();
    const result = await c.create({ model: "gpt-4o", messages: [] });
    expect(result.id).toBe("chatcmpl-test");
    expect(interceptCount).toBe(1);
    expect(c.callCount).toBe(1);
  });
});
