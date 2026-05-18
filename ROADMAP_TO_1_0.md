# Roadmap to 1.0

> **Current:** `spending-guard-v0.5.3-beta`
> **Target:** `spending-guard-v1.0.0`
> **Bottleneck:** real partners. Not engineering. Not features. **Real partners.**

## The honest framing

1.0 is **not** "we shipped more features." 1.0 is **a contract you can publicly commit to** without expecting breaking changes for the next ~6 months. For an infrastructure product, that means three things had to happen first:

1. **Real-world usage** found the bugs we cannot see in simulation
2. **The API contract** survived 7+ days against real traffic without needing to change
3. **The honesty disclaimers** in CHANGELOG / SECURITY / README can be sharpened from "best-effort beta" to actual commitments

Every "new detector" / "new endpoint" / "dashboard" we could build before 1.0 either:
- (a) isn't required for 1.0 (it's 1.x territory), or
- (b) actively delays 1.0 by adding contract surface we'd have to re-freeze later

So the path to 1.0 is mostly **operational + sales**, with a tiny amount of engineering at the end to react to what real data shows.

---

## Bucket A — Hard prerequisites (cannot skip, no 1.0 without these)

### A1. At least one real partner with 7+ days of logs
- Paid agent workload averaging > $0.05/call (otherwise the guard isn't valuable enough to justify integration friction)
- Shadow-mode integration (`checkShadow` only, never enforcing)
- Their `decisions.jsonl` accessible to us (or aggregated stats via `/v1/public/stats`)
- One completed `BETA_FEEDBACK_TEMPLATE.md` from that partner
- **Status: 0 partners. Single biggest gap to 1.0.**

### A2. Public hosted API
- `https://api.aibrake.dev/v1/check` (or your real domain) reachable from the internet
- Auto-TLS via Render / Fly / Caddy
- `/health` + uptime monitor (UptimeRobot 5-min check)
- Persistent volume for `/var/data/decisions.jsonl`
- Survived at least 30 days of uptime without intervention
- **Status: localhost only. 1-2 days of ops work to deploy.**

### A3. Frozen API contract review
- Final structural review of every field in `/v1/check` input / output
- SDK contract reviewed across all 4 helpers (`check`, `checkShadow`, `checkOrConfirm`, `checkOrDowngrade`)
- `CodingAgentAdapter.AgentActionTelemetry` shape audited
- Fingerprint formats locked (`fp_v1_*`, `input_v1_*`, `key_v1_*` — already versioned; 1.0 commits to these surviving)
- All `0.x → 1.0` breaking changes documented in `MIGRATION_GUIDE.md`
- **Status: never reviewed in one pass. ~1 week of focused architectural review with the data from A1.**

### A4. Production posture, not "works on my machine"
- Real-domain DNS + TLS termination (not localhost)
- Log rotation set up (`logrotate` or equivalent — see `DEPLOYMENT.md § 11`)
- API key rotation playbook documented and tested once
- Error budget defined (`DEPLOYMENT.md § 11` has a candidate)
- Backup of decision logs to durable storage
- A `runbook.md` for the maintainer for common ops events
- **Status: deployment recipes exist in `DEPLOYMENT.md`; never actually performed.**

---

## Bucket B — Strongly recommended for 1.0

### B1. Three to five partners, not one
- Spreads the calibration risk — one partner's edge case isn't the whole product
- A single referenceable customer is fragile; three is durable
- **Status: 0 / 3.**

### B2. Real `BETA_FEEDBACK` from each
- Template exists at `BETA_FEEDBACK_TEMPLATE.md`
- Specifically: did the guard catch a real loop that would have cost real money?
- False-positive rate measured against real traffic
- Would they pay the anchor price ($0.001–0.005 per check) at this useful-warning rate?

### B3. Formal API reference
- OpenAPI 3.x spec generated from Zod schemas (we already have them in `src/core/schemas.ts`)
- Or a hand-written `API_REFERENCE.md` mirroring the schema
- Lets partners codegen clients in any language without reading TS source
- **Status: schemas exist but not exported as OpenAPI.**

### B4. `MIGRATION_GUIDE.md` for 0.5 → 1.0
- Especially: which detector versions changed and what behavior shifted
- Each `<detector>@x.y.z` bump documented
- "If you were pinned to `model_escalation_without_evidence@0.2.0`, here's what changed in 0.3.0"

### B5. Updated `SECURITY.md`
- Remove "no SLA, no compliance, no commitments" beta language
- Replace with what we WILL commit to at 1.0
  - Uptime target (99.0%? 99.5%?)
  - Log retention policy (we currently say "host filesystem, rotate as you like")
  - Incident response SLO ("security issues acknowledged within 24h")

### B6. Detector calibration against real data
- Compare real-partner `warn` / `require_confirmation` rates to the synthetic benchmark
- Real data may show:
  - Self-trial Finding 1 wasn't the only gap (E3/E8 redundant-work likely matters at scale)
  - Some thresholds need tightening or relaxing per real cost distributions
- One or two `0.5.x` patches between A1 and the 1.0 tag

---

## Bucket C — Nice to have for 1.0 (but ship-able)

### C1. x402 paid endpoint
- `POST /x402/v1/check` with USDC settlement via facilitator
- Target price `$0.001–0.005` (anchored in `BENCHMARK_10_AGENTS.md`, validated by `SIMULATION_100_PARTNERS_WEEK_REPORT.md`)
- **Status: stubbed in `src/payments/`, not implemented. Deferred per `CLAUDE.md § 6.3` until at least one partner has completed a 7-day shadow integration and reported usefulness. This is a monetization mechanism, not a savings-detection gap — see the 7-leak savings audit in `IMPLEMENTATION_NOTES.md § 20` if you're looking for the detection-side roadmap.**

### C2. agentic.market listing
- Listing copy ready in `X402_LISTING.md`
- Submit only after C1 is live OR explicit founder decision to list the free beta
- Adds discovery / SEO

### C3. Public GitHub repo
- Currently the repo has no `git remote`
- Public docs + private hosted service is the published posture
- Replace all `github.com/your-username/aibrake` placeholders with real URL once decided

### C4. OG card as PNG
- `web/og-card.svg` exists; needs PNG rasterization for Twitter/Facebook crawlers
- `scripts/render-og-card.mjs` ready; just needs `npm install --save-dev @resvg/resvg-js && npm run render:og`

### C5. Performance / capacity baseline doc
- "Single instance handles N checks/sec, P95 latency X ms"
- From the 100-partner sim we know ~5ms median at ~100 req/sec local; production numbers TBD
- A `PERFORMANCE.md` codifying this is a 1.0 nicety

---

## Bucket D — Out of scope for 1.0 (1.x or 2.0 territory)

These have come up repeatedly and stay deferred:

| Item | Why deferred |
| --- | --- |
| `wasteful_repeated_work` detector (E3/E8 gap) | New detector; only if real-partner data shows the gap matters. **1.x** |
| `same_premium_model_retry_without_evidence` (Утечка 1) | Same. **1.x** |
| Per-partner dashboard with charts | Out-of-scope per CLAUDE.md § 6. **2.0** |
| Database / per-partner persistence | Violates stateless Core (§ 4.1 contract). **Never in current architecture**, would require fundamental redesign |
| Adaptive thresholds (server-side learning) | Requires server state, violates § 4.1. **2.0+** |
| Browser extension / mobile app | Out of scope per CLAUDE.md § 6.1. **Never planned** |
| LLM-based deep judgment in `/v1/check-deep` | Listed as `Deep audit` pricing tier; will probably stay stubbed through 1.0 |
| Conversation memory / long-term per-user state | Out of scope. **2.0+** |
| Multi-region deployment | Not warranted at hosted-beta volumes. **2.0** |
| GDPR / SOC 2 / compliance certs | Real conversation when there's enterprise demand. **2.0** |

---

## The concrete sequence

In order. Each step gates the next.

1. **Deploy public API** — 1-2 days of ops. Render or Fly. Set env, attach domain, TLS via host's auto-cert. Smoke test `/v1/check` from internet.
2. **Deploy landing** — 1 day. Push `web/` to Vercel / Netlify. Update `window.AGENT_SPEND_GUARD_API_BASE` to the real API URL. Replace placeholders.
3. **Recruit 3-5 partners** — 1-2 weeks. This is sales, not engineering. Personal outreach to teams running paid coding agents / scrapers / opus-routing wrappers. Give them invite + `PARTNER_ONBOARDING.md`.
4. **Observe 7-14 days** — calendar time, not work time. Daily `npm run logs:summary` review. Note any anomalies.
5. **Collect feedback** — `BETA_FEEDBACK_TEMPLATE.md` from each partner. Specifically: useful warnings caught, false positives, would they pay.
6. **Calibrate** — react to data. May produce one or two `0.5.x-beta` patches. Probably NOT a new detector — most likely threshold adjustments.
7. **Contract freeze review** — single architectural pass through every field. Document anything that would warrant a `2.0`. Write `MIGRATION_GUIDE.md`.
8. **Update docs** — remove beta-disclaimers from SECURITY.md, README banner, CHANGELOG entry. Update version everywhere.
9. **Tag `spending-guard-v1.0.0`** — annotated tag with the verification summary including real-partner counts.
10. **Optional follow-up**: ship `1.1` with x402 paid endpoint + agentic.market listing once revenue model is validated.

**Realistic timeline: 6-8 weeks from now to 1.0**, gated entirely on partner recruitment. Steps 1-2 are 2-3 days. Steps 6-9 are another ~1 week of engineering. The other 4-6 weeks are calendar time waiting for real data.

---

## What we will NOT do to "speed up" 1.0

These are tempting and wrong:

1. **Ship 1.0 on simulation data alone.** That's how products get returned with broken contracts. Simulation is not validation.
2. **Add more detectors before partner data.** Detectors are calibration-sensitive. Adding them on synthetic workloads risks creating false positives we'd have to fix in 1.1, defeating the freeze.
3. **Build the dashboard "because it'll be needed eventually."** Partners read `npm run logs:summary`. Build a dashboard when they ask for one.
4. **Skip the migration guide.** Without it, the 0.5 → 1.0 jump for any existing partner is risky.

---

## When 1.0 is unambiguously ready

All of these true simultaneously:

```text
[ ] >= 1 real partner with 7+ days of real-traffic logs
[ ] Public hosted API at a real domain, 30+ days uptime
[ ] Frozen API contract review complete
[ ] BETA_FEEDBACK collected from >= 1 partner with "useful warnings, would pay"
[ ] MIGRATION_GUIDE.md written
[ ] SECURITY.md updated with 1.0 commitments
[ ] No planned breaking changes for the next 6 months
[ ] CHANGELOG 1.0.0 entry drafted with verification numbers
```

When the checkbox count is 0/8, we're at v0.5.3-beta. When it's 8/8, we tag 1.0.

Right now: **0/8.**

The fastest path to 8/8 is deployment + outreach, not more code.
