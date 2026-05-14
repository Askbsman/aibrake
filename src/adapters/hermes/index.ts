// Hermes-style adapter.
// Stage 0.1: Hermes telemetry shape is treated as a subset/superset of OpenClaw
// telemetry. We re-export the OpenClawAdapter here so consumers can write
// `import { OpenClawAdapter as HermesAdapter } from "spending-guard/adapters/hermes"`
// without coupling to a future split.
//
// When Hermes lands a distinct telemetry shape, this module gets its own
// `record`/`buildCheckInput` implementations, but the universal Spending Guard
// Core input contract remains the only thing the engine sees.

export { OpenClawAdapter as HermesAdapter } from "../openclaw/adapter.js";
export type {
  AgentActionTelemetry as HermesAgentActionTelemetry,
  ObjectiveDescriptor as HermesObjectiveDescriptor,
  SpendDescriptor as HermesSpendDescriptor,
} from "../openclaw/types.js";
