import { describe, expect, it } from "vitest";
import {
  pickRecommendedPolicy,
  pickTopPattern,
  riskLevelFromScore,
  scoreToDecision,
  summedScore,
} from "../src/core/policy.js";
import { setLoggerSink } from "../src/core/logger.js";
import type { DetectorResult } from "../src/core/types.js";

setLoggerSink({ emit: () => {} });

function result(
  pattern: string,
  score: number,
  extras: Partial<DetectorResult> = {}
): DetectorResult {
  return {
    pattern,
    detectorVersion: `${pattern}@0.1.0`,
    scoreContribution: score,
    confidence: 0.8,
    matchedRules: [pattern],
    suggestedActions: [{ type: pattern, message: pattern }],
    ...extras,
  };
}

describe("aggregation", () => {
  it("sum and cap risk score at 100", () => {
    const sum = summedScore([result("a", 60), result("b", 60)]);
    expect(sum).toBe(100);
  });

  it("top pattern is the highest-contribution detector", () => {
    const top = pickTopPattern([
      result("low", 10),
      result("high", 80),
      result("mid", 30),
    ]);
    expect(top?.pattern).toBe("high");
  });

  it("tie-breaker priority: task_budget_breach beats stale_context_retry_storm at equal score", () => {
    const top = pickTopPattern([
      result("stale_context_retry_storm", 40),
      result("task_budget_breach", 40),
    ]);
    expect(top?.pattern).toBe("task_budget_breach");
  });

  it("score 100 + good confidence → require_confirmation, not block", () => {
    const d = scoreToDecision(100, 0.9);
    expect(d).toBe("require_confirmation");
  });

  it("score < 25 → allow", () => {
    expect(scoreToDecision(15, 0.9)).toBe("allow");
  });

  it("score 25-49 with high confidence on a deterministic feel → warn", () => {
    expect(scoreToDecision(40, 0.85)).toBe("warn");
  });

  it("risk level mapping bands", () => {
    expect(riskLevelFromScore(0)).toBe("low");
    expect(riskLevelFromScore(30)).toBe("moderate");
    expect(riskLevelFromScore(60)).toBe("elevated");
    expect(riskLevelFromScore(80)).toBe("high");
    expect(riskLevelFromScore(95)).toBe("critical");
  });

  it("pickRecommendedPolicy honors model escalation as downgrade", () => {
    const policy = pickRecommendedPolicy("warn", result("model_escalation_without_evidence", 50));
    expect(policy).toBe("downgrade");
  });

  it("pickRecommendedPolicy(uncertain) picks request_more_telemetry when telemetry is the issue", () => {
    const policy = pickRecommendedPolicy("uncertain", null, {
      telemetryUncertain: true,
    });
    expect(policy).toBe("request_more_telemetry");
  });
});
