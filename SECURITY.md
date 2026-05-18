# Security & Privacy

> **Status:** Stage 0.5.1-beta
> **Scope:** what the hosted AIBrake beta records, what it deliberately does not, how API keys are handled, and how to report security issues.

## TL;DR

```text
We do not log raw prompts, source files, secrets, or API keys by default.
Decision logs store hashes and structured metadata only.
Fail-open is the SDK default — guard outage never takes your agent offline.
```

---

## 1. What the guard receives in a request

The `/v1/check` POST body is the agent runtime's telemetry for ONE upcoming action. Concretely:

- **Actor descriptor:** type / runtime / id (e.g. `claude-code`).
- **Objective:** id, goal text, success criteria, optional budget, optional `model_policy` / `detector_policy` / `allowed_actions` / `blocked_actions`.
- **Next action:** type, provider, model, estimated cost, optional `model_role` / `model_tier`.
- **History:** structured counts (`attempt_number`, `same_failure_count`, `paid_attempts_on_same_failure`, etc.) and `evidence_signals` (file/test/log/diff change counts, **counts only — never the file contents**).
- **Spend descriptor:** running cost on the objective.
- **Telemetry quality:** the agent's own report of how much was captured.

The schema is in [`src/core/schemas.ts`](./src/core/schemas.ts). Any field outside that schema is rejected with `VALIDATION_ERROR` and never reaches storage.

---

## 2. What the guard NEVER receives

The Core schema deliberately does not include and the server actively rejects (Zod `safeParse` fails on unknown top-level keys when partners try to send them):

- **Raw prompt text.** The decision uses `failure_fingerprint` (sha256-16 of the canonical failure descriptor) — never the prompt.
- **Source-file contents.** Only `filesRead.length` is counted, never the bytes.
- **Test output bodies, log lines, stack traces.** Only counts and the categorical `failure_signal_type`.
- **Stdout / stderr of the underlying tool.** Same.
- **API keys, OAuth tokens, secrets, credentials.** Any field that smells like one is the partner's bug — AIBrake has no slot for them.
- **PII / user content / customer messages.** None of these are in the input schema.

If a partner stuffs raw content into a string field that the schema accepts (e.g. `objective.goal`), it will be stored as-is in the request payload. **Don't.** The contract is fingerprints and counts, not free-text dumps.

---

## 3. Decision log — what's persisted server-side

When `AGENT_SPEND_GUARD_LOG_SINK=jsonl`, the server appends one structured line per `/v1/check` to the configured `AGENT_SPEND_GUARD_LOG_PATH` (default `./logs/decisions.jsonl`). The log line contains:

```jsonc
{
  "event_type": "agent_spend_guard.check.completed",
  "request_id": "req_<uuid>",
  "input_hash": "input_v1_<sha256-16>",     // not the input itself
  "api_key_hash": "key_v1_<sha256-16>",     // not the raw key
  "objective_id": "...",                    // partner-supplied label
  "actor_runtime": "...",                   // partner-supplied label
  "decision": "...",
  "recommended_policy": "...",
  "pattern": "...",
  "risk_score": 0,
  "confidence": 0.0,
  "detector_version": "...",
  "policy_version": "...",
  "matched_rules_count": 0,
  "matched_rules": [...],
  "timestamp": "..."
}
```

What is **NOT** in the log line by default:

- The request body.
- Any free-text fields (goal, success criteria, error message).
- The raw API key — only its sha256-16 hash, prefixed `key_v1_`.
- The model name in the next_action (it lives only inside the guard's in-memory decision, not on the log line).

The decision logger code is [`src/core/logger.ts`](./src/core/logger.ts) + sinks in [`src/sinks/`](./src/sinks/). To verify exactly what your hosted server emits, read those two files — there's nothing else.

---

## 4. API key handling

- Keys are partner-issued, opaque, format `asg_v1_<partnername>_<random>`. The partnername segment is for human triage in logs — it carries no auth weight.
- Keys are passed in `Authorization: Bearer <key>`. No cookies, no sessions, no signed URLs.
- The server compares against `AGENT_SPEND_GUARD_API_KEYS` (comma-separated) loaded once at process start. No database lookup per request.
- Logs record `key_v1_<sha256-16>` — never the raw key.
- Key rotation = redeploy with the updated env var. There is no API to add/revoke keys at runtime in 0.5.x.
- **If you suspect your key leaked:** notify the maintainer (see § 7), they rotate and redeploy.

---

## 5. Network / transport

- TLS termination is your hosting provider's job (Render / Fly / Cloudflare in front of your origin / nginx — see `DEPLOYMENT.md`).
- The server itself runs plain HTTP on `PORT` (default 8080). Do not expose it directly to the internet without TLS in front.
- Rate limit is per-key sliding-window, in-memory (default 600 req/min). On restart, the window resets. This is intentional — distributed rate-limiting is out of scope for the beta.

---

## 6. Fail-open default

Both SDKs (TypeScript and Python) default to `failureMode: "open"` (resp. `failure_mode="open"`). If the guard is unreachable — DNS failure, timeout, 5xx, abort — the SDK returns a synthetic `allow` result with `pattern: "guard_unavailable"` and your agent keeps running. **Your agent never goes offline because of us.**

What the SDK does NOT fail open on (Stage 0.4.1 / 0.4.2 / 0.5 contract):

- HTTP 4xx — server saw the request and rejected it → `SpendingGuardValidationError` propagates.
- `JSON.stringify` errors (BigInt, circular refs) → `TypeError` propagates.
- Any programmer error → propagates.

The discipline: failure of the guard service is operationally safe; integration bugs in your wrapper are loud.

---

## 7. Reporting a security issue

If you find a vulnerability — payload that crashes the server, auth bypass, log injection, fingerprint collision, anything that lets a request read another partner's decision — email the maintainer privately. **Do not open a public GitHub issue.**

For non-security bugs (false positives, calibration concerns, integration friction): GitHub issues are fine.

---

## 8. What we do not promise

- No legal SLA. The hosted beta is best-effort and can be taken down with short notice.
- No data-residency guarantees. The hosted server runs wherever the partner has deployed it; for the maintainer-hosted instance, see the README footer.
- No log-retention guarantee. Logs are kept on the host filesystem at `AGENT_SPEND_GUARD_LOG_PATH`. Rotate / archive as your ops policy requires.
- No compliance certifications (no SOC 2, no ISO 27001). This is a beta service for engineering teams that are comfortable with that.

When the product graduates from beta these will be revisited. Today they would be marketing, not commitments.
