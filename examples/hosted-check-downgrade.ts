// Hosted checkOrDowngrade example.
//
// Demonstrates the structured model_route.to behavior: when the operator's
// objective.model_policy declares a secondaryModel, the guard suggests
// switching to it and the SDK auto-applies the route.
//
// Run:
//   AGENT_SPEND_GUARD_URL=http://localhost:8080 \
//   AGENT_SPEND_GUARD_API_KEY=asg_v1_demo_key \
//   npx tsx examples/hosted-check-downgrade.ts

import { SpendingGuard, SpendingGuardBlockedError } from "../src/sdk/index.js";
import premiumLoopPayload from "./payloads/premium-model-loop.json" with { type: "json" };

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
  console.log(`Agent Spend Guard hosted downgrade demo @ ${baseUrl}`);

  try {
    const { action, result } = await guard.checkOrDowngrade(
      premiumLoopPayload as never,
      {
        // Static fallback. The guard's model_route.to (from operator's
        // model_policy.secondaryModel) takes precedence when present.
        downgradeTo: {
          provider: "anthropic",
          model: "claude-haiku",
          estimatedCost: 0.01,
        },
      }
    );

    // eslint-disable-next-line no-console
    console.log("\nGuard verdict:");
    // eslint-disable-next-line no-console
    console.log(`  decision:           ${result.decision}`);
    // eslint-disable-next-line no-console
    console.log(`  pattern:            ${result.pattern}`);
    // eslint-disable-next-line no-console
    console.log(`  suggested:          ${result.suggested_action.type}`);
    if (result.suggested_action.model_route) {
      // eslint-disable-next-line no-console
      console.log(
        `  model_route.to:     ${result.suggested_action.model_route.to?.provider}/${result.suggested_action.model_route.to?.model}`
      );
    }

    // eslint-disable-next-line no-console
    console.log("\nAction after auto-downgrade (what the agent should actually run):");
    // eslint-disable-next-line no-console
    console.log(`  provider:           ${action.provider}`);
    // eslint-disable-next-line no-console
    console.log(`  model:              ${action.model}`);
    // eslint-disable-next-line no-console
    console.log(`  estimated_cost:     $${action.estimated_cost.amount.toFixed(4)} ${action.estimated_cost.currency}`);
  } catch (err) {
    if (err instanceof SpendingGuardBlockedError) {
      // eslint-disable-next-line no-console
      console.error("\nGuard hard-blocked the action:");
      // eslint-disable-next-line no-console
      console.error(`  pattern: ${err.result.pattern}`);
      // eslint-disable-next-line no-console
      console.error(`  reason:  ${err.result.reason}`);
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
