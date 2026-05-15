import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { runCheck } from "../src/core/check.js";
import { setLoggerSink } from "../src/core/logger.js";
import { withCodingFailure } from "./helpers/fixtures.js";

describe("decision logging", () => {
  let captured: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    captured = [];
    setLoggerSink({ emit: (e) => captured.push(e) });
  });

  afterEach(() => {
    setLoggerSink({ emit: () => {} });
  });

  it("emits a structured event for every /v1/check call", () => {
    runCheck(withCodingFailure(7));
    expect(captured.length).toBe(1);
    // Stage 0.3: event_type is namespaced under the product brand.
    expect(captured[0]?.event_type).toBe("agent_spend_guard.check.completed");
  });

  it("event includes detector_version and policy_version", () => {
    runCheck(withCodingFailure(7));
    const event = captured[0]!;
    expect(event.detector_version).toMatch(/@\d+\.\d+\.\d+$/);
    expect(event.policy_version).toBe("policy@0.1.0");
  });

  it("event does not include raw payload (no objective.goal text)", () => {
    runCheck(withCodingFailure(7));
    const event = captured[0]!;
    const json = JSON.stringify(event);
    expect(json).not.toContain("Fix failing TypeScript build");
    // input_hash is present and redacts payload content.
    expect(event.input_hash).toMatch(/^input_v1_/);
  });

  it("event includes matched_rules and decision summary", () => {
    runCheck(withCodingFailure(7));
    const event = captured[0]!;
    expect(Array.isArray(event.matched_rules)).toBe(true);
    expect(event.decision).toBeDefined();
    expect(event.recommended_policy).toBeDefined();
  });

  it("emitLog: false suppresses logging", () => {
    runCheck(withCodingFailure(7), { emitLog: false });
    expect(captured.length).toBe(0);
  });
});
