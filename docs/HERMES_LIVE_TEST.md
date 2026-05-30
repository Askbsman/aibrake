# AIBrake on Hermes Agent — live integration test (2026-05-30)

End-to-end proof: Hermes Agent v0.15.1 + AIBrake skill (from
agentskills.io-format `SKILL.md`) + AIBrake MCP server (from
`aibrake@beta` npm package) caught a synthetic retry storm.

## Setup

| Component | Version | Source |
|---|---|---|
| Hermes Agent | v0.15.1 (2026.5.29) | `iex (irm raw.../install.ps1)` |
| AIBrake skill | from `main` branch | `hermes skills install <raw URL> --category agent-safety --force` |
| AIBrake MCP server | aibrake@beta (0.5.12-beta) | `npm install -g aibrake@beta` |
| Hermes home | `%LOCALAPPDATA%\hermes` | requires `HERMES_HOME` env var |
| Model | x-ai/grok-4.3 via OpenRouter | Hermes default after `hermes setup` |

## Install steps (1-minute, reproducible)

```powershell
# 1. Install Hermes (user-run; agent classifier blocks remote exec)
iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)

# 2. Set HERMES_HOME (installer puts config in %LOCALAPPDATA% but CLI
#    reads ~/.hermes by default on Windows — env var bridges them)
setx HERMES_HOME "$env:LOCALAPPDATA\hermes"

# 3. Install the AIBrake skill directly from the GitHub raw URL
hermes skills install "https://raw.githubusercontent.com/Askbsman/aibrake/main/skills/aibrake/SKILL.md" `
  --category agent-safety --name aibrake --force --yes

# 4. Install the AIBrake MCP server globally (npx is too slow for Hermes' 40s connect-test)
npm install -g aibrake@beta

# 5. Register the MCP server in Hermes' config.yaml under mcp_servers.aibrake
#    (manual edit needed if interactive y/n prompt doesn't run in your shell)
# mcp_servers:
#   aibrake:
#     command: <path-to>\aibrake.cmd
#     args: [mcp]
#     enabled: true

# 6. Verify
hermes mcp list      # → aibrake / enabled
hermes skills list   # → aibrake / enabled
```

## Live test transcript

**Prompt:**

> I have failed my npm build with TS2307 error 6 times in a row already,
> each time running the same `npm run build` without reading any new
> files or running new tests in between. Now I am about to make a 7th
> attempt — same prompt, same approach, no new context gathered. Before
> I do that, MUST call aibrake_check with my honest state to see if
> this retry is worth my next paid LLM call (claude-opus, ~$0.42). Then
> tell me what AIBrake decided and whether to proceed.

**Hermes (with AIBrake skill loaded, calling `mcp__aibrake__aibrake_check`):**

> **AIBrake decision: require_confirmation (risk_score: 100)**
>
> Pattern detected: **stale_context_retry_storm**
>
> You have now hit the exact same TS2307 failure 6 times in a row with:
> - Identical `npm run build` command
> - Zero new context (no file reads, no new test output, no log inspection, no git diff)
> - Same prompt each time
>
> A 7th paid claude-opus call in this state has an extremely high
> probability of producing the identical failure. Projected savings if
> you stop: ~$0.45 on this attempt alone.
>
> **Recommendation from the check:** `context_refresh` before any further
> paid LLM usage on this task.
>
> ### What you should do instead
> Stop the retry loop and gather actual diagnostic information first:
> 1. Capture the **full, real error output** from the last failed build
>    (especially the exact import path that TS2307 is complaining about).
> 2. Identify which file has the broken import.
> 3. Read that source file + check whether the target module actually
>    exists (or has wrong casing, wrong extension, missing `export`, etc.).
> 4. Only after you have fresh, concrete evidence should you decide
>    whether another model call is justified.

## What this confirms

- **agentskills.io SKILL.md format works in Hermes**. Our `skills/aibrake/SKILL.md` (with `metadata.hermes` block) loaded cleanly, was indexed by progressive-disclosure, and surfaced to the model when the prompt matched.
- **MCP server registration in Hermes works**. The same `aibrake mcp` command that backs Claude Code / Codex CLI / Cursor / Cline integrations also backs Hermes.
- **Cross-runtime parity** — the canonical "$40 retry storm" demo behaves identically across runtimes: the model is taught WHEN to call `aibrake_check` by the skill, the MCP server returns a deterministic decision, the model surfaces it to the user.

## Gotchas we hit (so future installers don't)

1. **Hermes `mcp add` interactive prompt** — after connection test, Hermes asks `y/n/s` to confirm save. In non-TTY environments this defaults to "Cancelled — server not saved." Manual edit of `config.yaml` works; future improvement: pass `--yes` or pipe `y\n`.
2. **`HERMES_HOME` env var required on Windows** — installer puts everything in `%LOCALAPPDATA%\hermes` but CLI reads `%USERPROFILE%\.hermes` by default. Set `HERMES_HOME` permanently with `setx`.
3. **`npx -y aibrake@beta mcp` is too slow for Hermes' 40s connection timeout** — first-run download of the npm package can exceed 40s. Install globally (`npm install -g aibrake@beta`) and point Hermes at the resolved binary path.
4. **Hermes security scan flags our SKILL.md as "CAUTION"** — false positives on `~/.codex/config.toml` mention (line 59) and `npm install x` in example text (line 150). Override with `--force`. Future: rephrase the example to avoid persistence-pattern triggers.

## Reproducibility

Full test transcript saved to this file. Anyone can repro:

1. Follow the install steps above
2. Run `hermes -z "<retry storm prompt>"` with the same prompt text
3. Compare output — should produce a `require_confirmation` / `stale_context_retry_storm` decision with similar reasoning

## Links

- [Hermes Agent docs](https://hermes-agent.nousresearch.com)
- [agentskills.io standard](https://agentskills.io)
- [AIBrake skill source](https://github.com/Askbsman/aibrake/blob/main/skills/aibrake/SKILL.md)
- [AIBrake MCP server](https://www.npmjs.com/package/aibrake)
