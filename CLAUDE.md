# CLAUDE.md — AIBrake project contract

This file is the contract between the founder and any AI assistant (including Claude Code) working in this repository. If anything anywhere contradicts this file — **this file wins**.

This is not the AIVID CLAUDE.md. That's a separate project at `C:\Users\777\Desktop\AIVID\`. The two share neither code, nor architecture, nor scope. If a Claude Code session has both directories visible — pay attention to which one's CLAUDE.md you're reading.

---

## 1. What this project is

**AIBrake** — pre-flight loop detection and model stop-loss for paid AI agents.

- npm package: `spending-guard`
- Python package: `agent-spend-guard`
- Service brand: `agent-spend-guard`
- Env prefix: `AGENT_SPEND_GUARD_*`

The historical name `spending-guard` is preserved on the npm package (it predates the rename); the user-facing product name everywhere else is **AIBrake**.

**The wedge in one line:** *PQS checks the prompt. AIBrake checks the loop.*

**Not a budget counter.** A judgment layer. Catches:
- Retry storms on the same deterministic failure with no new evidence
- Same-tool loops without diagnostic steps between calls
- Premium-model escalation when no new evidence has been gathered
- Objective drift (out-of-scope action / explicit `blocked_actions` violation)
- Hard budget breach (the only deterministic blocker by default)

Provider-agnostic. Stateless Core. ~5 ms median per check.

---

## 2. Current state

```text
tag:        spending-guard-v0.5.3-beta
service:    agent-spend-guard
version:    0.5.3-beta
TS tests:   198 / 198, typecheck clean
Python:     35 / 35 on Python 3.14.5
audit:      14 / 14
harness:    36 / 36
mode:       hosted beta (invite-only, shadow-first)
auth:       Bearer token, partner-issued keys
log sink:   JSONL with hashes-and-counts only
public:     GET /v1/public/stats (no auth, CORS, 30s cache)
```

Real partners onboarded so far: **zero**. The 10-partner numbers in `BENCHMARK_10_AGENTS.md` / `SIMULATION_10_PARTNERS_REPORT.md` are a simulation with honest disclosures, not customer data.

---

## 3. Stack

Do not deviate without explicit approval.

| Layer | Choice |
| --- | --- |
| Server | Fastify 4.x + Zod 3.x |
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) |
| Tests | Vitest (TS) + pytest (Python) |
| Dev runner | `tsx` (no build step in dev) |
| Python SDK deps | **stdlib only** (urllib, json). No `requests`, no `httpx`, no `aiohttp`. |
| Logging sink | JSONL file, fail-safe, pluggable via `setLoggerSink` |
| Auth | single `Authorization: Bearer <key>` header, env-loaded keys |
| Rate limit | per-key sliding window, in-memory, ~600 req/min default |
| Versioning | `policy@x.y.z`, `<detector>@x.y.z`, `fp_v1_*` fingerprint family |
| Persistence | filesystem (JSONL). **No database.** |
| Hosting target | any Node 20 container, 256 MB RAM enough |

Monorepo layout:

```text
src/
  core/                 stateless judgment engine
    types.ts            public TS surface
    schemas.ts          Zod input validation
    check.ts            runCheck() — the only function routes call
    policy.ts           aggregation, legal pairs, score→decision
    confidence.ts       coverage × signal_quality × base
    fingerprints.ts     fp_v1_*, input_v1_* helpers
    logger.ts           pluggable structured log sink
  detectors/
    stale-context-retry-storm.ts
    task-budget-breach.ts
    same-tool-retry-loop.ts
    model-escalation-without-evidence.ts
    objective-drift.ts
  routes/
    health.ts
    meta.ts             GET /v1/meta (advertises detector_policy + DEFAULT_DOWNGRADE_MAP + endpoints)
    public-stats.ts     GET /v1/public/stats (aggregate-only, no auth)
    check.ts            POST /v1/check
    check-deep.ts       POST /v1/check-deep (stub)
  sdk/
    client.ts           SpendingGuard class, 4 helpers, structured errors
    errors.ts           5 error classes, all with `.details.kind`
  adapters/
    openclaw/           stateful per-objective history tracker
    hermes/             alias of openclaw
    coding-agent/       alias of openclaw (post-Stage-0.4 export name)
  payments/             x402 stubs (not active)
  middleware/           auth, rate-limit
  sinks/                jsonl-sink
  config/env.ts         typed env loader
  cli/logs-summary.ts   `npm run logs:summary` aggregator

python/agent_spend_guard/
  __init__.py           exports + KIND_* constants
  client.py             AgentSpendGuard (urllib only)
  errors.py             SpendingGuardError base + 4 subclasses, all with .kind/.status_code/.retryable

tests/                  198 TS specs
python/tests/           35 Python specs (3 files: client, integration, error_kinds)
scripts/                self-trial-guard.ts, simulate-10-partners.ts
web/                    index.html (static landing, no framework, no dependencies)
examples/               runnable demo payloads + scripts
```

---

## 4. Architecture rules

These are NOT up for discussion. Breaking them is a code-review reject.

### 4.1. Core is stateless

`runCheck(input): SpendingGuardCheckOutput` is a pure function. No module-level mutable state in `src/core/**`. Detectors are pure functions over the input. History tracking lives in the **adapter**, on the partner's side of the wire.

### 4.2. Adapter = telemetry + history translator. Nothing more.

The adapter (`CodingAgentAdapter` / `OpenClawAdapter` / `HermesAdapter` — all the same class) records partner-side telemetry events, computes derived counters (`same_failure_count`, `paid_attempts_on_same_failure`, etc.), and produces a Universal Core Input shape. It does NOT make decisions and does NOT call the LLM.

### 4.3. Universal evidence model — sacred

Every action carries six evidence annotations on the **current** attempt:
- `filesRead.length`
- `testsRun.length`
- `logsRead.length`
- `gitDiffChanged` (bool)
- `toolResultsChanged` (bool)
- `contextSourceConfirmed` (bool)

Any one of them being non-zero / true is what distinguishes *"agent learned something"* from *"agent retried blindly"*. This is the entire Stage 0.5.1 calibration — the `newEvidence` computation MUST credit current-attempt evidence, not only between-attempt evidence.

### 4.4. Fail-open scope is narrow

The SDK's `failureMode: "open"` synthesizes a `decision: allow, pattern: "guard_unavailable"` ONLY for transport-class failures:
- Network errors (DNS, connection refused, timeout, abort)
- HTTP 5xx responses

It does NOT fail open on:
- Server-side 4xx (validation, auth) — propagates as `SpendingGuardValidationError`
- `JSON.stringify` errors (BigInt, circular refs) — propagates as `TypeError`
- Any other programmer error — propagates as itself

This is the Stage 0.4.1 / 0.4.2 / 0.5 hardened contract. Broadening the catch to `except Exception` is a regression.

### 4.5. Per-request `detector_policy`, not server state

Detector threshold overrides (`same_tool_retry_threshold`, `premium_retry_without_evidence_threshold`, `expensive_action_usd_threshold`, `require_confirmation_after_repeats`) travel inside the request payload under `objective.detector_policy`. The Core never stores them. No partner-specific config sticks to a server key. This keeps the Core stateless.

`/v1/meta.detector_policy.supported_fields` advertises the schema for discoverability. Discovery only. Runtime is still per-request.

### 4.6. SDK contract — 4 helpers, structured errors

```ts
guard.check(input)            // returns result, never throws on a decision
guard.checkShadow(input)      // same, synthesizes allow on transport failure
guard.checkOrConfirm(input)   // throws Blocked on block, calls onWarn on warn/req_confirm
guard.checkOrDowngrade(input) // auto-applies model_route.to from response
```

Every error class exposes a structured `details` block (TS) or `.kind` / `.status_code` / `.retryable` attributes (Python). Partners catch once and branch on `err.kind`, not on `instanceof`.

### 4.7. `projected_savings` is offered, not realized

Every non-`allow`, non-`uncertain` response with a cost-bearing `next_action` carries `projected_savings.amount_usd` with one of three explainable bases. The Core never invents a price — all numbers derive from partner-supplied `next_action.estimated_cost` and `history.paid_attempts_on_same_failure`.

The CLI / public stats endpoint sum **offered** savings. The guard cannot know which recommendations the partner heeded; that data lives in the partner's outcome log, not in the guard's decision log.

### 4.8. Versioned everything

`policy_version` and `detector_version` ship in every `/v1/check` response. Partners pin these in production. Behavior drift between server upgrades is detectable. New detectors / new policy = new version string.

### 4.9. Privacy by design

The decision log records **hashes and counts only**:
- `input_hash` (sha256-16 of canonical input) — not the input
- `api_key_hash` (sha256-16 of raw key) — not the key
- Partner-supplied labels (`objective_id`, `actor_runtime`) — accepted as-is
- Decision + pattern + matched_rules + cost + projected_savings

The decision log NEVER records:
- Raw prompts
- Source file contents (only `filesRead.length`)
- Test output bodies (only `failure_signal_type` enum + fingerprint)
- API keys
- PII / customer messages

`/v1/public/stats` exposes only aggregates. No per-partner identifiers. Pinned by test PS08.

### 4.10. Hard rules — no exceptions

- **No bare `except Exception`** in Python SDK. Always a typed tuple.
- **No SDK silently allows on a 4xx.** Stage 0.4.1/0.4.2 contract.
- **No partner identifiers in `/v1/public/stats`.** Test PS08 must keep passing.
- **No raw payloads in the decision log.** Hashes and counts only.
- **No detector with server-side mutable state.** Adaptive thresholds = post-0.7 if ever.

---

## 5. Discipline rules

### 5.1. Stage 0.5 closing rule

> *"After Stage 0.5, do not continue internal engineering unless a real partner gives specific feedback."*

This rule is currently **paused under explicit founder override** (the 0.5.1 / 0.5.2 / 0.5.3 work was acknowledged as "no waiting for partner — improving"). It remains the default. When the founder is quiet, the default is **hold**.

If you start to think *"let me add a wasteful_repeated_work detector while I'm here"* — stop. That detector is the explicit E3/E8 gap from the self-trial report. It's deferred until real partner traffic tells us it matters.

### 5.2. Architectural review before code

Every stage spec (`STAGE_0_X_*_SPEC.md` arriving from outside the repo) gets an ADR-style review before any code is written:
1. Identify load-bearing decisions in the spec
2. Identify what's missing or over-scoped
3. Propose 1-3 variants (verbatim / with N modifications / minimal / hold)
4. Surface to founder via `AskUserQuestion` for selection
5. **Then** implement

The history of this pattern is in `IMPLEMENTATION_NOTES.md` § 14 (Stage 0.3 with 4 reviewer modifications), § 15 (Stage 0.4), § 18 (Stage 0.5), etc. Read those before proposing a new stage — they show the right shape of architectural review.

### 5.3. Honesty disclosures over hype

If you ship a partial stage — say so loudly in CHANGELOG + README + IMPLEMENTATION_NOTES. The Stage 0.5 "tag deferred, Python verification could not run" disclosure was the right pattern. Don't tag a release that doesn't meet § 11 acceptance criteria. Don't claim "real users" when the data is from a simulation harness.

When the founder asks for marketing copy that would require lying ("write it like these were real users"): **push back, offer the honest version that uses the same numbers, then write that.** The `BENCHMARK_10_AGENTS.md` is the template — methodology section included.

### 5.4. Self-trial before partner

Before exposing a behavior to an external partner, dogfood it against your own work. `SELF_TRIAL_CLAUDE_CODE_LOG.md` + `SELF_TRIAL_CLAUDE_CODE_REPORT.md` are the prior art. The trial surfaced one calibration finding (E2) that became Stage 0.5.1 — that's the goal of the exercise.

### 5.5. Spec → variant → implement → verify → commit → tag

Every stage follows this sequence. Skipping verification before tag = doing it wrong. Each version is one coherent feature, not a grab-bag.

| Version | Theme |
| --- | --- |
| 0.1.x | Universal Core, first detector, SDK skeleton |
| 0.2.0 | Premium model awareness |
| 0.3.0 | Hosted beta — auth, rate limit, JSONL, /v1/meta |
| 0.3.1 | Calibration patches before partners |
| 0.4.0 | Real integration layer — Python SDK, CodingAgentAdapter, detector_policy |
| 0.4.1 | Python SDK fail-open scope hotfix |
| 0.4.2 | TS SDK mirror of 0.4.1 |
| 0.5.0 | Partner-ready hardening — structured errors, detector_policy discovery |
| 0.5.1 | Adapter evidence-window calibration (self-trial Finding 1) |
| 0.5.2 | Savings Visibility — `projected_savings` + DEFAULT_DOWNGRADE_MAP + CLI sums |
| 0.5.3 | Public stats endpoint + site polish |

---

## 6. What is NOT in scope

If tempted to build any of these — **write it in `ROADMAP.md` or `IMPLEMENTATION_NOTES.md` § "Deferred", not in code.**

### 6.1. Always out of scope (the wedge discipline)

- Full SaaS platform — accounts, teams, billing UI, dashboard with charts
- `/x402/v1/check` paid endpoint with real USDC settlement
- LLM-based deep semantic judgment in `/v1/check-deep` (stays a stub)
- Mobile app, browser extension
- "Sober Builder", "Family Mode", "Builder Mode" (historical concepts, dropped)
- Real-time adaptive thresholds (would require server state — violates § 4.1)
- Async Python SDK (sync is enough; add only when a partner asks)
- PyPI publish (defer until at least one paid partner)
- Public landing claiming "first preflight" (it's not, see `X402_LISTING.md`)
- Marketing testimonials before real customers exist (see § 5.3)

### 6.2. Currently deferred (pending real-partner signal)

- `wasteful_repeated_work` detector (E3/E8 self-trial gap)
- `same_premium_model_retry_without_evidence` detector (savings audit Утечка 1)
- Cheap-action shortcut in `/v1/check` (Утечка 6 — optimization, not value)
- Per-partner stats endpoint
- Dashboard with per-objective drilldowns
- Conversation memory / long-term per-objective state
- New adapters beyond the universal CodingAgentAdapter

When real partner data shows these are needed — they leave this list.

### 6.3. The agentic.market / x402 listing rule

`X402_LISTING.md` content is ready. **The listing is held until** either:
- Real `https://api.aibrake.dev/x402/v1/check` exists and is being paid for, OR
- The founder explicitly chooses to list the free beta as discovery

Do NOT submit the listing speculatively. An empty listing is noise.

---

## 7. Where to look

| Document | Use case |
| --- | --- |
| `README.md` | Top-level pitch, current status, quickstart |
| `CHANGELOG.md` | One section per tag, in reverse chronological order. Source of truth for behavior changes. |
| `IMPLEMENTATION_NOTES.md` | Why decisions were made. Currently 20 sections covering 0.1 → 0.5.2. Add a new § every stage. |
| `PARTNER_ONBOARDING.md` | 30-minute integration walkthrough for a real partner |
| `PYTHON_SDK.md` / `CODING_AGENT_ADAPTER.md` / `INTEGRATION_GUIDE.md` | SDK / adapter / wiring docs |
| `DEPLOYMENT.md` | Render / Fly / Railway / VPS recipes; monitoring section; smoke tests |
| `SECURITY.md` | What we log / don't log, hash policy, fail-open semantics |
| `LAUNCH_CHECKLIST.md` | 10-point GTM plan with current `done / ready / deferred / not-built` status |
| `BENCHMARK_10_AGENTS.md` | Public-facing blog write-up of the 10-agent simulation |
| `SELF_TRIAL_CLAUDE_CODE_REPORT.md` | Dogfood trial; source of Stage 0.5.1 Finding 1 |
| `SIMULATION_10_PARTNERS_REPORT.md` | Per-partner breakdown of the simulation |
| `X402_LISTING.md` | Marketplace listing draft (HELD — see § 6.3) |
| `EXAMPLES.md` | Concrete payload + SDK helper examples per integration pattern |
| `BETA_FEEDBACK_TEMPLATE.md` | What real partners fill in after 7 days |

---

## 8. Workflow

### Day-to-day

```bash
# Dev server (tsx watch — no build)
PORT=8080 \
  AGENT_SPEND_GUARD_AUTH_MODE=required \
  AGENT_SPEND_GUARD_API_KEYS=asg_v1_demo \
  AGENT_SPEND_GUARD_LOG_SINK=jsonl \
  AGENT_SPEND_GUARD_LOG_PATH=./logs/decisions.jsonl \
  npm run dev

# Smoke
curl -s http://localhost:8080/health
curl -s http://localhost:8080/v1/public/stats
curl -s -H "Authorization: Bearer asg_v1_demo" http://localhost:8080/v1/meta

# Tests
npm test                        # 198 / 198
npm run typecheck               # strict; clean
cd python && py -m pytest       # 35 / 35 on Python 3.14.5

# Decision log aggregate
npm run logs:summary
```

### Before a stage tag

1. All TS tests pass, typecheck clean
2. All Python tests pass (or honest disclosure if blocked)
3. CHANGELOG entry exists with verification numbers
4. IMPLEMENTATION_NOTES has a new § for the stage
5. Version bumped in all locations: `package.json`, `src/config/env.ts`, both test files asserting `/health.version`, `python/pyproject.toml`, `python/agent_spend_guard/__init__.py`, README banner
6. Commit message describes feature + what's NOT in scope
7. Tag with annotated message including verification summary

### When proposing the next stage

Read this file. Read the latest IMPLEMENTATION_NOTES § first. Check whether the proposed work is on the deferred list (§ 6.2) — if yes, ask whether real partner data has arrived. If not, push back: "this is deferred until partner signal; recommend hold."

### When in doubt

- "Should I add this detector?" — almost always **no**. See § 5.1 and § 6.2.
- "Should I broaden this except clause?" — almost always **no**. See § 4.4.
- "Should I add server-side state for X?" — almost always **no**. See § 4.1.
- "Should I tag without verification?" — **never**. See § 5.5.
- "Should I claim real users in marketing?" — **never**. See § 5.3.

---

## 9. The current valid next step

Per Stage 0.5 closing rule (§ 5.1), the unconditionally-correct next action is **find one real partner with a paid agent workload averaging > $0.05/call, give them an `asg_v1_<partner>_<random>` key, watch `npm run logs:summary` for 7 days, then act on what the data shows.**

Everything else — new detector, x402 endpoint, second pricing tier, Marketplace listing, dashboard — waits for that data.

The founder may override this rule explicitly ("partnera ne zhdem, uluchshaem"). When overridden, follow the savings-audit priority order: Утечка 3 → 5 → 4 → 1 → 2 → 6 → 7 from `IMPLEMENTATION_NOTES.md` § 20.

When not overridden — **hold**.
