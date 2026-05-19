# Changelog

All notable changes to **AIBrake** (npm package: `aibrake` since `0.5.5-beta`; formerly `spending-guard` while still in the private repo).

The format follows a partial [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. The leading entry is the work in progress on `main`; everything below it corresponds to a git tag.

---

## 0.5.9-beta — New detector: `unverified_success_assertion`

**Tag:** `aibrake-v0.5.9-beta`
**Base:** `aibrake-v0.5.8-beta`
**Goal:** catch the agent failure mode that 0.5.5–0.5.8's detectors do
NOT cover — agents confidently claiming success on operational outcomes
(deploy / install / restart / fix) without running any verification.

### Why now

Observed 2026-05-19: an agent ran `npm install aibrake@beta`, added
`import "aibrake/auto"` to a production Node entrypoint, ran `pm2
restart`, and reported "✅ deployed successfully" — on a package version
that didn't yet have the `aibrake/auto` export. The Node process was in
a crash loop, the agent had never `pm2 status`-ed or curled the endpoint.

Existing detectors (stale_context_retry_storm, same_tool_retry_loop,
model_escalation_without_evidence, objective_drift, task_budget_breach)
all reason about **paid LLM call** patterns. They can't see this — the
failure isn't a loop of LLM calls, it's a single confident wrong claim
about an operational action.

### Added

- **`src/detectors/unverified-success-assertion.ts`** — new detector,
  registered in `DEFAULT_DETECTORS` and re-exported from
  `aibrake/index.ts`.

  Fires when `next_action.type` is one of:
  ```
  success_assertion | deployment_assertion | install_assertion |
  restart_assertion | fix_assertion | claim_success | task_complete
  ```
  AND `history.evidence_signals` shows zero or one verification step
  among: `health_check_run`, `endpoint_curled`, `process_status_checked`,
  `logs_read_after_action`, `tests_run_after_action`,
  `file_re_read_after_edit`, `git_diff_verified`, `smoke_test_passed`.

  Decisions:
  - **2+ verifications** → detector returns `null` (lets the assertion pass)
  - **1 verification** → score ~40 → `warn`
  - **0 verifications** → score 75-95 → `require_confirmation`
  - **0 verifications + deployment_assertion or restart_assertion** →
    deterministic `block` (operational-stakes case)

  Reason text names the specific missing verifications so the agent
  gets actionable feedback ("Recommended: process_status_checked,
  endpoint_curled, logs_read_after_action").

- **`tests/detectors/unverified-success-assertion.test.ts`** — 7 tests
  covering the deterministic block, the soft warn, the pass case, and
  the don't-fire-on-paid_llm_call cross-category isolation check.

### Telemetry contract for partners

Partners using `aibrake/auto` get this detector for free on
`paid_llm_call` actions that include success-assertion-shaped reasons
(future enhancement — 0.5.9 only handles explicit `*_assertion` action
types). Partners writing manual integrations should:

1. Emit a check with `next_action.type = "deployment_assertion"` (or
   one of the other recognised types) right before their agent declares
   the task done.
2. Populate `history.evidence_signals` with whichever verifications
   the agent actually ran — e.g.
   `{ process_status_checked: true, endpoint_curled: true }`.

The detector trusts your telemetry. Honesty about what was/wasn't
verified is the entire mechanism.

### Verified

- 218/218 TS tests green (was 211 → +7 new tests on the detector).
- No changes to the existing detectors, so no risk of regression on
  the retry-storm / budget / drift catches that were calibrated against
  the simulation runs.

---

## 0.5.8-beta — `aibrake/auto`: one-line install for OpenAI + Anthropic

**Tag:** `aibrake-v0.5.8-beta`
**Base:** `aibrake-v0.5.7-beta`
**Goal:** make the partner-side integration one line of code instead of
five. The Sentry / New Relic pattern, applied to AI-agent guardrails.

### Why

Through 0.5.5-beta → 0.5.7-beta the integration story was:
"install the package, instantiate `SpendingGuard`, instantiate
`OpenClawAdapter`, build a check payload per call, wrap your LLM call
with `await guard.check(...)`, handle the decision." That's ~30 lines
of glue per project. Founder feedback after watching two independent
agents fail to follow even a single-command instruction: "people won't
bother."

The fix is monkey-patching, the pattern observability vendors have
used for a decade. Partner writes `import 'aibrake/auto'` once.
Every paid LLM call from `openai` and `@anthropic-ai/sdk` then routes
through AIBrake automatically — no wrappers, no per-call boilerplate.

### Added

- **`aibrake/auto`** — new side-effect entry point. Single import:
  ```ts
  import 'aibrake/auto';        // ← that's the entire integration
  import OpenAI from 'openai';   // existing code unchanged
  const client = new OpenAI();
  await client.chat.completions.create({ model: 'gpt-4o', messages });
  ```
  On import, it tries to dynamically import `openai/resources/chat/completions`
  and `@anthropic-ai/sdk/resources/messages`. For each one found, it
  monkey-patches the prototype's `create()` so every call passes
  through AIBrake first. Decisions print to stderr; in shadow mode
  (default) the call always proceeds.

- `src/auto/patch.ts` — patcher logic for both OpenAI and Anthropic.
  Idempotent (re-importing doesn't double-wrap). Falls back to silent
  no-op if the SDK isn't installed.

- `src/auto/history.ts` — per-process call history with prompt-hash
  fingerprinting + error-signature tracking. Capped at 200 entries
  to avoid memory leaks in long-lived processes.

- `src/auto/pricing.ts` — model → $/1k-token table covering the
  GPT-4 / o1 / Claude families. Used to populate
  `next_action.estimated_cost` for the AIBrake check.

- `src/auto/guard.ts` — lazy SpendingGuard singleton reading
  `AIBRAKE_API_KEY` / `AIBRAKE_URL` / `AIBRAKE_MODE` / `AIBRAKE_FAILURE_MODE`
  / `AIBRAKE_TIMEOUT_MS` from env. Backwards-compatible aliases:
  `AGENT_SPEND_GUARD_*` env vars are read if `AIBRAKE_*` are absent.

### Modes

- **Shadow** (default): every call gets a decision logged to stderr,
  the original call always proceeds. Recommended for the first week.
- **Hard** (`AIBRAKE_MODE=hard`): on `block` / `require_confirmation`
  the patched call throws before the network request, surfacing the
  AIBrake reason to the partner's exception handler.

### Verified

- 211/211 TS tests green (was 198 → +13 new tests on pricing, history,
  env config, and patch-shape primitives).
- `npm pack --dry-run`: tarball grew 95 kB → ~100 kB (+5 kB for the
  auto module compiled output).
- Existing `aibrake/sdk`, `aibrake/adapters/*`, `aibrake/server`, and
  the `aibrake` CLI binary unchanged — no API breaks.

### Peer dependencies (new, all optional)

```jsonc
"peerDependenciesMeta": {
  "openai":            { "optional": true },
  "@anthropic-ai/sdk": { "optional": true }
}
```

Partners who only use the SDK directly install nothing extra. Partners
using `aibrake/auto` install `openai` and/or `@anthropic-ai/sdk` for
their own work; auto-patch detects whichever is present.

---

## 0.5.7-beta — Client-only install (drops ~50 MB of fastify deps)

**Tag:** `aibrake-v0.5.7-beta`
**Base:** `aibrake-v0.5.6-beta`
**Goal:** make `npm install aibrake` fast (~2 sec) for the 95% of partners
who only use the SDK / adapters and never run their own AIBrake server.

### Why

After the founder watched OpenClaw take 30-60 seconds to install
aibrake@0.5.6-beta, profiling showed the dependency tree was dominated
by `fastify` (~50 MB transitive: @fastify/ajv-compiler, fast-json-stringify,
pino, @fastify/error, light-my-request, …). Fastify only matters if you
self-host an AIBrake instance with `buildServer()` — every other code
path (`SpendingGuard`, adapters, in-process `runCheck`, the `aibrake`
CLI) never touches it.

### Changed

- `fastify` moved from `dependencies` → `peerDependencies` with
  `peerDependenciesMeta.fastify.optional = true`. Clean `npm install
  aibrake` no longer pulls fastify. If a partner self-hosts:
  `npm install aibrake fastify` and they're back where they were.
- `buildServer` removed from the main `aibrake` export. New import path:
  ```ts
  import { buildServer } from "aibrake/server";  // requires `npm i fastify`
  ```
  This is the breaking change. Anyone importing `buildServer` from the
  package root (rare — only self-hosters) updates the path; the runtime
  behavior is identical.
- `package.json#exports` gained `"./server"` entry pointing at
  `dist/server.js`.

### Verified

- 198/198 TypeScript tests still green (tests import `buildServer`
  directly from `../src/server.js`, not via the package root — no
  test changes needed).
- `npm pack --dry-run`: tarball unchanged in size (same files), but
  `npm install aibrake` in a fresh project now pulls ~80 packages
  instead of ~280, and installed `node_modules/aibrake` is <1 MB
  instead of ~50 MB.

### Upgrade notes

| Before (0.5.6-beta)                                  | After (0.5.7-beta)                                   |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `import { buildServer } from "aibrake"`              | `import { buildServer } from "aibrake/server"`       |
| (fastify auto-installed)                             | `npm install fastify` if self-hosting                |
| 50 MB install                                        | <1 MB install                                        |

Partners using only `SpendingGuard` / `OpenClawAdapter` / `runCheck` /
the `npx aibrake demo` CLI do not need to change anything.

---

## 0.5.6-beta — `npx aibrake demo` (zero-setup CLI)

**Tag:** `aibrake-v0.5.6-beta`
**Base:** `aibrake-v0.5.5-beta`
**Goal:** make the first AIBrake interaction one command, not a code tour.

### Why

Founder feedback after the 0.5.5-beta publish: "you keep sending me code,
how do I just run a test, nobody is going to bother." Fair. Partners
shouldn't have to write a translator, set up an API key, or copy 30 lines
of TypeScript just to see what AIBrake does.

### Added

- **`bin/aibrake`** — CLI entry point exposed via the `bin` field in
  package.json. After `npm install aibrake`, partners can run:
  ```bash
  npx aibrake demo                # canonical retry-storm demo, no setup
  npx aibrake check input.json    # run Core check against a JSON file
  npx aibrake version
  npx aibrake help
  ```
- `npx aibrake demo` runs the stateless Core (`runCheck`) in-process —
  no API key, no network — and prints a formatted decision + projected
  savings for the canonical "$40 retry storm" scenario. Total time from
  `npm install` to seeing the decision: <30 seconds.

### Changed

- Version bumped 0.5.5-beta → 0.5.6-beta
- README install snippet now leads with `npx aibrake demo` instead of
  imports — the SDK example stays, but the first-touch story is the
  one-command demo

### Notes

The CLI uses zero runtime deps beyond what's already in the package
(no chalk, no commander) — raw ANSI codes + a tiny argv router. Keeps
the `bin` script <300 lines and `npm install aibrake` fast.

---

## 0.5.5-beta — npm publish: `aibrake`

**Tag:** `aibrake-v0.5.5-beta`
**Base:** `spending-guard-v0.5.4-beta`
**Goal:** first public npm release under the new brand. The package name `aibrake` was free on the registry, so we took it. No need for a scoped fallback.

### Changed

- **`package.json#name`:** `spending-guard` → `aibrake`
- **`package.json#license`:** `UNLICENSED` → `MIT` (SDK is permissively licensed; the hosted service is the paid product)
- **`package.json#private`:** removed (was `true` while we were repo-only)
- Added publish-ready metadata: `repository`, `homepage`, `bugs`, `keywords`, `author`, `files`, `prepublishOnly`
- Added top-level `LICENSE` file (MIT)
- Added `./adapters/coding-agent` to the `exports` map (was already in `src/`, just not declared as a public entry point)
- Version `0.5.4-beta` → `0.5.5-beta`

### Preserved (NOT renamed — backwards compat)

- API path prefix `/v1/*`, env vars `AGENT_SPEND_GUARD_*`, API key prefix `asg_v1_*`, SDK class name `SpendingGuard`, event type `spending_guard_decision`, service slug `agent-spend-guard`. See 0.5.4-beta entry below for the full preservation contract.

### Install

```bash
npm install aibrake
```

```ts
import { SpendingGuard } from "aibrake/sdk";
const guard = new SpendingGuard({ apiKey: process.env.AIBRAKE_API_KEY!, baseUrl: "https://api.aibrake.dev" });
```

---

## 0.5.4-beta — Rebrand to AIBrake

**Tag:** `spending-guard-v0.5.4-beta`
**Base:** `spending-guard-v0.5.3-beta`
**Goal:** rebrand the user-facing product from "Agent Spend Guard" to "AIBrake" ahead of production deploy on `aibrake.dev`. Technical identifiers preserved for backwards compatibility.

### Why now

Founder bought `aibrake.dev` on Cloudflare. Domain dictates the brand. The current marketing name "Agent Spend Guard" — three words, 17 characters — was a working title, not a final brand. With a short, ownable, pronounceable single-word domain in hand (`leash.dev` and `halt.com` weren't available; `aibrake.dev` was), the rebrand is the right move before going public. Doing it now (pre-partner) costs nothing; doing it post-partner costs partner-side `find-replace`.

### Changed

- **User-facing brand name:** `Agent Spend Guard` → `AIBrake` (39 files updated)
- **Domain placeholders:** `agentspendguard.com` / `agentspendguard.example` / `hello@agentspendguard.example` / `your-org/spending-guard` swapped to `aibrake.dev` / `api.aibrake.dev` / `hello@aibrake.dev` / `Askbsman/aibrake` (11 files)
- **`/v1/meta.name`** now returns `"AIBrake"` (was `"Agent Spend Guard"`)
- **Tagline:** *"PQS checks the prompt. AIBrake checks the loop."* (single-word brand fits the cadence better)
- **Landing copy, FAQ, partner docs, README, CLAUDE.md** — all user-facing surfaces refreshed
- Version bumped `0.5.3-beta` → `0.5.4-beta` / `0.5.3b0` → `0.5.4b0`

### Preserved (NOT renamed — backwards compat)

This is the discipline: a marketing rebrand should not break an existing partner's integration. Every technical identifier that could be hardcoded in partner code stays as-is:

- **npm package:** `spending-guard` (historical; matches `IMPLEMENTATION_NOTES.md § 13`)
- **Python package:** `agent-spend-guard` (PyPI hold)
- **TS SDK class:** `SpendingGuard`
- **Python SDK class:** `AgentSpendGuard`
- **Env prefix:** `AGENT_SPEND_GUARD_*`
- **API key prefix:** `asg_v1_*`
- **Service slug in /health:** `agent-spend-guard`
- **Decision log event_type:** `agent_spend_guard.check.completed`
- **Detector / policy version strings:** unchanged (`policy@0.1.0`, `<detector>@x.y.z`)
- **Historical CHANGELOG entries:** unchanged — they reference "Agent Spend Guard" because that was the name at the time. New entries (this one and forward) use "AIBrake."
- **Historical reports** (`SELF_TRIAL_*`, `BENCHMARK_10_AGENTS`, `SIMULATION_*`): preserved verbatim. They document moments in time using the name from that moment.
- **Tests:** test files preserved verbatim — they use `asg_v1_demo` and example.com as fixtures, not as branding state.

### Migration note for partners

If you integrated AIBrake (then "Agent Spend Guard") at `0.5.x`:
- No code changes required
- Your `asg_v1_*` API key continues to work
- Your env vars (`AGENT_SPEND_GUARD_*`) continue to work
- `/v1/check` contract unchanged
- The only thing that moved is the marketing domain — point the SDK at the new URL when we publish it (`https://api.aibrake.dev` instead of the localhost/example URL you had during beta)

### Files touched

39 brand swaps + 11 domain swaps + 4 version bumps + 1 CHANGELOG entry = 1 logical change, 4 commits:
1. `chore: configure production placeholders (aibrake.dev)` — 11 files
2. `chore: rebrand to AIBrake (39 user-facing files)` — 39 files
3. `chore: bump to 0.5.4-beta + CHANGELOG entry` — 5 files
4. Tag `spending-guard-v0.5.4-beta` (annotated)

### Verification

- TS suite: 198 / 198 (no test changes; tests that asserted brand string updated automatically through the rename script)
- Typecheck: clean
- Python: 35 / 35 still expected (Python source touched via docstrings only)
- Brand mark (SVG logo + favicon + OG card): unchanged — semantic-neutral hex+loop+dot design works for both brands
- `/v1/meta.name`: returns `"AIBrake"`
- `/health`: still returns `"service": "agent-spend-guard"` (slug preserved)

### One-shot scripts

`scripts/_apply-aibrake.mjs` and `scripts/_apply-aibrake-rename.mjs` performed the bulk swap. Both are committed for transparency; safe to delete after this tag lands. Their `PRESERVE` lists are the authoritative record of which files were excluded from the swap and why.

---

## 0.5.3-beta — Public stats endpoint + site polish

**Tag:** `spending-guard-v0.5.3-beta`
**Base:** `spending-guard-v0.5.2-beta`
**Goal:** make the savings visible *outside* the partner integration — a live public counter on the landing page, fed by a real endpoint, plus the site polish needed to actually show this to a blogger.

### Added

- **`GET /v1/public/stats`** — new unauthenticated, CORS-friendly read-only endpoint that returns aggregated statistics from the JSONL decision log:
  ```jsonc
  {
    "service": "agent-spend-guard",
    "version": "0.5.3-beta",
    "total_checks": 1133,
    "total_savings_offered_usd": 103.16,
    "total_cost_observed_usd": 99.30,
    "events_with_savings": 265,
    "decisions": { "allow": 868, "warn": 0, "require_confirmation": 237, "block": 28, "delay": 0, "uncertain": 0 },
    "savings_by_pattern": { "stale_context_retry_storm": 101.08, "objective_drift": 2.08 },
    "savings_by_basis":   { "projected_future_attempts": 101.08, "next_attempt_avoided": 2.08 },
    "generated_at": "2026-05-16T20:34:00.458Z",
    "log_present": true
  }
  ```
  - **No per-partner data** in the response. No `request_id`, no `api_key_hash`, no `objective_id`, no `actor_runtime`. Only patterns / bases / aggregates. Pinned by test PS08.
  - In-process 30s TTL cache + file-mtime fast path so the endpoint stays cheap even under landing-page traffic.
  - CORS: `access-control-allow-origin: *` plus an `OPTIONS` preflight handler returning 204.
  - `cache-control: public, max-age=30` so a CDN in front of the API can absorb most of the load.
- **`/v1/meta.endpoints.public_stats`** advertised for discoverability.
- **Landing page (`web/index.html`)** got a substantial pass:
  - **Live savings counter** in the hero — animated, fetches `/v1/public/stats` on load + every 60 s, falls back to the 10-agent benchmark numbers if the API is unreachable (no broken zero state). Re-flow animation on each successful update.
  - **§04 Integrate** — tabbed code example (TypeScript / Python / curl) with the actual 5-line integration. Real fields, real expected output.
  - **§09 FAQ** — 10 questions covering latency, fail-open semantics, what's logged, vs PQS / Boundary Guard / x402station, evidence model, threshold tuning, savings semantics, model coverage, pricing, source-open posture.
  - **Favicon** — inline SVG, no extra request.
  - **OG / Twitter meta** — title, description, type, site_name, summary_large_image card.
  - **Canonical URL** + `theme-color`.
  - Section numbers renumbered to fit Integrate and FAQ in.

### Changed

- Bumped `0.5.2-beta → 0.5.3-beta` / `0.5.2b0 → 0.5.3b0` in `package.json`, `src/config/env.ts`, `tests/routes.test.ts`, `tests/stage-03-hosting.test.ts`, `python/pyproject.toml`, `python/agent_spend_guard/__init__.py`, and the README banner.

### Tests

- New: `tests/stage-05-3-public-stats.test.ts` — **10 tests** (PS01–PS10):
  - PS01: empty-log case returns valid shape with `log_present: false`.
  - PS02: unauthenticated even in `auth=required` mode (the protected endpoints still 401).
  - PS03: CORS headers (`access-control-allow-origin: *`, `cache-control: max-age=30`).
  - PS04: OPTIONS preflight returns 204 with CORS headers.
  - PS05: aggregates total_checks, decisions histogram, total cost.
  - PS06: sums savings into total + by-pattern + by-basis (exact math).
  - PS07: ignores malformed lines and unrelated event_types.
  - PS08: **does not leak** `request_id` / `api_key_hash` / `objective_id` / `actor_runtime` / `input_hash` (asserted against the response body text directly).
  - PS09: serves cached response on rapid re-calls.
  - PS10: `/v1/meta.endpoints.public_stats === "/v1/public/stats"`.
- TS unit: **198 / 198** (was 188, +10). Typecheck clean.
- Python: **35 / 35** on Python 3.14.5 — unchanged, version bump only.

### Not changed (deliberately)

- No new detectors. No paid `/x402/v1/check`. No new adapters.
- The public stats endpoint exposes ONLY aggregates. Per-partner / per-objective dashboards stay deferred until there's real volume.

### Verification

- `/health`: returns `version: "0.5.3-beta"`.
- `/v1/public/stats`: returns the live `$103.16 / 1133 / 265` triple seeded by the 10-agent benchmark log.
- Landing page counter: animates from seed → live values when API reachable; falls back to seed values cleanly when unreachable.

---

## 0.5.2-beta — Savings Visibility

**Tag:** `spending-guard-v0.5.2-beta`
**Base:** `spending-guard-v0.5.1-beta`
**Goal:** turn every catch into a $-denominated decision. Three additions, no new detectors, no new adapters, no x402 payment integration.

### Added

- **`projected_savings` on every non-`allow` /v1/check response.** New optional field on `SpendingGuardCheckOutput`:
  ```jsonc
  "projected_savings": {
    "amount_usd": 1.26,
    "currency": "USD",
    "basis": "projected_future_attempts",          // or "model_downgrade_delta" / "next_attempt_avoided"
    "explanation": "Stopping this stale_context_retry_storm avoids an estimated 3 more paid attempt(s) at $0.42 each ($1.26 total) until the agent gathers new evidence."
  }
  ```
  Three explainable computation paths, picked deterministically:
  - **`model_downgrade_delta`** — `suggested_action.model_route.to.estimatedCostUsd` is set → savings = primary cost − secondary cost. If no explicit cost on the target, fall back to a 60% reduction estimate (labeled as such in the explanation).
  - **`projected_future_attempts`** — `pattern === "stale_context_retry_storm"` with `paid_attempts_on_same_failure >= 1` → savings = `next_action.estimated_cost × min(3, repeats)`. The "3" cap is deliberate — past three attempts we're guessing.
  - **`next_attempt_avoided`** — every other warn / require_confirmation / delay / block → savings = single next attempt cost. Conservative default.
  - `allow` always omits the field. `uncertain` omits it (low confidence; not promising a number we can't defend).
  - Zero-cost actions also omit the field (avoid nonsense).
- **`/v1/meta.default_downgrade_map`** advertises the heuristic downgrade table consulted by `model_escalation_without_evidence@0.3.0` when the partner has not declared `objective.model_policy.secondaryModel`. Nine entries covering Anthropic premium / OpenAI premium / generic "ultra" tier. Each entry exposes `matches` (regex source), `flags`, and `to: { provider, model, tier, estimatedCostUsd }` so partners can audit before relying on it.
- **`model_route` with default target** — the detector now emits a `switch_model` suggestion with a default route when no `secondaryModel` is declared but the model matches the map. `route.reason` explicitly flags it as `"Default downgrade target (no objective.model_policy.secondaryModel declared)"` so partners know it's heuristic. `result.metadata.used_default_downgrade: true` for log audit.
- **`logs:summary` savings aggregation.** The CLI now sums `projected_savings_usd` from the JSONL log into:
  ```
  savings_offered: $X.XX total ($X.XX avg per event)
  savings_by_pattern: { stale_context_retry_storm: $X.XX, model_escalation: $X.XX, ... }
  savings_by_basis:   { projected_future_attempts: $X.XX, model_downgrade_delta: $X.XX, ... }
  cost_observed:      $X.XX total across N events
  ```
- **`ModelRef.estimatedCostUsd`** — optional field on `ModelRef`. Set on `secondaryModel` to get a precise `model_downgrade_delta` instead of the 60% fallback.
- **Decision log fields** — JSONL log line now includes `next_action_cost_usd`, `projected_savings_usd`, `projected_savings_basis` so the CLI can aggregate without re-running detectors.

### Changed

- **`model_escalation_without_evidence` bumped `@0.2.0 → @0.3.0`** — default downgrade map fallback added. Old behavior (plain `downgrade_model` suggestion with no `model_route` when no secondary declared) is gone — operators always get an actionable target now, marked as default when it came from the map.
- **`policy_version` stays `policy@0.1.0`** — aggregation and decision policy unchanged.
- Two pre-existing tests pinned the old 0.2-era "plain downgrade_model" suggestion. Updated to assert the new contract:
  - `tests/model-policy.test.ts` § 06 → now asserts `switch_model` + default route + `used_default_downgrade: true`. Added § 06b pinning that the OLD behavior (plain `downgrade_model`, no route) still applies when the model name matches no entry in the default map.
  - `tests/stage-03-1-calibration.test.ts` § 05 → asserts `switch_model` with `claude-opus → claude-sonnet-4.5` from the default map.

### Tests

- New: `tests/stage-05-2-savings-visibility.test.ts` — **15 tests** covering S1-S15:
  - S1: cold-start allow has NO `projected_savings`
  - S2: stale-context fires `projected_future_attempts`, exact math `cost × min(3, repeats)`
  - S3: explicit secondary with `estimatedCostUsd` → precise `model_downgrade_delta`
  - S4: secondary without cost → conservative 60% estimate (labeled)
  - S5: deterministic block (objective_drift) → `next_attempt_avoided`
  - S6: cents rounding
  - S7: zero-cost action → no savings field
  - S8-S11: `/v1/meta.default_downgrade_map` shape; detector consumes it; metadata flags
  - S12: `logs:summary` aggregates savings across events
  - S13: malformed log lines skipped
  - S14-S15: backwards compat — `allow` response shape unchanged; non-allow carries both structured savings AND original `suggested_action`
- TS unit: **188 / 188** (was 172, +16). Typecheck clean.
- Python: **35 / 35** on Python 3.14.5. No Python-side changes — the SDK already returns the dict whole, so `result["projected_savings"]` is available without code changes.
- Audit + harness: unchanged, still 14 / 14 + 36 / 36.

### Not changed (deliberately)

- No new detectors. The `wasteful_repeated_work` detector (E3/E8 self-trial gap) stays deferred until real partner data.
- No paid `/x402/v1/check` endpoint. The savings number is itself the unlock — partners can decide if guard is worth paying for after seeing 7 days of `npm run logs:summary` output.
- No adaptive thresholds. Static per-objective overrides via `detector_policy` remain the only knob.

### Honesty disclosure

The 60% fallback ratio in `model_downgrade_delta` is a heuristic anchored on typical premium-vs-cheap pricing (opus/sonnet → haiku, gpt-4 → gpt-4o-mini ≈ 5-10x cheaper). It is **labeled as conservative** in the explanation string. Partners who care about precise numbers should declare `estimatedCostUsd` on their `secondaryModel` — the detector will use it verbatim.

The `DEFAULT_DOWNGRADE_MAP` itself will go stale as providers re-price. It is exposed via `/v1/meta` precisely so partners can audit and override. Treat it as discovery, not authoritative routing.

### Verification

- `/health`: returns `version: "0.5.2-beta"`.
- `/v1/meta.default_downgrade_map`: 9 entries advertised.
- `/v1/check` on a stale-context retry storm with $0.42 cost + 6 paid repeats: returns `projected_savings: { amount_usd: 1.26, basis: "projected_future_attempts", ... }` (verified live).
- TS suite: 188 / 188; typecheck clean.
- Python suite: 35 / 35 on Python 3.14.5.

---

## 0.5.1-beta — Adapter evidence-window calibration

**Tag:** `spending-guard-v0.5.1-beta`
**Base:** `spending-guard-v0.5.0-beta`
**Goal:** fix one calibration finding from the self-trial (`SELF_TRIAL_CLAUDE_CODE_REPORT.md` § 4.1, E2). No new features, no new detectors, no new adapters.

### Fixed

- **`CodingAgentAdapter.buildCheckInput` now includes the current attempt's own evidence annotations in the "since last attempt" window.** Pre-0.5.1 the window was strictly *between* prior same-failure events, which produced a false-positive `warn` on the most common partner integration pattern — read failing file, edit source, retry. The agent annotated rich evidence on the new attempt itself, but the adapter treated that evidence as belonging to the new attempt's boundary rather than the gap, so `new_evidence_since_last_attempt` came out `false`.

  The fix in `src/adapters/openclaw/adapter.ts` folds the current attempt's `filesRead`, `testsRun`, `logsRead`, `gitDiffChanged`, `toolResultsChanged`, and `contextSourceConfirmed` into the count. Window semantics become `(lastSameFailure, now]` — inclusive on the new-side boundary, exclusive of the prior failure event itself.

### Verification

- **Self-trial E2 flipped from `warn` → `allow`.** Re-running `npx tsx scripts/self-trial-guard.ts` against the live `:8080` 0.5.1-beta server: same 10 scenarios, same harness, no change to scenario definitions. Summary went from `allow=6 warn=1 req_confirm=2 block=1` (0.5.0) to `allow=7 warn=0 req_confirm=2 block=1` (0.5.1). The two real catches (E1 Docker poll storm, E10 hypothetical opus escalation) and the deterministic block (E7) all preserved.
- **TS suite: 172 / 172** (was 162; +10 new in `tests/stage-05-1-adapter-evidence-window.test.ts`). The new tests cover each evidence signal in isolation (filesRead / testsRun / logsRead / gitDiffChanged / toolResultsChanged / contextSourceConfirmed), the no-evidence regression case, the end-to-end E2 reproduction, and the cold-start `null` semantics (preserved).
- **TS typecheck:** clean.
- **Python suite: 35 / 35** on Python 3.14.5 (no change — fix is TS-only).
- **Audit + harness:** unchanged scope.

### Not changed (deliberately)

- No detector logic touched. The fix is local to the adapter — the same Core check that ran on 0.5.0 runs on 0.5.1. The difference is the adapter populates `new_evidence_since_last_attempt` more accurately.
- No new detectors, no new adapters, no SDK changes (the SDKs' contract with Core is unchanged).
- The "false-negative" cases from the self-trial (E3, E4, E8 — redundant work without failure signal) **remain not flagged**, per the report's recommendation to wait for real-partner production logs before introducing a `wasteful_repeated_work` detector.
- Pre-0.5.1 callers that relied on the strictly-between-attempts semantics see only one observable behavior change: `new_evidence_since_last_attempt` becomes `true` more often when the current attempt is annotated. This is the intended direction — it makes the universal evidence model match the obvious partner mental model. No deprecation needed; no payload-shape change.

### Behaviour delta — one-line summary

```
Before: `new_evidence_since_last_attempt` = evidence annotated on events BETWEEN same-failure attempts.
After : `new_evidence_since_last_attempt` = evidence annotated BETWEEN attempts OR on the current attempt.
```

---

## 0.5.0-beta — Partner-Ready Hardening

**Tag:** `spending-guard-v0.5.0-beta`
**Goal:** remove final integration friction before real partners use the hosted beta. No new detectors, no new adapters, no dashboard. Three workstreams: discoverable `detector_policy` knobs via `/v1/meta`, structured `details` on every SDK error, and partner-facing docs around error behavior and threshold guidance.

### Verification — both sides green

- **TypeScript:** 162 / 162 unit tests; typecheck clean.
- **Python (Python 3.14.5 on Windows):** 35 / 35 tests — 19 `test_client.py` unit + 4 `test_integration.py` against live `:8080` + 12 new `test_stage_05_error_kinds.py`. Verification command: `cd python && py -m pip install -e ".[dev]" && py -m pytest`.

### Late fix during Python verification

After Python 3.14 became available on the host, `py -m pytest` surfaced two failures in `tests/test_client.py` (`test_06_check_shadow_swallows_transport_error`, `test_06b_check_shadow_swallows_timeout_error`). These tests mock `_invoke` to raise `urllib.error.URLError` / `TimeoutError` *directly*, bypassing `_invoke`'s wrap-as-`SpendingGuardTransportError` logic. The Stage 0.5 narrow-catch in `check_shadow()` only caught `SpendingGuardTransportError`, which let raw `URLError` / `TimeoutError` propagate when they should synthesize allow.

Fix: broaden the narrow-catch tuple in `check_shadow` to `(SpendingGuardTransportError, urllib.error.URLError, TimeoutError, OSError)` — still explicit, still no bare `except Exception`, and explicitly matches the spec contract ("URLError / TimeoutError / OSError / SpendingGuardTransportError → synthetic allow"). Programmer errors (`TypeError`, `ValueError`, `json.JSONDecodeError`) and `SpendingGuardValidationError` (server-side 4xx) still propagate.

### Added

- **`/v1/meta` exposes `detector_policy.supported_fields`.** Partners can discover the four tunable knobs (`same_tool_retry_threshold`, `premium_retry_without_evidence_threshold`, `expensive_action_usd_threshold`, `require_confirmation_after_repeats`) without grepping the source. Each field carries `type` / `default` / `min` / `recommended_range` / `description`. A worked `example` block ships alongside `supported_fields` showing tighter thresholds (e.g. `same_tool_retry_threshold: 3` for expensive-per-call agents). `/v1/meta` remains discovery-only; runtime is still driven by the request's `objective.detector_policy`.
- **TypeScript SDK: structured `details` on every error.** New `SpendingGuardErrorKind` union (`transport | validation | http_4xx | http_5xx | serialization | parse | blocked | confirmation_denied | unknown`) and `SpendingGuardErrorDetails` interface (`kind`, `statusCode`, `code`, `requestId`, `retryable`, `message`). Every SDK error subclass (`SpendingGuardBlockedError`, `SpendingGuardConfirmationDeniedError`, `SpendingGuardTransportError`, `SpendingGuardValidationError`) now exposes a `.details` block. Partners can `catch (err)` once and branch on `err.details?.kind` / `err.details?.retryable` instead of importing every subclass.
- **Python SDK: matching structured attributes.** New `SpendingGuardError` base class with `.kind` / `.status_code` / `.retryable` / `.code`. Existing errors (`SpendingGuardTransportError`, `SpendingGuardValidationError`, `SpendingGuardBlockedError`, `SpendingGuardConfirmationDeniedError`) all subclass it. Kind constants exported at package level (`KIND_TRANSPORT`, `KIND_VALIDATION`, `KIND_HTTP_4XX`, `KIND_HTTP_5XX`, `KIND_BLOCKED`, `KIND_CONFIRMATION_DENIED`, etc.) so partners can use string-literal comparisons against typed names.
- **Python SDK: 4xx now propagates as `SpendingGuardValidationError` instead of routing through `failure_mode` (matches TS 0.4.2).** Server-side 4xx means the guard saw the request and rejected it — propagate so the partner fixes their integration. Previously the Python SDK lumped HTTP 4xx and 5xx into the same handler. The new contract matches the TS SDK: 4xx propagates, 5xx (and network errors) wrap as `SpendingGuardTransportError` and route via `failure_mode`.
- **PARTNER_ONBOARDING.md**: "Choosing detector_policy thresholds" section with concrete recommendations for scraper / coding / premium-routing agents; "SDK error behavior" section explaining fail-open scope.
- **PYTHON_SDK.md, DEPLOYMENT.md**: documented `python -m pytest` smoke command + the `python -c "from agent_spend_guard import AgentSpendGuard; print('ok')"` self-check.

### Changed

- README banner: `Stage 0.5 Partner-Ready Beta` / `Version: 0.5.0-beta`. Tag references updated.
- Bumped versions to `0.5.0-beta` / `0.5.0b0` across `package.json`, `src/config/env.ts`, `tests/routes.test.ts`, `tests/stage-03-hosting.test.ts`, `python/pyproject.toml`, `python/agent_spend_guard/__init__.py`, and the README banner.
- `python/tests/test_integration.py`: `test_int_04_invalid_key_returns_401_handled_as_failure_open` renamed to `test_int_04_invalid_key_returns_401_propagates_with_http_4xx_kind`; the test now asserts `SpendingGuardValidationError` with `kind == "http_4xx"` instead of synthetic allow. Documents the Stage 0.4.2 / 0.5 contract.

### Tests

- New: `tests/stage-05-partner-ready-hardening.test.ts` — **14 tests** covering `/v1/meta.detector_policy.supported_fields`, `details.kind` on every error path, BigInt programmer-error propagation contract, and confirmation-denied / blocked discriminators.
- New: `python/tests/test_stage_05_error_kinds.py` — **12 Python tests** mirroring the TS contract. Source written; **execution deferred** per the disclaimer above.
- TS unit tests: **162 / 162** (was 148; +14). ≥ 158 target met.
- TS typecheck: clean.
- Audit scenarios: 14 / 14 (unchanged; Stage 0.5 has no detector changes).
- Harness: 36 / 36 (unchanged).
- Python tests: **35 / 35** passing on Python 3.14.5 (19 unit + 4 integration + 12 Stage 0.5).

### Not changed (deliberately)

- Fail-open semantics. Still applies only to transport / server-availability failures (Stage 0.4.1 / 0.4.2 contract preserved). Programmer errors and 4xx still propagate.
- No new detectors, no new adapters, no dashboard, no database, no full x402, no billing.
- `/v1/meta` is still discovery-only; runtime is still per-request.
- No PyPI publish.

### Verification (re-stated at end)

- `/health`: returns `version: "0.5.0-beta"`.
- `/v1/meta`: returns `detector_policy.supported_fields` with all four knobs + `example`.
- TS suite: 162 / 162; typecheck clean.
- Python suite: 35 / 35 on Python 3.14.5 (19 unit + 4 integration vs live `:8080` + 12 Stage 0.5).

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
