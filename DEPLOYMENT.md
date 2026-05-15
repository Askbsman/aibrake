# DEPLOYMENT — Agent Spend Guard Hosted Beta

> Status: Stage 0.3 hosted-beta candidate. Single-instance deployment, no horizontal scaling, no managed database. If you need more than that, you are past Stage 0.3 — open an issue.

This document is what a partner integrating Agent Spend Guard into their own infrastructure (or a vendor hosting it for a small beta cohort) needs to ship it.

---

## 1. What you are deploying

A Node.js (20+) HTTP server. One process. Three endpoints:

```
GET  /health        → liveness, free
GET  /v1/meta       → product metadata, free
POST /v1/check      → rules-only pre-flight judgment (auth + rate-limited)
POST /v1/check-deep → honest stub in 0.3 (same auth + rate limit)
```

No database. No external dependency. No background workers. State lives in-process for the rate limiter only; everything else is stateless.

Memory footprint: < 100 MB. CPU: negligible for < 100 req/s.

---

## 2. Pick a host

Any standard Node host works. We recommend, in order:

| Host | Why |
| --- | --- |
| **Render** | Easiest setup; free tier covers a beta cohort; auto-TLS; persistent disk if you want JSONL logs survived restarts |
| **Fly.io** | Cheaper, edge regions, persistent volumes |
| **Railway** | Closest to "git push and it runs" |
| **Bare VPS (Hetzner / DigitalOcean droplet)** | Full control; pair with Caddy or Nginx for TLS |

Do **not** use Kubernetes. Single-instance is the design target.

---

## 3. Build & run

### Local

```bash
git clone <repo>
cd spending-guard
npm install
npm run build
cp .env.example .env
# edit .env to set AGENT_SPEND_GUARD_API_KEYS
node dist/server.js
```

### Docker

```bash
docker build -t agent-spend-guard:0.3.0-beta .
docker run -p 8080:8080 \
  -e AGENT_SPEND_GUARD_AUTH_MODE=required \
  -e AGENT_SPEND_GUARD_API_KEYS=asg_v1_partner_a,asg_v1_partner_b \
  -e AGENT_SPEND_GUARD_LOG_SINK=jsonl \
  -v $(pwd)/logs:/app/logs \
  agent-spend-guard:0.3.0-beta
```

Mount a host volume to `/app/logs` if you want JSONL decision logs to survive container restart.

### Render / Fly / Railway

Push to a git remote and connect the host to it. Set environment variables from `.env.example`. Set start command to `node dist/server.js`. Build command is `npm install && npm run build`.

---

## 4. Environment

See `.env.example` for the full list. The four you must set for a hosted beta:

```
AGENT_SPEND_GUARD_AUTH_MODE=required
AGENT_SPEND_GUARD_API_KEYS=asg_v1_partner_a,asg_v1_partner_b,...
AGENT_SPEND_GUARD_LOG_SINK=jsonl
AGENT_SPEND_GUARD_LOG_PATH=./logs/decisions.jsonl
```

---

## 5. Generating API keys

The format is a convention, not enforced. Recommended: `asg_v1_<24+ base32 chars>`.

One-liner for Linux/macOS:

```bash
echo "asg_v1_$(openssl rand -hex 12 | head -c 24)"
```

PowerShell:

```powershell
"asg_v1_" + -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
```

Add the result(s) to `AGENT_SPEND_GUARD_API_KEYS` (comma-separated). Restart the server to pick up the change. There is no key rotation UI; rotation is "regenerate and restart" in Stage 0.3.

---

## 6. TLS

Stage 0.3 does not terminate TLS itself. Use the host platform's TLS (Render/Fly/Railway/Vercel auto-provision Let's Encrypt) or front the process with Caddy / Nginx.

Do not run unencrypted in production. Partners will be sending action telemetry that may include error fingerprints, file paths, and reasons — none of these are secrets but they should not traverse the public internet in cleartext.

---

## 7. Rate limit semantics

Per API key, sliding 60-second window. Default 600 = 10 req/sec/key.

Tune via `AGENT_SPEND_GUARD_RATE_LIMIT_PER_KEY_PER_MIN`.

Set to `0` to disable (not recommended in hosted-beta).

When a key exceeds its quota:

```
HTTP 429
Retry-After: <seconds>
{ "error": { "code": "RATE_LIMITED", "message": "..." } }
```

Anonymous traffic (when `AGENT_SPEND_GUARD_AUTH_MODE=optional`) shares one synthetic `anon` bucket.

---

## 8. Logs

Stage 0.3 emits one JSONL line per `/v1/check` (and `/v1/check-deep`). Fields:

```
event_type, request_id, input_hash, api_key_hash, objective_id,
actor_runtime, decision, recommended_policy, pattern, risk_score,
confidence, detector_version, policy_version, matched_rules_count,
matched_rules, timestamp
```

What is **never** logged:

```
raw API key
raw prompts
raw file contents
raw error messages (only the failure fingerprint is logged)
private conversations
```

If `AGENT_SPEND_GUARD_LOG_PATH` cannot be written (disk full, permission denied), the server emits one stderr warning per minute and continues serving requests. API responses are never blocked by logging failures.

### Aggregating logs

```bash
npm run logs:summary
```

This reads `AGENT_SPEND_GUARD_LOG_PATH` and prints a beta-style summary (totals, decision breakdown, pattern frequencies). No dashboard; CLI is the intended interface for Stage 0.3 partners.

---

## 9. Health check

The host's health probe should hit `GET /health`. Expect:

```json
{ "ok": true, "service": "agent-spend-guard", "version": "0.3.0-beta", "mode": "hosted-beta" }
```

Status 200 always when the process is running.

---

## 10. Upgrading

```bash
git pull
npm install
npm run build
# restart the process (Render/Fly/Railway auto-redeploy on push)
```

Stage 0.3 → 0.4 may include schema additions; all schema fields remain optional and backward-compatible. There is no migration step. The Dockerfile is pinned to the major Node version (20).

**Python SDK smoke check (Stage 0.5).** If you ship a Python wrapper alongside the hosted service, validate the SDK on the deploy host:

```bash
cd python
pip install -e ".[dev]"
python -m pytest
# Quick check without test deps:
python -c "from agent_spend_guard import AgentSpendGuard; print('ok')"
```

The integration suite (`test_integration.py`) is opt-in — it skips automatically unless you set `AGENT_SPEND_GUARD_URL` to a reachable server and the `integration` marker fires:

```bash
AGENT_SPEND_GUARD_URL=http://localhost:8080 \
AGENT_SPEND_GUARD_API_KEY=asg_v1_demo \
python -m pytest -m integration
```

---

## 11. What is intentionally missing

- TLS termination
- Multi-tenant onboarding UI
- Self-serve key management
- Distributed rate limit (Redis-backed)
- Decision-log shipping to S3 / BigQuery / Datadog
- A management dashboard
- Auto-rotation of keys
- Per-partner per-pattern threshold customization

All of these are valid v0.4+ work once a real beta surfaces the need. Until then we stay simple.

---

## 12. Going live checklist

```
[ ] AGENT_SPEND_GUARD_AUTH_MODE=required
[ ] AGENT_SPEND_GUARD_API_KEYS set with at least one per-partner key
[ ] AGENT_SPEND_GUARD_LOG_SINK=jsonl
[ ] Persistent volume mounted at the log path (if Docker/Render)
[ ] /health returns 200 with version 0.3.0-beta and mode hosted-beta
[ ] /v1/meta returns the product metadata
[ ] Tested /v1/check with a real Bearer key from at least one terminal
[ ] Rate-limit 429 confirmed by stress test (>600 req/min against one key)
[ ] TLS verified
[ ] CHANGELOG entry exists for this deploy
[ ] PARTNER_ONBOARDING.md sent to each partner with their unique key
```

If any checkbox is unchecked, you are not in hosted beta — you are in dev.
