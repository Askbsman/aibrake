# Launch Checklist — first hosted beta partner

> **Stage:** post-`spending-guard-v0.5.1-beta`
> **Goal:** first real partner integrating against a publicly-reachable AIBrake endpoint
> **Discipline:** no new engineering until that partner reports back with 7 days of usefulness data
> **Source:** founder GTM plan (10 items), filtered through the Stage 0.5 "do not continue engineering until real partner feedback" contract

---

## Status legend

```
✅ done       — committed, on main, verifiable
🟡 ready      — content exists, requires only an ops decision to ship
🟠 deferred   — explicitly held until partner data arrives
❌ not built  — would violate the discipline contract
```

---

## 1. v0.5.1-beta stable

| | |
| --- | --- |
| Status | ✅ done |
| Tag | `spending-guard-v0.5.1-beta` |
| TS tests | 172 / 172, typecheck clean |
| Python tests | 35 / 35 on Python 3.14.5 |
| Self-trial | 10 events; E2 false positive fixed; E1 / E10 / E7 strong catches preserved |

## 2. Hosted API endpoint

| | |
| --- | --- |
| Status | 🟡 ready (deploy decision is yours) |
| What's in repo | Dockerfile + `DEPLOYMENT.md` updated with Render / Fly / Railway recipes |
| What's not | Live `https://api.aibrake.dev` URL — that's an ops decision (cost, region, TLS, DNS) |
| Required env | `PORT=8080`, `AGENT_SPEND_GUARD_AUTH_MODE=required`, `AGENT_SPEND_GUARD_API_KEYS=<csv>`, `AGENT_SPEND_GUARD_LOG_SINK=jsonl` |
| Minimum hosting tier | Any Node 20 container with 256 MB RAM. The guard is stateless and CPU-light. |

## 3. Landing page

| | |
| --- | --- |
| Status | ✅ done |
| File | `web/index.html` (single static file, no JS framework, zero dependencies) |
| Deploy | Drop on Vercel / Netlify / GitHub Pages / Cloudflare Pages — `cp web/index.html .` |
| Edit | Update the form's `mailto:` and the GitHub link before going live |

## 4. Docs

| | |
| --- | --- |
| Status | ✅ done (gap report below) |
| Already in repo | `PARTNER_ONBOARDING.md`, `PYTHON_SDK.md`, `CODING_AGENT_ADAPTER.md`, `INTEGRATION_GUIDE.md`, `DEPLOYMENT.md`, `EXAMPLES.md`, `BETA_FEEDBACK_TEMPLATE.md`, `IMPLEMENTATION_NOTES.md`, `CHANGELOG.md`, `X402_LISTING.md`, `SECURITY.md` (new), `LAUNCH_CHECKLIST.md` (this file) |
| Honest gap | No standalone `API_REFERENCE.md`. The OpenAPI shape can be reconstructed from `src/core/types.ts` + `src/core/schemas.ts`. Defer until a partner asks. |

## 5. TS / Python examples

| | |
| --- | --- |
| Status | ✅ done |
| TS | `examples/40-dollar-retry-storm.ts`, `examples/coding-agent-integration.ts`, full SDK helper coverage in `EXAMPLES.md` § 1–7 |
| Python | `python/tests/test_integration.py` (live `:8080`), `PYTHON_SDK.md` § 2-3 |
| Live demo | `scripts/self-trial-guard.ts` — 10 reproducible scenarios |

## 6. API keys for 3 beta users

| | |
| --- | --- |
| Status | 🟡 ready (waiting for actual partner names) |
| Format | `asg_v1_<partnername>_<random16hex>` |
| Generation | `node -e "console.log('asg_v1_' + process.argv[1] + '_' + require('crypto').randomBytes(8).toString('hex'))" <partnername>` |
| Storage | `AGENT_SPEND_GUARD_API_KEYS=asg_v1_a_xxx,asg_v1_b_yyy,asg_v1_c_zzz` (CSV in env) |
| Rotation | Redeploy with the updated env var. No runtime API in 0.5.x. |

## 7. x402 listing draft

| | |
| --- | --- |
| Status | ✅ done (content); 🟠 deferred (publication) |
| File | `X402_LISTING.md` — refreshed with sharper lead copy |
| Hold reason | Don't list a paid endpoint that doesn't exist. Listing goes live only after § 8 (paid endpoint) is real or after the founder explicitly chooses to list the free beta. |

## 8. x402 paid endpoint (`POST /x402/v1/check`)

| | |
| --- | --- |
| Status | ❌ not built (deliberate) |
| Why | This is new engineering on an unvalidated price hypothesis. The 0.5.0 spec explicitly excluded "full x402 production settlement" and the 0.5 changelog says next valid step is "1 real partner integration → 7 days of logs → useful-warning review." |
| When to revisit | After 1+ partner reports useful warnings in shadow mode. Then x402 payment integration is a 2-3 day add (facilitator wrap around existing `/v1/check`). |
| Target price | $0.001–$0.005 USDC per call (anchor only; pending data) |

## 9. agentic.market submission

| | |
| --- | --- |
| Status | 🟡 ready (content); 🟠 hold (submission) |
| Content | `X402_LISTING.md` carries the listing copy |
| Hold reason | Marketplace listing is more valuable when there's a live hosted endpoint + at least one referenceable partner. Submitting empty is noise. |

## 10. Uptime monitor

| | |
| --- | --- |
| Status | 🟡 ready (probe target exists); 🟠 (hookup is ops) |
| Probe | `GET /health` returns `{ ok: true, service: "agent-spend-guard", version, mode }` |
| Recommended | UptimeRobot / Better Uptime / Healthchecks.io — 5-minute interval is enough |
| Alert | Slack / email on 3 consecutive failures |

## 11. Privacy / security note

| | |
| --- | --- |
| Status | ✅ done |
| File | `SECURITY.md` — what we log, what we don't, hash policy, fail-open semantics, how to report a security issue |

## 12. Feedback form

| | |
| --- | --- |
| Status | ✅ template ready |
| File | `BETA_FEEDBACK_TEMPLATE.md` — partners fill it in after 7 days |

---

## What I deliberately did NOT build in this batch

Per the Stage 0.5 closing rule ("After this, do not continue internal engineering unless a real partner gives specific feedback"), the following stay deferred:

- **Dashboard.** No partner has asked for one. Server-side JSONL log + `npm run logs:summary` CLI covers the founder use case.
- **Billing / subscription tiers.** No customer yet.
- **Account management / team auth.** Single Bearer key per partner is enough for 3 partners.
- **New adapters.** OpenClawAdapter / CodingAgentAdapter / HermesAdapter cover Claude Code, Cursor, Codex, OpenClaw, Hermes, generic custom runtimes. No partner pulling on a different runtime yet.
- **New detectors.** Self-trial surfaced one calibration finding (fixed in 0.5.1); no new detector was needed. `wasteful_repeated_work` for the E3/E8 redundant-work case stays deferred until real-partner data.
- **Paid `/v1/check` via x402.** See § 8.
- **`/v1/check-deep` real implementation.** Still a stub. Defer until rules-only checks are validated as useful.
- **Mobile app, Sober Builder, Family Mode, Builder Mode.** Out of scope for the wedge.

---

## The actual launch sequence (concrete next steps)

In order. Each step gates the next.

1. **Pick a hosting provider.** Render / Fly / Railway / your own VPS. `DEPLOYMENT.md` has recipes.
2. **Deploy the current `main` branch.** Set env: `PORT=8080`, `AGENT_SPEND_GUARD_AUTH_MODE=required`, `AGENT_SPEND_GUARD_API_KEYS=<csv>`, `AGENT_SPEND_GUARD_LOG_SINK=jsonl`.
3. **Verify `/health` returns `0.5.1-beta` and `/v1/meta` returns `detector_policy.supported_fields`.**
4. **Wire an uptime monitor on `/health` with a 5-minute interval.**
5. **Deploy `web/index.html`** (Vercel / Netlify / GitHub Pages). Update the `mailto:` and GitHub links to your real ones. Update the API URL placeholder in `PARTNER_ONBOARDING.md` § "Before you start."
6. **Identify 3 prospective partners.** Real names. Coding agents, scraper agents, premium-model wrappers, or any team that runs >$10/day on a single agent objective.
7. **Send each partner a private invite** — the landing URL + a freshly-generated `asg_v1_<partnername>_<random>` key + the `PARTNER_ONBOARDING.md` link.
8. **Watch the JSONL log for 7 days** with `npm run logs:summary`. Look for: how many `warn` / `require_confirmation` events fire per partner per day. Aim for 1-10. If <1 per day, the guard isn't useful enough; if >100, false-positive territory.
9. **Collect the `BETA_FEEDBACK_TEMPLATE.md` from each partner after their 7 days.**
10. **THEN decide:** paid endpoint via x402, marketplace listing publish, new detectors, second-tier pricing. The data tells you which.

Steps 1-7 are 1-2 days of focused ops work. Step 8 is calendar time, not work. Step 10 is the next engineering stage — and it has to wait for step 9.
