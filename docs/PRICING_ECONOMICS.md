# AIBrake pricing economics — 2026-05-30 review

## Customer value (what AIBrake saves them per call)

From three independent measurements:

| Source | Metric | Per-call savings |
|---|---|---|
| **LCR corpus** (100 isolated scenarios, 6 detectors) | catch rate 98.0% | — (no cost data) |
| **Odyssey benchmark** (5 multi-step sessions, 130 steps) | $6.28 total saved | **$0.048 / step** |
| **100-partners simulation** (73,765 real `/v1/check` calls over 7 days) | $6,883 offered savings | **$0.093 / call** |
| Per actual catch (not all calls catch) | 17,978 catches in 73,765 calls | **$0.38 / catch** |

**Synthesis:** average call saves ~$0.05–0.09 in projected spend. Even applying a conservative 50% "heed rate" (customers actually follow the recommendation half the time), realized savings are still **$0.025–0.045 per call**.

## Our cost per call

| | Cost / call |
|---|---|
| AIBrake Core | **$0** — rule-based detectors, no LLM dependency |
| Render hosting (Starter, $7/mo, supports ~50k calls/day) | ~$0.00005 amortized |
| x402 facilitator (xpay / CDP) | $0 — facilitators don't charge sellers today |
| Bandwidth | negligible (5KB in, 2KB out) |
| **Total marginal cost** | **< $0.0001 per call** |

Margin at any price > $0.0005 is **99%+**.

## Pricing ladder

| Tier | Price | Buyer ROI (vs $0.09 avg saved) | Revenue at 10k calls/day | Friction |
|---|---|---|---|---|
| Beta launch | $0.001 | 93× | $10/day · $300/mo | None — feels free |
| **v1 (current)** | **$0.005** | **18×** | **$50/day · $1500/mo** | **None — still no-brainer** |
| Premium | $0.01 | 9× | $100/day · $3000/mo | Light — visible cost |
| Enterprise (with SLA) | $0.02 | 4.5× | $200/day · $6000/mo | Moderate — requires SLA |

**Picked $0.005 for v1** — sweet spot where:
- ROI for buyer is still obviously a no-brainer (18× return)
- Revenue is 5× higher than $0.001 at the same call volume
- Doesn't read as "free / hobby" the way $0.001 does (psychological anchoring)
- Leaves room for premium and enterprise tiers above

## What changed in the codebase (2026-05-30)

- Render env var `X402_PRICE_CHECK_USD`: `0.001` → `0.005`
- `web/index.html`: hero CTA `Try $0.001` → `Try $0.005`, stat card `$0.001 per check` → `$0.005 per check`, try-now section subtitle, pricing table now shows `$0.005` with a "Avg $0.09 saved — ROI 18×" bullet
- No code change needed (price is env-driven; `buildPaymentRequirements()` rebuilds the `amount` field on each request).

## Future moves

- **Volume discount** at 10k+ calls/month — drop to $0.003 per call (still 30× ROI)
- **Enterprise tier** at $0.02–$0.05 with SLA, dedicated support, custom detectors
- **Subscription bypass** — $99/mo unlimited up to 50k calls/day (for partners who want predictable spend)
- Premium `/check-deep` (LLM-judged) at $0.05–$0.10 when it ships

Don't change pricing again until we have 10+ paying customers — current data is internal-only.
