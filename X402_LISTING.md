# Spending Guard API — x402 Marketplace Listing

**Stop paying for useless agent loops.**

Spending Guard is a provider-agnostic, x402-native judgment middleware for expensive AI agent actions. It checks paid LLM calls, tool retries, model escalation and objective drift before execution, and returns an actionable decision with a clear reason and suggested alternative.

## First detector

`stale_context_retry_storm` — detects repeated paid retries on the same deterministic failure without new evidence (no new files read, no tests rerun, no logs refreshed, no git diff change, no context-source confirmation).

> Example: a coding agent makes 6 paid Claude Opus calls trying to fix the same `TS2307: Cannot find module` build error. No files were read since attempt 2. The 7th paid call is about to fire. Spending Guard returns:
>
> `decision: "warn" / "require_confirmation"` · `recommended_policy: "ask_human"` · `pattern: "stale_context_retry_storm"`

## Use cases

- OpenClaw-style agent runtimes
- Hermes-style agents
- Claude Code / Codex workflows
- LiteLLM / OpenRouter pipelines
- x402 paid agent actions
- Custom autonomous agents
- Coding agents
- Research / scraper agents
- Browser automation agents
- Media-generation agents
- Any paid AI tool/API workflow

## API surface (Stage 0.1)

| Endpoint | Description |
| --- | --- |
| `GET /health` | Free liveness probe |
| `POST /v1/check` | Rules-only pre-flight judgment. Sub-300ms target. |
| `POST /v1/check-deep` | Optional deeper judgment (LLM judgment stubbed in v0.1) |

## Key outputs

```jsonc
{
  "decision": "warn | allow | require_confirmation | delay | block | uncertain",
  "recommended_policy": "continue | log_only | shadow_log | downgrade | ask_human | delay_action | stop_action | run_deep_check | request_more_telemetry",
  "risk_score": 0-100,
  "risk_level": "low | moderate | elevated | high | critical",
  "confidence": 0.0-1.0,
  "pattern": "stale_context_retry_storm | task_budget_breach | ...",
  "matched_rules": [...],
  "reason": "human-readable summary",
  "suggested_action": { "type": "context_refresh", "message": "..." },
  "detector_version": "stale_context_retry_storm@0.1.0",
  "policy_version": "policy@0.1.0"
}
```

## Why this isn't a budget counter

Budget caps are table stakes — every LLM dashboard already ships them. Spending Guard's defensible product is *judgment*: it catches loops, stale context, model escalation without evidence, and objective drift before the next paid action. The API answers a question budget counters cannot: **"Is the next paid step actually likely to make progress, or is it just the 7th guess?"**

## Pricing (model)

Stage 0.1 ships free. Stage 0.3 introduces paid `/v1/check` via x402:

- Rules-only `/v1/check`: sub-cent per call. Suitable for hot-path pre-flight at high volume.
- `/v1/check-deep`: more expensive. Use only for ambiguous cases (when `/v1/check` returns `uncertain`).

The architecture allows the SDK to fail open if the guard is unavailable, so operators integrating early are not exposed to availability risk before the paid path is wired.

## SDK

```bash
npm install spending-guard
```

```ts
import { SpendingGuard } from "spending-guard";

const guard = new SpendingGuard({
  baseUrl: "https://spending-guard.example.com",
  timeoutMs: 500,
  failureMode: "open",
});

await guard.checkOrConfirm(input, {
  onWarn: async (result) => askHumanForConfirmation(result),
});
```

## Repository

Stage 0.1 reference implementation: TypeScript, stateless Fastify API, three-pattern SDK, OpenClaw/Hermes adapter, 96+ tests. See `README.md`.

## Contact

This listing is updated alongside each release. Detector and policy version strings appear in every `/v1/check` response so operators can pin behavior and detect drift.
