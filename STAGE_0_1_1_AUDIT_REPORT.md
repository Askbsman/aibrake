# Stage 0.1.1 Audit Report

**Build:** Spending Guard Stage 0.1 + 0.1.1 nit cleanup
**Date:** 2026-05-15
**Auditor:** implementing engineer (self-audit before handing back)
**Companion document:** [`STAGE_0_1_AUDIT_REPORT.md`](./STAGE_0_1_AUDIT_REPORT.md) — full long-form audit with per-scenario output.

---

## 1. Final verdict

# **ACCEPT WITH KNOWN RISKS.**

Stage 0.1.1 is ready to freeze as a release candidate for first integration partners. Behavior is correct across all 14 audit scenarios. The remaining items are tunable knobs and v0.2 work, not v0.1 defects.

---

## 2. Fixes made during the audit

Four issues were spotted by reading the output as a product (not as code) and fixed before this report was written. No new features were added.

| # | Fix | File(s) | Why |
| --- | --- | --- | --- |
| 1 | **Corrected `last_new_evidence_at_attempt`** | `src/adapters/openclaw/adapter.ts` | Previously set to the index of the most recent same-failure event, which is tautological ("no new evidence since the last failed attempt"). Now scans `past` backward for the most recent event that actually gathered evidence (files / tests / logs / git diff / tool results); falls to `null` if none did. |
| 2 | **Stuck / soft split in `stale_context_retry_storm`** | `src/detectors/stale-context-retry-storm.ts` | Previously the detector piled on all loop penalties regardless of `new_evidence_since_last_attempt`. Split into a "stuck" branch (full penalties, only when `newEvidence === false`) and a "soft" branch (one mild signal at `same_failure_count >= 7`, only when `newEvidence === true`). |
| 3 | **FP-05 debugging-with-evidence is now `allow` / `pattern: none`** | follow-on of fix #2 | A 4-attempt loop where the agent actively reads files, runs tests and changes the git diff no longer trips the loop detector. Previously this would have scored 50+ and produced `warn`. |
| 4 | **Improved `reason` text for all 5 detectors** | `task-budget-breach.ts`, `same-tool-retry-loop.ts`, `model-escalation-without-evidence.ts`, `objective-drift.ts` (and `stale-context-retry-storm.ts` from fix #2) | Reason strings used to be `"<pattern> matched rules: a, b, c."` Now every detector emits a product-grade sentence that answers (1) what happened, (2) why it's suspicious, (3) what to do instead. |

All 96 unit tests still pass after these changes.

---

## 3. Test status

| Command | Result |
| --- | --- |
| `npm test` (full vitest suite, 14 files) | ✅ **96 passing** |
| `npx tsc --noEmit` (strict + `noUncheckedIndexedAccess`) | ✅ clean |
| `npx tsx examples/audit/run-audit.ts` | ✅ **14 / 14 scenarios pass** |
| `npx tsx examples/40-dollar-retry-storm.ts` | ✅ canonical demo runs end-to-end; `decision: require_confirmation`, `pattern: stale_context_retry_storm`, `risk_score: 100`, `confidence: 0.90` |

---

## 4. Audit scenarios

### Decision-producing scenarios (Demo + False-positive)

| # | Scenario | Expected decision | Actual decision | Pattern | Confidence | Verdict |
|---|---|---|---|---|:---:|:---:|
| DEMO-01 | Same build error retry storm ($40 TypeScript Retry Storm) | `warn` or `require_confirmation` | `require_confirmation` | `stale_context_retry_storm` | 0.90 | ✅ PASS |
| DEMO-02 | Same web-search tool loop (no failure signal) | `allow`/`warn`; no hard-block; pattern surfaced | `allow` | `same_tool_retry_loop` | 0.65 | ✅ PASS¹ |
| DEMO-03 | Model escalation without new evidence | `warn` or `require_confirmation`; downgrade-aware | `require_confirmation` | `stale_context_retry_storm` | 0.90 | ✅ PASS² |
| DEMO-04 | Objective drift (fix-build → rewrite-architecture) | `block` | `block` | `objective_drift` | 0.70 | ✅ PASS |
| DEMO-05 | Missing / incomplete adapter telemetry | `uncertain` | `uncertain` | `stale_context_retry_storm` | 0.24 | ✅ PASS |
| FP-01 | Writer-agent rewriting paragraph 10× | `allow`; no `stale_context_retry_storm` | `allow` | `same_tool_retry_loop` | 0.65 | ✅ PASS |
| FP-02 | Research agent iterating with *different* queries | `allow`; no pattern | `allow` | `none` | 1.00 | ✅ PASS |
| FP-03 | Planner refining roadmap (7 paid calls, no failure) | `allow` | `allow` | `same_tool_retry_loop` | 0.65 | ✅ PASS |
| FP-04 | Designer generating 5 logo variants | `allow`; no pattern | `allow` | `none` | 1.00 | ✅ PASS |
| FP-05 | Debugging WITH new evidence between attempts | `allow`; no loop pattern fires | `allow` | `none` | 1.00 | ✅ PASS³ |

¹ Pattern is surfaced in `matched_rules`; `decision: allow` is honest under the "rarely false-block" philosophy. Tunable knob — see §5.
² Top `pattern` is `stale_context_retry_storm` (it outscores `model_escalation_without_evidence`); the escalation rules still appear in `matched_rules` and `suggested_action` covers downgrade.
³ The single most important false-positive check: with `failure_signal_present: true`, `same_failure_count: 4`, but `new_evidence_since_last_attempt: true` and active investigation, the detector correctly does NOT fire.

### Adapter-derivation scenarios (Timeline)

| # | Scenario | Field under test | Expected | Actual | Verdict |
|---|---|---|:---:|:---:|:---:|
| TIMELINE-01 | Files read in attempt 2 only; plan attempt 4 | `new_evidence_since_last_attempt` / `last_new_evidence_at_attempt` | `false` / `2` | `false` / `2` | ✅ PASS |
| TIMELINE-02 | Cold start (no past events); plan attempt 1 | `new_evidence_since_last_attempt` / `last_new_evidence_at_attempt` | `null` / `null` | `null` / `null` | ✅ PASS |
| TIMELINE-03 | 5 attempts, none gathered evidence; plan attempt 6 | `last_new_evidence_at_attempt` | `null` (not `0`, not `1`) | `null` | ✅ PASS |
| TIMELINE-04 | Tests run + git diff in attempt 2; plan attempt 3 | `new_evidence_since_last_attempt` / `last_new_evidence_at_attempt` | `true` / `2` | `true` / `2` | ✅ PASS |

**Total: 14 / 14 pass.**

---

## 5. Known risks

### v0.2 must-fix

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | **Soft signal at `allow` is easy to miss.** Demo 02 returns `decision: allow` with `pattern: same_tool_retry_loop` in `matched_rules`. Operators integrating only on `decision` will not act on it. | Either bump `same_tool_retry_loop.baseConfidence` from `0.65` → `0.70` (so it crosses the warn-band threshold at score 25+), or add a top-level `surfaced_patterns` array distinct from the primary decision. Both are 1-day changes. |
| 2 | **`OpenClawAdapter` is single-process in-memory.** A restart loses history. Production cannot run on this. | Add a `HistoryStore` interface with two implementations: `InMemoryHistoryStore` (current behavior, default) and `RedisHistoryStore`. Adapter API does not change. |
| 3 | **`/v1/check-deep` is a stub.** When the SDK recommends `run_deep_check`, the deep endpoint currently re-runs `runCheck` and marks `deep_check_used: true`. LLM-based semantic objective-drift judgment is not implemented. | Wire an LLM call (provider-agnostic via LiteLLM/OpenRouter or direct) into `/v1/check-deep`. Cost-gate it. |
| 4 | **`matched_rules` is long and ungrouped** (17 entries in Demo 01). Useful for analytics, noisy for UI. | Group under their detector in the output: `matched_rules_by_pattern: { stale_context_retry_storm: [...], task_budget_breach: [...] }`. Keep flat `matched_rules` for back-compat. |

### Later (v0.3+)

| # | Risk | Note |
| --- | --- | --- |
| 5 | **Adapter accuracy is load-bearing.** If the operator's instrumentation reports `filesRead: []` while the agent actually did read files, the detector inherits the lie. | Cannot fix in code. Document clearly in operator-onboarding material. |
| 6 | **`failure_fingerprint` normalizers cover line:col, timestamps, UUIDs, hex addresses, `/tmp/X`.** Errors with embedded data hashes will produce different fingerprints across runs and slip past `same_failure_count`. | Extend the normalization rules as we observe real misses in the field. The fingerprint stability test suite already exists and is the right place to lock in new normalizers. |
| 7 | **Decision-log persistence is BYO.** `setLoggerSink()` is wired, default sink is `console.log` JSON line. No shipped integrations with S3 / BigQuery / Datadog / Honeycomb. | Provide reference sinks once we have a paying customer who needs one. |
| 8 | **No `policy_version` migration story.** The output emits `policy_version: "policy@0.1.0"`. We have not defined what happens when v0.1.1 ships with the same policy version but different scoring behavior. | Bump `policy_version` to `policy@0.1.1` when this RC ships. Add a `POLICY_CHANGELOG.md` in v0.2. |

---

## 6. Recommendation

1. **Freeze Stage 0.1.1 as release candidate.** Tag it. Pin the spec set (base + v0.1.1 patch + v0.1.2 patch + IMPLEMENTATION_NOTES) and the policy version.
2. **Do not add dashboard, auth, database, full x402 integration, Family Mode, Builder Mode, or the Sober Builder consumer app in this stage.** They are downstream of validating the first detector with paying customers.
3. **Hand to 2–3 first integration partners** (x402 agent operators or coding-agent runtimes) and watch what they report. Two things to learn:
   - Does the SDK integration take ≤ 30 minutes for the OpenClaw-style flow?
   - Do operators act on `decision: warn` / `require_confirmation` outputs, or ignore them?
4. **v0.2 work begins only after** the four v0.2-must-fix items above and at least one signed integration partner. The most important v0.2 deliverable is the `same_tool_retry_loop` tuning (soft signal → visible warn) — that is the bridge from "we ship loops detection" to "operators actually see the loops we ship."

The first detector — `stale_context_retry_storm` — demonstrably catches the canonical $40 retry storm while staying silent on writer / planner / designer / research / debug-with-evidence patterns. That was the entire bar for Stage 0.1. It clears it.

**Ship the RC.**
