# AIBrake launch kit — ready-to-publish content

Copy-paste any block as-is. Replace `[SCREENSHOT N]` placeholders with
your captured case study screenshots (filenames in the founder's
~/Pictures or wherever they're saved):

- `[SCREENSHOT 1]` — `aibrake-case-1-retry-storm.png` (organic graduated
  catch, attempt 1→4, AIBrake escalation from `allow` → `warn` → `block`)
- `[SCREENSHOT 2]` — `aibrake-case-2-unverified-deploy.png`
  (`deployment_assertion` with 0 verifications, `decision: block`)
- `[SCREENSHOT 3]` — `aibrake-case-3a-soft-escalation.png` (model
  escalation: 1 attempt → `allow + advice`, not false-positive)
- `[SCREENSHOT 5]` — `aibrake-case-5-honest-work-allowed.png` (real
  evidence gathered → `decision: allow`, `risk_score: 0`, **no false positives**)

---

## Twitter / X thread (EN, 7 tweets)

### Tweet 1 (opener)

```
Built AIBrake — catches retry-storms, unverified deploys, and
premium-model burn in AI coding agents.

4 lines in your MCP config. Works with Codex CLI, Claude Code, Cursor,
Cline, Goose, OpenHands.

98.0% Loop Catch Rate on a published corpus. p50 0.004 ms.

🧵👇
```

### Tweet 2 (the canonical demo)

```
The "$40 retry storm" — agent loops on the same failing TypeScript
build 7 times, each time burning $0.42 in Claude Opus tokens, no new
files read between attempts.

AIBrake catches it at attempt #3-4. Decision: require_confirmation.
projected_savings: $1.26.

[SCREENSHOT 1]
```

### Tweet 3 (the relatable demo)

```
The other catch nobody else has — "✅ deployed successfully" claims
without actually running pm2 status or curling the endpoint.

Agent runs npm install, edits a file, restarts the process — about to
declare success. AIBrake blocks. Tells the agent which verifications
it's missing.

[SCREENSHOT 2]
```

### Tweet 4 (no false positives)

```
The fear from skeptics: "won't it block legit work?"

When the agent genuinely refreshes context (reads new files, runs new
tests, checks logs), AIBrake returns decision: allow, risk_score: 0,
matched_rules: []. Silent pass.

[SCREENSHOT 5]
```

### Tweet 5 (install)

```
Install — same 4 lines for every MCP-capable runtime.

For Codex CLI (~/.codex/config.toml):
  [mcp_servers.aibrake]
  command = "npx"
  args = ["-y", "aibrake@beta", "mcp"]

For Claude Code / Cursor / Cline (JSON):
  "aibrake": { "command": "npx", "args": ["-y", "aibrake@beta", "mcp"] }

Restart agent. mcp__aibrake__aibrake_check appears in the tool palette.
```

### Tweet 6 (Webwright positioning — PR-judo)

```
Re: Microsoft Webwright (60.8% Odysseys) — different problem, same
team. Webwright makes browser-using agents finish tasks better. AIBrake
makes paid AI agents stop wasting money when they're not finishing.

You want both. Defence-in-depth for agent stacks.
```

### Tweet 7 (closer)

```
Open source MIT. npm: aibrake. Repo:
https://github.com/Askbsman/aibrake

Reproduce the 98% LCR yourself:
  npx tsx benchmarks/run-lcr.ts

Site: https://aibrake.dev

Hosted decision log API available with a beta key — DM if interested.
```

---

## Russian-language Telegram / X / VK version (6 messages)

### Message 1

```
Сделал AIBrake — ловит retry-storm'ы и unverified-deploy у AI-агентов.

98.0% Loop Catch Rate на опубликованном corpus'е. p50 latency 0.004 мс
(4 микросекунды).

4 строки в MCP-config → tool появляется в Codex / Claude Code / Cursor / Cline.

aibrake.dev
```

### Message 2 (показать catch)

```
Кейс который всем понятен — агент 7 раз пытается пофиксить тот же
TypeScript build, каждый раз Claude Opus за $0.42, между попытками
0 новых файлов прочитано.

AIBrake перехватывает на 3-4 попытке. Decision: require_confirmation,
projected_savings: $1.26.

[СКРИНШОТ 1]
```

### Message 3 (deploy)

```
А вот это блогеры особенно ценят — агент пишет "✅ задеплоено!" не
запустив pm2 status, не курлнув endpoint, не прочитав логи.

AIBrake блокирует ровно эту ситуацию. Возвращает список конкретных
проверок которые надо сделать ДО claim'а успеха.

[СКРИНШОТ 2]
```

### Message 4 (no false positives)

```
Главный страх скептиков: "а вдруг оно заблокирует мою нормальную работу?"

Когда агент реально работает (читает файлы, гоняет тесты, смотрит
diff) — AIBrake пропускает молча. decision: allow, risk_score: 0,
zero matched rules.

[СКРИНШОТ 5]
```

### Message 5 (install)

```
Установка — 4 строки в твоём MCP config.

Codex CLI:
  [mcp_servers.aibrake]
  command = "npx"
  args = ["-y", "aibrake@beta", "mcp"]

Claude Code / Cursor / Cline:
  "aibrake": { "command": "npx", "args": ["-y", "aibrake@beta", "mcp"] }

Без регистрации, без ключей. Hosted log опц.
```

### Message 6 (закрытие)

```
Open source MIT. github.com/Askbsman/aibrake

Можно прогнать benchmark самому:
  npx tsx benchmarks/run-lcr.ts

Если хочешь beta-ключ для hosted decision log — пинг.

aibrake.dev
```

---

## Hacker News / Reddit post

### Title

```
AIBrake — catches retry-storms in AI coding agents (98% LCR, MCP integration)
```

### Body

```
Hi HN — I built AIBrake to solve a problem my own agents kept causing:
they would loop on the same failing task 7+ times, each iteration
burning $0.42 in Claude Opus tokens, without gathering any new
information between attempts. Existing tools (Sentry, New Relic, agent
runtimes' own retry limits) don't catch this — they catch errors or
rate-limit network calls, not "you're spinning your wheels".

How it works:
- One MCP server you register in your agent's config (Codex CLI, Claude
  Code, Cursor, Cline, OpenHands, etc — anything supporting Model
  Context Protocol).
- One tool: `aibrake_check`. Agent calls it before any expensive paid
  action — retry, deploy claim, model escalation, budget-stretching call.
- Returns decision (allow/warn/require_confirmation/block) + risk
  score + projected $-savings + reason.

Detectors (6):
1. stale_context_retry_storm — N+ paid attempts on same failure
   fingerprint, zero new files / tests / logs between attempts
2. same_tool_retry_loop — same tool with same args called N+ times
3. model_escalation_without_evidence — premium model on repeated
   failure without new context
4. objective_drift — action explicitly in `blocked_actions`
5. task_budget_breach — projected spend > hard budget
6. unverified_success_assertion — "✅ deployed/fixed/done" claim with
   zero verification steps run

Benchmark: 98.0% Loop Catch Rate on a synthetic 100-scenario corpus
(`benchmarks/corpus.ts`). Per-detector breakdown in
`benchmarks/RESULTS.md`. Reproducible:
  git clone https://github.com/Askbsman/aibrake
  cd aibrake && npm install && npx tsx benchmarks/run-lcr.ts

Latency: p50 0.004 ms (stateless Core, no DB, no LLM judgment — pure
fingerprint matching + score aggregation).

Free to use locally. Optional hosted decision log at api.aibrake.dev.
Paid x402 endpoint at /x402/v1/check ($0.001 USDC on Base) for
on-chain settled decisions — separate path, not required.

Different from but complementary to Microsoft Webwright (released same
week, 60.8% Odysseys browser benchmark) — Webwright makes agents do
tasks better; AIBrake makes them stop when the task isn't working.

Repo: https://github.com/Askbsman/aibrake
Site: https://aibrake.dev
npm: aibrake (just `npm install aibrake` for the SDK; or use the
MCP path which doesn't require an install)

Happy to take feedback / discuss the corpus / hear about real
retry-storms in your own agents.
```

---

## dev.to / hashnode blog post

Use [POSITION_VS_WEBWRIGHT.md](./POSITION_VS_WEBWRIGHT.md) as the body.
Title: *"AIBrake vs Webwright — different problems, same goal in AI
agent infrastructure"*. Cross-post to dev.to, hashnode, Medium, your
personal blog.

---

## DM template (for individual outreach to bloggers / dev influencers)

### Short (DM-friendly)

```
Hey! Made AIBrake — catches retry-storms and unverified deploys in AI
coding agents. 98% LCR, 4-line MCP config, works with Codex / Claude
Code / Cursor / Cline.

Quick demo screenshot if you have 10 seconds: [SCREENSHOT 1]

If interested in trying — there's no signup or key needed, just
add the MCP entry from aibrake.dev and restart your agent.

Happy to give you a beta key for hosted decision-log if you want
to track catches over time.

Repo: github.com/Askbsman/aibrake
```

### Slightly longer (for cold outreach + context)

```
Hey [name],

I follow your work on [their project / niche]. Just shipped AIBrake —
a guardrail for paid AI coding agents that catches retry-storms,
unverified deploys, and premium-model burn before the next expensive
action. 98% Loop Catch Rate on a published corpus, 4 microseconds p50.

Reason I think it's relevant: [specific reason for THIS person — e.g.
"you've talked about agent costs", or "you build with Codex/Cursor",
or "your project [X] would benefit from this"].

Install is 4 lines in your MCP config — works with Codex CLI, Claude
Code, Cursor, Cline, OpenHands, anything MCP-capable. No signup, no
key needed for the local path.

Screenshot of it catching a real retry storm in Codex:
[SCREENSHOT 1]

Repo: https://github.com/Askbsman/aibrake
Site: https://aibrake.dev

Would love your honest take. Even "doesn't apply to me because X"
is useful feedback.
```

---

## Notes on timing

- Webwright launched [date]. Riding the wave for ~7 days is the
  sweet spot — long enough that the algorithm has surfaced it to your
  followers; short enough that the comparison is still topical.
- Post the EN twitter thread first. Russian version 2-4 hours later
  (different audience, different active hours).
- HN post: aim for Tuesday-Thursday 8-10 AM PT for best front-page chance.
- DMs to specific bloggers: any time, day-of-week dependent on their
  posting cadence (look at when they're active).
