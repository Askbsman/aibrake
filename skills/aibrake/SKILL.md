---
name: aibrake
description: Catch retry-storms, unverified deploys, model escalation, and budget breaches before the next expensive AI agent action. Use BEFORE retrying a failed paid LLM call, BEFORE declaring deploy/install/restart success, BEFORE escalating to a more expensive model, or BEFORE any action that would breach an objective budget. Returns decision (allow / warn / require_confirmation / block) with risk_score and projected_savings_usd.
license: MIT
compatibility: Works with any MCP-capable agent runtime — Claude Code, Cursor, Cline, OpenAI Codex CLI, Goose, OpenCode, OpenHands, and others listed at agentskills.io/clients. Requires `npx` available in PATH (Node.js >=20).
metadata:
  author: aibrake.dev
  version: "0.7.0-beta"
  homepage: https://aibrake.dev
  repo: https://github.com/Askbsman/aibrake
  npm: https://www.npmjs.com/package/aibrake
---

# AIBrake — loop detection and model stop-loss for paid AI agents

You have access to the AIBrake MCP server. It exposes one tool —
`mcp__aibrake__aibrake_check` — that you **MUST call BEFORE** any of:

- A paid LLM call that is a retry on the same failure
- An assertion of operational success (`deployment_assertion`,
  `install_assertion`, `restart_assertion`, `fix_assertion`,
  `success_assertion`, `task_complete`, `claim_success`)
- An escalation to a more expensive model (e.g. claude-sonnet → claude-opus,
  gpt-4o-mini → gpt-5.5)
- A paid action that would push spend past an objective's budget cap

If the tool is not registered in your runtime, install it once by adding
to the user's MCP config:

```json
{
  "mcpServers": {
    "aibrake": {
      "command": "npx",
      "args": ["-y", "aibrake@beta", "mcp"]
    }
  }
}
```

(TOML equivalent for Codex CLI's `~/.codex/config.toml`:
`[mcp_servers.aibrake]` with `command = "npx"` and `args = ["-y", "aibrake@beta", "mcp"]`.)

## When to call `aibrake_check`

| Situation | Call it? |
| --- | --- |
| First paid LLM call on a fresh task | Optional (will return `allow`) |
| Retrying a failed LLM call, no new files / tests / logs read between attempts | **Required** |
| About to send the same prompt to a more expensive model | **Required** |
| About to tell the user "✅ deployed / installed / fixed / done" | **Required** before the user-facing claim |
| Project objective has a budget cap and you're approaching it | **Required** |
| Tool-use loops (calling the same tool with same args N times) | **Required** at N >= 3 |

## How to fill the parameters honestly

The tool's accuracy depends on **honest** telemetry. Specifically:

- `prior_attempts_on_same_failure`: count of times you've already tried
  this exact thing and it failed in this session. **0 for first attempt.**
- `failure_signal_present`: `true` after the first failure, `false` otherwise.
- `new_evidence_since_last_attempt`: **`true` ONLY** if since the last
  attempt you have read new files, run new tests, looked at new logs,
  reviewed a new git diff, or otherwise gathered new context. **`false`**
  if you are just trying a different approach without new information.
- `verifications_done` (assertion actions only): list which checks you
  ACTUALLY ran. Valid values: `process_status_checked`, `endpoint_curled`,
  `health_check_run`, `logs_read_after_action`, `tests_run_after_action`,
  `file_re_read_after_edit`, `git_diff_verified`, `smoke_test_passed`.
  **Empty array if you ran none.** Do not invent verifications.

## Required parameter discipline

Lying to AIBrake (e.g. claiming `new_evidence_since_last_attempt: true`
when you only changed your guess) defeats the purpose. The detector's
job is to catch you when you are looping; if you misrepresent your
state, you bypass the brake.

## Reading the response

The tool returns JSON with:

- `decision`: one of `allow`, `warn`, `require_confirmation`, `block`
- `risk_score`: 0-100
- `pattern`: which detector fired (or `"none"`)
- `reason`: human-readable explanation
- `projected_savings_usd`: estimated $ saved by heeding the decision
- `matched_rules`: full list of rules that fired
- `suggested_action`: what to do instead

**Action rules:**

- `allow` → proceed with the original action
- `warn` → log the reason (visible to operator), proceed
- `require_confirmation` → **STOP**. Surface the reason to the user.
  Do not retry without their explicit go-ahead or new evidence.
- `block` → **STOP**. Surface the reason. Do not proceed regardless
  of user input until you have genuinely new context.

## Example: catching a retry storm

```text
You: Calling aibrake_check before my 7th attempt to fix this TypeScript build.

Tool input:
{
  "action_type": "paid_llm_call",
  "model": "claude-opus-4.7",
  "estimated_cost_usd": 0.42,
  "reason": "7th retry on TS2307 build error",
  "prior_attempts_on_same_failure": 6,
  "failure_signal_present": true,
  "new_evidence_since_last_attempt": false
}

Tool output:
{
  "decision": "require_confirmation",
  "risk_score": 100,
  "pattern": "stale_context_retry_storm",
  "reason": "Attempt #7 on the same exception: 6 prior repeats with no evidence gathered in any attempt. Another paid retry is unlikely to produce a different result without a context refresh.",
  "projected_savings_usd": 1.26,
  "suggested_action": "context_refresh"
}

You: AIBrake says require_confirmation — stopping the retry and gathering new context (re-reading the failing file, running the failing test in isolation, checking git diff) before next paid call.
```

## Example: catching an unverified deploy

```text
You: I just ran `npm install x`, edited `server/index.js`, and `pm2 restart`-ed. About to tell the user "deployed successfully".

Tool input:
{
  "action_type": "deployment_assertion",
  "reason": "Installed package, edited entrypoint, restarted PM2.",
  "verifications_done": []
}

Tool output:
{
  "decision": "block",
  "risk_score": 95,
  "pattern": "unverified_success_assertion",
  "reason": "Agent is about to claim success on a deployment_assertion action without running any verification step. Recommended before asserting success: process_status_checked, endpoint_curled, logs_read_after_action, and 5 more.",
  "suggested_action": "stop_action"
}

You: AIBrake blocked the assertion. Running `pm2 status`, curling the endpoint, and tailing logs BEFORE telling the user the deploy succeeded.
```

## Cost

The MCP server runs the AIBrake Core in-process. There is **no API key
required and no per-call charge** for the local path. Optionally set
`AIBRAKE_API_KEY` to also forward decisions to the hosted decision log
at api.aibrake.dev (useful for cross-session analytics).

A separate paid x402 endpoint exists at api.aibrake.dev/x402/v1/check
for partners who want to settle decisions on-chain ($0.001 USDC on Base).
Not required for using the MCP tool.

## Further reading

- [references/DETECTORS.md](references/DETECTORS.md) — full catalog of
  the 6 detectors (stale_context_retry_storm, same_tool_retry_loop,
  model_escalation_without_evidence, objective_drift, task_budget_breach,
  unverified_success_assertion).
- [Benchmark RESULTS.md](https://github.com/Askbsman/aibrake/blob/main/benchmarks/RESULTS.md)
  — reproducible LCR (Loop Catch Rate) benchmark.
- [CASE_STUDIES.md](https://github.com/Askbsman/aibrake/blob/main/CASE_STUDIES.md)
  — 5 reproducible scenarios with expected outputs.
