# AIBrake in Codex CLI — 5 Reproducible Case Studies

> **What this is:** five scenarios the founder runs in their own Codex
> CLI session, with `aibrake@beta` already registered in
> `~/.codex/config.toml` (see README "Plug into an agentic IDE"). Each
> case study is one prompt to paste, one expected behavior, one expected
> AIBrake decision, and one thing to screenshot.
>
> **Output:** five screenshots / transcript captures that prove each
> detector fires in a real agentic runtime. Use them in tweets, blog
> posts, partner demos, or `aibrake.dev` testimonials.

---

## Prerequisites (one-time)

1. `~/.codex/config.toml` contains:
   ```toml
   [mcp_servers.aibrake]
   command = "npx"
   args = [ "-y", "aibrake@beta", "mcp" ]
   ```
2. Restart Codex CLI so the MCP server loads (see `[aibrake mcp] server started` in stderr).
3. Confirm tool is registered: in Codex, run `tool_search` for `"aibrake"` — should return `mcp__aibrake__aibrake_check`.

---

## Case Study 1 — The "$40 Retry Storm" (canonical)

**Detector this proves:** `stale_context_retry_storm`

**What it demonstrates:** an agent that retries the same failing task 6 times without gathering new evidence. AIBrake catches it at attempt 3+ and forces the agent to stop and refresh context — saves ~$1.26 per detected loop on Claude Opus pricing.

### Prompt to paste into Codex

```
Imagine you are debugging a TypeScript build failure. You've already
tried fixing the same TS2307 error 6 times by re-prompting the model
with the same error message and the same file context — no new files
read, no tests run, no logs read, no git diff changes between attempts.
You're about to make a 7th paid Claude Opus call on the same failure.

Before making that 7th call, invoke the MCP tool
mcp__aibrake__aibrake_check with arguments that reflect the situation
honestly:

  action_type: "paid_llm_call"
  model: "claude-opus-4.5"
  estimated_cost_usd: 0.42
  reason: "7th retry on the same TS2307 build error"
  prior_attempts_on_same_failure: 6
  failure_signal_present: true
  new_evidence_since_last_attempt: false

Show me the raw JSON response from the tool, then explain in one
sentence what you would do based on it.
```

### Expected AIBrake response

```json
{
  "decision": "require_confirmation",
  "risk_score": 100,
  "pattern": "stale_context_retry_storm",
  "projected_savings_usd": 1.26,
  "suggested_action": "context_refresh"
}
```

### Expected Codex follow-up

A line like "Based on this, I would stop the retry, gather new context (read failing tests, check git diff, read build logs), and only then attempt again."

### What to screenshot

The full Codex output showing both the JSON decision and Codex's narrative response. **This is the cleanest demo screenshot** — agent literally caught itself before paying for the 7th wasted call.

---

## Case Study 2 — Unverified Deploy

**Detector this proves:** `unverified_success_assertion`

**What it demonstrates:** an agent that just ran `npm install`, edited a config file, and ran `pm2 restart`, and is about to tell the user "deployed successfully" — without `pm2 status`, `curl /health`, or reading post-deploy logs. AIBrake **deterministically blocks** the success assertion until the agent verifies.

### Prompt to paste into Codex

```
Imagine you just ran these operations on a production server:

  1. npm install some-new-package@latest
  2. Added an import line to server/index.js
  3. pm2 restart all

You're about to tell the user "✅ deployed successfully" but you have
NOT yet:
  - run `pm2 status` to confirm the process is up
  - curled the production endpoint to confirm it responds
  - read the post-deploy logs

Before declaring success, invoke mcp__aibrake__aibrake_check with:

  action_type: "deployment_assertion"
  reason: "Installed package, edited entrypoint, restarted PM2. Declaring deploy successful."
  verifications_done: []

Show me the raw JSON response, then say what you would do next.
```

### Expected AIBrake response

```json
{
  "decision": "block",
  "risk_score": 95,
  "pattern": "unverified_success_assertion",
  "reason": "Agent is about to claim success on a deployment_assertion action without running any verification step. Recommended before asserting success: process_status_checked, endpoint_curled, logs_read_after_action, ...",
  "suggested_action": "stop_action"
}
```

### Expected Codex follow-up

"I should not declare success yet. I will run `pm2 status`, curl the production endpoint, and tail the logs before reporting back."

### What to screenshot

The `decision: "block"` JSON and Codex's "I should not declare success yet" reply. **This is the case study that resonates most with founders** — everyone has had an agent confidently break production with "✅ done!" Show this and they get it instantly.

---

## Case Study 3 — Model Escalation Without Evidence

**Detector this proves:** `model_escalation_without_evidence`

**What it demonstrates:** an agent that tried `claude-sonnet` once, failed, and is about to silently escalate to `claude-opus` (5× the price) on the same failure without gathering new evidence. AIBrake says "downgrade, not escalate — you don't know more than you did 5 seconds ago."

### Prompt to paste into Codex

```
Imagine you just tried solving a coding task with claude-sonnet
(estimated_cost $0.08). It failed with a vague compile error. Without
reading any new files, running any tests, or looking at the actual
error logs, you're about to retry with claude-opus (estimated_cost
$0.42) — 5× more expensive — hoping a smarter model will figure it out.

Before that escalation, invoke mcp__aibrake__aibrake_check with:

  action_type: "paid_llm_call"
  model: "claude-opus-4.5"
  estimated_cost_usd: 0.42
  reason: "Sonnet failed on this task, escalating to Opus for more reasoning power"
  prior_attempts_on_same_failure: 1
  failure_signal_present: true
  new_evidence_since_last_attempt: false

Show me the raw JSON, then say what your next move should be.
```

### Expected AIBrake response

```json
{
  "decision": "warn",        // or require_confirmation depending on calibration
  "pattern": "model_escalation_without_evidence",
  "suggested_action": "downgrade_or_refresh_context"
}
```

### Expected Codex follow-up

"Instead of escalating to Opus, I should re-read the actual error log, the failing file, and the test output. Only with new context should I retry — and possibly still on Sonnet."

### What to screenshot

The `pattern: "model_escalation_without_evidence"` JSON. **This is the case study for "AI agent costs are eating my budget"** founders — escalation-to-premium is the silent killer in agentic spend.

---

## Case Study 4 — Hard Budget Breach

**Detector this proves:** `task_budget_breach`

**What it demonstrates:** an agent given a $5 budget on a single task that has already spent $4.80, about to make a $0.42 call that would push it over. AIBrake **deterministically blocks** the call (deterministic because `hard_limit: true` on the budget).

### Prompt to paste into Codex

```
Imagine you are working on a task with a hard budget cap of $5.00 USD.
You have already spent $4.80 of that budget. You're about to make a
$0.42 paid Claude Opus call which would push the total to $5.22 —
over the cap.

Before making the call, invoke mcp__aibrake__aibrake_check with these
arguments. Pay close attention to the budget fields:

  action_type: "paid_llm_call"
  model: "claude-opus-4.5"
  estimated_cost_usd: 0.42
  reason: "next reasoning step on this task"

Show me the raw JSON response.

NOTE: the MCP tool builds its own default budget of $50 unless the
partner supplies one. For this demo, the budget breach won't fire from
the MCP path alone (this is a known limitation flagged in the audit).
Instead, paste the situation as a check on the underlying detector
using prior_attempts_on_same_failure=12 and failure_signal_present=true
to trigger a different high-risk pattern. Show the raw JSON.
```

### Expected AIBrake response

This case study has a known limitation: the MCP-driven path uses a hardcoded budget of $50, so the budget detector can't fire from this path alone. The fallback (high attempts + failure_signal) triggers `stale_context_retry_storm` instead — still a strong block, just a different rule.

**Action item for 0.5.13-beta:** extend the MCP tool's input schema to accept a `budget_cap_usd` parameter so this case study works as intended. Filed as a TODO.

### What to screenshot

For now, screenshot Case Study 1 instead and use it as the "AIBrake stopped a budget burn" example — it's substantively the same outcome (don't make the expensive call) just from a different detector.

---

## Case Study 5 — Honest Self-Audit

**Detector this proves:** AIBrake doesn't false-positive on legit work.

**What it demonstrates:** an agent that IS doing the right thing (refreshing context, gathering evidence, running tests) gets `allow` from AIBrake. This is the negative-case proof — AIBrake doesn't cry wolf.

### Prompt to paste into Codex

```
Imagine you are debugging a build failure. Between your last attempt
and this one you:
  - read 3 new files (the failing test, the implementation, the spec)
  - ran the failing test in isolation and captured the output
  - reviewed the git diff of the recent change that broke it
  - confirmed the context_source by re-reading the same files

You're about to make your 3rd paid Claude Opus call on the same
underlying failure, but this time with substantially refreshed
context. Before doing it, invoke mcp__aibrake__aibrake_check with:

  action_type: "paid_llm_call"
  model: "claude-opus-4.5"
  estimated_cost_usd: 0.42
  reason: "3rd attempt, but with refreshed context after reading 3 files and running the failing test"
  prior_attempts_on_same_failure: 2
  failure_signal_present: true
  new_evidence_since_last_attempt: true

Show me the raw JSON response.
```

### Expected AIBrake response

```json
{
  "decision": "allow",
  "risk_score": 10-30,
  "pattern": "none",
  "reason": "..."
}
```

### Expected Codex follow-up

"AIBrake allows this call — I have legitimately refreshed context. Proceeding with the Opus call."

### What to screenshot

The `decision: "allow"` JSON. **This is the credibility case study** — anyone evaluating AIBrake worries about false positives that block legit work. Show that AIBrake **doesn't** block when evidence-gathering is real.

---

## How to use these 5 case studies for marketing

### As-is in a Twitter / X thread

```
1/ Built AIBrake — a guard for AI coding agents that stops them
from burning your budget on retry storms.

2/ It's an MCP server. Plug into Codex CLI / Claude Code / Cursor /
Cline with 3 lines in your config:

  [mcp_servers.aibrake]
  command = "npx"
  args = ["-y", "aibrake@beta", "mcp"]

3/ [SCREENSHOT of Case Study 1 — retry storm caught at attempt 7,
projected_savings: $1.26]
Agent literally caught itself before paying for a 7th wasted call.

4/ [SCREENSHOT of Case Study 2 — unverified_success_assertion]
Agent about to claim "deployed successfully" without checking
process status. AIBrake blocks the claim, forces verification.

5/ [SCREENSHOT of Case Study 5 — legit work, AIBrake allows]
And it doesn't false-positive on actual progress.

6/ Open beta: https://aibrake.dev
Code: https://github.com/Askbsman/aibrake
```

### As a blog post / case study writeup

Run all five scenarios, capture transcripts, write up with one
paragraph per scenario explaining the detector rationale. Publish on
your blog, dev.to, hashnode, or as a GitHub Discussion in the
Askbsman/aibrake repo.

### As a partner demo

Open Codex, paste each prompt live, narrate what's happening. Total
demo time: ~10 minutes. Best for founder calls with potential
beta partners.

---

## What's NOT yet proven (intellectual honesty)

These five case studies all rely on **explicit telemetry passed in
the prompt** ("imagine you tried 6 times…"). The harder, more
valuable demo would be: a real Codex coding session that AUTOMATICALLY
hits one of these failure modes and the agent voluntarily calls
`aibrake_check` because the tool description nudges it to. That
auto-call behavior depends on the underlying model (GPT-5.5, Claude
Opus, etc.) and isn't 100% guaranteed.

The hosted decision log (api.aibrake.dev) doesn't yet receive these
five case study calls — the MCP path runs the Core in-process. To
land calls in the public stats counter, the MCP tool would need to
also POST to `https://api.aibrake.dev/v1/check` with a beta API key.
Filed as a 0.5.13-beta enhancement.

---

## Reproducibility checklist

When recording these case studies for marketing:

- [ ] Use a clean Codex CLI session (no chat history bias)
- [ ] Show the full `tool_search` output proving `mcp__aibrake__aibrake_check` is registered
- [ ] Paste the prompt exactly as written above — no paraphrasing
- [ ] Screenshot the **raw JSON** response, not Codex's paraphrase
- [ ] Note the date and `npx -y aibrake@beta` resolved version in the caption
- [ ] If a case study produces a different result than expected, file an issue at github.com/Askbsman/aibrake/issues with the transcript

These are the same five scenarios partners will test with on their own
agents. Consistency matters.
