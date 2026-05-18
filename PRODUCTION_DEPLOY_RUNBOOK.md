# Production deploy runbook

> **From `v0.5.3-beta` local to `v0.5.3-beta` public.**
> **This is a runbook, not a feature spec. Follow steps in order.**

---

## Phase 0 — Decisions you need to make BEFORE starting

These choices are sticky (changing them mid-flight is painful), so settle them first.

### D1. Domain name

Pick one. Buy from Namecheap / Porkbun / Cloudflare Registrar (~$10-50/year):

| TLD | Vibe | Notes |
| --- | --- | --- |
| `agentspendguard.com` | classic | safest if available |
| `agentspendguard.io` | dev-tool tier | classic for infra brands |
| `agentspendguard.dev` | dev-tool tier | Google-owned, HTTPS-only by default |
| `agentspendguard.ai` | AI-company tier | ~$60-100/year, signal-heavy |

**Recommendation:** if `.com` is available — buy it. If not — `.dev`.

### D2. Subdomain layout

Recommended pattern (industry standard):
```
agentspendguard.com         → landing (Vercel/Netlify/Cloudflare Pages)
api.agentspendguard.com     → API (Render/Fly/Railway)
docs.agentspendguard.com    → eventually, redirects to GitHub docs for now
```

The landing page JS expects `window.AGENT_SPEND_GUARD_API_BASE = "https://api.<domain>"`. If you change the pattern, tell me — I update the placeholder.

### D3. Hosting providers (TWO needed)

**For the API:**

| Host | Cost/month | Setup time | Best for |
| --- | --- | --- | --- |
| **Render** (recommended) | $7 web service + $1 disk | 15 min | first-time deploys, you want minimum surprises |
| Fly.io | $5-15 | 30-45 min | edge regions, fly CLI familiarity |
| Railway | $5-20 | 15 min | nixpacks auto-detection, no config |
| Hetzner/DO + Caddy | $4-12 | 1-2 hours | full control, willing to do TLS yourself |

`DEPLOYMENT.md § 3` has the exact recipes for all four. Render config is shortest.

**For the landing:**

| Host | Cost | Notes |
| --- | --- | --- |
| **Vercel** (recommended) | free | drag `web/` folder, done |
| Netlify | free | same |
| Cloudflare Pages | free | best if domain DNS is already on CF |
| GitHub Pages | free | needs the repo to be public |

The landing is one static HTML + 4 SVG files. All four hosts work the same.

### D4. GitHub repo posture

The sbbuilder folder is currently a LOCAL git repo with no remote. Decide:

| Option | Pros | Cons |
| --- | --- | --- |
| **Public GitHub repo** | landing/FAQ links work, partners can audit | open source posture; competitors see everything |
| Private repo | hide source until ready | placeholder GitHub links stay broken |
| No GitHub at all | simplest | landing/FAQ have dead links |

**Recommendation:** public repo at `github.com/<your-username>/agent-spend-guard` (or `/spending-guard`). It's a marketing asset.

### D5. Contact email

Currently `hello@agentspendguard.example` and `beta@agentspendguard.example` in:
- Landing page `mailto:` button
- FAQ section
- Footer

Decide: real address on your new domain (e.g. `hello@agentspendguard.com` via Cloudflare Email Routing — free), or temp Gmail / Fastmail.

### D6. Initial API key list

Don't reuse `asg_v1_demo` in production. Generate per-partner keys with:
```bash
node -e "console.log('asg_v1_' + process.argv[1] + '_' + require('crypto').randomBytes(8).toString('hex'))" partnername
```

For initial deployment without partners yet, generate at least:
- `asg_v1_owner_<random>` — your own key for monitoring / smoke tests
- `asg_v1_test_<random>` — for the landing's `/v1/check` demo (rate-limited, can be public)

---

## Phase 1 — Things I prepare BEFORE you click "Deploy"

While you're buying the domain and signing up for Render, I can prepare:

### P1. A `scripts/configure-for-deploy.mjs` tool

Interactive CLI that takes:
- `DOMAIN` (e.g. `agentspendguard.com`)
- `API_SUBDOMAIN` (default `api.<DOMAIN>`)
- `GITHUB_REPO` (e.g. `your-username/agent-spend-guard`)
- `CONTACT_EMAIL` (e.g. `hello@<DOMAIN>`)

And does a single mass find-replace across the 28 placeholder locations the audit found, then prints a diff for review before committing.

### P2. A pre-deploy `npm run preflight` script

Runs:
1. Full TS test suite
2. Python test suite (if available)
3. Typecheck
4. Smoke test: builds, starts server, hits `/health` + `/v1/meta` + `/v1/public/stats`
5. Reports green/red

So you don't deploy a broken build.

### P3. A `render.yaml` for one-click Render deploy

If you go with Render, dropping `render.yaml` into the repo lets you say "Render → New Blueprint → point at repo" and it pre-fills:
- Service type (Web Service)
- Region
- Build command (`npm install && npm run build`)
- Start command (`node dist/server.js`)
- Health check path (`/health`)
- All env vars (you fill in the secret values in Render's UI)
- Persistent disk for `/var/data`

### P4. A `web/_redirects` and `web/_headers` for Vercel/Netlify

Static config so:
- HTTP → HTTPS redirect
- `/health` proxies to API (avoids CORS on health check from same origin)
- Security headers (CSP, X-Content-Type-Options, Referrer-Policy)
- Cache headers on SVG assets

### P5. Production `SECURITY.md` update

Remove "no SLA" language for what we WILL commit to in beta:
- 99% target (not contract)
- 24h security response SLO
- Log retention: 30 days minimum

I'll do P1-P5 right now while you handle D1-D6. Then we converge.

---

## Phase 2 — Deploy day (the actual sequence)

Once D1-D6 are decided and P1-P5 are done:

### Step 1 — Configure
```bash
cd C:\Users\777\Desktop\sbbuilder
node scripts/configure-for-deploy.mjs
# Answer 4 questions; review the diff; commit.
```

### Step 2 — Push to GitHub (if D4 = public/private repo)
```bash
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
git push --tags
```

### Step 3 — Generate API keys
```bash
# Owner key (for monitoring)
OWNER_KEY=$(node -e "console.log('asg_v1_owner_' + require('crypto').randomBytes(8).toString('hex'))")
# Public demo key (rate-limited, for landing JS demo)
TEST_KEY=$(node -e "console.log('asg_v1_test_' + require('crypto').randomBytes(8).toString('hex'))")
echo "$OWNER_KEY"
echo "$TEST_KEY"
# Save to your password manager. You'll paste these into Render.
```

### Step 4 — Deploy API to Render
1. Render → New → Blueprint → connect GitHub repo → pick `render.yaml`
2. In env vars, set:
   - `AGENT_SPEND_GUARD_API_KEYS` = `<OWNER_KEY>,<TEST_KEY>`
   - everything else is in `render.yaml`
3. Deploy. Wait for green.
4. Attach custom domain `api.<your-domain>`. Render gives you a CNAME target.
5. In your DNS (Cloudflare / registrar), add CNAME `api` → Render's hostname. TLS auto-issues in ~2 min.

### Step 5 — Smoke test API
```bash
HOST=https://api.<your-domain>
curl -s "$HOST/health"               # → {ok:true, ... "version":"0.5.3-beta"}
curl -s -H "Authorization: Bearer $OWNER_KEY" "$HOST/v1/meta" | jq .endpoints
curl -s "$HOST/v1/public/stats" | jq .total_checks
```

### Step 6 — Deploy landing
1. Vercel → New Project → Import repo OR drag-and-drop `web/` folder
2. Set env / build: none needed (pure static)
3. Deploy. Get vercel.app URL.
4. Attach custom domain `<your-domain>` and `www.<your-domain>`. DNS A/CNAME records per Vercel's instructions.
5. The landing JS auto-detects production hostname and pulls from `https://api.<your-domain>/v1/public/stats`.

### Step 7 — Smoke test landing
1. Open `https://<your-domain>/` in browser
2. Counter animates from $0 to live API values within ~3 seconds
3. Click each FAQ — all expand cleanly
4. Click code tabs — switch between TS/Python/curl
5. View page source — check `og:image` is real PNG URL (after rasterizing — see Phase 3)
6. Twitter/Facebook share preview tool: paste your URL, confirm OG card renders

### Step 8 — Wire monitoring
1. UptimeRobot (free): add HTTPS monitor on `https://api.<your-domain>/health`, 5-min interval, alert your email on 3 consecutive failures
2. UptimeRobot: same for `https://<your-domain>/` (landing)
3. Render's built-in metrics dashboard — check CPU/memory baseline

### Step 9 — DNS sanity
```bash
dig +short <your-domain>           # should show landing host IPs
dig +short api.<your-domain>       # should show Render's hostname / IPs
dig +short MX <your-domain>        # email routing (if you set up Cloudflare Email Routing)
```

### Step 10 — Announce-ready check
- [ ] `https://api.<your-domain>/health` returns 200 with `version: "0.5.3-beta"`
- [ ] `https://<your-domain>/` loads in <2s, counter animates, no console errors
- [ ] Twitter share preview shows OG card correctly
- [ ] UptimeRobot has run for 24+ hours with no failure alerts
- [ ] You can paste a partner-key invite template and have it Just Work

---

## Phase 3 — First 7 days live

### Pre-announce (Day 0)

Don't announce immediately. Let the site sit for 24-48 hours so:
- DNS propagation completes globally
- Render's autocert is stable
- You catch any "works on US East not EU West" issues yourself

### Soft announce (Day 1-2)

Send 5-10 individual messages to potential partners. Personal, not a tweet thread.
Template at `BETA_FEEDBACK_TEMPLATE.md`-adjacent — what to write is in `LAUNCH_CHECKLIST.md § "The actual launch sequence"` step 7.

### Public announce (Day 3-7)

Tweet / blog / agentic.market listing — only AFTER at least 1 personal partner has integrated and confirmed it didn't break their agent. **Don't pre-commit on public if a real run might fail.**

### Daily check (every day, Day 1-7)

```bash
npm run logs:summary    # on the production host (or scp the log down)
```

Look for:
- `total_checks` growing — partners actually using it
- `warn` + `require_confirmation` rate around 10-25% of total — calibration sane
- `block` rate near 0% — deterministic blockers shouldn't fire often
- No 5xx in Render logs

### Trigger points

| Signal | Action |
| --- | --- |
| Render 5xx > 1% | Investigate immediately, may need to roll back |
| Same partner generates 100% allow | Calibration too lax, or partner isn't using guard properly |
| Same partner generates >50% warn | Calibration too aggressive, false positives, urgent fix |
| Decision log >500 MB | Trigger logrotate; consider S3 archive |
| Custom domain TLS warning | Render usually fixes auto; if not, force-renew |

---

## What I'll do for you right now (Phase 1 prep)

While you're at the registrar:

1. `scripts/configure-for-deploy.mjs` — interactive placeholder swap tool
2. `scripts/preflight.mjs` — pre-deploy sanity check
3. `render.yaml` — drop-in Render Blueprint
4. `web/_redirects` + `web/_headers` — for Vercel/Netlify
5. `SECURITY.md` update — 1.0-track commitments

I'll commit them and tell you when ready. Then you come back with your 4 placeholder values and we converge in <30 minutes.

---

## What you tell me when ready

A single message:

```
domain:        agentspendguard.com   (or whatever you got)
api subdomain: api.agentspendguard.com
github repo:   github.com/your-username/agent-spend-guard
contact email: hello@agentspendguard.com
hosting api:   render | fly | railway | vps
hosting site:  vercel | netlify | cloudflare-pages | github-pages
```

And I run `node scripts/configure-for-deploy.mjs`, review the diff with you, commit, and you're 30 minutes from green production.
