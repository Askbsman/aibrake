# Changelog

All notable changes to Agent Spend Guard (npm package `spending-guard`).

The format follows a partial [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. The leading entry is the work in progress on `main`; everything below it corresponds to a git tag.

---

## 0.4.2-beta — TypeScript SDK fail-open scope hotfix

**Tag:** `spending-guard-v0.4.2-beta`
**Goal:** mirror the Stage 0.4.1 Python fix in the TypeScript SDK. Same bug class, found by Partner D (`validation-log/partner-D-real-eval.md`, Finding F1, severity HIGH) during their first-hour eval against `:8080` v0.4.1-beta. No new features. No new detectors.

### Fixed

- **TS SDK: `invoke()` and `checkShadow()` no longer swallow programmer errors or server-side 4xx validation errors.** Both helpers previously had broad `catch (err)` blocks that routed everything — including `TypeError` from `JSON.stringify` on BigInt / circular references, and server 400 VALIDATION_ERROR responses — through `failureMode`. Partner D verified live against `:8080`: BigInt payload, circular reference, and missing required field all produced `decision: allow, pattern: guard_unavailable`. **Severity: HIGH**, same class as Stage 0.4.1.

  The fix routes ONLY transport-class errors through `failureMode`. Two new typed error classes discriminate:

  ```ts
  export class SpendingGuardTransportError extends Error { /* DNS, 5xx, abort, timeout */ }
  export class SpendingGuardValidationError extends Error {
    readonly status: number;
    readonly body: unknown;
    /* 4xx — partner's payload or auth was rejected by the server */
  }
  ```

  `createHttpFetcher` now distinguishes:
  - `fetch` rejected (DNS / connection refused / abort)          → `SpendingGuardTransportError`
  - server returned 5xx                                          → `SpendingGuardTransportError`
  - server returned 4xx (validation, auth, etc.)                 → `SpendingGuardValidationError`
  - `JSON.stringify` threw on payload (BigInt, circular, etc.)   → naked `TypeError` propagates
  - successful 2xx                                               → parsed `SpendingGuardCheckOutput`

  `invoke()` and `checkShadow()` both catch only `SpendingGuardTransportError`; everything else propagates so the operator sees the bug.

### Changed

- `src/sdk/errors.ts` adds `SpendingGuardTransportError` and `SpendingGuardValidationError`. Both exported from `src/sdk/index.ts` and `src/index.ts`.
- `src/sdk/client.ts`: `createHttpFetcher` updated to throw typed errors per the contract above. `invoke()` and `checkShadow()` narrow their catches to `instanceof SpendingGuardTransportError`.
- `tests/sdk.test.ts`: failure-mode test fixtures switched from `fetcherThrowing(new Error(...))` (no longer treated as transport) to a new `fetcherThrowingTransport(...)` helper that throws `SpendingGuardTransportError`. The timeout test's mocked fetcher likewise rejects with `SpendingGuardTransportError` to opt into synthesis.
- Bumped versions to `0.4.2-beta` / `0.4.2b0` across `package.json`, `src/config/env.ts`, `tests/routes.test.ts`, `tests/stage-03-hosting.test.ts`, `python/pyproject.toml`, `python/agent_spend_guard/__init__.py`. Python SDK source itself unchanged — version bumped for release coherence so partners see one consistent number across both clients and `/health`.

### Tests

- Added `tests/stage-04-2-sdk-fail-open-scope.test.ts` with 11 regression tests:
  - **R1–R3**  programmer errors propagate: `BigInt` payload via `check()`, `BigInt` via `checkShadow()`, circular reference via `check()`. All assert `TypeError`.
  - **R4–R6**  4xx propagates as `SpendingGuardValidationError`: via `check()`, via `checkShadow()`, and the error carries the server's parsed body so callers can read `error.code`.
  - **R7–R9**  5xx is transport-class: synthesizes allow in `failureMode: "open"`, synthesizes block in `failureMode: "closed"`, propagates `SpendingGuardTransportError` in `failureMode: "throw"`.
  - **R10–R11** custom fetcher contract: a fetcher throwing plain `Error` is no longer silently synthesized; partners must explicitly throw `SpendingGuardTransportError` to opt into transport-class handling.
- TS unit tests: **148** passing (was 137 + 11 new).
- Audit scenarios: 14 / 14.
- Harness: 36 / 36 actions against `:8080`.

### Custom-fetcher migration note (operator-facing)

If you wrote a custom `Fetcher` against the TS SDK and your fetcher throws plain `Error` to simulate transport failures, that pattern stopped working in 0.4.2. Either:

- Throw `SpendingGuardTransportError` explicitly (recommended for tests):
  ```ts
  const fetcher = async () => { throw new SpendingGuardTransportError("simulated outage"); };
  ```
- Let your fetcher throw whatever and accept that non-transport errors will propagate (semantically correct — your operator wants to see the bug).

`createHttpFetcher` (used when you pass `baseUrl`) handles this automatically: it wraps DNS / connection failures and 5xx responses in `SpendingGuardTransportError`, and lets `TypeError` / 4xx errors propagate naturally.

### Not changed (deliberately)

- Partner D's F2 (`/v1/meta` doesn't advertise `detector_policy` knobs). Doc/discovery improvement; defer to v0.5.
- Partner D's F3 (free-text `error.message` instead of structured `error.cause`). Defer to v0.5.
- Python SDK source. Not affected by this bug class — fixed in 0.4.1. Only version-bumped here for release coherence.
- No async TS SDK, no PyPI publish, no new adapters / detectors / dashboard.

### Verification

- TS typecheck: clean.
- TS unit tests: 148 / 148.
- Audit scenarios: 14 / 14.
- Harness: 36 / 36 actions against `:8080`.
- `/health`: returns `version: "0.4.2-beta"`.
- Partner D rerun: the three repro cases that previously returned synthetic allow now correctly surface the bug — see verification section in `validation-log/raw/partner-D-results-after-042.txt`.

---

## 0.4.1-beta — Python SDK fail-open scope hotfix

**Tag:** `spending-guard-v0.4.1-beta`
**Goal:** fix one real bug found via code review during the simulated Partner C revisit after Stage 0.4 (`validation-log/partner-C-revisit-after-04.md`, Finding 1). One file changed, one test updated, one regression test added. No new features, no new detectors.

### Fixed

- **Python SDK: `check_shadow()` no longer swallows programmer errors.** The previous broad `except Exception` clause silently converted malformed-payload bugs (e.g., a `TypeError` from `json.dumps()` when the payload contained an unserializable value) into a synthetic `decision: allow, pattern: guard_unavailable` response. That made the operator believe their agent was protected by the guard when in fact the request had never reached the server. **Severity: high** — silent error hiding in a guardrail SDK is the #1 reason partners rip middleware out.

  The catch is now narrowed to transport-class exceptions only:

  ```python
  except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as err:
      return _synthesize_failure_open(err)
  ```

  Errors that now propagate (correctly):
  - `TypeError`, `ValueError` — payload construction / programmer error
  - `json.JSONDecodeError` — guard returned malformed JSON (contract bug)
  - `SpendingGuardClientError` — SDK-internal config error

  Errors that still convert to synthetic `allow` (correct — these mean "guard unavailable"):
  - `urllib.error.URLError` — DNS failure, host unreachable
  - `urllib.error.HTTPError` — 4xx / 5xx response
  - `TimeoutError` — request timed out
  - `OSError` — socket reset, connection refused

### Changed

- `python/tests/test_client.py` `test_06` switched from `RuntimeError` mock (which now correctly propagates under the new contract) to `urllib.error.URLError`. New companion `test_06b` covers `TimeoutError`.
- Bumped `package.json` version, env `serviceVersion`, `python/pyproject.toml` version, `python/agent_spend_guard/__init__.py __version__`, and `/health` route test assertions to `0.4.1-beta` / `0.4.1b0`.

### Tests

- Added `test_17_check_shadow_propagates_programmer_errors_on_unserialisable_payload` — payload with a lambda (not JSON-serializable) must raise `TypeError`, not return synthetic allow.
- Added `test_18_check_propagates_programmer_errors_too` — same contract for `check()`; confirms no regression on the helper that never had the bug.
- TS unit tests: **137 / 137** still passing (no TS code changes in this stage).
- Python unit tests: **18** (was 16 + 2 new) — pinned by `python/tests/test_client.py`; live `python -m pytest` run still awaits a real Python user. The bundled `python/Dockerfile.test` remains the verification path on hosts without Python.

### Not changed (deliberately)

- Partner C's Finding 2 (`test_14`'s `mocker.stopall()` weirdness). Cosmetic test-code quality; not a partner-facing SDK behavior bug. Defer until a real partner asks.
- No async Python.
- No PyPI publish.
- No Claude Code / LangChain adapter packages.
- No configurable thresholds beyond what 0.4 shipped.

### Verification

- TS typecheck: clean.
- TS unit tests: 137 / 137.
- Audit scenarios: 14 / 14.
- Harness: 36 / 36 actions against `:8080`.
- `/health`: returns `version: "0.4.1-beta"`.

---

## 0.4.0-beta — Real Integration Layer

**Tag:** `spending-guard-v0.4.0-beta`
**Goal:** lower the cost of integrating Agent Spend Guard for a real partner. The 0.3.1 calibration fixed the friction in the Core; 0.4 fixes the friction in *getting to* the Core. No new detectors, no dashboard, no DB.

Built per the architectural review of `STAGE_0_4_REAL_INTEGRATION_LAYER_SPEC` with four reviewer modifications applied before any code was written (documented in IMPLEMENTATION_NOTES § 15):

  1. **One `CodingAgentAdapter`, not two** (single Claude Code + Codex adapter; runtime differences live in translator examples, not adapter code).
  2. **Per-request `objective.detector_policy`, not server-side state** (keeps Core stateless; no key-management UI in 0.4).
  3. **Two example files, not four** (one TS, one Python; comments cover the runtime variations).
  4. **Python SDK as thin HTTP client, not feature-parity SDK** (urllib + json + typing only; no async; no typed response objects; explicit "we are not the source of truth, the server is" framing).

### Added

- **Per-request detector thresholds** (`objective.detector_policy`). Operators can tune `same_tool_retry_threshold` (default 6), `premium_retry_without_evidence_threshold` (default 3), `expensive_action_usd_threshold` (reserved), and `require_confirmation_after_repeats` (default 5). All optional; absent fields fall back to detector defaults. Read by `same_tool_retry_loop`, `model_escalation_without_evidence`, and `stale_context_retry_storm`. Never server-state; each request carries its own policy. Adapter `ObjectiveDescriptor.detectorPolicy` forwards the value into `input.objective.detector_policy` unchanged.
- **`CodingAgentAdapter`** — friendly alias for the existing `OpenClawAdapter`. Same class. Partners running Claude Code / Codex / Cursor / custom wrappers `import { CodingAgentAdapter } from "spending-guard"`. Existing 0.1.x imports of `OpenClawAdapter` keep working unchanged.
- **`examples/coding-agent-integration.ts`** — single runnable TS example covering the translator pattern for Claude Code and Codex lifecycle events. Demonstrates the "carry failure context onto planned model calls" pattern explicitly. Live retry-storm trajectory against `:8080`: allow → warn → warn → require_confirmation.
- **Python SDK at `python/agent_spend_guard/`** — package `agent-spend-guard` (PyPI name reserved; not yet published). Thin urllib-based HTTP client with the same four helpers as the TS SDK: `check`, `check_shadow`, `check_or_confirm`, `check_or_downgrade`. Three failure modes (`open` / `closed` / `throw`). `hash_api_key()` exposed for partners who want to correlate their own logs without keeping raw keys. 16 unit tests (mocked) + 4 integration tests (live server). Zero runtime dependencies; stdlib only.
- **`python/Dockerfile.test`** — verify the Python SDK without installing Python on the host. `docker build -f python/Dockerfile.test -t asg-python-test python/ && docker run --rm asg-python-test`.
- **`python/examples/shadow.py` + `python/examples/downgrade.py`** — partner-ready runnable starter code.
- **Three new docs at the repo root:**
  - **`INTEGRATION_GUIDE.md`** — meta-document explaining the three integration layers (your runtime → adapter → SDK → /v1/check), the three integration modes (shadow / confirm / downgrade), the minimum useful payload, and the recommended 14-day promotion path.
  - **`PYTHON_SDK.md`** — Python-specific quickstart, the four helpers, cold-start convention, per-request policy overrides, honesty contract ("not a feature-parity SDK").
  - **`CODING_AGENT_ADAPTER.md`** — the translator pattern, the critical "carry failure context onto planned model calls" rule, and runtime-specific hints for Claude Code / Codex / Cursor / custom wrappers.

### Changed

- Bumped `package.json` `version` and env `serviceVersion` to `0.4.0-beta`. `/health` now reports `version: "0.4.0-beta"`.
- `same_tool_retry_loop.same_action_count_critical` rule now scales with the operator's chosen base threshold (`threshold + 4`) instead of the hard-coded 10.
- `OpenClawAdapter.ObjectiveDescriptor` adds optional `detectorPolicy` field — forwarded into the universal input as `objective.detector_policy`.
- README banner refreshed; PARTNER_ONBOARDING.md unchanged (the "Pick your path" tiles from 0.3.1 still apply); IMPLEMENTATION_NOTES.md adds § 15 documenting the Stage 0.4 scope + four reviewer modifications.

### Tests

- Added `tests/detector-policy.test.ts` with 8 tests covering per-request threshold overrides for all three affected detectors and the per-request (not server-state) invariant.
- Added 16 Python unit tests + 4 integration tests in `python/tests/`. Maintainer verification:
  - With Python installed: `cd python && pip install -e ".[dev]" && python -m pytest`
  - Without Python installed: `docker build -f python/Dockerfile.test -t asg-python-test python/ && docker run --rm asg-python-test`
- TS total: **137** passing (was 129; +8 new in `tests/detector-policy.test.ts`). Audit 14 / 14. Harness 36 / 36.

### Not changed (deliberately)

- No new detectors.
- No new evidence-model fields.
- No async Python.
- No type stubs (.pyi) — too premature, surface still drifting.
- No PyPI publish.
- No dashboard, no DB, no full x402 integration, no Sober Builder / Family Mode / Builder Mode.
- `validation-log/` is still gitignored.

### Known constraint

The maintainer's development host (Windows) does not have Python on PATH. The Python SDK was written, tested in isolation (mocked), but the live unit test suite has not been executed locally. Verification options: (a) install Python locally, then `cd python && pip install -e ".[dev]" && python -m pytest`; (b) build the bundled Docker image and run the test container. Reference: PYTHON_SDK.md § Verification.

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
