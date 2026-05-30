# AIBrake on Hermes Agent

AIBrake's `skills/aibrake/SKILL.md` is agentskills.io-compatible — Hermes
Agent (NousResearch) loads it the same way it loads any other skill folder.

This page is for users running [Hermes Agent](https://hermes-agent.nousresearch.com).
For Claude Code / Cursor / Codex CLI etc., see the main README — MCP one-liner.

---

## 1. Install — fastest path (manual, 1 minute)

```bash
# 1. Clone the AIBrake repo (or just the skills/ folder)
git clone https://github.com/Askbsman/aibrake.git /tmp/aibrake

# 2. Move the skill into Hermes' skills directory
mkdir -p ~/.hermes/skills/agent-safety
cp -r /tmp/aibrake/skills/aibrake ~/.hermes/skills/agent-safety/aibrake

# 3. Restart Hermes — it auto-scans ~/.hermes/skills/ on startup
```

After restart:
- `/aibrake` slash command appears
- `skills_list()` returns aibrake among the others
- Natural-language queries about retry storms / model escalation /
  unverified deploys will pull the skill via progressive disclosure

---

## 2. Install — external dir (multi-machine teams)

If your team keeps shared skills in one place, point Hermes at it
instead of copying:

```yaml
# ~/.hermes/config.yaml
skills:
  external_dirs:
    - ~/agents/skills      # path to your shared skills checkout
```

Then put `aibrake/SKILL.md` under `~/agents/skills/aibrake/SKILL.md`
and restart.

---

## 3. Verify it loaded

In a Hermes session:

```text
You: /skills
```

You should see `aibrake` listed with description starting "Catch
retry-storms, unverified deploys...".

To smoke-test the skill instructions are wired in:

```text
You: /aibrake
```

Hermes should respond with the skill's body content (the same
"WHEN to call aibrake_check / HOW to fill parameters" instructions
that Claude Code, Codex, OpenClaw see).

---

## 4. Wire the runtime

The skill instructs the agent to call `mcp__aibrake__aibrake_check`.
Hermes needs that MCP server registered. Two options:

### Option A — MCP server (recommended)

Hermes supports MCP servers via its `~/.hermes/mcp.json` (or equivalent
per-version config). Add:

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

Restart Hermes. `aibrake_check` becomes a tool the agent can call. No
API key required for the local-Core path.

### Option B — direct npm/SDK use

If you'd rather call AIBrake from your agent code directly (no MCP
indirection):

```bash
npm install aibrake@beta
```

```ts
import { runCheck } from "aibrake/sdk";
const decision = runCheck(input);
```

The SDK is fail-open by default (returns `allow` on any error) so a
broken AIBrake install won't break your agent.

---

## 5. Hermes-specific frontmatter

The skill ships with a `metadata.hermes` block that Hermes' loader
understands:

```yaml
metadata:
  hermes:
    category: agent-safety
    tags: [agent-safety, guardrail, cost-control, loop-detection, ...]
    requires_toolsets: [terminal]
    config:
      - key: aibrake.api_key
        description: Optional hosted decision-log API key
        default: ""
        env: AIBRAKE_API_KEY
```

`requires_toolsets: [terminal]` means Hermes will only surface the
skill when a terminal toolset is available (the MCP server needs `npx`
to spawn). On environments where you wire AIBrake purely via the SDK,
the runtime is also fine — Hermes won't block the skill in that case
because the body documents both paths.

If you want to set the optional hosted API key, Hermes will prompt for
`AIBRAKE_API_KEY` on first load. Skip if you only need the local Core
path.

---

## 6. Cross-runtime portability

The same `skills/aibrake/` folder works across:

- Hermes Agent (NousResearch) — this guide
- Claude Code (Anthropic)
- OpenAI Codex CLI
- Cursor / Cline / OpenCode / OpenHands / Goose
- OpenClaw / Webwright stacks

`SKILL.md` is the contract. Adapters in `apps/aibrake/src/adapters/`
(OpenClaw / Hermes / Coding-Agent — all the same class today) handle
telemetry differences.

---

## 7. Repro the benchmarks in Hermes

After install, give Hermes the canonical "$40 retry storm" prompt:

```text
You: I've spent 40 minutes and 6 paid Opus calls trying to fix this
TS2307 build error. About to make the 7th attempt — same prompt, no
new files read. Help me decide.
```

A correctly-wired AIBrake makes Hermes call `aibrake_check`
automatically with `prior_attempts_on_same_failure: 6`,
`new_evidence_since_last_attempt: false`, and surface the
`require_confirmation` decision back to you.

---

## Links

- Hermes Agent docs: https://hermes-agent.nousresearch.com
- agentskills.io standard: https://agentskills.io
- AIBrake repo: https://github.com/Askbsman/aibrake
- Benchmarks (LCR + Odyssey): https://github.com/Askbsman/aibrake/tree/main/benchmarks
