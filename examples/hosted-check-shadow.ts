// Hosted shadow-mode example.
//
// Run:
//   AGENT_SPEND_GUARD_URL=http://localhost:8080 \
//   AGENT_SPEND_GUARD_API_KEY=asg_v1_demo_key \
//   npx tsx examples/hosted-check-shadow.ts
//
// Shows a real partner integration in shadow mode: never blocks, logs the
// decision, executes the action regardless.

import { SpendingGuard } from "../src/sdk/index.js";
import retryStormPayload from "./payloads/retry-storm.json" with { type: "json" };

const baseUrl = process.env.AGENT_SPEND_GUARD_URL ?? "http://localhost:8080";
const apiKey = process.env.AGENT_SPEND_GUARD_API_KEY;

const guard = new SpendingGuard({
  baseUrl,
  ...(apiKey ? { apiKey } : {}),
  failureMode: "open",
  timeoutMs: 1000,
});

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`AIBrake hosted shadow-mode demo @ ${baseUrl}`);
  // eslint-disable-next-line no-console
  console.log(`API key configured: ${apiKey ? "yes" : "no (anonymous)"}`);

  const result = await guard.checkShadow(retryStormPayload as never);

  // eslint-disable-next-line no-console
  console.log("\nGuard result (advisory only — shadow mode):");
  // eslint-disable-next-line no-console
  console.log(`  decision:            ${result.decision}`);
  // eslint-disable-next-line no-console
  console.log(`  recommended_policy:  ${result.recommended_policy}`);
  // eslint-disable-next-line no-console
  console.log(`  pattern:             ${result.pattern}`);
  // eslint-disable-next-line no-console
  console.log(`  risk_score:          ${result.risk_score} (${result.risk_level})`);
  // eslint-disable-next-line no-console
  console.log(`  confidence:          ${result.confidence.toFixed(2)}`);
  // eslint-disable-next-line no-console
  console.log(`  reason:              ${result.reason}`);
  // eslint-disable-next-line no-console
  console.log(`  suggested_action:    ${result.suggested_action.type} — ${result.suggested_action.message}`);

  // Shadow mode contract: the agent action runs no matter what the guard said.
  // eslint-disable-next-line no-console
  console.log("\n[agent] executing the planned action regardless (shadow mode)...");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
