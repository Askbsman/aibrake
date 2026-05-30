# Hermes Adapter

The Hermes adapter is exported alongside `OpenClawAdapter` and
`CodingAgentAdapter` — they're all the same class today. Hermes Agent
(NousResearch) emits a near-superset of OpenClaw telemetry: action
events, error fingerprints, file/test/log evidence. Until Hermes
diverges in shape, sharing the adapter keeps both runtimes on the
same fingerprinting + history rules.

```ts
import { HermesAdapter } from "aibrake/adapters/coding-agent";
// Same as OpenClawAdapter / CodingAgentAdapter
```

For installing AIBrake as a Hermes skill (not just calling the
adapter from your own code), see [`docs/HERMES_INSTALL.md`](./docs/HERMES_INSTALL.md).

## When Hermes will diverge

A separate adapter implementation lands when Hermes adds telemetry
that OpenClaw doesn't have, such as:

- Multi-agent coordination signals (peer-tool retries, voting events)
- Structured plan / subplan boundaries (Hermes plans expose
  sub-goal boundaries that the rules-only `objective_drift`
  detector can't currently see)
- Tool-graph dependencies

At that point, a dedicated `src/adapters/hermes/` grows its own
`record()` / `buildCheckInput()` implementation. The AIBrake Core
input contract is the only thing the judgment engine sees, so the
change stays local to the adapter — Core detectors don't need to know.

## Expected telemetry shape

Same as `AgentActionTelemetry` from
`src/adapters/coding-agent/types.ts`. See
[`OPENCLAW_ADAPTER.md`](./OPENCLAW_ADAPTER.md) for the full event
catalog. Hermes-specific events (peer signals, plan boundaries) can
be added later without breaking the contract.

## See also

- [`docs/HERMES_INSTALL.md`](./docs/HERMES_INSTALL.md) — install
  AIBrake as a Hermes skill (1-minute setup)
- [`skills/aibrake/SKILL.md`](./skills/aibrake/SKILL.md) — the
  agentskills.io-compatible skill spec Hermes auto-loads
- [`OPENCLAW_ADAPTER.md`](./OPENCLAW_ADAPTER.md) — same telemetry
  contract as Hermes for now
