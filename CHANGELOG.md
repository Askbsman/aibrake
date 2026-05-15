# Changelog

All notable changes to Agent Spend Guard (npm package `spending-guard`).

The format follows a partial [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. The leading entry is the work in progress on `main`; everything below it corresponds to a git tag.

---

## 0.3.1-beta — Pre-Partner Calibration

**Tag:** `spending-guard-v0.3.1-beta`
**Goal:** fix the two real defects surfaced by the simulated 3-partner validation run before sending the build to a real partner. Three small fixes; no new features, no new detectors, no new SDK / adapter / dashboard work.

### Fixed

- **Cold-start false-positive in `model_escalation_without_evidence`** (Partner A reproduction). On attempt #1 of any workflow with no prior history — `same_failure_count: 0`, `paid_attempts_on_same_failure: 0`, `same_action_count: 0` — but `new_evidence_since_last_attempt: false`, the detector used to fire with `decision: uncertain` and a `downgrade_model` suggestion. Operators following PARTNER_ONBOARDING.md were natural to set `new_evidence: false` on first call (their mental model: "I haven't gathered evidence yet"); the `OpenClawAdapter` correctly sets `null` for cold starts but hand-rolled clients tripped this. Fix: gate the `no_new_evidence` rule on `(same_failure_count ≥ 1) OR (paid_attempts_on_same_failure ≥ 1) OR (same_action_count ≥ 1)`. Cold start now returns `decision: allow` / `pattern: none`.
- **`looksExpensive` cost-only branch removed.** A $0.50 paid scrape with `model: "browser-v1"` (Anchor scraper, not an LLM) used to register as expensive purely on cost. Model-escalation semantics imply a model is being escalated; cost alone is not enough. The detector now requires at least one of: `model_role: "primary"`, `model_tier: "premium"`, `model_policy.primaryModel` matching the action, or a model-name regex hit. Operators with non-LLM expensive actions (paid scrapes, paid browser sessions) are now correctly NOT flagged by this detector — `same_tool_retry_loop` is the right detector for those, and it remains unchanged.
- **`allow + downgrade_model` dissonance in `model_escalation_without_evidence`** (Partner B reproduction). Operators without `objective.model_policy` declared used to receive `decision: allow` and `suggested_action.type: downgrade_model` in the same response, because coverage_ratio ran at 4/5 → confidence 0.60 → below the warn-band threshold of 0.70. Fix: drop `objective.model_policy` from the detector's `recommendedFields` (now 4 fields). Both with-policy and without-policy callers hit coverage 1.0 → confidence 0.75 → decision `warn` at score 25+. Operators who declare `model_policy` still receive the structured `model_route.to` in the response — that is the real benefit of declaring, not a confidence bonus. Same class of fix as the v0.1.2 `same_tool_retry_loop` calibration (0.65 → 0.70 baseConfidence).

### Changed

- `PARTNER_ONBOARDING.md` rewritten with three top-level "Pick your path" tiles: **Coding-agent operator** (canonical retry-storm demo), **Scraper / research-agent operator** (scraper-loop demo), **Primary/secondary model operator** (premium-model-loop demo). Each tile names the canonical demo command, the pain it addresses, the detector that will fire, the sample payload path, and the minimal telemetry shape. Partner A and Partner C both reported in simulated validation that the docs leaned coding-agent and they had to spelunk for the right shape; this fixes that without code changes.
- Bumped `package.json` `version` and env `serviceVersion` to `0.3.1-beta`. `/health` now reports `version: "0.3.1-beta"`.
- `IMPLEMENTATION_NOTES.md § 11` extended with the `recommendedFields` calibration entry alongside the existing baseConfidence drift entries.

### Tests

- Added `tests/stage-03-1-calibration.test.ts` with 6 regression tests pinning the two fixes:
  - 01–04 reproduce Partner A's cold-start case and assert clean allow/none.
  - 05–06 reproduce Partner B's dissonance and assert no `allow + downgrade-class suggestion` response can be emitted.
- Total tests: **129** (was 123). All pass. Existing 14 audit scenarios and 36 harness actions unchanged.

### Not changed (deliberately)

- No new detectors.
- No SDK changes.
- No new adapters.
- No dashboard, no DB, no billing, no x402 publishing.
- `validation-log/` partner feedback files are gitignored — produced by the simulated 3-partner stress test that surfaced these fixes.

---

## 0.3.0-beta — Hosted Beta Candidate

**Tag:** `spending-guard-v0.3.0-beta`
**Goal:** turn the v0.2.0-rc RC into something a real partner can integrate against a hosted endpoint in under 30 minutes.

### Added

- **API key authentication** (single `Authorization: Bearer <key>` header). Two modes via env: `AGENT_SPEND_GUARD_AUTH_MODE=optional|required`. Comma-separated key list via `AGENT_SPEND_GUARD_API_KEYS`. Raw keys are never logged; the JSONL log records a `key_v1_<sha256-16>` hash so operators can correlate without leaking.
- **Per-key sliding-window rate limit** (default 600 req/min/key). Configurable via `AGENT_SPEND_GUARD_RATE_LIMIT_PER_KEY_PER_MIN`. On breach: HTTP 429 + `Retry-After` header. Anonymous traffic (when auth is optional) shares an `anon` bucket.
- `GET /v1/meta` — public product metadata: name, version, positioning, supported patterns, SDK modes, policy_version. Always accessible without auth.
- **JSONL log sink** (`AGENT_SPEND_GUARD_LOG_SINK=jsonl`) — appends one redacted JSON line per `/v1/check` to `AGENT_SPEND_GUARD_LOG_PATH` (default `./logs/decisions.jsonl`). Auto-creates the parent directory. Write failures emit one rate-limited stderr warning per minute and never block the API response.
- `npm run logs:summary` — CLI that reads the JSONL log and prints a beta-style aggregate (total / by decision / by pattern / by recommended_policy / false-positive review counts). No dashboard; CLI is the only review surface in Stage 0.3.
- **Hosted SDK examples:** `examples/hosted-check-shadow.ts` and `examples/hosted-check-downgrade.ts`. Each runs against a live `AGENT_SPEND_GUARD_URL` with a configured `AGENT_SPEND_GUARD_API_KEY`.
- **Payload fixtures** in `examples/payloads/` (retry-storm, scraper-loop, premium-model-loop) — JSON files runnable via curl or imported by the example scripts.
- **Deployment artifacts:** `Dockerfile`, `.dockerignore`, `.env.example`.
- **Partner-facing docs:** `DEPLOYMENT.md`, `PARTNER_ONBOARDING.md`, `BETA_FEEDBACK_TEMPLATE.md`.
- `request_id` (`req_<uuid>`) is generated per `/v1/check` call and emitted into the decision log so partners can correlate their own logs with the guard's.
- `IMPLEMENTATION_NOTES.md` § 13 (brand vs. package identity matrix) and § 14 (Stage 0.3 scope and the four reviewer modifications applied to the original spec).

### Changed

- **`GET /health`** now returns `{ ok, service: "agent-spend-guard", version: "0.3.0-beta", mode: "hosted-beta" }`. The legacy fields `service: "spending-guard"` and `version: "0.1.0"` are replaced. Health remains public (no auth).
- **Default `PORT`** is now `8080` (was `3000`). Avoids the local clash with Next.js / CRA / Rails dev servers we hit during 0.2 integration testing.
- **Decision-log `event_type`** is now `"agent_spend_guard.check.completed"` (was `"spending_guard.check.completed"`). The change reflects the product brand. The existing `setLoggerSink` API is unchanged; only the event string moves.
- **Decision-log payload** adds `request_id`, `api_key_hash`, `matched_rules_count`. Existing fields are preserved.
- **OpenClaw harness `guard-client.ts`** reads `AGENT_SPEND_GUARD_URL` and `AGENT_SPEND_GUARD_API_KEY` first, falling back to the legacy `SPENDING_GUARD_*` env vars. Default URL is now `http://localhost:8080`.
- Package `version` bumped to `0.3.0-beta`.

### Not changed (deliberately)

- Core remains stateless. Auth and rate limit are middleware; they never touch `runCheck`.
- No new detectors. No schema additions beyond what 0.2-minimal already shipped.
- `/v1/check-deep` remains an honest stub: `deep_check_used: false`, `deep_check_stub: true`. LLM-based semantic judgment is out of scope until 0.4 or later.
- No dashboard, no auth UI, no database, no user accounts, no team management, no billing dashboard, no full x402 settlement, no Sober Builder / Family Mode / Builder Mode.

### Reviewer modifications applied to the original Stage 0.3 spec

1. **Single auth header.** The spec accepted both `Authorization: Bearer` and a custom `X-Agent-Spend-Guard-Key`. The custom header was dropped — partners get one well-known integration path.
2. **Default `PORT=8080`** (spec said 3000). See "Changed" above.
3. **Per-key rate limit added.** The spec did not include this; it is a hard operational requirement for a hosted beta.
4. **Brand vs. package matrix** in IMPLEMENTATION_NOTES § 13 — fixes naming drift across `/health`, log strings, env vars, and package metadata.

### Test count

- Unit tests: **123** passing (was 109 + 14 new for hosting). 14 audit scenarios still pass. Harness runs 36 actions against the rebuilt dist.

---

## 0.2.0-rc — Model policy awareness + structured model_route

**Tag:** `spending-guard-v0.2.0-rc`

### Added

- `ModelRole`, `ModelTier`, `ModelRef`, `ModelPolicy`, `ModelRoute` types.
- `NextAction.model_role` / `NextAction.model_tier` (optional).
- `Objective.model_policy` (optional) with `primaryModel` / `secondaryModel` / `auditModel`.
- `SuggestedAction.model_route` (optional, populated by the escalation detector when a secondary model is configured).
- OpenClaw adapter forwards `objective.modelPolicy` and `next_action.model_role` / `model_tier` into the universal input.
- `premium-model-loop` scenario in the harness ($100 Claude 4.7 Stuck Task).
- 13 new tests in `tests/model-policy.test.ts`.

### Changed

- `model_escalation_without_evidence` detector reads `model_policy` and emits a structured `model_route.to` when the secondary is configured. Falls back to the regex+cost heuristic when policy is absent (backward-compat).
- `SDK.checkOrDowngrade()` prefers `result.suggested_action.model_route.to` over the operator's static `downgradeTo`.

---

## 0.1.2-rc — Calibration before partner validation

**Tag:** `spending-guard-v0.1.2-rc`

### Changed

- `same_tool_retry_loop.baseConfidence` bumped from `0.65` to `0.70` so 8x-same-call-no-result-change reaches `warn` instead of `allow`.
- `POST /v1/check-deep` honest contract: `deep_check_used: false`, `deep_check_stub: true` (was `true` / `true`, which was misleading).
- `IMPLEMENTATION_NOTES.md § 11` records the two `baseConfidence` deviations from the v0.1.1 spec table (objective_drift 0.60→0.70, same_tool_retry_loop 0.65→0.70).

---

## 0.1.1-rc — Frozen audit point

**Tag:** `spending-guard-v0.1.1-rc`

### Added

- Universal stateless Core API; `runCheck()` pure function.
- Five detectors: `task_budget_breach`, `stale_context_retry_storm`, `same_tool_retry_loop`, `model_escalation_without_evidence`, `objective_drift`.
- TypeScript SDK with `check` / `checkOrConfirm` / `checkOrDowngrade` / `checkShadow`. Fail-open default (`failureMode: "open"`), 500 ms timeout.
- `OpenClawAdapter` (also re-exported as `HermesAdapter`) with inclusive-slice evidence semantics.
- Versioned fingerprints (`fp_v1_*`, `input_v1_*`) with sha256-16 and prompt/secret redaction for `inputHash`.
- Structured decision logging via pluggable `LoggerSink`.
- `STAGE_0_1_AUDIT_REPORT.md` and `STAGE_0_1_1_AUDIT_REPORT.md` with the 14-scenario audit runner.
- 96 unit tests + 14 audit scenarios — all green.
