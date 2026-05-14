# Hermes Adapter

In Stage 0.1, the Hermes adapter is an alias of [`OpenClawAdapter`](./OPENCLAW_ADAPTER.md).

```ts
import { HermesAdapter } from "spending-guard/adapters/hermes";
// Stage 0.1: identical to OpenClawAdapter
```

Hermes-style telemetry is a near-superset of OpenClaw telemetry: action events, error fingerprints, file/test/log evidence. Until Hermes diverges in shape, sharing the adapter implementation keeps both runtimes on the same fingerprinting and history rules.

## When Hermes will diverge

A separate adapter implementation lands when Hermes adds telemetry that OpenClaw does not have, such as:

- multi-agent coordination signals (peer-tool retries, voting events)
- structured plan/subplan boundaries
- tool-graph dependencies

At that point, `src/adapters/hermes/` grows its own `record()`/`buildCheckInput()`. The Spending Guard Core input contract remains the only thing the judgment engine sees, so the change is local to the adapter.

## Expected telemetry shape

Same as `AgentActionTelemetry` from `src/adapters/openclaw/types.ts`. See [`OPENCLAW_ADAPTER.md`](./OPENCLAW_ADAPTER.md).

## Future work

- Hermes-native telemetry types (after Hermes ships its event schema)
- Plan/subplan-aware objective drift (Hermes plans expose sub-goal boundaries that the rules-only objective-drift detector cannot see today)
- Cross-agent coordination signals
