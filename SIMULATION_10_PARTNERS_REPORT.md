# 10-Partner Day Simulation Report

> **Server:** http://localhost:8080 — version `0.5.2-beta`
> **Mode:** shadow only — `/v1/check` POSTs, every response logged, no enforcement
> **Date:** 2026-05-16T20:08:03.585Z
> **Source:** `scripts/simulate-10-partners.ts` (deterministic seeds per partner; reproducible)

---

## Grand totals across all 10 partners

| Metric | Value |
| --- | --- |
| Total /v1/check calls | **1 133** |
| Total agent spend observed | **$99.30** |
| **Total projected savings offered** | **$103.16** |
| Savings as % of spend | **103.9%** |
| allow | 868 (76.6%) |
| warn | 0 (0.0%) |
| require_confirmation | 237 (20.9%) |
| block | 28 (2.5%) |
| Events with non-zero savings | 265 |

### Savings broken down by computation basis

| basis | total $ | share |
| --- | --- | --- |
| `projected_future_attempts` | $101.08 | 98.0% |
| `next_attempt_avoided` | $2.08 | 2.0% |

---

## Per-partner breakdown

| ID | Partner | Calls | Spend | **Savings** | Savings/Spend | warn | req_confirm | block |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P01 | Acme Coding Agent (Claude Code wrapper) | 140 | $12.08 | **$18.61** | 154.0% | 0 | 41 | 2 |
| P02 | Crawly (web scraper agent) | 320 | $31.89 | **$30.87** | 96.8% | 0 | 100 | 8 |
| P03 | DeepResearch (opus-first agent) | 28 | $9.80 | **$12.18** | 124.3% | 0 | 11 | 2 |
| P04 | BrowserPilot (browser automation) | 64 | $5.27 | **$2.07** | 39.3% | 0 | 8 | 2 |
| P05 | Pixelator (image generation agent) | 42 | $1.67 | **$0.90** | 53.8% | 0 | 7 | 2 |
| P06 | CursorDev (heavy Cursor user) | 110 | $7.40 | **$4.64** | 62.7% | 0 | 11 | 0 |
| P07 | Codex-CLI (gpt-4o coding agent) | 95 | $4.32 | **$4.03** | 93.2% | 0 | 20 | 2 |
| P08 | QueryStorm (search aggregation agent) | 210 | $6.18 | **$1.25** | 20.2% | 0 | 12 | 9 |
| P09 | PremiumOnly (opus-only wrapper) | 36 | $15.25 | **$25.16** | 165.0% | 0 | 22 | 0 |
| P10 | Disciplined Inc (well-instrumented agent) | 88 | $5.44 | **$3.45** | 63.4% | 0 | 5 | 1 |

---

## Partner profile detail

### P01 — Acme Coding Agent (Claude Code wrapper)

*Big-ish coding agent. Sonnet primary, occasional opus reach.*

- Workload: 140 calls/day on `anthropic/claude-sonnet-4.5` (~$0.05 mean per call)
- Spend observed: $12.08
- **Savings offered: $18.61** (154.0% of spend)
- Decisions: allow=97 · warn=0 · req_confirm=41 · block=2 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: yes
- Top 3 individual catches:
  - **$1.27** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered i…"
  - **$1.25** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 4 prior repeats with no evidence gathered i…"
  - **$1.18** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered i…"

### P02 — Crawly (web scraper agent)

*High-volume scraper. $0.10/call. Loves same-tool retry.*

- Workload: 320 calls/day on `exa/search-pro` (~$0.10 mean per call)
- Spend observed: $31.89
- **Savings offered: $30.87** (96.8% of spend)
- Decisions: allow=212 · warn=0 · req_confirm=100 · block=8 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: no (relies on DEFAULT_DOWNGRADE_MAP)
- Top 3 individual catches:
  - **$0.38** — `stale_context_retry_storm` — "Attempt #7 on the same test_failure: 6 prior repeats with no new files, tests, l…"
  - **$0.38** — `stale_context_retry_storm` — "Attempt #5 on the same test_failure: 4 prior repeats with no new files, tests, l…"
  - **$0.38** — `stale_context_retry_storm` — "Attempt #7 on the same test_failure: 6 prior repeats with no new files, tests, l…"

### P03 — DeepResearch (opus-first agent)

*Slow, deep reasoning agent. Premium model burn risk.*

- Workload: 28 calls/day on `anthropic/claude-opus-4.5` (~$0.35 mean per call)
- Spend observed: $9.80
- **Savings offered: $12.18** (124.3% of spend)
- Decisions: allow=15 · warn=0 · req_confirm=11 · block=2 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: yes
- Top 3 individual catches:
  - **$1.30** — `stale_context_retry_storm` — "Attempt #5 on the same test_failure: 4 prior repeats with no new files, tests, l…"
  - **$1.13** — `stale_context_retry_storm` — "Attempt #5 on the same test_failure: 4 prior repeats with no evidence gathered i…"
  - **$1.12** — `stale_context_retry_storm` — "Attempt #4 on the same test_failure: 3 prior repeats with no evidence gathered i…"

### P04 — BrowserPilot (browser automation)

*Anchor/Browserbase-style runtime. Mostly clean, rare drift.*

- Workload: 64 calls/day on `browserbase/browser-session` (~$0.08 mean per call)
- Spend observed: $5.27
- **Savings offered: $2.07** (39.3% of spend)
- Decisions: allow=54 · warn=0 · req_confirm=8 · block=2 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: no (relies on DEFAULT_DOWNGRADE_MAP)
- Top 3 individual catches:
  - **$0.29** — `stale_context_retry_storm` — "Attempt #7 on the same test_failure: 6 prior repeats with no new files, tests, l…"
  - **$0.28** — `stale_context_retry_storm` — "Attempt #6 on the same test_failure: 5 prior repeats with no new files, tests, l…"
  - **$0.26** — `stale_context_retry_storm` — "Attempt #4 on the same test_failure: 3 prior repeats with no evidence gathered i…"

### P05 — Pixelator (image generation agent)

*fal.ai-style image agent. Prompt-iteration patterns.*

- Workload: 42 calls/day on `fal-ai/flux-pro` (~$0.04 mean per call)
- Spend observed: $1.67
- **Savings offered: $0.90** (53.8% of spend)
- Decisions: allow=33 · warn=0 · req_confirm=7 · block=2 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: no (relies on DEFAULT_DOWNGRADE_MAP)
- Top 3 individual catches:
  - **$0.13** — `stale_context_retry_storm` — "Attempt #8 on the same test_failure: 7 prior repeats with no new files, tests, l…"
  - **$0.13** — `stale_context_retry_storm` — "Attempt #8 on the same test_failure: 7 prior repeats with no new files, tests, l…"
  - **$0.13** — `stale_context_retry_storm` — "Attempt #6 on the same test_failure: 5 prior repeats with no new files, tests, l…"

### P06 — CursorDev (heavy Cursor user)

*Cursor agent with thorough file-context refreshes.*

- Workload: 110 calls/day on `anthropic/claude-sonnet-4.5` (~$0.06 mean per call)
- Spend observed: $7.40
- **Savings offered: $4.64** (62.7% of spend)
- Decisions: allow=99 · warn=0 · req_confirm=11 · block=0 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: yes
- Top 3 individual catches:
  - **$1.56** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 4 prior repeats with no evidence gathered i…"
  - **$1.32** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 4 prior repeats with no evidence gathered i…"
  - **$0.24** — `stale_context_retry_storm` — "Attempt #6 on the same test_failure: 5 prior repeats with no new files, tests, l…"

### P07 — Codex-CLI (gpt-4o coding agent)

*OpenAI Codex CLI user. Command_error retry patterns.*

- Workload: 95 calls/day on `openai/gpt-4o` (~$0.04 mean per call)
- Spend observed: $4.32
- **Savings offered: $4.03** (93.2% of spend)
- Decisions: allow=73 · warn=0 · req_confirm=20 · block=2 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: no (relies on DEFAULT_DOWNGRADE_MAP)
- Top 3 individual catches:
  - **$0.92** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered i…"
  - **$0.91** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 4 prior repeats with no evidence gathered i…"
  - **$0.15** — `stale_context_retry_storm` — "Attempt #8 on the same test_failure: 7 prior repeats with no new files, tests, l…"

### P08 — QueryStorm (search aggregation agent)

*Exa/Tavily/Brave aggregator. Redundant query risk.*

- Workload: 210 calls/day on `tavily/search-deep` (~$0.03 mean per call)
- Spend observed: $6.18
- **Savings offered: $1.25** (20.2% of spend)
- Decisions: allow=189 · warn=0 · req_confirm=12 · block=9 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: no (relies on DEFAULT_DOWNGRADE_MAP)
- Top 3 individual catches:
  - **$0.11** — `stale_context_retry_storm` — "Attempt #8 on the same test_failure: 7 prior repeats with no new files, tests, l…"
  - **$0.10** — `stale_context_retry_storm` — "Attempt #5 on the same test_failure: 4 prior repeats with no new files, tests, l…"
  - **$0.10** — `stale_context_retry_storm` — "Attempt #4 on the same test_failure: 3 prior repeats with no evidence gathered i…"

### P09 — PremiumOnly (opus-only wrapper)

*Always-opus. Worst-case premium burn pattern.*

- Workload: 36 calls/day on `anthropic/claude-opus-4.5` (~$0.42 mean per call)
- Spend observed: $15.25
- **Savings offered: $25.16** (165.0% of spend)
- Decisions: allow=14 · warn=0 · req_confirm=22 · block=0 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: no (relies on DEFAULT_DOWNGRADE_MAP)
- Top 3 individual catches:
  - **$1.43** — `stale_context_retry_storm` — "Attempt #5 on the same test_failure: 4 prior repeats with no new files, tests, l…"
  - **$1.41** — `stale_context_retry_storm` — "Attempt #6 on the same test_failure: 5 prior repeats with no new files, tests, l…"
  - **$1.35** — `stale_context_retry_storm` — "Attempt #5 on the same test_failure: 4 prior repeats with no evidence gathered i…"

### P10 — Disciplined Inc (well-instrumented agent)

*Annotates evidence carefully; almost never trips guard.*

- Workload: 88 calls/day on `anthropic/claude-sonnet-4.5` (~$0.05 mean per call)
- Spend observed: $5.44
- **Savings offered: $3.45** (63.4% of spend)
- Decisions: allow=82 · warn=0 · req_confirm=5 · block=1 · uncertain=0 · delay=0
- Declared `model_policy.secondaryModel`: yes
- Top 3 individual catches:
  - **$1.15** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 4 prior repeats with no evidence gathered i…"
  - **$1.12** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered i…"
  - **$0.82** — `stale_context_retry_storm` — "Attempt #1 on the same test_failure: 2 prior repeats with no evidence gathered i…"

---

## Methodology

Each partner is one realistic archetype with a fixed daily call count and a weighted mix of behavioural arcs:

- **`coldStart`** — first action on a new objective, no history
- **`healthyDebug`** — same failure as prior attempt but with annotated new evidence (filesRead, testsRun, gitDiffChanged on the current attempt). Stage 0.5.1 fix should keep these at `allow`.
- **`retryStorm`** — 4–7 prior attempts on the same failure, no evidence between or on the current attempt. Should trip `stale_context_retry_storm`.
- **`premiumEscalation`** — 2–4 sonnet/gpt-4o attempts on the same failure, current attempt jumps to opus/gpt-5 without new evidence. Should trip `model_escalation_without_evidence` with route to declared secondary (or DEFAULT_DOWNGRADE_MAP).
- **`drift`** — action listed in `objective.blocked_actions`. Should deterministic-block.
- **`redundantWork`** — same tool/input fingerprint repeated with no failure signal. Currently NOT caught (E3/E8 gap in `wasteful_repeated_work` detector — deliberately deferred per Stage 0.5).

Each arc generates the prior-event history (recorded into a fresh `CodingAgentAdapter`) and one "action under check" that gets POSTed to `/v1/check`. The guard's response — including `projected_savings.amount_usd` — is the source of every number in this report.

Numbers are deterministic per seed (partner ID hash). Re-running the script reproduces the same totals exactly.

## Honesty disclosures

- These are **simulated** partners, not real users. The behavioural mix is anchored on plausible archetypes but no claim is made that real Acme/Crawly/etc. behave exactly this way.
- "Total projected savings" is what the guard would have saved **if every recommendation were heeded**. Real adoption is typically 40–80% of recommendations followed; multiply by your team's actual heed rate.
- Per-call cost numbers are conservative estimates. Real production costs vary 5–10× depending on context size and provider price ladders.
- The `redundantWork` arc is NOT caught by the current detector set (deliberate gap, deferred for real-partner data). It still consumes spend on the chart but contributes $0 to savings.
- Numbers are scaled to one calendar day. A 7-day deployment would see roughly 5× these totals (weekend dip).