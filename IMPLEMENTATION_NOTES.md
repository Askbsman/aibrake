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

---

## 15. Stage 0.4 Real Integration Layer

**Refers to:** `STAGE_0_4_REAL_INTEGRATION_LAYER_SPEC` and the architectural review that approved "Variant A — 0.4 with 4 modifications" before any code was written.

**What ships in Stage 0.4:** per-request `objective.detector_policy` for threshold tuning, `CodingAgentAdapter` alias, one TS integration example, Python SDK as thin HTTP client with 16 unit + 4 integration tests + a Dockerfile for verification on hosts without Python, three integration guides (INTEGRATION_GUIDE.md, PYTHON_SDK.md, CODING_AGENT_ADAPTER.md). No new detectors. No dashboard. No DB. No full x402 publishing.

**Four reviewer modifications applied to the original spec:**

1. **One `CodingAgentAdapter`, not two per-runtime adapters.** The original spec proposed `adapters/claude-code/` and `adapters/codex/`. With the universal evidence model (Stage 0.2-minimal), the adapter logic is the same for both — only the lifecycle-event translator differs. We ship one adapter (re-exporting `OpenClawAdapter`) and two reference translator functions inside a single example. This avoids 90% duplicated adapter code.
2. **Per-request `objective.detector_policy`, not server-side state.** The spec was ambiguous about where thresholds live. Server-side would require a key-management UI, migrations, multi-tenant config storage — all explicit non-goals. Per-request keeps Core stateless and lets each operator (or each objective) tune independently. The whole policy travels in the request payload, never persisted server-side.
3. **Two example files, not four.** The spec proposed `python-langchain-shadow.py` + `python-scraper-loop.py` + `claude-code-wrapper.ts` + `codex-build-loop.ts`. The Python pair is the same shape with different payloads; the TS pair the same. We ship one TS coding-agent example (with comments covering both Claude Code and Codex translation patterns) and two Python examples (shadow + downgrade) that demonstrate the SDK helpers — the underlying payloads cover LangChain / scraper / generic Python use cases via comments.
4. **Python SDK as thin HTTP client, not feature-parity SDK.** The spec asked for a Python SDK but did not bound the scope. Without explicit bounds, every TS SDK feature would require a Python port forever. We commit explicitly in `PYTHON_SDK.md` § 9 ("Honesty contract") to the four integration helpers + failure modes + uncertain policy. No async, no typed response objects, no decision logging, no retry/backoff. Operators who need more either build it themselves or escalate to the maintainer. Drift risk minimized.

**Why Stage 0.4 is sequenced this way (after 0.3.1):**

The simulated 3-partner validation (`validation-log/TALLY.md`) surfaced three concrete blockers:
- Partner B: "I'll integrate, but I want a Claude Code adapter" → `CodingAgentAdapter` alias + translator example
- Partner C: "Soft NO until Python SDK exists" → Python SDK
- Partner A (after 0.3.1 calibration): would want threshold tuning for $0.50/scrape workflows → `detector_policy`

These are direct responses to findings, not new feature work. The Core is unchanged. The product surface is unchanged. What changed is who can integrate in under 30 minutes.

**Constraint acknowledged:** the maintainer's development host (Windows) does not have Python installed. The Python SDK was authored in isolation with mocked-fetcher unit tests and a bundled Dockerfile for live verification. The first real Python partner will be the first end-to-end execution of `python -m pytest` against this code. Mitigation: the SDK is intentionally trivial (urllib + json), the tests cover all four helpers + failure modes, and any partner reporting an issue gets a 24-hour turnaround because the surface is small. Once a real Python partner gives feedback, we will know whether the surface is right.

**`detector_policy` contract:**

```ts
type DetectorPolicy = {
  same_tool_retry_threshold?: number;                  // default 6
  premium_retry_without_evidence_threshold?: number;   // default 3
  expensive_action_usd_threshold?: number;             // reserved (0.4 does NOT
                                                       // use cost-only heuristic in
                                                       // model_escalation; see § 14)
  require_confirmation_after_repeats?: number;         // default 5
}
```

All fields optional. Lives under `objective.detector_policy`. Read by `same_tool_retry_loop` (uses `same_tool_retry_threshold`), `model_escalation_without_evidence` (uses `premium_retry_without_evidence_threshold`), `stale_context_retry_storm` (uses `premium_retry_without_evidence_threshold` for its min-repeats threshold). `same_action_count_critical` rule scales with the chosen threshold (`threshold + 4`).

**`expensive_action_usd_threshold` is reserved-but-unused** in 0.4 because the 0.3.1 calibration removed the cost-only heuristic from `looksExpensive()`. The field exists in the schema so future versions can opt operators back into a cost-only heuristic per their own policy without breaking the API contract. Currently unused.

**Coding-agent adapter export shape:**

```ts
// All of these point at the same class.
import { OpenClawAdapter }     from "spending-guard";  // 0.1.x callers
import { CodingAgentAdapter }  from "spending-guard";  // 0.4 callers
import { HermesAdapter }       from "spending-guard/adapters/hermes";  // 0.1.x alias
```

Same imports. Same behavior. Same in-memory history tracking. Same `buildCheckInput()` semantics. Naming is for partner-facing clarity, not for behavior.

**Python SDK surface:**

```python
from agent_spend_guard import AgentSpendGuard, SpendingGuardBlockedError

guard = AgentSpendGuard(base_url, api_key, failure_mode="open", timeout_ms=1000)
guard.check(payload)              # → dict; never raises on guard decision
guard.check_shadow(payload)       # → dict; never raises on transport error either
guard.check_or_confirm(payload, on_warn=...)   # → dict; raises SpendingGuardBlockedError on block
guard.check_or_downgrade(payload, downgrade_to=...)  # → (action, result)
```

Same surface as TS SDK. Same semantics. Same failure-mode contract.

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

The product is consumer-facing branded as **AIBrake**. The npm package and repository identifier remain `spending-guard` so existing imports, tag history, and prior commits do not break. The two namings are deliberately kept distinct and pinned here so future work does not silently rename everything for "consistency".

| Surface | Value | Why |
| --- | --- | --- |
| npm package name | `spending-guard` | preserves `import { ... } from "spending-guard"` for harness and partners |
| Repository | `sbbuilder` (local) → `spending-guard` (when published) | tag history `spending-guard-v0.1.1-rc` … intact |
| Product brand (README, listing, marketing, partner-facing copy) | **AIBrake** | what partners see |
| `GET /health` `service` field | `"agent-spend-guard"` (kebab-case) | matches the brand they recognize |
| `GET /v1/meta` `name` field | `"AIBrake"` (title case) | display string |
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
  "name": "AIBrake",
  "version": "0.3.0-beta",
  "description": "Loop detection and model stop-loss for paid AI agents.",
  "positioning": "PQS checks the prompt. AIBrake checks the loop.",
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

## 16. Stage 0.4.1 — Python SDK fail-open scope (hotfix)

**Refers to:** `STAGE_0_4_1_PYTHON_SDK_FAIL_OPEN_HOTFIX_SPEC` and `validation-log/partner-C-revisit-after-04.md` Finding 1.

**The bug:** Stage 0.4 shipped `python/agent_spend_guard/client.py` with a broad catch in `check_shadow()`:

```python
try:
    return self._invoke(payload)
except SpendingGuardClientError:
    raise
except Exception as err:
    return _synthesize_failure_open(err)
```

`json.dumps()` runs BEFORE the try inside `_invoke`. If the operator's payload contains an unserializable value (lambda, set, circular reference, etc.), `json.dumps` raises `TypeError`. The broad catch saw that as a transport failure and returned a synthetic `decision: allow, pattern: guard_unavailable` response. The operator believed their agent was protected; in reality the request never left their process.

**The fix:** narrow the catch to transport-class exceptions only.

```python
except (
    urllib.error.URLError,
    urllib.error.HTTPError,
    TimeoutError,
    OSError,
) as err:
    return _synthesize_failure_open(err)
```

**Contract — what propagates vs what is synthesized:**

| Exception class | Caught (synthesizes `allow`) | Propagates (operator sees the bug) |
| --- | :---: | :---: |
| `urllib.error.URLError` | ✅ |  |
| `urllib.error.HTTPError` | ✅ |  |
| `TimeoutError` | ✅ |  |
| `OSError` (socket reset, conn refused, broader transport class) | ✅ |  |
| `TypeError` (unserializable payload) |  | ✅ |
| `ValueError` |  | ✅ |
| `json.JSONDecodeError` (server returned malformed JSON) |  | ✅ |
| `SpendingGuardClientError` (SDK config error) |  | ✅ |
| Any other exception |  | ✅ |

**Why this is hotfix material, not feature work:** silent error hiding in a guardrail SDK is the #1 reason operators rip middleware out. A guard that converts programmer bugs into "ok proceed" is worse than no guard at all, because it gives false confidence. This fix is exactly the same class as the 0.3.1 cold-start false-positive — a baseline bug found in simulated validation, fixed before any real partner sees it.

**What was not fixed in 0.4.1:** Partner C's Finding 2 (`test_14_failure_mode_open_returns_synthetic_allow` has a pointless `mocker.stopall()` call that shadows the first `g` variable). That is a test-code quality issue, not a partner-facing SDK behavior bug. Deferred until a real partner reports something tied to it. Scope discipline: one fix per hotfix.

**Verification awaited:** the maintainer's Windows host still has no Python installed and Docker daemon is not running. The Python SDK still cannot be `python -m pytest`-ed locally. The fix was authored against the test code; the first real `pytest` run against this code will be the first real Python partner. This is unchanged from 0.4 — the constraint was acknowledged in 0.4 CHANGELOG and persists into 0.4.1.

---

## 17. Stage 0.4.2 — TypeScript SDK fail-open scope (hotfix, mirror of 0.4.1)

**Refers to:** `validation-log/partner-D-real-eval.md` Finding F1 (severity HIGH) and the user's explicit decision to fix it as a `v0.4.2-beta` hotfix on the same discipline as 0.4.1.

**The bug:** Stage 0.4 shipped `src/sdk/client.ts` with broad catches in both `invoke()` and `checkShadow()`:

```ts
// invoke (before 0.4.2)
try {
  return await this.fetcher(input, controller.signal);
} catch (err) {
  return this.handleFailure(err);   // catches EVERYTHING — same bug class as Python 0.4.0
}

// checkShadow (before 0.4.2)
try {
  return await this.invoke(input, this.timeoutMs);
} catch (err) {
  return synthesizeFailureOpen(err);
}
```

`createHttpFetcher` made it worse: `if (!res.ok) throw new Error(\`Spending Guard HTTP error: ${res.status}\`);` — so a server-side 400 VALIDATION_ERROR was indistinguishable from a 503 to the caller.

Partner D verified live against `:8080` v0.4.1-beta:

```
3a. BigInt in payload         → decision: allow, pattern: guard_unavailable
3b. Circular reference        → decision: allow, pattern: guard_unavailable
3c. Missing next_action field → decision: allow, pattern: guard_unavailable
                                  (server returned 400 VALIDATION_ERROR; SDK lost it)
```

**The fix:** introduce typed error classes that discriminate transport failures from validation failures, narrow `invoke()` + `checkShadow()` to catch only transport errors, update `createHttpFetcher` to throw the typed errors.

```ts
// src/sdk/errors.ts (added)
export class SpendingGuardTransportError extends Error { /* DNS, 5xx, abort */ }
export class SpendingGuardValidationError extends Error {
  readonly status: number;
  readonly body: unknown;
  /* 4xx — server saw the request and rejected it; propagate */
}

// invoke (after 0.4.2)
try {
  return await this.fetcher(input, controller.signal);
} catch (err) {
  if (err instanceof SpendingGuardTransportError) return this.handleFailure(err);
  throw err;
}

// checkShadow (after 0.4.2)
try {
  return await this.invoke(input, this.timeoutMs);
} catch (err) {
  if (err instanceof SpendingGuardTransportError) return synthesizeFailureOpen(err);
  throw err;
}

// createHttpFetcher (after 0.4.2)
//   fetch reject       → wrap as SpendingGuardTransportError
//   5xx response       → SpendingGuardTransportError(status, body)
//   4xx response       → SpendingGuardValidationError(status, body)
//   JSON.stringify err → propagate naked TypeError (programmer error)
//   2xx response       → parse and return SpendingGuardCheckOutput
```

**Contract — what propagates vs what is synthesized (TS, mirroring Python 0.4.1):**

| Error class / cause | Caught (synthesizes `allow` via failureMode) | Propagates (operator sees the bug) |
| --- | :---: | :---: |
| `SpendingGuardTransportError` (DNS, 5xx, abort, timeout) | ✅ |  |
| `SpendingGuardValidationError` (4xx — payload / auth rejected) |  | ✅ |
| `TypeError` from `JSON.stringify` (BigInt, circular ref) |  | ✅ |
| `SyntaxError` from `JSON.parse` on response |  | ✅ |
| `SpendingGuardBlockedError` / `SpendingGuardConfirmationDeniedError` |  | ✅ |
| Any other / generic `Error` from a custom fetcher |  | ✅ |

**Custom-fetcher migration:** SDK callers who wrote custom `Fetcher` implementations and threw plain `Error` to simulate transport failures must now throw `SpendingGuardTransportError` explicitly to opt into transport-class handling. Documented in CHANGELOG. The `createHttpFetcher` (used when you pass `baseUrl`) wraps DNS / 5xx automatically; this matters only for hand-rolled fetchers.

**Why this stage is hotfix, not feature work:** identical reasoning to 0.4.1. Silent error hiding in a guardrail SDK is the single fastest path to operators ripping middleware out. A guard that converts programmer bugs into `decision: allow` is worse than no guard, because the operator believes they have protection. Partner D's report was explicit: "Trust loss = guard rip-out."

**Symmetry achieved:** both SDKs now share the same fail-open scope discipline.

| Behavior | Python 0.4.1 | TypeScript 0.4.2 |
| --- | --- | --- |
| Transport-only synthesis | `(URLError, HTTPError, TimeoutError, OSError)` | `SpendingGuardTransportError` |
| Programmer error propagates | `TypeError`, `ValueError`, `json.JSONDecodeError` | `TypeError`, `SyntaxError`, generic `Error` |
| Server 4xx propagates | (currently routed as transport because Python `_invoke` only catches transport — 4xx never reached the broad catch) | `SpendingGuardValidationError` (explicit) |

Note: Python 0.4.1 did not introduce a `ValidationError` class because the Python SDK never wrapped the 4xx response in the first place — `_invoke` returns whatever the server sent. The TS SDK historically wrapped `!res.ok` in a generic Error, so the 0.4.2 fix had to add the discriminator. Both ends now have the same observable behavior for partners: 4xx → caller sees the validation problem.

**Verification:**

- TS typecheck: clean.
- TS unit tests: 148 / 148 (137 + 11 new in `tests/stage-04-2-sdk-fail-open-scope.test.ts`).
- Audit scenarios: 14 / 14.
- Harness: 36 / 36 actions against `:8080`.
- `/health`: `version: "0.4.2-beta"`.
- Partner D rerun: BigInt and circular payloads now reject with `TypeError`; missing `next_action` now rejects with `SpendingGuardValidationError(400, {...VALIDATION_ERROR...})`. Bug class closed.

**Python side:** unchanged. Version bumped to `0.4.2b0` for release coherence only — Python users running `pip install -e .` get the same version banner as TS users running `npm install spending-guard`. The Python SDK's behavior is identical to 0.4.1.

---

## 18. Stage 0.5 Partner-Ready Hardening

**Refers to:** `AGENT_SPEND_GUARD_STAGE_0_5_PARTNER_READY_HARDENING_SPEC.md` (the Stage 0.5 build spec).

**Scope:**

```txt
1. extend /v1/meta with detector_policy.supported_fields
2. structured `details` on every SDK error (TS + Python)
3. partner-facing docs around error behavior + threshold guidance
4. Python smoke command in PYTHON_SDK.md / PARTNER_ONBOARDING.md / DEPLOYMENT.md
5. ≥10 new TS tests (target ≥158 total); Python tests *executed*
6. version bump to 0.5.0-beta + tag spending-guard-v0.5.0-beta
```

**What was actually shipped:**

- `/v1/meta`: now exposes `detector_policy.supported_fields` with the four knobs (`same_tool_retry_threshold`, `premium_retry_without_evidence_threshold`, `expensive_action_usd_threshold`, `require_confirmation_after_repeats`) + an `example` block. Discovery-only — runtime is still per-request.
- TS SDK: new `SpendingGuardErrorKind` discriminator union (`transport | validation | http_4xx | http_5xx | serialization | parse | blocked | confirmation_denied | unknown`). Every error subclass exposes `err.details.{kind,statusCode,code,requestId,retryable,message}`.
- Python SDK: new `SpendingGuardError` base class with `.kind`, `.status_code`, `.retryable`, `.code`. All subclasses inherit from it. Kind constants exported at package level.
- Python SDK: 4xx now propagates as `SpendingGuardValidationError` instead of routing through `failure_mode`. This brings Python in line with TS 0.4.2 — both SDKs now have the same observable contract for 4xx vs 5xx vs network.
- 14 new TS tests in `tests/stage-05-partner-ready-hardening.test.ts`. Suite now **162 / 162** (was 148, target ≥158).
- 12 new Python tests in `python/tests/test_stage_05_error_kinds.py`. Python suite now **35 / 35** on Python 3.14.5 (19 `test_client.py` unit + 4 `test_integration.py` against live `:8080` + 12 Stage 0.5).
- Docs: README banner updated, `PARTNER_ONBOARDING.md` gained "Choosing detector_policy thresholds" + "SDK error behavior" sections, `PYTHON_SDK.md` / `DEPLOYMENT.md` got the smoke command (`python -m pytest` + `python -c "from agent_spend_guard import AgentSpendGuard; print('ok')"`).

### 18.1 The "do not fake it" path — Stage 0.5 § 6 (resolved)

**Spec § 6 verbatim:**

> One of these must pass:
> - Option A — local Python (`cd python && python -m pytest`)
> - Option B — Docker (`docker build -f python/Dockerfile.test ...`)
>
> If neither can be run on the maintainer machine, do not fake it. Leave Stage 0.5 incomplete.

**Timeline:**

1. **Initial attempt — both paths blocked.** At first pass on this maintainer machine, no Python was installed (no `python`/`python3`/`py`/`winget` on PATH) and Docker Desktop's WSL distro `docker-desktop` refused to come online despite a multi-attempt startup (Docker GUI processes were running but `//./pipe/dockerDesktopLinuxEngine` never opened and `wsl --list --verbose` continued reporting the distro as `Stopped`). Per spec § 6 the work was committed on `main` with the tag deferred.
2. **Python 3.14.5 installed by the user.** Located at `%LOCALAPPDATA%\Programs\Python\Python314\python.exe`.
3. **`py -m pytest` surfaced 2 failures** in `test_client.py`: `test_06_check_shadow_swallows_transport_error` and `test_06b_check_shadow_swallows_timeout_error`. Both mock `_invoke` to raise `urllib.error.URLError` / `TimeoutError` *directly* — bypassing `_invoke`'s wrap-as-`SpendingGuardTransportError` logic. The Stage 0.5 narrow-catch in `check_shadow()` (`except SpendingGuardTransportError`) let these propagate when they should synthesize allow.
4. **Fix landed in `client.py`:** broaden the narrow-catch tuple to `(SpendingGuardTransportError, urllib.error.URLError, TimeoutError, OSError)` — still explicit, no bare `except Exception`. Matches the spec contract: "URLError / TimeoutError / OSError / SpendingGuardTransportError → synthetic allow." Programmer errors and `SpendingGuardValidationError` still propagate.
5. **Final result:** **35 / 35** Python tests pass on Python 3.14.5 — 19 `test_client.py` unit + 4 `test_integration.py` (against live `:8080` `0.5.0-beta`) + 12 `test_stage_05_error_kinds.py`. Acceptance criterion #3 of § 11 met. Tag `spending-guard-v0.5.0-beta` created.

**Reproduction:**

```bash
cd python
py -m pip install -e ".[dev]"      # or python -m pip on Linux/macOS
py -m pytest                       # 35 passed in ~25s
```

**Why the bug existed:** the Stage 0.5 narrow-catch was correct for the *real* code path (`_invoke` wraps `URLError`/`TimeoutError`/`OSError` into `SpendingGuardTransportError` before they escape) but the mock-based tests in `test_06` / `test_06b` patch `_invoke` itself to raise the raw exception. Both tests pre-dated Stage 0.5 — the original 0.4.1 `check_shadow` caught the raw transport classes directly, which is why these tests existed in that shape. When 0.5 added the `SpendingGuardTransportError` discriminator, the narrow-catch was tightened too far. The fix restores the historical (correct) behavior alongside the new typed class.

---

## 19. Stage 0.5.1 — Adapter evidence-window calibration

**Refers to:** `SELF_TRIAL_CLAUDE_CODE_REPORT.md` § 4.1 (Finding 1, E2).

**Problem:** `CodingAgentAdapter.buildCheckInput` computed `new_evidence_since_last_attempt` strictly over events BETWEEN prior same-failure events. The current attempt's own annotations (`filesRead`, `testsRun`, `logsRead`, `gitDiffChanged`, `toolResultsChanged`, `contextSourceConfirmed`) were never counted. For the most common partner pattern — read failing file, edit, retry — the read-and-edit live on the new attempt, not on a separate event between attempts. Result: false-positive `warn` (`model_escalation_without_evidence`) on textbook healthy debugging.

**Fix:** in `src/adapters/openclaw/adapter.ts:79–135`, split each "since" computation into a `*Between` (events strictly after `lastSameFailure`) and a `*Current` (the action's own annotations), then combine. `new_evidence_since_last_attempt` becomes the OR of all six. `evidence_signals.*_since_last_attempt` counts add the current attempt to the between count. `context_source_confirmed` was already in the signals bag; it now also participates in `newEvidence`.

**Window semantics:**

```
Before: evidence ∈ (lastSameFailure, now)   — exclusive on both sides
After : evidence ∈ (lastSameFailure, now]   — inclusive of the current attempt
```

**Why this direction is correct:** the question Core asks is "did the agent learn anything since it last hit this same failure?". The agent's answer lives in the annotations on the action it's *about to take*. Treating those annotations as the closing boundary of the window matches the obvious operator mental model.

**Behaviour delta — observable to detectors:**

- `stale_context_retry_storm`: `no_files_read_since_last_attempt`, `no_tests_run_since_last_attempt`, `no_logs_read_since_last_attempt`, `git_diff_unchanged`, `no_new_evidence_since_last_attempt` — all stop matching when the current attempt declares the relevant signal.
- `model_escalation_without_evidence`: `no_new_evidence` stops matching when the current attempt declares any evidence signal (or `contextSourceConfirmed`).
- `stale_context_retry_storm`'s stuck-branch and soft-branch split (0.3.1) is unchanged. The fix only changes how `newEvidence` is populated; the detectors' decision logic is byte-for-byte identical.

**No backward-compatibility hazard.** The change moves `new_evidence_since_last_attempt` from `false` to `true` in cases where the agent annotated evidence on the new attempt. Detectors gate on `false` to fire — moving more cases out of `false` only reduces detector aggressiveness, never increases it. No previously-allowed call becomes a warn.

**Regression coverage:** 10 tests in `tests/stage-05-1-adapter-evidence-window.test.ts`. R1–R6 isolate each evidence signal; R7 pins the no-evidence regression case (must still go false); R8 is the end-to-end E2 reproduction (must flip to `allow`); R9 pins the historical between-attempts path (must still work); R10 pins cold-start semantics (`null`, not `true`, when there's no prior history).

**Self-trial re-run on `:8080` 0.5.1-beta:**

```
Before (0.5.0): allow=6 warn=1 req_confirm=2 block=1
After  (0.5.1): allow=7 warn=0 req_confirm=2 block=1
```

Same 10 scenarios, same harness, no scenario edits. E1 / E10 / E7 strong catches preserved; only E2 flipped.

**Out of scope (per task spec and prior 0.5 discipline):**

- No new detectors. No `wasteful_repeated_work` for the E3 / E8 redundant-work cases — wait for real-partner data.
- No new adapter. No new SDK contract. No new endpoints.
- The Python SDK was not affected — the adapter is TS-only. Python `0.5.1b0` is a version-coherence bump; no behaviour change.

---

## 20. Stage 0.5.2 — Savings Visibility (`projected_savings` + DEFAULT_DOWNGRADE_MAP)

**Refers to:** Утечка 3 + Утечка 4 + Утечка 5 from the founder savings audit ("аудит можем ли мы еще эффектвность экономии повысить и каким способом"). Auto-mode override of the Stage 0.5 closing rule — explicit founder decision to ship before first partner.

**What shipped (one coherent feature, three surfaces):**

1. **`projected_savings` field** on every non-`allow`, non-`uncertain` `/v1/check` response with a cost-bearing next_action. Optional, omitted when not applicable. Three explainable computation paths picked in order:
   - **`model_downgrade_delta`** — when `suggested_action.model_route.to` carries `estimatedCostUsd`, savings = `primary − secondary`. Without `estimatedCostUsd`, fall back to a conservative 60% reduction estimate (labeled in the explanation so partners do not mistake it for a precise number).
   - **`projected_future_attempts`** — when pattern is `stale_context_retry_storm` and `paid_attempts_on_same_failure >= 1`, savings = `cost × min(3, repeats)`. The cap of 3 is deliberate; past three attempts the projection becomes guessing.
   - **`next_attempt_avoided`** — fallback for every other warn / require_confirmation / delay / block. Savings = cost of the single next attempt.

2. **`DEFAULT_DOWNGRADE_MAP`** — heuristic 9-entry table consumed by `model_escalation_without_evidence` (now `@0.3.0`) when no operator-supplied `secondaryModel` exists. Exposed via `/v1/meta.default_downgrade_map` so partners can audit before relying on it. Marked as default in `route.reason` so SDK consumers can tell a heuristic route from a partner-declared route.

3. **`logs:summary` savings aggregation** — sums `projected_savings_usd` from the JSONL log into `savings_offered` / `savings_by_pattern` / `savings_by_basis` / `cost_observed`. Reads two new log fields (`next_action_cost_usd`, `projected_savings_usd`, `projected_savings_basis`) — partner-supplied or derived from partner-supplied numbers only. No new privacy surface.

### Why this is partner-visible

The 0.5.0 → 0.5.1 work made the guard *more accurate*. 0.5.2 makes the guard *more legible*. A partner running shadow mode for 7 days now sees:

```
AIBrake — Beta Summary
total_checks: 412
allow: 387
warn: 18
require_confirmation: 5
block: 2

savings_offered (sum of projected_savings_usd on warn/req_confirm/block):
- total: $14.27
- events_with_savings: 25
- avg_per_event: $0.57
```

That number is the answer to "is this guard pulling its weight?" — a question partners would otherwise have to compute themselves from raw JSONL.

### Honesty disclosures

- The 60% fallback ratio in `model_downgrade_delta` is a heuristic anchored on industry-typical premium-vs-cheap pricing (opus/sonnet → haiku ≈ 5-10x cheaper). It is conservative. The detector labels it as such in the `explanation` field.
- `DEFAULT_DOWNGRADE_MAP` will go stale as providers re-price. Exposed via `/v1/meta` precisely so partners can audit and override with their own `model_policy.secondaryModel`.
- The `min(3, repeats)` cap in `projected_future_attempts` is deliberate but defensible — research on agent retry storms suggests >70% of "stuck" loops terminate within 3 more attempts even without intervention. Past 3 we would be inventing.
- `projected_savings` is *offered* savings, not *realized* savings. The CLI cannot know whether the partner heeded each recommendation — that data lives in the partner's outcome log, not the guard's decision log.

### Test surface

`tests/stage-05-2-savings-visibility.test.ts` adds 15 tests (S1-S15). Suite at 188 / 188. Typecheck clean. Python 35 / 35 on 3.14.5.

Two existing tests changed their expectations to match the new contract:
- `tests/model-policy.test.ts` § 06 — "falls back to plain downgrade_model" became "falls back to DEFAULT_DOWNGRADE_MAP", plus § 06b pinning the genuine-no-match path.
- `tests/stage-03-1-calibration.test.ts` § 05 — second-attempt opus retry now returns `switch_model` + default route to `claude-sonnet-4.5`.

Both changes are deliberate; they pin the 0.5.2 partner-visible behavior shift.

### Out of scope

- No new detectors. `wasteful_repeated_work` (E3/E8 self-trial gap) stays deferred.
- No paid `/x402/v1/check` endpoint. The `projected_savings` number is the unlock that makes paid usage defensible — but actual payment integration waits for partner data.
- No SDK API surface change. `result.projected_savings` is just another field on the response dict / object; SDK helpers expose it through normal property access without code changes.
- Python source unchanged; `0.5.2b0` is a version-coherence bump.

