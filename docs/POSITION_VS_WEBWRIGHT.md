# AIBrake vs Webwright — different problems, same goal

> **TL;DR.** Microsoft Webwright makes browser-using agents finish tasks
> better (60.8% Odysseys). AIBrake makes paid AI agents stop wasting
> money when they're not finishing (98.0% LCR on v1 corpus). The two
> ship together in a healthy production stack — Webwright extends what
> the agent CAN do; AIBrake constrains what the agent SHOULD do.

---

## Why this post exists

Microsoft released Webwright last week — a Playwright fork built for
autonomous AI agents. Generates reusable scripts, parametrises CLI tools,
reduces context drift, scores 60.8% on the Odysseys benchmark.

We released AIBrake the same week — an MCP server that catches
retry-storms, unverified deploys, premium-model burn, and budget
breaches before they happen. 98.0% LCR on a published corpus.

People are going to ask: are these competitors?

**No.** They're complementary. Webwright is a tool. AIBrake is a
guardrail. They live in different parts of the stack.

---

## Quick comparison

| | Webwright | AIBrake |
| --- | --- | --- |
| **Category** | Tool / framework | Guardrail / middleware |
| **What it does** | Extends agent capability — better browser control, reusable scripts, parametrised CLI | Constrains agent behaviour — blocks retry storms, unverified deploys, budget breaches |
| **Trigger** | Agent calls a Webwright primitive | Agent calls `mcp__aibrake__aibrake_check` before any expensive / loop-prone action |
| **Built on** | Playwright | Stateless detector pipeline, 6 evidence-based detectors |
| **Integration standard** | agentskills.io (Hermes-native skill) | MCP (Anthropic / Cursor / Cline / Codex CLI) — **also** agentskills.io as of today |
| **Latency** | depends on browser ops | p50 0.004 ms (4 microseconds) |
| **Public metric** | 60.8% on Odysseys long-task benchmark | 98.0% LCR on isolated-scenario corpus · **100% sensitivity / 100% precision** on 130-step Odyssey multi-step session corpus |
| **Origin** | Microsoft | Indie founder, open source MIT |
| **License** | Microsoft license | MIT |

The metric numbers measure **different things** — don't confuse them.
Odysseys tests task COMPLETION. LCR tests loop-pattern CATCH. Both are
valid; both matter.

---

## The mental model

```
                       ┌─ User ─┐
                            │
                            ▼
                       ┌─ Agent ─┐
                        ╔══════════╗
                        ║          ║
   ┌──── AIBrake ──────┤  decide  │
   │   (before action)  ║          ║
   │                    ╚══════════╝
   │                          │
   │                          ▼
   │                  ┌─ Tool calls ─┐
   │                            │
   │                            ▼
   │                   ┌── Webwright ──┐
   │                    (browser ops)
   │                            │
   ▼                            ▼
log/audit              actual work done
```

Webwright sits in the **action path** — when the agent decides to do
browser stuff, Webwright does it efficiently. AIBrake sits in the
**decision path** — when the agent decides WHETHER to do another paid
LLM call / deploy / claim of success, AIBrake checks if the agent is
looping.

You want **both**.

---

## When to reach for which

### Reach for Webwright when

- Your agent's main task involves browser automation, scraping, web testing
- You want reusable scripts auto-generated from agent sessions
- Long-horizon browser tasks where context drift is hurting you
- You're already on Playwright and want agent-native primitives

### Reach for AIBrake when

- Your agent makes paid LLM calls and you've seen retry storms eat your budget
- Your agent makes operational claims ("✅ deployed", "✅ fixed", "✅ done")
  and you want them gated behind actual verification
- You want a hard `block` on budget breaches without writing your own enforcement
- You want one MCP-config-line integration that works across all your agent runtimes
- You want a published latency number (p50 0.004 ms) so adding the guardrail
  is invisible at runtime

### Reach for **both** when

- Production agent stack
- Either of the above is true AND the other is also true
- You want defence-in-depth — efficient tools (Webwright) plus a brake
  for when the tools aren't getting you anywhere (AIBrake)

---

## How AIBrake catches what Webwright doesn't

Webwright reduces context drift WITHIN a task. It doesn't tell the agent
when to stop a task that isn't working. If an agent loops on an
impossible bug 7 times, Webwright will help each individual attempt be
slightly more efficient — but it won't stop attempt #8.

AIBrake stops attempt #8. Specifically:

- **`stale_context_retry_storm`** — fires at 3+ paid attempts on the
  same `failure_fingerprint` with no new evidence between attempts.
- **`model_escalation_without_evidence`** — catches silent
  sonnet→opus fallbacks on the same failure.
- **`unverified_success_assertion`** — blocks "deployed successfully"
  claims with zero verifications (no `pm2 status`, no curl, no log read).
- **`task_budget_breach`** — deterministic block when projected spend
  would exceed an objective's hard budget cap.
- **`objective_drift`** — blocks actions explicitly in
  `objective.blocked_actions`.
- **`same_tool_retry_loop`** — soft warning when the same tool with
  same args is called 6+ times.

Each detector returns a decision (`allow / warn / require_confirmation / block`),
a risk score, a reason, and a `projected_savings_usd` figure — concrete
dollars saved by heeding the decision.

---

## Try AIBrake in 4 lines

Same `~/.codex/config.toml` (or `~/.claude/settings.json`, or your IDE's
MCP config — same shape across all of them):

```toml
[mcp_servers.aibrake]
command = "npx"
args = ["-y", "aibrake@beta", "mcp"]
```

Restart the agent. `mcp__aibrake__aibrake_check` appears as a tool.
No API key required; no signup; the tool runs the AIBrake Core
in-process via `npx`. Set `AIBRAKE_API_KEY` if you also want hosted
decision-log forwarding.

For Node.js apps that call OpenAI / Anthropic directly (not via an
agent IDE), `import "aibrake/auto"` monkey-patches the SDK — same one-line story.

---

## Try it agentskills-style

Drop `skills/aibrake/SKILL.md` from
[the repo](https://github.com/Askbsman/aibrake/tree/main/skills/aibrake)
into any agentskills-compatible runtime — Cursor, Claude Code, OpenAI
Codex CLI, GitHub Copilot, OpenHands, Goose, Letta, Roo Code, Junie,
and others listed at [agentskills.io/clients](https://agentskills.io/clients).
The skill teaches your agent **when** to call `aibrake_check` and
**how** to fill the parameters honestly — same level of integration
Microsoft shipped for Webwright + Hermes.

---

## Repro the benchmarks

```bash
git clone https://github.com/Askbsman/aibrake.git
cd aibrake
npm install
npx tsx benchmarks/run-lcr.ts        # 98.0% LCR (isolated scenarios)
npx tsx benchmarks/run-odyssey.ts    # 100/100 on multi-step sessions
```

**LCR (`benchmarks/corpus.ts`)** — 100 labeled isolated scenarios
across the 6 detectors. Tests decision boundaries.

**Odyssey (`benchmarks/odyssey-corpus.ts`)** — 5 hand-crafted agent
sessions of 15–40 steps each (130 steps total). Mixes loop-prone
regions with legitimate progress. Tests AIBrake's behavior under
realistic context drift — does it catch the loops without flagging
the work?

Both are synthetic v1. v2 will be real partner traces with
human-reviewed labels.

---

## Links

- AIBrake: [aibrake.dev](https://aibrake.dev) · [github.com/Askbsman/aibrake](https://github.com/Askbsman/aibrake) · [npm](https://www.npmjs.com/package/aibrake)
- Webwright: [Microsoft announcement](https://github.com/microsoft/webwright)
- Agent Skills standard: [agentskills.io](https://agentskills.io)
- Model Context Protocol: [modelcontextprotocol.io](https://modelcontextprotocol.io)
