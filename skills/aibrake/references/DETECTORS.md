# AIBrake detector catalog

Full reference for the 6 detectors that ship with AIBrake. The `aibrake_check`
tool runs ALL detectors against your input and returns the most severe finding.

## 1. `stale_context_retry_storm`

**Catches:** N+ paid attempts on the same `failure_fingerprint` with
`new_evidence_since_last_attempt: false` and zero counters on
`files_read / tests_run / logs_read / git_diff_changed`.

**Default threshold:** 3 prior attempts. Configurable per-objective via
`detector_policy.premium_retry_without_evidence_threshold`.

**Suggested action:** `context_refresh` — re-read the failing source,
run the failing test in isolation, check git diff, then retry.

## 2. `same_tool_retry_loop`

**Catches:** Same action fingerprint called N+ times (default 6),
even without an explicit failure signal. Soft warn only — never blocks.

**Use case:** Agent keeps calling the same tool (e.g. `read_file`,
`web_search`) with same args. Often signals confusion rather than progress.

## 3. `model_escalation_without_evidence`

**Catches:** About to call premium/primary model (e.g. claude-opus,
gpt-5.5) on a repeated failure without new evidence.

**Behavior:** If `objective.model_policy.secondaryModel` is declared,
emits a `model_route.to` pointing at that model. Otherwise falls back
to a `DEFAULT_DOWNGRADE_MAP` regex (claude-opus → claude-sonnet,
gpt-5.5 → gpt-5.5-mini, etc).

**Suggested action:** `switch_model` (with the cheaper model named).

## 4. `objective_drift`

**Catches:** `next_action.type` is in `objective.blocked_actions` or
outside `objective.allowed_actions`. Deterministic — always blocks.

**Use case:** Operator wrote `blocked_actions: ["start_new_architecture"]`
and the agent is about to do exactly that. Stop.

## 5. `task_budget_breach`

**Catches:** `spent_on_objective + estimated_cost > objective.budget.amount`.
Deterministic block when `objective.budget.hard_limit: true`; soft warn otherwise.

**Use case:** Set a budget at task creation. AIBrake protects it.

## 6. `unverified_success_assertion`

**Catches:** `next_action.type` is one of the assertion-shaped types
(`success_assertion`, `deployment_assertion`, `install_assertion`,
`restart_assertion`, `fix_assertion`, `task_complete`, `claim_success`)
AND `history.evidence_signals` shows zero or one verification step.

**Verification keys:** `process_status_checked`, `endpoint_curled`,
`health_check_run`, `logs_read_after_action`, `tests_run_after_action`,
`file_re_read_after_edit`, `git_diff_verified`, `smoke_test_passed`.

**Behavior:** 0 verifications + `deployment_assertion`/`restart_assertion`
→ deterministic `block`. 0 verifications + other assertion types →
`require_confirmation`. 1 verification → `warn`. 2+ → no fire (pass).

**Use case:** Catches "✅ deployed successfully" without `pm2 status` /
endpoint curl / log read. The agent must actually verify before claiming
success.

## Policy aggregator

When multiple detectors fire, the policy aggregator picks the **top
pattern** (highest scoring detector result) for the response, but all
matched rules from all detectors are returned in `matched_rules`.

A deterministic blocker (budget/drift/unverified-deploy) short-circuits
to `decision: "block"` regardless of score.

## Calibration

See `benchmarks/RESULTS.md` for the latest LCR (Loop Catch Rate) snapshot —
currently 98.0% on the v1 synthetic corpus. Per-detector-family recall
broken out in the same file.
