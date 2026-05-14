import { describe, expect, it } from "vitest";
import {
  coverageRatio,
  detectorConfidence,
  resolvePath,
  signalQualityMultiplier,
} from "../src/core/confidence.js";
import { staleContextRetryStormDetector } from "../src/detectors/stale-context-retry-storm.js";
import { setLoggerSink } from "../src/core/logger.js";
import { withCodingFailure } from "./helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

describe("confidence formula", () => {
  it("full telemetry → confidence at base × 1 × 1", () => {
    const c = detectorConfidence(
      staleContextRetryStormDetector,
      withCodingFailure(7)
    );
    expect(c).toBeCloseTo(0.9, 2);
  });

  it("missing telemetry quality drops multiplier to 0.6", () => {
    expect(signalQualityMultiplier(undefined)).toBe(0.6);
    expect(signalQualityMultiplier("unknown")).toBe(0.6);
    expect(signalQualityMultiplier("high")).toBe(1.0);
    expect(signalQualityMultiplier("medium")).toBe(0.85);
    expect(signalQualityMultiplier("low")).toBe(0.65);
  });

  it("missing optional fields lower coverage ratio (not assume zero)", () => {
    const fields = [
      "history.failure_signal_present",
      "history.failure_signal_type",
      "history.evidence_kind",
    ];
    const full = coverageRatio(
      {
        actor: { type: "agent" },
        next_action: {
          type: "x",
          estimated_cost: { amount: 0, currency: "USD" },
        },
        history: {
          failure_signal_present: true,
          failure_signal_type: "build_error",
          evidence_kind: "code",
        },
      },
      fields
    );
    const partial = coverageRatio(
      {
        actor: { type: "agent" },
        next_action: {
          type: "x",
          estimated_cost: { amount: 0, currency: "USD" },
        },
        history: { failure_signal_present: true },
      },
      fields
    );
    expect(full).toBe(1);
    expect(partial).toBeCloseTo(1 / 3, 5);
  });

  it("explicit null counts as missing, not zero", () => {
    const v = resolvePath(
      {
        actor: { type: "agent" },
        next_action: {
          type: "x",
          estimated_cost: { amount: 0, currency: "USD" },
        },
        history: { new_evidence_since_last_attempt: null },
      },
      "history.new_evidence_since_last_attempt"
    );
    expect(v).toBeUndefined();
  });

  it("low telemetry + partial coverage → confidence < 0.5", () => {
    const input = withCodingFailure(7);
    input.telemetry_quality = { completeness: "low" };
    input.history!.evidence_kind = undefined;
    input.history!.evidence_signals = undefined;
    input.history!.confidence_delta = undefined;
    const c = detectorConfidence(staleContextRetryStormDetector, input);
    expect(c).toBeLessThan(0.5);
  });
});
