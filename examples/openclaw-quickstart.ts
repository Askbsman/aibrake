// AIBrake × OpenClaw — 30-second quickstart.
//
// What this does:
//   1. Creates a SpendingGuard client pointed at api.aibrake.dev
//   2. Creates an OpenClawAdapter to track agent action history
//   3. Records a few attempts at the same failing task
//   4. Asks AIBrake whether the next paid attempt is worth making
//   5. Prints the decision (allow / warn / require_confirm / block)
//
// Run from a project where `aibrake` is installed:
//   npm install aibrake
//   $env:AIBRAKE_API_KEY = "asg_v1_yourkey"
//   npx tsx openclaw-quickstart.ts
//
// Or from inside this repo:
//   $env:AIBRAKE_API_KEY = "asg_v1_yourkey"
//   npx tsx examples/openclaw-quickstart.ts

import { OpenClawAdapter, SpendingGuard } from "aibrake";
// If running from inside this repo, swap to:
// import { OpenClawAdapter, SpendingGuard } from "../src/index.js";

const guard = new SpendingGuard({
  baseUrl: "https://api.aibrake.dev",
  apiKey: process.env.AIBRAKE_API_KEY!,
  failureMode: "open",          // never breaks your agent if AIBrake is down
});

const claw = new OpenClawAdapter();

// ── Simulate an OpenClaw agent that's been retrying the same failing task ──
//
// Imagine: the agent is trying to fix the same TypeError across 6 attempts.
// No new evidence after each attempt (same context, same error). Each attempt
// costs ~$0.42 in Opus tokens. This is the "$40 retry storm" pattern.

const failingTask = {
  objectiveId: "fix-checkout-button",
  attemptId: "attempt-7",
  toolName: "model_call",
  toolArgs: { model: "claude-opus-4.5" },
  estimatedCostUsd: 0.42,
  failureSignal: {
    type: "exception" as const,
    message: "TypeError: cannot read 'onClick' of undefined",
    stackHash: "sha:abc123",
  },
  evidenceSignals: {
    files_read_since_last_attempt: [],
    tests_run_since_last_attempt: [],
    git_diff_changed_since_last_attempt: false,
    tool_results_changed_since_last_attempt: false,
  },
  timestamp: new Date().toISOString(),
};

// Record 6 prior identical attempts (no new evidence between them).
for (let i = 1; i <= 6; i++) {
  claw.record({
    ...failingTask,
    attemptId: `attempt-${i}`,
    timestamp: new Date(Date.now() - (7 - i) * 60_000).toISOString(),
  });
}

// Build the check payload for the next attempt and ask AIBrake.
const checkInput = claw.buildCheckInput(failingTask, {
  objective: {
    id: "fix-checkout-button",
    description: "Fix the TypeError on the checkout button onClick handler",
    budgetUsd: 5.00,
    spentUsd: 2.52,                  // 6 attempts * $0.42
  },
  spend: { currency: "USD", spentTotalUsd: 2.52 },
});

const result = await guard.check(checkInput);

console.log("─".repeat(60));
console.log("Decision:        ", result.decision);
console.log("Risk level:      ", result.risk_level);
console.log("Detector fired:  ", result.detector_id);
console.log("Reason:          ", result.reason);
if (result.projected_savings) {
  console.log("─".repeat(60));
  console.log("💰 Projected savings:");
  console.log("   amount:       $" + result.projected_savings.amount_usd.toFixed(2));
  console.log("   basis:       ", result.projected_savings.basis);
}
console.log("─".repeat(60));

// In a real OpenClaw integration you'd:
//   - allow             → proceed with the LLM call
//   - warn              → log it but proceed
//   - require_confirm   → ask the user "agent wants to retry, ok?"
//   - block             → cancel the call, return savings to budget
