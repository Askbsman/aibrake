# 100-Partner × 7-Day Simulation Report

> **Server:** http://localhost:8080 — version `0.5.3-beta`
> **Mode:** shadow only — `/v1/check` POSTs, every response captured, no enforcement
> **Date:** 2026-05-18T10:31:43.562Z
> **Source:** `scripts/simulate-100-partners-week.ts` (deterministic seed; reproducible)
> **Scale:** 100 partners × 7 days

---

## Grand totals (one full simulated workweek across 100 partners)

| Metric | Value |
| --- | --- |
| Total /v1/check calls | **73,765** |
| Total agent spend observed | **$6450.83** |
| **Total projected savings offered** | **$6883.44** |
| Savings as % of spend | **106.7%** |
| allow | 55,787 (75.6%) |
| warn | 0 (0.0%) |
| require_confirmation | 15,980 (21.7%) |
| block | 1,998 (2.7%) |
| Avg savings / partner / week | **$68.83** |
| Avg savings / partner / day | **$9.83** |
| Projected savings / month (×4.3 weeks) | **$29598.79** |

### Savings broken down by computation basis

| basis | total $ | share |
| --- | --- | --- |
| `projected_future_attempts` | $6724.00 | 97.7% |
| `next_attempt_avoided` | $159.44 | 2.3% |

### Savings broken down by detector pattern

| pattern | total $ | share |
| --- | --- | --- |
| `stale_context_retry_storm` | $6724.00 | 97.7% |
| `objective_drift` | $159.44 | 2.3% |

---

## Day-by-day breakdown

| Day | Calls | Spend | Savings | Savings/Spend | allow | req_conf | block |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Day 1 | 10,930 | $954.98 | **$1035.69** | 108.5% | 8,209 | 2,419 | 302 |
| Day 2 | 11,443 | $1005.18 | **$1065.44** | 106.0% | 8,678 | 2,442 | 323 |
| Day 3 | 11,509 | $997.39 | **$1041.44** | 104.4% | 8,717 | 2,487 | 305 |
| Day 4 | 11,175 | $980.49 | **$1033.40** | 105.4% | 8,489 | 2,380 | 306 |
| Day 5 | 11,344 | $986.46 | **$1073.11** | 108.8% | 8,584 | 2,471 | 289 |
| Day 6 (weekend) | 8,756 | $766.79 | **$808.72** | 105.5% | 6,635 | 1,885 | 236 |
| Day 7 (weekend) | 8,608 | $759.55 | **$825.64** | 108.7% | 6,475 | 1,896 | 237 |

---

## By archetype (averaged across partners in each archetype)

| Archetype | # partners | Total calls | Total spend | **Total savings** | Avg savings/partner | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **P02** Crawly (web scraper) | 10 | 20,650 | $1983.90 | **$1938.22** | $193.82 | 97.7% |
| **P09** PremiumOnly (opus wrapper) | 10 | 2,316 | $923.95 | **$1562.38** | $156.24 | 169.1% |
| **P01** Acme Coding (Claude Code wrapper) | 10 | 8,916 | $751.87 | **$1217.75** | $121.78 | 162.0% |
| **P03** DeepResearch (opus-first) | 10 | 1,831 | $641.36 | **$685.17** | $68.52 | 106.8% |
| **P07** Codex-CLI (gpt-4o) | 10 | 5,881 | $381.49 | **$575.20** | $57.52 | 150.8% |
| **P06** CursorDev (heavy Cursor) | 10 | 7,161 | $554.22 | **$479.26** | $47.93 | 86.5% |
| **P10** Disciplined Inc | 10 | 5,826 | $321.63 | **$142.32** | $14.23 | 44.2% |
| **P08** QueryStorm (search aggregation) | 10 | 14,089 | $434.34 | **$116.48** | $11.65 | 26.8% |
| **P04** BrowserPilot (automation) | 10 | 4,249 | $346.36 | **$94.28** | $9.43 | 27.2% |
| **P05** Pixelator (image gen) | 10 | 2,846 | $111.71 | **$72.38** | $7.24 | 64.8% |

---

## Top 10 individual catches (single $ amounts caught in single decisions)

| Rank | Partner | Archetype | Day | Savings | Pattern | Reason (truncated) |
| --- | --- | --- | ---: | ---: | --- | --- |
| 1 | P046 | CursorDev (heavy Cursor) | 7 | **$1.78** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered in any attempt. Anoth… |
| 2 | P076 | CursorDev (heavy Cursor) | 7 | **$1.78** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered in any attempt. Anoth… |
| 3 | P076 | CursorDev (heavy Cursor) | 5 | **$1.75** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered in any attempt. Anoth… |
| 4 | P046 | CursorDev (heavy Cursor) | 2 | **$1.74** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered in any attempt. Anoth… |
| 5 | P036 | CursorDev (heavy Cursor) | 5 | **$1.72** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 4 prior repeats with no evidence gathered in any attempt. Anoth… |
| 6 | P076 | CursorDev (heavy Cursor) | 2 | **$1.72** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered in any attempt. Anoth… |
| 7 | P036 | CursorDev (heavy Cursor) | 2 | **$1.71** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 3 prior repeats with no evidence gathered in any attempt. Anoth… |
| 8 | P046 | CursorDev (heavy Cursor) | 4 | **$1.70** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 4 prior repeats with no evidence gathered in any attempt. Anoth… |
| 9 | P036 | CursorDev (heavy Cursor) | 5 | **$1.67** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 4 prior repeats with no evidence gathered in any attempt. Anoth… |
| 10 | P016 | CursorDev (heavy Cursor) | 3 | **$1.64** | `stale_context_retry_storm` | Attempt #1 on the same test_failure: 4 prior repeats with no evidence gathered in any attempt. Anoth… |

---

## Methodology

This simulation runs 100 synthetic partners over 7 simulated calendar days against a live Agent Spend Guard hosted server at `http://localhost:8080`. Every `/v1/check` POST is real; every response is captured; `projected_savings.amount_usd` is read directly from the server's reply, not estimated by the simulator.

Each partner is sampled from one of 10 realistic agent archetypes (coding agents, scrapers, browser automation, image gen, search aggregation, opus-only wrappers, etc.) with per-partner parameter jitter (±20% on call volume, ±15% on per-call cost). Each day applies a multiplier: weekdays 0.85-1.15, weekends 0.70-0.85, simulating real-world workload dips.

Each "call" is one of six behavioural arcs sampled per the archetype's weights:

- **`coldStart`** — first action on a fresh objective. Should `allow`.
- **`healthyDebug`** — same failure as prior attempt, with annotated new evidence on the current attempt. Should `allow` (Stage 0.5.1 calibration).
- **`retryStorm`** — 4-7 prior attempts on the same failure, no evidence between or on current attempt. Should trip `stale_context_retry_storm` → `require_confirmation`.
- **`premiumEscalation`** — sonnet/gpt-4o tried, current attempt jumps to opus/gpt-5 without new evidence. Should trip `model_escalation_without_evidence` or fall under stale-context.
- **`drift`** — action listed in `objective.blocked_actions`. Deterministic `block`.
- **`redundantWork`** — same tool, no failure, no evidence. **Currently not caught** (E3/E8 gap, deliberately deferred per Stage 0.5).

Deterministic seeded RNG — re-running reproduces the same totals.

## Honesty disclosures

- **Simulated, not real users.** No specific real team behaves exactly as encoded. Numbers are anchored on plausible production patterns observed in agent runtimes, but encoded archetypes are constructs.
- **"Projected savings" is offered, not realized.** Real adoption typically heeds 40-80% of guard recommendations. Multiply by your team's actual heed rate for a realized number.
- **Per-call cost numbers are conservative anchors.** Real production costs vary 5-10× by context size and provider price tier. Treat these as floor estimates.
- **`projected_future_attempts` looks forward up to 3 attempts** per stale-context catch — that's why per-call savings can exceed per-call spend.
- **`redundantWork` arcs consume spend but contribute $0 savings** in this simulation, because the current detector set requires a failure signal to fire. This gap is deliberately deferred until real-partner data tells us how bad it is.
- **Weekend dip is a heuristic.** Real agentic workloads may or may not exhibit this pattern; for back-of-envelope numbers it adds realism but the underlying claim does not depend on it.
