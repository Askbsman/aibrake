// Demo: The $40 TypeScript Retry Storm
//
// Reproduces the canonical Spending Guard demo:
// a coding agent is about to make the 7th paid Claude Opus call on the same
// TypeScript build error. No files have been read since attempt 2. No tests
// rerun. No git diff change. Spending Guard catches this before the agent
// pays again.
//
// Run: npx tsx examples/40-dollar-retry-storm.ts

import { OpenClawAdapter } from "../src/adapters/openclaw/index.js";
import { runCheck } from "../src/core/check.js";
import { setLoggerSink } from "../src/core/logger.js";
import type { AgentActionTelemetry } from "../src/adapters/openclaw/types.js";

// Capture the structured decision log so we can show it at the end.
const events: Array<Record<string, unknown>> = [];
setLoggerSink({ emit: (e) => events.push(e) });

function pastAttempt(attemptNumber: number): AgentActionTelemetry {
  return {
    actionId: `act_${attemptNumber}`,
    objectiveId: "obj_ts_build",
    runtime: "openclaw",
    actionType: "paid_llm_call",
    toolName: "claude",
    provider: "anthropic",
    model: "claude-opus",
    estimatedCostUsd: 0.42,
    reason: "fix typescript build error",
    failureSignalPresent: true,
    failureSignalType: "build_error",
    errorCode: "TS2307",
    errorMessage: "Cannot find module '../payments/payment-guard'",
    failingFile: "src/core/check.ts",
    filesRead: [],
    testsRun: [],
    logsRead: [],
    gitDiffChanged: false,
    toolResultsChanged: false,
    contextSourceConfirmed: false,
    timestamp: new Date(Date.now() - (10 - attemptNumber) * 60_000).toISOString(),
  };
}

const adapter = new OpenClawAdapter();
for (let i = 1; i <= 6; i += 1) adapter.record(pastAttempt(i));

const plannedSeventh: AgentActionTelemetry = {
  ...pastAttempt(7),
  // The agent is about to fire the 7th attempt with the same context.
  timestamp: new Date().toISOString(),
};

const input = adapter.buildCheckInput(plannedSeventh, {
  objective: {
    id: "obj_ts_build",
    goal: "Fix failing TypeScript build",
    successCriteria: ["npm run build passes", "npm test passes"],
    budget: { amount: 5, currency: "USD", hardLimit: false },
    maxPaidAttempts: 8,
  },
  spend: { spentOnObjectiveUsd: 4.61, spentTodayUsd: 38.42, dailyBudgetUsd: 50 },
});

const result = runCheck(input);

// eslint-disable-next-line no-console
console.log("\n=== Spending Guard demo: The $40 TypeScript Retry Storm ===\n");
console.log("decision:           ", result.decision);
console.log("recommended_policy: ", result.recommended_policy);
console.log("pattern:            ", result.pattern);
console.log("risk_score:         ", result.risk_score, `(${result.risk_level})`);
console.log("confidence:         ", result.confidence.toFixed(2));
console.log("hard_block:         ", result.hard_block);
console.log("detector_version:   ", result.detector_version);
console.log("policy_version:     ", result.policy_version);
console.log("\nreason:");
console.log("  " + result.reason);
console.log("\nsuggested_action:");
console.log("  type:    " + result.suggested_action.type);
console.log("  message: " + result.suggested_action.message);
console.log("\nmatched_rules:");
for (const rule of result.matched_rules) console.log("  - " + rule);

console.log("\nstructured decision log event:");
console.log(JSON.stringify(events[0], null, 2));
