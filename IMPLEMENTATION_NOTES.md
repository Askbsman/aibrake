# IMPLEMENTATION_NOTES.md

This file records implementation choices made during the build of Spending Guard Stage 0.1 that are not fully specified by the spec set. Each entry must reference the spec section it clarifies or extends.

Spec precedence:

1. `SPENDING_GUARD_CORE_MVP_CLAUDE_CODE_SPEC.md` (base)
2. `SPENDING_GUARD_SPEC_PATCH_v0_1_1.md` (architectural patch)
3. `SPENDING_GUARD_SPEC_PATCH_v0_1_2.md` (nit cleanup)

The v0.1.1 and v0.1.2 patches override any conflicting behavior in the base spec.

---

## 1. RecommendedPolicy / UncertainPolicy handling

**Refers to:** v0.1.1 § 10.1, v0.1.2 § 2, v0.1.2 § 6.

**Issue:** v0.1.2 introduces the strings `shadow_log`, `request_more_telemetry`, and `allow_with_log` that are not present in the v0.1.1 `RecommendedPolicy` union.

**Decision:**

- Extend the **API** `RecommendedPolicy` union with `shadow_log` and `request_more_telemetry`.
- Keep `allow_with_log` as an **SDK-internal** `UncertainPolicy`, not an API output.

API-level `RecommendedPolicy`:

```ts
type RecommendedPolicy =
  | "continue"
  | "log_only"
  | "shadow_log"
  | "downgrade"
  | "ask_human"
  | "delay_action"
  | "stop_action"
  | "run_deep_check"
  | "request_more_telemetry";
```

SDK-level `UncertainPolicy`:

```ts
type UncertainPolicy =
  | "allow_with_log"
  | "ask_human"
  | "run_deep_check"
  | "throw";
```

**Legal pair table (extended):**

| decision | allowed recommended_policy values |
|---|---|
| `allow` | `continue`, `log_only` |
| `warn` | `log_only`, `shadow_log`, `downgrade`, `ask_human`, `run_deep_check` |
| `require_confirmation` | `ask_human`, `run_deep_check`, `downgrade` |
| `delay` | `delay_action`, `ask_human`, `run_deep_check` |
| `block` | `stop_action` |
| `uncertain` | `run_deep_check`, `log_only`, `shadow_log`, `ask_human`, `request_more_telemetry` |

Pair validation is enforced inside the policy mapper and asserted by tests.

---

## 2. HTTP framework

**Decision:** Fastify 4.x.

**Rationale:**
- Native async/await ergonomics.
- Low overhead, helps meet `/v1/check` remote latency target (< 300ms).
- Built-in JSON schema validation slot we fill with Zod manually for v0.1 (no extra type-provider dependency).

---

## 3. Test runner

**Decision:** Vitest.

**Rationale:**
- Native TypeScript, no Babel/SWC config burden.
- Fast watch mode, parallel test files.
- Familiar Jest-compatible API.

---

## 4. Hashing

**Decision:** Node built-in `node:crypto` SHA-256, truncated to 16 hex chars (8 bytes).

**Rationale:**
- No extra dependency.
- Matches v0.1.1 § 17.4 contract exactly.

---

## 5. Canonical JSON for fingerprints and input_hash

**Decision:** Implement a small `canonicalJson` helper:

- Stable key ordering (lexicographic).
- `undefined` fields dropped.
- Arrays preserved in order unless detector signals order-insensitive.
- Numbers serialized via `JSON.stringify` (no special locale).
- No whitespace.

**Redaction (for `input_hash` only):** before canonicalization, strip:
- `next_action.reason` raw text
- `objective.goal` raw text
- any field path matching `*.raw_prompt`, `*.raw_response`, `*.secret`, `*.token`, `*.api_key`

These are replaced with their SHA-256-16 hash so the input hash remains a useful equality key but doesn't expose payload.

---

## 6. Stateless Core enforcement

**Decision:** Core check function is exported as a pure function `runCheck(input): SpendingGuardCheckOutput`. The Fastify route is a thin wrapper. No module-level mutable state in `src/core/**`.

---

## 7. Detector registration

**Decision:** Detectors are exported as `DetectorDefinition` records and registered in `src/detectors/index.ts` via a static array. v0.1 has two enabled detectors: `task_budget_breach`, `stale_context_retry_storm`. Skeletons for `same_tool_retry_loop`, `model_escalation_without_evidence`, `objective_drift` ship with TODO bodies and are enabled later in this stage.

---

## 8. Score → decision mapping (concrete bands)

Concretizes v0.1.1 § 6 "global decision mapping" with explicit thresholds. The "depending on confidence and pattern" hint resolves to:

```
0–24   → allow
25–49  → if confidence >= 0.70 and top_pattern has a deterministic feel → warn; else allow
50–74  → warn
75–89  → require_confirmation
90–100 → require_confirmation (block only if deterministic_decision fired)
```

Plus the v0.1.2 § 2 override:

```
if confidence < 0.50 and no deterministic_decision → uncertain
```

---

## 9. Logger

**Decision:** Use a thin `logger.ts` wrapper around `console.log` with structured JSON output for v0.1. Pluggable: accepts an optional `LoggerSink` so tests and operators can substitute. No pino/winston dependency in v0.1.

---

## 10. x402 payment stub

**Decision:** `PaymentGuard` interface + `MockPaymentGuard` (always-allow) + `X402PaymentGuardStub` (throws `not_implemented`). The Fastify route does not gate `/v1/check` on payment in v0.1 — payment guard is wired but inactive, controlled by env flag `SPENDING_GUARD_REQUIRE_PAYMENT=false` (default).

---

## 11. Detector `baseConfidence` deviations from v0.1.1 spec table

The v0.1.1 patch § 7 specifies a base-confidence table per detector. The implementation matches it except for the two cases below. Both deviations are intentional and recorded here so future audits do not flag spec drift.

| Detector | v0.1.1 spec | Code | Why |
| --- | :---: | :---: | --- |
| `objective_drift_rules_only` | 0.60 | 0.70 | Detector is deterministic when a policy rule matches (`action_not_in_allowed_list` or `explicit_blocked_action`). 0.60 risked dragging confidence under the 0.50 uncertain threshold when only `next_action.type` was present. The `recommendedFields` list was also reduced to `["next_action.type"]` since the rule fires deterministically once the policy is declared. No behavior change at score ≥ 50; behavior nudges from `uncertain` to `warn` at score 25–49. |
| `same_tool_retry_loop` | 0.65 | 0.70 | Calibrated in Stage 0.1.2 RC. At 0.65 the detector emitted `decision: allow` with reason text recommending "consider switching tool, model, or approach before spending again" — internally contradictory. 0.70 puts the detector at the warn-band threshold for score 25–49 so the surfaced pattern matches the surfaced advice. |
| `model_escalation_without_evidence` recommendedFields | 5 fields (incl. `objective.model_policy`) | 4 fields (dropped `objective.model_policy`) | Calibrated in Stage 0.3.1 — same class of fix as `same_tool_retry_loop` calibration. With 5 fields, operators who did not declare model_policy hit 4/5 coverage → conf 0.60 → at score 25 (warn band threshold is conf ≥ 0.70) → decision allow, but suggested_action: downgrade_model. Partner B flagged this dissonance in simulated validation. Dropping model_policy from recommendedFields yields ~1.0 coverage for both shapes (with/without policy), confidence 0.75, decision warn. Operators who declare model_policy still get the structured `model_route.to` in `suggested_action` — that is the real reward, not a confidence bonus. |

All other detector base confidences match the spec table:

| Detector | Both spec and code |
| --- | :---: |
| `task_budget_breach` | 0.98 |
| `stale_context_retry_storm` | 0.90 |
| `model_escalation_without_evidence` | 0.75 |
| `explicit_blocked_action` (sub-case of `objective_drift`) | n/a — handled via `deterministicDecision: "block"` rather than confidence |

If a future patch re-pins these values to match the spec table exactly, both Demo 02 (audit) and the `objective_drift` warn-case test will need new thresholds to keep their current decisions.

---

## 12. Stage 0.2-minimal — Premium model awareness without a new detector

**Refers to:** `STAGE_0_2_PREMIUM_MODEL_STOPLOSS_SPEC.md` (full Stage 0.2 design); this section records the scoped-down implementation actually shipped on top of v0.1.2 RC.

**Decision:** the full Stage 0.2 spec proposed a new `premium_model_loop` detector plus six new `history` counters, two new hard-block paths, two new suggested-action types, and a new `cross_model_audit` recommended_policy value. Architectural review (see ADR commentary in the build log) concluded that ~80% of the partner-visible value comes from:

1. Operator can declare `objective.model_policy.primaryModel` and `secondaryModel`.
2. The existing `model_escalation_without_evidence` detector reads that policy and uses it as the strongest "expensive" signal (stronger than the regex heuristic).
3. When `secondaryModel` is declared, the suggested action ships a structured `model_route.to` instead of free-text "downgrade somehow."
4. `SpendingGuard.checkOrDowngrade()` prefers `model_route.to` over its static `downgradeTo` option.

This is what 0.2-minimal ships. Nothing else from the full spec was added.

**Explicitly NOT added in 0.2-minimal:**

| Full spec | Status here |
| --- | :---: |
| New `premium_model_loop` detector | not added — existing `model_escalation_without_evidence` extended |
| 6 new history counters (`premium_attempts_*`, `last_*_at_attempt`) | not added — existing `same_failure_count` + `evidence_signals` are sufficient |
| New hard-block path via `requireEvidenceBeforePremiumRetry` | not added — would creep the deterministic-block surface; budget caps remain the only hard-block class |
| New hard-block path via `maxPremiumSpendOnObjectiveUsd` | not added — same reason; existing `objective.budget.hard_limit` covers this |
| `model_cost_class` field | not added — duplicates `model_tier`, dropped to keep schema small |
| `cross_model_audit` as a `recommended_policy` value | not added — existing `run_deep_check` covers the policy; `cross_model_audit` may be a future `suggested_action.type` |
| Cross-model audit prompt template (docs/examples) | not added — operator-side concern, ship when a partner asks |

**Schema additions actually made (all optional, fully backward-compatible):**

```ts
type ModelRole = "primary" | "secondary" | "fallback" | "audit" | "unknown";
type ModelTier = "premium" | "standard" | "cheap" | "free" | "unknown";

interface ModelRef    { provider?, model?, role?: ModelRole, tier?: ModelTier }
interface ModelPolicy { primaryModel?, secondaryModel?, auditModel?, maxPremiumRetriesWithoutEvidence? }
interface ModelRoute  { from?: ModelRef, to?: ModelRef, reason?: string }

NextAction      += { model_role?, model_tier? }
Objective       += { model_policy? }
SuggestedAction += { model_route? }
```

**Backward-compatibility guarantees:**

- Existing 96 unit tests pass unchanged.
- Existing 14 audit scenarios pass unchanged.
- `withCodingFailure()` fixture (no model_policy) still triggers escalation via the regex heuristic.
- Operators on v0.1.2 callers do not need to send any new field.

**When the full Stage 0.2 spec should land instead:**

- If a partner reports they need to track `premium_attempts_without_evidence` *separately* from `same_failure_count` (e.g., because they want to allow expensive retries on different failures but block them on the same one).
- If a partner asks for a hard block on premium retries that is independent of budget.
- If decision logs from shadow-mode integrations show that `model_escalation_without_evidence` is too coarse (e.g., conflates legitimate model upgrades with stuck loops).

Until any of those signals arrive from a real integration, 0.2-minimal is the correct shipped surface.

---

## 13. Brand vs package identity (Stage 0.3)

The product is consumer-facing branded as **Agent Spend Guard**. The npm package and repository identifier remain `spending-guard` so existing imports, tag history, and prior commits do not break. The two namings are deliberately kept distinct and pinned here so future work does not silently rename everything for "consistency".

| Surface | Value | Why |
| --- | --- | --- |
| npm package name | `spending-guard` | preserves `import { ... } from "spending-guard"` for harness and partners |
| Repository | `sbbuilder` (local) → `spending-guard` (when published) | tag history `spending-guard-v0.1.1-rc` … intact |
| Product brand (README, listing, marketing, partner-facing copy) | **Agent Spend Guard** | what partners see |
| `GET /health` `service` field | `"agent-spend-guard"` (kebab-case) | matches the brand they recognize |
| `GET /v1/meta` `name` field | `"Agent Spend Guard"` (title case) | display string |
| Log event `event_type` prefix | `agent_spend_guard.*` (underscore-case) | structured-log convention |
| Env variable prefix | `AGENT_SPEND_GUARD_*` (uppercase) | shell convention |
| Tag name | `spending-guard-v0.3.0-beta` | preserves history; do not rename the tag chain |
| Docker image name | `agent-spend-guard` | what hosting platforms display |
| SDK fingerprint prefixes | `fp_v1_*`, `input_v1_*`, `key_v1_*` | unchanged from 0.1 fingerprint contract |

Do **not** rename the package, the imports, or the existing tag chain. If a future stage decides to publish to npm under a new name, do it via a meta-package alias — never break import paths.

---

## 14. Stage 0.3 hosted-beta scope (with 4 reviewer modifications)

**Refers to:** `STAGE_0_3_HOSTED_BETA_SPEC` (full text) and the architectural review that approved "full spec with 4 modifications" before any code was written.

**What ships in Stage 0.3:** API key authentication, rate limiting, JSONL log sink, `/v1/meta`, logs-summary CLI, deployment artifacts, partner-facing docs, hosted-mode SDK examples. No new detectors, no dashboard, no database.

**Four modifications applied to the original spec:**

1. **Single `Authorization: Bearer <key>` header.** The original spec accepted both `Authorization: Bearer` and a custom `X-Agent-Spend-Guard-Key` header. Dropping the custom header avoids "which one do I use?" integration friction; `Authorization: Bearer` is universal across SDKs (OpenAI, Anthropic, fetch, axios, native curl).
2. **Default `PORT=8080`, not `3000`.** Port 3000 is the default for nearly every modern dev framework (Next.js, CRA, Rails, Express templates). Local conflict was already observed in this codebase (AIVID dev server vs. sbbuilder server). 8080 is UNIX-friendly and avoids the clash for partner laptops.
3. **Rate limit per API key.** The spec did not include this; it is an operational safety requirement that a hosted beta cannot ship without. Sliding-window limit, configurable via `AGENT_SPEND_GUARD_RATE_LIMIT_PER_KEY_PER_MIN` (default 600 = 10 req/sec/key). On breach: HTTP 429 with `Retry-After` header. In-process Map only; no Redis or distributed counter in Stage 0.3.
4. **Brand-vs-package identity matrix** (§ 13 above) made explicit so partners and contributors do not see drift between log strings, API output, env vars, and package metadata.

**Not in scope (deferred to 0.4):**

- TLS termination (assume the host platform provides it — Render / Fly / Vercel default behavior).
- Multi-tenant key management UI (manual `AGENT_SPEND_GUARD_API_KEYS=k1,k2,k3` env update is the partner-onboarding flow for 0.3).
- Distributed rate-limit (in-process is fine for single-instance hosted beta; if we scale horizontally we need Redis-backed limit, but we are not scaling horizontally in 0.3).
- Decision-log shipping to S3/BigQuery (operator can mount a volume to `./logs/` and ship the JSONL themselves; we provide the file, not the pipeline).
- Real LLM judgment for `/v1/check-deep` (stub remains; `deep_check_used: false` is the honest contract from 0.1.2).

**Auth contract details (settling the spec):**

- `AGENT_SPEND_GUARD_AUTH_MODE=optional` (default) — requests without a key go through; requests with a key are validated and logged with a `key_v1_*` hash.
- `AGENT_SPEND_GUARD_AUTH_MODE=required` — requests without a key receive 401 with `{ error: { code: "UNAUTHORIZED" } }`.
- API key format is recommended (`asg_v1_<24+ base32 chars>`) in `DEPLOYMENT.md` but **not enforced** — middleware accepts any non-empty string in `AGENT_SPEND_GUARD_API_KEYS`. Operators with their own conventions are not rejected.
- Auth middleware is mounted only on `/v1/check` and `/v1/check-deep`. `GET /health` and `GET /v1/meta` are always public — partners need them for liveness checks and discovery without provisioning.

**Rate limit contract details:**

- Per-key sliding window of 60 seconds.
- Default `600` = 10 req/sec/key. Burst-tolerant within the window.
- Anonymous traffic (when `authMode=optional`) groups under one synthetic `anon` bucket — protects against a misbehaving local dev client from saturating the server.
- 429 response includes `Retry-After: <seconds>` header.
- On `authMode=required` the middleware never sees anonymous traffic (auth fails first), so the anon bucket only triggers when `authMode=optional` and a partner forgot to set a key.

**Logging contract details:**

- Existing `setLoggerSink` API (0.1.x) is preserved.
- New `JsonlSink` implementation accepts `{ filePath, onError? }`. Auto-creates parent directory once; subsequent write failures emit a single stderr warning per minute (de-duped) and swallow the error so API responses never fail because the disk is full.
- Log payload **never** contains the raw API key, raw prompts, raw file content, or any prompt/response text. Only:
  - `request_id` (uuid)
  - `input_hash` (`input_v1_*` — already redacted by `inputHash()`)
  - `api_key_hash` (`key_v1_*` — sha256-16 of the bearer key, never the key itself)
  - `decision`, `recommended_policy`, `pattern`, `risk_score`, `confidence`
  - `detector_version`, `policy_version`
  - `matched_rules_count` (the count, not the list — keeps each line small)
  - `timestamp` (ISO)

**`/v1/meta` response shape:**

```json
{
  "name": "Agent Spend Guard",
  "version": "0.3.0-beta",
  "description": "Loop detection and model stop-loss for paid AI agents.",
  "positioning": "PQS checks the prompt. Agent Spend Guard checks the loop.",
  "endpoints": { "check": "/v1/check", "check_deep": "/v1/check-deep" },
  "supported_patterns": [
    "stale_context_retry_storm",
    "same_tool_retry_loop",
    "model_escalation_without_evidence",
    "objective_drift",
    "task_budget_breach"
  ],
  "modes": ["check", "shadow", "confirm", "downgrade"],
  "policy_version": "policy@0.1.0"
}
```

Note: `"modes"` includes `check` (raw helper) — partners reading `/v1/meta` should see the full SDK surface, not just opinionated wrappers.

---
