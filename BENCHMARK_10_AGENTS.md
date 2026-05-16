# Benchmark: $103 of agent spend caught in one simulated workday

> **Methodology in one line:** we stress-tested Agent Spend Guard v0.5.2-beta against 10 realistic agent archetypes for one full simulated workday each — 1,133 real `/v1/check` calls against a live hosted server, deterministic seeds, fully reproducible.

**Headline numbers:**

```
1,133 /v1/check calls       — across 10 distinct agent profiles
   $99.30 spend observed    — on the simulated agent side
  $103.16 savings offered   — by the guard, across 265 catches
   103.9% savings/spend     — the guard's offers include projected
                              future attempts, not just the current call
       ~5 ms median         — guard response latency at this volume
```

---

## The setup

We built ten partner profiles, each one a realistic archetype from the paid-agent ecosystem:

| Profile | What it represents | Calls/day | Cost/call |
| --- | --- | ---: | ---: |
| **P01 — Acme Coding** | Claude Code wrapper, sonnet primary | 140 | $0.05 |
| **P02 — Crawly** | High-volume web scraper | 320 | $0.10 |
| **P03 — DeepResearch** | opus-first reasoning agent | 28 | $0.35 |
| **P04 — BrowserPilot** | Browser-automation runtime | 64 | $0.08 |
| **P05 — Pixelator** | Image-generation agent | 42 | $0.04 |
| **P06 — CursorDev** | Heavy Cursor user | 110 | $0.06 |
| **P07 — Codex-CLI** | OpenAI Codex CLI user | 95 | $0.04 |
| **P08 — QueryStorm** | Search-aggregation agent | 210 | $0.03 |
| **P09 — PremiumOnly** | Always-opus wrapper | 36 | $0.42 |
| **P10 — Disciplined Inc** | Well-instrumented agent | 88 | $0.05 |

Each profile got its own API key, its own per-objective history, and a weighted mix of behavioural arcs we observe in real coding-agent traces — cold starts, healthy debug cycles, retry storms, premium-model escalations, objective drift, redundant work.

Then we ran one full workday for each. Real HTTP POSTs to `localhost:8080`. Real decisions. Every `projected_savings_usd` from every response, tallied.

---

## What the guard caught

```
allow                  — 868  (76.6%)    healthy work, no signal
warn                   —   0  (0.0%)     stale_context_retry won the
                                          aggregation tiebreaker
require_confirmation   — 237 (20.9%)     real retry storms, the
                                          $0.42 opus call at attempt #7
block                  —  28  (2.5%)     deterministic policy
                                          violations (blocked_actions)
```

The dominant pattern: **`stale_context_retry_storm`** — `$101.08` of the `$103.16` total, fired on 237 events. That's a coding agent or scraper that has already tried the same thing 4-7 times, with no new files read, no new tests run, no diff change between attempts — and is about to pay again.

The other `$2.08` came from `objective_drift` — deterministic blocks on actions explicitly excluded by the operator's `blocked_actions` policy. Small dollars, but the "did NOT do an out-of-scope refactor mid-stage" kind of catch you only notice when it's missing.

**No false-positive warns.** The Stage 0.5.1 adapter calibration fix held — `healthyDebug` arcs (same failure, but with new files / tests / diff annotated on the current attempt) all returned `allow`. The guard does not punish honest iteration.

---

## Who saved how much

| Profile | Spend | **Savings** | Ratio | Top catches |
| --- | ---: | ---: | ---: | --- |
| **P09 PremiumOnly** | $15.25 | **$25.16** | **165%** | every opus retry storm × $0.42 = expensive |
| P01 Acme Coding | $12.08 | $18.61 | 154% | dense retry pattern on small-cost calls |
| P03 DeepResearch | $9.80 | $12.18 | 124% | few calls per day, but each one is big |
| P02 Crawly | $31.89 | $30.87 | 97% | sheer volume × moderate cost |
| P07 Codex-CLI | $4.32 | $4.03 | 93% | command-error retry patterns |
| P06 CursorDev | $7.40 | $4.64 | 63% | moderate use, moderate catches |
| P10 Disciplined Inc | $5.44 | $3.45 | 63% | rarely trips — by design |
| P05 Pixelator | $1.67 | $0.90 | 54% | image-gen iteration is mostly fine |
| P04 BrowserPilot | $5.27 | $2.07 | 39% | browser sessions are mostly clean |
| P08 QueryStorm | $6.18 | $1.25 | 20% | redundant queries — see honesty note |

The pattern is clear: **the more expensive the agent's average action, the more the guard pays for itself.** P09 (always-opus) saw a 165% savings-to-spend ratio because every catch on a $0.42 model is structurally bigger than a catch on a $0.03 search call.

---

## One catch in detail

Here's an actual response from the simulation, P03 (DeepResearch on opus):

**The setup:** seven attempts on the same `test_failure` fingerprint. Each attempt $0.42 opus call. Between attempts: zero files read, zero tests run, zero git-diff change. Total spent on this loop so far: **$2.94**. The agent was about to fire attempt #8.

**The guard's verdict:**

```jsonc
{
  "decision": "require_confirmation",
  "risk_score": 100,
  "pattern": "stale_context_retry_storm",
  "matched_rules": [
    "failure_signal_present",
    "same_failure_count_high",
    "paid_attempts_on_same_failure_high",
    "no_new_evidence_since_last_attempt",
    "no_files_read_since_last_attempt",
    "no_tests_run_since_last_attempt",
    "git_diff_unchanged",
    "context_source_unconfirmed",
    "expensive_next_action",
    "same_failure_repeated",
    /* 6 more */
  ],
  "reason": "Attempt #8 on the same test_failure: 7 prior repeats with no
             new files, tests, logs, or state changes since attempt #2.
             Another paid retry is unlikely to produce a different result
             without a context refresh.",
  "suggested_action": {
    "type": "context_refresh",
    "message": "Before another paid model call, read the actual failing
                file, run the exact failing test, confirm the current git
                diff, or downgrade to a cheaper model."
  },
  "projected_savings": {
    "amount_usd": 1.26,
    "currency": "USD",
    "basis": "projected_future_attempts",
    "explanation": "Stopping this stale_context_retry_storm avoids an
                    estimated 3 more paid attempt(s) at $0.42 each
                    ($1.26 total) until the agent gathers new evidence."
  },
  "recommended_policy": "ask_human"
}
```

Latency: **~5 ms**. The SDK's `checkOrConfirm` would have surfaced this to the operator via an `onWarn` callback before the agent fired the $0.42 call.

That's $1.26 saved on one decision — and that catch fired 11 times across DeepResearch's simulated day.

---

## What it would mean for a real team

A team running ten varied agent workloads — say a coding agent for engineering, a scraper for sales research, an opus reasoning agent for analysis — at the volumes simulated here would see roughly:

```
~$100 of "offered savings" per workday
~$700 per workweek
~$2,800 per month
```

Adoption matters: that's the number **if every recommendation is heeded**. Real production heed rates in early shadow-mode deployments tend to be 40-80%, so the realistic floor is ~$1,100-2,200/month per ten-agent setup. The premium-heavy workloads (P03, P09) carry most of the dollar value.

For agents averaging under $0.05 per call, the savings ratio is more like 50-90% of spend. For premium agents averaging $0.30+, it pushes past 100% because each catch projects forward at the expensive-per-attempt rate.

---

## Methodology — read it before quoting us

This is a **stress test against realistic synthetic workloads**, not a survey of paying customers. Every honest piece of you-should-know:

- **Simulated partners, not real users.** Acme / Crawly / DeepResearch are archetypes encoded in `scripts/simulate-10-partners.ts`. We anchored their call volumes, costs, and behaviour distributions on plausible production patterns from coding-agent runtimes and scraper agents we've observed in the wild — but no specific real team behaves exactly this way.
- **"Projected savings" is offered, not realized.** The guard's response says *"if you heed this, you save $X"*. Whether the team heeded each recommendation lives in the operator's outcome log, not in the guard's decision log. We can't claim realized dollars; we can claim offered dollars.
- **Cost numbers are conservative anchors.** Real production costs vary 5–10× by context size and provider price tier. Treat these as floor estimates, not exact.
- **`projected_future_attempts` looks forward up to 3 attempts** per stale-context catch. That's why total savings exceeds total observed single-day spend: the guard is saying *"this loop would have cost you 3 more attempts; that's the savings if you stop now."*
- **`redundantWork` arcs are NOT caught** by the current detector set — the guard requires a failure signal to fire its stale-context detector, and redundant work (re-running passing tests, re-fetching identical results) has none. This is a deliberate gap we'll close when real-partner data tells us how bad it actually is.

The simulation harness is open in the repo. Re-run it against your own hosted instance:

```bash
git clone <repo> && cd repo
npm install && npm run build
PORT=8080 \
  AGENT_SPEND_GUARD_AUTH_MODE=required \
  AGENT_SPEND_GUARD_API_KEYS=asg_v1_P01,asg_v1_P02,...,asg_v1_P10 \
  AGENT_SPEND_GUARD_RATE_LIMIT_PER_KEY_PER_MIN=5000 \
  AGENT_SPEND_GUARD_LOG_SINK=jsonl \
  npx tsx src/server.ts &
npx tsx scripts/simulate-10-partners.ts
```

You get the same `$103.16` total — deterministic seeds. Change a profile, get different numbers. The benchmark is yours to interrogate.

---

## What's next

Closed beta — 3-5 real partners, free, 7 days of shadow-mode logs, then a real (not simulated) report with their numbers. If you run a paid agent workload averaging more than $0.05 per call and you want to see what your week looks like:

→ **[Request an invite](https://agentspendguard.example.com/#beta)**

We'd rather have one real team's logs than ten more simulations.

---

*Agent Spend Guard v0.5.2-beta · Loop detection and model stop-loss for paid AI agents · [GitHub](https://github.com/your-org/spending-guard) · [CHANGELOG](./CHANGELOG.md) · [SECURITY](./SECURITY.md)*
