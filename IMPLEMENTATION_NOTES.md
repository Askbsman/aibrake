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
