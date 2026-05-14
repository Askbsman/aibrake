# Stage 0.1 Audit Report

**Build:** Spending Guard Stage 0.1 + 0.1.1 nit cleanup
**Date:** 2026-05-15
**Auditor:** implementing engineer (self-audit before handing back)
**Recommendation:** **ACCEPT**

---

## Build status

| Item | Status |
| --- | --- |
| `npx tsc --noEmit` (strict + `noUncheckedIndexedAccess`) | ✅ clean |
| `npx vitest run` | ✅ **96 / 96 passing** (target was 55+) |
| Routes (`GET /health`, `POST /v1/check`, `POST /v1/check-deep`) | ✅ wired, integration-tested via Fastify `inject` |
| SDK (`check`, `checkOrConfirm`, `checkOrDowngrade`, `checkShadow`, three failure modes) | ✅ 13 tests cover error / timeout / failure-mode paths |
| Adapter (`OpenClawAdapter`, `HermesAdapter` alias) | ✅ 8 tests, Zod-valid payload, fingerprint stability |
| Demo script (`examples/40-dollar-retry-storm.ts`) | ✅ runs end-to-end |
| Audit runner (`examples/audit/run-audit.ts`) | ✅ **14 / 14 scenarios pass** |
| Docs | ✅ README, PRODUCT, OPENCLAW_ADAPTER, HERMES_ADAPTER, X402_LISTING, EXAMPLES, IMPLEMENTATION_NOTES |

---

## Tweaks made during the audit (before this report)

Two issues were noticed while reading the output as a product, not as code, and fixed before writing the report:

1. **Reason text was bare matched-rules in 4 of 5 detectors.** Replaced with human-readable strings in `task_budget_breach`, `same_tool_retry_loop`, `model_escalation_without_evidence`, `objective_drift`. `stale_context_retry_storm` already had product-grade text.
2. **`last_new_evidence_at_attempt` was the index of the most recent same-failure event** (a tautology that read as "no new evidence since the last failure" in the reason). Rewrote the adapter to scan past events for the most recent one that actually gathered evidence (files / tests / logs / gitdiff / tool results). Falls to `null` if no past event ever investigated.
3. **`stale_context_retry_storm` piled penalties even when `new_evidence_since_last_attempt: true`.** Split into a "stuck" branch (full penalties) and a "soft" branch (one mild signal at `same_failure_count >= 7`) so legitimate debugging with real investigation between attempts never escalates to `require_confirmation`.

All 96 unit tests still pass after these changes.

---

## Demo runs

### DEMO 01 — Same build error retry storm ($40 TypeScript Retry Storm)

**Scenario.** Coding agent has made 6 paid Claude Opus calls on the same `TS2307: Cannot find module` build error. No files have been read, no tests rerun, no git diff change. Agent is about to fire the 7th paid call.

**Output:**
```
decision:           require_confirmation
recommended_policy: ask_human
pattern:            stale_context_retry_storm
risk_score:         100 (critical)
confidence:         0.90
hard_block:         false
reason:             Attempt #7 on the same build_error: 6 prior repeats with no
                    evidence gathered in any attempt. Another paid retry is
                    unlikely to produce a different result without a context refresh.
suggested_action:   context_refresh — Before another paid model call, read the
                    actual failing file, run the exact failing test, confirm the
                    current git diff, or downgrade to a cheaper model.
```

**Expected.** decision ∈ {warn, require_confirmation}, pattern = stale_context_retry_storm, no hard block (budget is soft).
**Verdict.** ✅ **PASS** — human agrees.

---

### DEMO 02 — Same web search tool loop (no failure signal)

**Scenario.** Research agent runs the same paid Exa search 8 times with the same query; result set is unchanged; no deterministic failure.

**Output:**
```
decision:           allow
recommended_policy: continue
pattern:            same_tool_retry_loop
risk_score:         25 (moderate)
confidence:         0.65
hard_block:         false
matched_rules:      [same_action_count_high, tool_results_unchanged,
                     confidence_not_improving]
reason:             The same action has been performed 8 times in a row without
                    changing the tool's result; agent confidence is not improving.
                    No deterministic failure is reported, so this is surfaced as
                    a soft signal — consider switching tool, model, or approach
                    before spending again.
suggested_action:   switch_strategy — ...
```

**Expected.** `stale_context_retry_storm` does NOT fire (no failure signal). `same_tool_retry_loop` surfaces the pattern as a soft signal; never hard-blocks.
**Verdict.** ✅ **PASS** — human agrees.

**Caveat for v0.2.** Decision is `allow` even though the pattern is in `matched_rules`. The output is honest under the "rarely false-block" philosophy, but operators reading only `decision` will miss it. Two ways to address this later: (a) bump `same_tool_retry_loop.baseConfidence` from 0.65 to 0.70 so it crosses into the warn band at score 25+, or (b) add a `notable_patterns` array to the output that surfaces soft signals separately from the primary decision. Not blocking for Stage 0.1.

---

### DEMO 03 — Model escalation without new evidence

**Scenario.** Agent failed 4 times on `claude-haiku` with the same lint error; is now planning a `claude-opus` call ($0.45) with no new files/tests/logs in between.

**Output:**
```
decision:           require_confirmation
recommended_policy: ask_human
pattern:            stale_context_retry_storm
risk_score:         100 (critical)
confidence:         0.90
hard_block:         false
matched_rules:      [..., expensive_next_action, same_failure_repeated,
                     no_new_evidence, ...]
reason:             Attempt #5 on the same command_error: 4 prior repeats with no
                    new files, tests, logs, or state changes since attempt #1.
                    Another paid retry is unlikely to produce a different result
                    without a context refresh.
suggested_action:   context_refresh — ... or downgrade to a cheaper model.
```

**Expected.** Decision ∈ {warn, require_confirmation}. `matched_rules` includes `expensive_next_action` and `no_new_evidence`. Suggested action covers downgrade.
**Verdict.** ✅ **PASS** — human agrees.

**Note.** The top `pattern` is `stale_context_retry_storm`, not `model_escalation_without_evidence`, because stale-context outscores escalation when both fire (the coding-domain signals pile up). The escalation pattern still contributes to `matched_rules`, and the suggested action explicitly mentions downgrading. The product message lands correctly.

---

### DEMO 04 — Objective drift (fix build → rewrite architecture)

**Scenario.** Objective is "fix failing TypeScript build" with `blocked_actions: ["rewrite_architecture", ...]`. Agent proposes `rewrite_architecture` as the next action.

**Output:**
```
decision:           block
recommended_policy: stop_action
pattern:            objective_drift
risk_score:         90 (critical)
confidence:         0.70
hard_block:         true
matched_rules:      [explicit_blocked_action]
reason:             Next action "rewrite_architecture" is explicitly listed in
                    objective.blocked_actions. This is a hard policy violation,
                    not a recommendation.
suggested_action:   stop_action — Next action is explicitly blocked by
                    operator-defined objective policy.
```

**Expected.** Deterministic block. `matched_rules` contains `explicit_blocked_action`.
**Verdict.** ✅ **PASS** — human agrees.

---

### DEMO 05 — Missing telemetry / incomplete adapter data

**Scenario.** Repeated paid attempts on the same failure but adapter sends only `failure_signal_present`, `same_failure_count`, `paid_attempts_on_same_failure`, `new_evidence_since_last_attempt`. No `evidence_kind`, no `evidence_signals`, no `failure_fingerprint`, no `confidence_delta`. No `telemetry_quality`.

**Output:**
```
decision:           uncertain
recommended_policy: request_more_telemetry
pattern:            stale_context_retry_storm
risk_score:         100 (critical)
confidence:         0.24
hard_block:         false
reason:             Possible stale_context_retry_storm signals detected but
                    telemetry confidence is below the decision threshold.
suggested_action:   context_refresh — ...
```

**Expected.** `decision = "uncertain"` (confidence < 0.5). Recommended policy steers the operator to send more data, not to block on partial information.
**Verdict.** ✅ **PASS** — human agrees.

---

## False-positive checks

### FP 01 — Writer-agent rewriting the same paragraph 10 times

```
decision:           allow
pattern:            same_tool_retry_loop
matched_rules:      [same_action_count_high, same_action_count_critical]
reason:             The same action has been performed 10 times in a row.
                    No deterministic failure is reported, so this is surfaced
                    as a soft signal ...
hard_block:         false
```

`stale_context_retry_storm` does NOT fire (no `failure_signal_present`). The detector surfaces the repeat-count pattern but never blocks. ✅ **PASS**.

---

### FP 02 — Research agent iterating with DIFFERENT queries

```
decision:           allow
pattern:            none
risk_score:         0
```

Each query produces a different `actionFingerprint`, so `same_action_count` stays at 1. No detector fires. ✅ **PASS**.

---

### FP 03 — Planner agent refining a plan

```
decision:           allow
pattern:            same_tool_retry_loop
risk_score:         10
```

No failure signal, no deterministic stuckness. Soft pattern at `same_action_count >= 6` only, never escalates. ✅ **PASS**.

---

### FP 04 — Designer agent generating variants

```
decision:           allow
pattern:            none
risk_score:         0
```

`tool_results_changed: true` and `output_hash_changed: true` between calls. The retry-loop detector requires `tool_results_unchanged` to add weight; it doesn't here, so nothing fires. ✅ **PASS**.

---

### FP 05 — Normal debugging WITH new evidence between attempts

```
decision:           allow
pattern:            none
risk_score:         0
```

`failure_signal_present: true`, `same_failure_count: 4`, but `new_evidence_since_last_attempt: true` with `files_read: 3`, `tests_run: 1`, `git_diff_changed: true`. The detector's soft branch only fires at `same_failure_count >= 7`. At 4 attempts with active investigation, nothing fires at all. ✅ **PASS**.

This is the most important false-positive check. The detector correctly soft-pedals when the agent is doing what it should do — investigating between paid attempts.

---

## Adapter history checks

### TIMELINE 01 — files read mid-loop

```
events: [attempt 1: none, attempt 2: read files, attempt 3: none]
plan:   attempt 4

derived input.history:
  attempt_number:                    4
  same_failure_count:                3
  paid_attempts_on_same_failure:     3
  new_evidence_since_last_attempt:   false   ← inclusive slice from attempt 3
  last_new_evidence_at_attempt:      2       ← attempt 2 is the most recent
  files_read_since_last_attempt:     0          investigative attempt
  tests_run_since_last_attempt:      0
  git_diff_changed_since_last_attempt: false
```

✅ **PASS.** The inclusive-slice semantic is correctly off-by-zero. Attempt 3 happened without investigation; attempt 4 inherits that emptiness. The reporting field correctly identifies attempt 2 as the last investigation point.

---

### TIMELINE 02 — cold start

```
events: []
plan:   first attempt

derived input.history:
  attempt_number:                    1
  same_failure_count:                0
  new_evidence_since_last_attempt:   null    ← no marker → null, not false
  last_new_evidence_at_attempt:      null
```

✅ **PASS.** Distinguishes "no history" (null) from "history shows no evidence" (false). This is critical — the detector must not panic on a fresh first attempt.

---

### TIMELINE 03 — 5 attempts, none gathered evidence

```
events: 5x same-failure with empty filesRead/testsRun/logsRead/gitDiff
plan:   attempt 6

derived input.history:
  attempt_number:                    6
  same_failure_count:                5
  paid_attempts_on_same_failure:     5
  new_evidence_since_last_attempt:   false
  last_new_evidence_at_attempt:      null    ← honest signal: nothing ever investigated
```

✅ **PASS.** `last_new_evidence_at_attempt: null` (not `1`, not "0") accurately tells the detector that no past attempt has ever investigated. The reason text becomes "X prior repeats with no evidence gathered in any attempt" — exactly the right product copy.

---

### TIMELINE 04 — tests run in the latest attempt

```
events: [attempt 1: none, attempt 2: tests + gitdiff]
plan:   attempt 3

derived input.history:
  attempt_number:                    3
  same_failure_count:                2
  new_evidence_since_last_attempt:   true
  last_new_evidence_at_attempt:      2
  files_read_since_last_attempt:     0
  tests_run_since_last_attempt:      1
  git_diff_changed_since_last_attempt: true
```

✅ **PASS.** Inclusive-slice picks up the activity of attempt 2 itself as evidence for the upcoming attempt 3. Without inclusive semantics, this case would silently drop the test run and the git-diff change.

---

## Output quality as product (review of `reason` text)

Standard the user asked for: not just rule names, but a sentence that answers (1) what happened, (2) why it's suspicious, (3) what to do instead.

| Detector | Sample reason | Passes the bar? |
| --- | --- | --- |
| `stale_context_retry_storm` | "Attempt #7 on the same build_error: 6 prior repeats with no evidence gathered in any attempt. Another paid retry is unlikely to produce a different result without a context refresh." | ✅ |
| `task_budget_breach` (hard) | "Hard task budget would be breached: planned spend 5.30 USD > budget 5 USD. Stop the action or raise the budget explicitly." | ✅ |
| `same_tool_retry_loop` | "The same action has been performed 8 times in a row without changing the tool's result; agent confidence is not improving. No deterministic failure is reported, so this is surfaced as a soft signal — consider switching tool, model, or approach before spending again." | ✅ |
| `model_escalation_without_evidence` | "Next action escalates to claude-opus ($0.45) while the same failure has repeated 4 times and no new evidence has been gathered between attempts. Escalating without new input rarely produces a different answer — try the cheaper model with refreshed context first." | ✅ |
| `objective_drift` (block) | "Next action 'rewrite_architecture' is explicitly listed in objective.blocked_actions. This is a hard policy violation, not a recommendation." | ✅ |
| `objective_drift` (warn) | "Next action 'X' is not in the objective's allowed_actions list ([read_file, run_test]). Confirm before spending — the agent may be drifting away from the original objective." | ✅ |
| Aggregator (uncertain) | "Possible stale_context_retry_storm signals detected but telemetry confidence is below the decision threshold." | ✅ |

All five detectors pass the product-readability bar. `suggested_action.message` is always actionable.

---

## Known risks (carry into Stage 0.2)

1. **`matched_rules` is long.** In Demo 01 it has 17 entries. Useful for machines and analytics; a human UI showing this raw will be noisy. **Mitigation idea:** group rules under their detector (`stale_context.rules`, `same_tool_retry_loop.rules`, ...) or surface only the top-pattern's rules separately. Not a blocker for v0.1.

2. **Soft signals at allow are easy to miss.** Demo 02 returns `decision: allow + pattern: same_tool_retry_loop`. Operators integrating only on `decision` won't act on it. **Mitigation idea:** either bump `same_tool_retry_loop.baseConfidence` from 0.65 to 0.70 (so it crosses the warn-band threshold at score 25+), or add a top-level `surfaced_patterns` array distinct from the primary decision. Tunable knob, not a defect.

3. **`OpenClawAdapter` is single-process in-memory.** A restart loses history. Production needs persistence (Redis / DB) — that work belongs in v0.2 and does not require Core API changes.

4. **Adapter accuracy is load-bearing.** If the agent operator's instrumentation reports `filesRead: []` while the agent actually did read files, the detector inherits the lie. This is a feature of the design (Core stays stateless and adapter-trusting), but operators should be told.

5. **Same-failure detection depends on `failure_fingerprint` stability.** The fingerprint algorithm strips line/column markers, timestamps, UUIDs, hex addresses, and temp paths. Errors with high cardinality not covered by those normalizers (e.g. embedded data hashes) will produce different fingerprints each time and slip past `same_failure_count`. **Mitigation:** ship the fingerprint stability test suite already in place; add more normalizers as we see real-world misses.

6. **`/v1/check-deep` is a stub.** When the SDK recommends `run_deep_check`, the deep endpoint currently re-runs `runCheck` and marks `deep_check_used: true`. LLM-based semantic objective-drift judgment is explicitly out of scope for v0.1 — landing in v0.2.

7. **No decision-log persistence yet.** The `setLoggerSink` API exists; the default sink writes JSON to stdout. A real operator wiring to S3/BigQuery/Datadog is a few lines of integration, but the repo doesn't ship one.

None of these are corrections to the build — they are forward-looking notes for v0.2.

---

## Files changed during this audit

```
src/adapters/openclaw/adapter.ts         (last_new_evidence_at_attempt rewrite)
src/detectors/stale-context-retry-storm.ts  (stuck/soft branch split + reason text)
src/detectors/task-budget-breach.ts      (reason text)
src/detectors/same-tool-retry-loop.ts    (reason text)
src/detectors/model-escalation-without-evidence.ts  (reason text)
src/detectors/objective-drift.ts         (reason text)
examples/audit/run-audit.ts              (new — runs 14 scenarios)
STAGE_0_1_AUDIT_REPORT.md                (new — this file)
```

---

## Recommendation

# **ACCEPT.**

- 96 / 96 unit tests pass
- 14 / 14 audit scenarios pass
- Reason text is product-grade across all detectors
- Adapter history semantics verified on 4 timelines including cold-start edge cases
- False positives correctly avoided on writer / planner / designer / research / debug-with-evidence
- Known limitations documented and have clear v0.2 mitigation paths

The first detector (`stale_context_retry_storm`) demonstrably catches the canonical $40 retry storm while staying silent on legitimate creative iteration. That was the entire bar for Stage 0.1, and it clears it.

Ready to share with first integration partners.
