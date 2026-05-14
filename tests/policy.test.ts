import { describe, expect, it } from "vitest";
import { isLegalPair, assertLegalPair } from "../src/core/policy.js";

describe("decision / recommended_policy legal pairs", () => {
  it("warn + ask_human is legal", () => {
    expect(isLegalPair("warn", "ask_human")).toBe(true);
  });

  it("block + continue is illegal", () => {
    expect(isLegalPair("block", "continue")).toBe(false);
  });

  it("block + stop_action is the only legal block pair", () => {
    expect(isLegalPair("block", "stop_action")).toBe(true);
    expect(isLegalPair("block", "log_only")).toBe(false);
    expect(isLegalPair("block", "ask_human")).toBe(false);
  });

  it("uncertain + run_deep_check is legal", () => {
    expect(isLegalPair("uncertain", "run_deep_check")).toBe(true);
  });

  it("uncertain + request_more_telemetry is legal", () => {
    expect(isLegalPair("uncertain", "request_more_telemetry")).toBe(true);
  });

  it("warn + shadow_log is legal", () => {
    expect(isLegalPair("warn", "shadow_log")).toBe(true);
  });

  it("assertLegalPair throws on illegal pair", () => {
    expect(() => assertLegalPair("block", "continue")).toThrow();
  });
});
