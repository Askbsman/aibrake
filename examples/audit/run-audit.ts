// Stage 0.1.1 Audit Runner
//
// Runs 14 scenarios in three categories:
//   - 5 demo scenarios that SHOULD produce a warning/block.
//   - 5 false-positive scenarios that should NOT trigger stale_context_retry_storm
//     and should remain allow/soft.
//   - 4 adapter-timeline scenarios that verify the inclusive-slice semantics
//     for new_evidence_since_last_attempt.
//
// Run: npx tsx examples/audit/run-audit.ts

import { runCheck } from "../../src/core/check.js";
import { setLoggerSink } from "../../src/core/logger.js";
import { OpenClawAdapter } from "../../src/adapters/openclaw/index.js";
import type { AgentActionTelemetry } from "../../src/adapters/openclaw/types.js";
import type {
  SpendingGuardCheckInput,
  SpendingGuardCheckOutput,
} from "../../src/core/types.js";

setLoggerSink({ emit: () => {} });

type Verdict = "PASS" | "FAIL";

interface ScenarioRecord {
  id: string;
  category: "demo" | "false_positive" | "adapter_timeline";
  description: string;
  expected: string;
  output: SpendingGuardCheckOutput;
  verdict: Verdict;
  humanAgrees: boolean;
  notes?: string;
}

interface AdapterTimelineRecord {
  id: string;
  category: "adapter_timeline";
  description: string;
  expected: string;
  derivedInput: {
    attempt_number: number | undefined;
    same_failure_count: number | undefined;
    paid_attempts_on_same_failure: number | undefined;
    new_evidence_since_last_attempt: boolean | null | undefined;
    last_new_evidence_at_attempt: number | null | undefined;
    files_read_since_last_attempt: unknown;
    tests_run_since_last_attempt: unknown;
    git_diff_changed_since_last_attempt: unknown;
  };
  verdict: Verdict;
  humanAgrees: boolean;
  notes?: string;
}

const records: Array<ScenarioRecord | AdapterTimelineRecord> = [];

function divider(s: string): void {
  // eslint-disable-next-line no-console
  console.log("\n" + "═".repeat(72));
  // eslint-disable-next-line no-console
  console.log(s);
  // eslint-disable-next-line no-console
  console.log("═".repeat(72));
}

function printResult(r: SpendingGuardCheckOutput): void {
  // eslint-disable-next-line no-console
  console.log(`  decision:           ${r.decision}`);
  // eslint-disable-next-line no-console
  console.log(`  recommended_policy: ${r.recommended_policy}`);
  // eslint-disable-next-line no-console
  console.log(`  pattern:            ${r.pattern}`);
  // eslint-disable-next-line no-console
  console.log(`  risk_score:         ${r.risk_score} (${r.risk_level})`);
  // eslint-disable-next-line no-console
  console.log(`  confidence:         ${r.confidence.toFixed(2)}`);
  // eslint-disable-next-line no-console
  console.log(`  hard_block:         ${r.hard_block}`);
  // eslint-disable-next-line no-console
  console.log(`  matched_rules:      [${r.matched_rules.join(", ") || "<none>"}]`);
  // eslint-disable-next-line no-console
  console.log(`  reason:             ${r.reason}`);
  // eslint-disable-next-line no-console
  console.log(`  suggested_action:   ${r.suggested_action.type} — ${r.suggested_action.message}`);
}

// ────────────────────────────────────────────────────────────────────────
// DEMO SCENARIOS — these SHOULD warn / block / require confirmation.
// ────────────────────────────────────────────────────────────────────────

function demo01_buildRetryStorm(): void {
  divider("DEMO 01 — Same build error retry storm ($40 TypeScript Retry Storm)");
  const adapter = new OpenClawAdapter();
  const baseEvt = (i: number): AgentActionTelemetry => ({
    actionId: `act_${i}`,
    objectiveId: "obj_ts_build",
    runtime: "openclaw",
    actionType: "paid_llm_call",
    toolName: "claude",
    provider: "anthropic",
    model: "claude-opus",
    estimatedCostUsd: 0.42,
    reason: "fix typescript build error",
    failureSignalPresent: true,
    failureSignalType: "build_error",
    errorCode: "TS2307",
    errorMessage: "Cannot find module '../payments/payment-guard'",
    failingFile: "src/core/check.ts",
    filesRead: [],
    testsRun: [],
    logsRead: [],
    gitDiffChanged: false,
    toolResultsChanged: false,
    contextSourceConfirmed: false,
    timestamp: new Date(Date.now() - (10 - i) * 60_000).toISOString(),
  });
  for (let i = 1; i <= 6; i += 1) adapter.record(baseEvt(i));
  const input = adapter.buildCheckInput(baseEvt(7), {
    objective: {
      id: "obj_ts_build",
      goal: "Fix failing TypeScript build",
      budget: { amount: 5, currency: "USD", hardLimit: false },
    },
    spend: { spentOnObjectiveUsd: 4.61 },
  });
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "DEMO-01",
    category: "demo",
    description: "Coding agent about to make 7th paid Opus call on the same TS2307 build error with no files/tests/logs/git changes since attempt 2.",
    expected: "decision in {warn, require_confirmation}; pattern=stale_context_retry_storm; hard_block=false (no hard budget)",
    output: out,
    verdict:
      ["warn", "require_confirmation"].includes(out.decision) &&
      out.pattern === "stale_context_retry_storm" &&
      out.hard_block === false
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
    notes: "The suggested action mentions context refresh and model downgrade — both apply.",
  });
}

function demo02_webSearchToolLoop(): void {
  divider("DEMO 02 — Same web search tool loop (no failure signal)");
  // A research agent is hitting the same paid web-search endpoint with the same
  // query 8 times, getting effectively the same result set each time. No
  // deterministic failure — just a tool loop with no progress.
  const input: SpendingGuardCheckInput = {
    actor: { type: "agent", runtime: "openclaw", id: "research-agent-7" },
    objective: {
      id: "obj_market_research",
      goal: "Find recent x402 marketplace data",
      budget: { amount: 5, currency: "USD", hard_limit: false },
    },
    next_action: {
      type: "web_search_call",
      provider: "exa",
      model: "search-v1",
      estimated_cost: { amount: 0.02, currency: "USD" },
      reason: "search 'x402 marketplace adoption 2026'",
    },
    history: {
      attempt_number: 9,
      same_action_count: 8,
      paid_attempts_on_same_failure: 0,
      // No failure signal — the search ran fine, results just didn't help.
      new_evidence_since_last_attempt: false,
      evidence_kind: "web",
      evidence_signals: {
        urls_read: [],
        result_set_hash: "stable_hash_xyz",
        tool_results_changed_since_last_attempt: false,
      },
      confidence_delta: 0,
    },
    spend: { spent_on_objective: { amount: 0.16, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "DEMO-02",
    category: "demo",
    description: "Research agent loops on the same web-search query 8 times; tool results unchanged; no deterministic failure.",
    expected: "stale_context_retry_storm does NOT fire (no failure_signal_present). same_tool_retry_loop fires as soft warn or allow with the pattern surfaced.",
    output: out,
    verdict:
      out.hard_block === false &&
      out.pattern !== "stale_context_retry_storm"
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
    notes: "Right product behavior: surface the pattern, never hard-block without a deterministic failure signal.",
  });
}

function demo03_modelEscalation(): void {
  divider("DEMO 03 — Model escalation without new evidence");
  // The agent failed 4 times on Haiku, now planning to switch to Opus.
  // Same failure fingerprint, no new files/tests/logs/git in between.
  const input: SpendingGuardCheckInput = {
    actor: { type: "agent", runtime: "openclaw", id: "coding-agent-3" },
    objective: {
      id: "obj_lint_fix",
      goal: "Fix the lint errors in the auth module",
      budget: { amount: 3, currency: "USD", hard_limit: false },
    },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-opus", // escalated
      estimated_cost: { amount: 0.45, currency: "USD" },
      reason: "Retry lint fix on auth module with more capable model",
    },
    history: {
      attempt_number: 5,
      same_action_count: 4,
      paid_attempts_on_same_failure: 4,
      failure_signal_present: true,
      failure_signal_type: "command_error",
      failure_fingerprint: "fp_v1_failure_lint_error_auth",
      same_failure_count: 4,
      last_new_evidence_at_attempt: 1,
      new_evidence_since_last_attempt: false,
      evidence_kind: "code",
      evidence_signals: {
        files_read_since_last_attempt: 0,
        tests_run_since_last_attempt: 0,
        logs_read_since_last_attempt: 0,
        git_diff_changed_since_last_attempt: false,
        context_source_confirmed: false,
      },
      confidence_delta: 0,
    },
    spend: { spent_on_objective: { amount: 0.6, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "DEMO-03",
    category: "demo",
    description: "Agent failed 4 times on Haiku, escalating to Opus on the 5th attempt with no new evidence in between.",
    expected: "warn or require_confirmation; matched_rules include expensive_next_action and no_new_evidence; suggested_action mentions downgrade.",
    output: out,
    verdict:
      ["warn", "require_confirmation"].includes(out.decision) &&
      out.matched_rules.includes("expensive_next_action") &&
      out.matched_rules.some((r) =>
        ["no_new_evidence", "no_new_evidence_since_last_attempt"].includes(r)
      )
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
    notes: "Suggested action mentions downgrading — covers the escalation pattern even though stale-context is the top label.",
  });
}

function demo04_objectiveDrift(): void {
  divider("DEMO 04 — Objective drift (fix build → rewrite architecture)");
  const input: SpendingGuardCheckInput = {
    actor: { type: "agent", runtime: "openclaw", id: "coding-agent-9" },
    objective: {
      id: "obj_ts_build",
      goal: "Fix failing TypeScript build",
      allowed_actions: [
        "paid_llm_call",
        "read_file",
        "run_test",
        "inspect_logs",
      ],
      blocked_actions: ["rewrite_architecture", "start_new_project"],
      budget: { amount: 5, currency: "USD", hard_limit: false },
    },
    next_action: {
      type: "rewrite_architecture",
      provider: "anthropic",
      model: "claude-opus",
      estimated_cost: { amount: 1.2, currency: "USD" },
      reason: "Refactor the whole module layout to side-step the build issue",
    },
    history: { attempt_number: 3 },
    telemetry_quality: { completeness: "high" },
  };
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "DEMO-04",
    category: "demo",
    description: "Original objective: fix build. Next action: rewrite_architecture (explicitly in blocked_actions).",
    expected: "decision=block; matched_rules contains explicit_blocked_action.",
    output: out,
    verdict:
      out.decision === "block" &&
      out.matched_rules.includes("explicit_blocked_action")
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
  });
}

function demo05_missingTelemetry(): void {
  divider("DEMO 05 — Missing telemetry / incomplete adapter data");
  const input: SpendingGuardCheckInput = {
    actor: { type: "agent", id: "noisy-agent" }, // no runtime
    next_action: {
      type: "paid_llm_call",
      estimated_cost: { amount: 0.4, currency: "USD" },
    },
    history: {
      attempt_number: 7,
      paid_attempts_on_same_failure: 6,
      failure_signal_present: true,
      same_failure_count: 6,
      new_evidence_since_last_attempt: false,
      // no failure_signal_type, no failure_fingerprint, no evidence_kind,
      // no evidence_signals, no confidence_delta. Sparse adapter.
    },
    // no telemetry_quality field → "unknown" multiplier (0.6)
  };
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "DEMO-05",
    category: "demo",
    description: "Repeated paid attempts on the same failure but the adapter only reports a few fields. Confidence should drop below the 0.5 threshold.",
    expected: "decision=uncertain; recommended_policy in {request_more_telemetry, run_deep_check}; hard_block=false.",
    output: out,
    verdict:
      out.decision === "uncertain" &&
      out.hard_block === false &&
      ["request_more_telemetry", "run_deep_check"].includes(out.recommended_policy)
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
    notes: "Operator is told to send more telemetry rather than getting a confident block on partial data.",
  });
}

// ────────────────────────────────────────────────────────────────────────
// FALSE-POSITIVE SCENARIOS — must NOT fire stale_context_retry_storm and
// must stay at allow / soft warn.
// ────────────────────────────────────────────────────────────────────────

function fp01_writerRewriting(): void {
  divider("FP 01 — Writer-agent rewriting the same paragraph 10 times");
  const input: SpendingGuardCheckInput = {
    actor: { type: "agent", runtime: "openclaw", id: "writer-agent-1" },
    objective: {
      id: "obj_blog_post",
      goal: "Polish the opening paragraph",
      budget: { amount: 5, currency: "USD", hard_limit: false },
    },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-sonnet",
      estimated_cost: { amount: 0.05, currency: "USD" },
      reason: "rewrite paragraph in a tighter voice",
    },
    history: {
      attempt_number: 11,
      same_action_count: 10,
      // No failure signal — writing is iterative on purpose.
      new_evidence_since_last_attempt: true,
      evidence_kind: "generic",
      evidence_signals: { tool_results_changed_since_last_attempt: true },
      confidence_delta: 0.05,
    },
    spend: { spent_on_objective: { amount: 0.5, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "FP-01",
    category: "false_positive",
    description: "Writer agent has rewritten the same paragraph 10 times. Each output is different. No deterministic failure.",
    expected: "stale_context_retry_storm does NOT fire. decision=allow (or very soft warn). hard_block=false.",
    output: out,
    verdict:
      out.pattern !== "stale_context_retry_storm" &&
      out.hard_block === false &&
      out.decision !== "block"
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
  });
}

function fp02_researchIteration(): void {
  divider("FP 02 — Research agent iterating with DIFFERENT queries");
  // Each iteration has a different `reason`, which feeds the action fingerprint,
  // so same_action_count stays low. tool_results_changed=true between calls.
  const input: SpendingGuardCheckInput = {
    actor: { type: "agent", runtime: "openclaw", id: "research-agent-12" },
    objective: {
      id: "obj_competitive_brief",
      goal: "Find competitive pricing data for AI guardrails",
      budget: { amount: 5, currency: "USD", hard_limit: false },
    },
    next_action: {
      type: "web_search_call",
      provider: "exa",
      estimated_cost: { amount: 0.02, currency: "USD" },
      reason: "search 'helicone pricing tiers 2026'",
    },
    history: {
      attempt_number: 6,
      // Different queries → adapter would report low same_action_count.
      same_action_count: 1,
      new_evidence_since_last_attempt: true,
      evidence_kind: "web",
      evidence_signals: {
        tool_results_changed_since_last_attempt: true,
        urls_read_since_last_attempt: 4,
      },
      confidence_delta: 0.1,
    },
    spend: { spent_on_objective: { amount: 0.1, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "FP-02",
    category: "false_positive",
    description: "Research agent runs 6 different web searches as part of normal investigation. Each call has different fingerprint.",
    expected: "decision=allow; no loop pattern fires.",
    output: out,
    verdict:
      out.decision === "allow" &&
      out.pattern !== "stale_context_retry_storm" &&
      out.pattern !== "same_tool_retry_loop"
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
  });
}

function fp03_plannerRefining(): void {
  divider("FP 03 — Planner agent refining a plan (no failure signal)");
  const input: SpendingGuardCheckInput = {
    actor: { type: "agent", runtime: "openclaw", id: "planner-agent-2" },
    objective: {
      id: "obj_roadmap",
      goal: "Produce a 6-week roadmap",
      budget: { amount: 10, currency: "USD", hard_limit: false },
    },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-sonnet",
      estimated_cost: { amount: 0.06, currency: "USD" },
      reason: "refine roadmap milestones based on dependencies",
    },
    history: {
      attempt_number: 8,
      same_action_count: 7,
      // No failure signal — planning has no objective fail.
      new_evidence_since_last_attempt: true,
      evidence_kind: "generic",
      evidence_signals: { tool_results_changed_since_last_attempt: true },
      confidence_delta: 0.08,
    },
    spend: { spent_on_objective: { amount: 0.4, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "FP-03",
    category: "false_positive",
    description: "Planner refines a roadmap across 7 paid calls; confidence is improving; no objective fail.",
    expected: "no stale_context fire; decision=allow.",
    output: out,
    verdict:
      out.pattern !== "stale_context_retry_storm" &&
      ["allow", "warn"].includes(out.decision) &&
      out.hard_block === false
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
  });
}

function fp04_designerVariants(): void {
  divider("FP 04 — Designer agent generating variants");
  const input: SpendingGuardCheckInput = {
    actor: { type: "agent", runtime: "openclaw", id: "designer-agent-1" },
    objective: {
      id: "obj_logo_variants",
      goal: "Generate 5 logo variants for review",
      budget: { amount: 10, currency: "USD", hard_limit: false },
    },
    next_action: {
      type: "image_generation",
      provider: "stablestudio",
      model: "sdxl-1",
      estimated_cost: { amount: 0.4, currency: "USD" },
      reason: "generate logo variant #5",
    },
    history: {
      attempt_number: 5,
      same_action_count: 4,
      new_evidence_since_last_attempt: true,
      evidence_kind: "media",
      evidence_signals: {
        tool_results_changed_since_last_attempt: true,
        output_hash_changed: true,
      },
      confidence_delta: 0.02,
    },
    spend: { spent_on_objective: { amount: 1.6, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "FP-04",
    category: "false_positive",
    description: "Designer generates 5 different logo variants; each output is different; no objective failure.",
    expected: "no stale_context fire; decision=allow.",
    output: out,
    verdict:
      out.pattern !== "stale_context_retry_storm" && out.decision !== "block"
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
  });
}

function fp05_debuggingWithEvidence(): void {
  divider("FP 05 — Normal debugging WITH new evidence between attempts");
  const input: SpendingGuardCheckInput = {
    actor: { type: "agent", runtime: "openclaw", id: "coding-agent-15" },
    objective: {
      id: "obj_api_fix",
      goal: "Fix the failing /v1/users endpoint",
      budget: { amount: 5, currency: "USD", hard_limit: false },
    },
    next_action: {
      type: "paid_llm_call",
      provider: "anthropic",
      model: "claude-sonnet",
      estimated_cost: { amount: 0.08, currency: "USD" },
      reason: "apply fix based on the freshly inspected error log",
    },
    history: {
      attempt_number: 5,
      same_action_count: 4,
      paid_attempts_on_same_failure: 4,
      failure_signal_present: true,
      failure_signal_type: "exception",
      failure_fingerprint: "fp_v1_failure_typeerror_users",
      same_failure_count: 4,
      last_new_evidence_at_attempt: 4,
      new_evidence_since_last_attempt: true,
      evidence_kind: "code",
      evidence_signals: {
        files_read_since_last_attempt: 3,
        tests_run_since_last_attempt: 1,
        logs_read_since_last_attempt: 2,
        git_diff_changed_since_last_attempt: true,
        context_source_confirmed: true,
      },
      confidence_delta: 0.15,
    },
    spend: { spent_on_objective: { amount: 0.4, currency: "USD" } },
    telemetry_quality: { completeness: "high" },
  };
  const out = runCheck(input);
  printResult(out);
  records.push({
    id: "FP-05",
    category: "false_positive",
    description: "Agent has tried 4 times on a TypeError but each attempt actually inspected logs, ran tests, and changed the git diff. Confidence is improving.",
    expected: "no hard-block; decision in {allow, warn}; if a soft warn fires, it should NOT include no_new_evidence_since_last_attempt.",
    output: out,
    verdict:
      out.hard_block === false &&
      ["allow", "warn"].includes(out.decision) &&
      !out.matched_rules.includes("no_new_evidence_since_last_attempt") &&
      !out.matched_rules.includes("no_files_read_since_last_attempt")
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
    notes: "Detector correctly soft-pedals when the agent is investigating.",
  });
}

// ────────────────────────────────────────────────────────────────────────
// ADAPTER TIMELINE SCENARIOS — verify inclusive-slice semantics.
// ────────────────────────────────────────────────────────────────────────

function baseAdapterEvent(i: number, over: Partial<AgentActionTelemetry> = {}): AgentActionTelemetry {
  return {
    actionId: `act_${i}`,
    objectiveId: "obj_adapter_timeline",
    runtime: "openclaw",
    actionType: "paid_llm_call",
    provider: "anthropic",
    model: "claude-opus",
    estimatedCostUsd: 0.3,
    reason: "fix failing test in service.ts",
    failureSignalPresent: true,
    failureSignalType: "test_failure",
    errorCode: "ASSERT_FAIL",
    errorMessage: "expected 42 received undefined",
    failingFile: "src/service.ts",
    failingTest: "service.spec.ts > computes total",
    filesRead: [],
    testsRun: [],
    logsRead: [],
    gitDiffChanged: false,
    toolResultsChanged: false,
    contextSourceConfirmed: false,
    timestamp: new Date(Date.now() - (10 - i) * 60_000).toISOString(),
    ...over,
  };
}

function timeline01_filesReadInMidLoop(): void {
  divider("TIMELINE 01 — attempt 1: none; attempt 2: read files; attempt 3: none; plan attempt 4");
  const a = new OpenClawAdapter();
  a.record(baseAdapterEvent(1));
  a.record(baseAdapterEvent(2, { filesRead: ["src/service.ts", "src/util.ts"] }));
  a.record(baseAdapterEvent(3));
  const input = a.buildCheckInput(baseAdapterEvent(4));
  const h = input.history!;
  const signals = h.evidence_signals ?? {};
  const summary = {
    attempt_number: h.attempt_number,
    same_failure_count: h.same_failure_count,
    paid_attempts_on_same_failure: h.paid_attempts_on_same_failure,
    new_evidence_since_last_attempt: h.new_evidence_since_last_attempt,
    last_new_evidence_at_attempt: h.last_new_evidence_at_attempt ?? null,
    files_read_since_last_attempt: signals.files_read_since_last_attempt,
    tests_run_since_last_attempt: signals.tests_run_since_last_attempt,
    git_diff_changed_since_last_attempt:
      signals.git_diff_changed_since_last_attempt,
  };
  // eslint-disable-next-line no-console
  console.log("  derived input.history:");
  // eslint-disable-next-line no-console
  console.log("  " + JSON.stringify(summary, null, 2).replace(/\n/g, "\n  "));
  // Last same-failure event is event 3, inclusive slice = [event 3] only,
  // so files_read_since_last_attempt should be 0 and new_evidence = false.
  // last_new_evidence_at_attempt should point to event 2 (most recent event
  // that DID gather evidence).
  records.push({
    id: "TIMELINE-01",
    category: "adapter_timeline",
    description: "Files were read in attempt 2 only. The most recent attempt (3) did not gather anything.",
    expected: "new_evidence_since_last_attempt=false; last_new_evidence_at_attempt=2.",
    derivedInput: summary,
    verdict:
      h.new_evidence_since_last_attempt === false &&
      h.last_new_evidence_at_attempt === 2
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
    notes: "Semantics: 'since the last same-failure attempt'. Attempt 3 didn't investigate, so we're stuck again.",
  });
}

function timeline02_coldStart(): void {
  divider("TIMELINE 02 — cold start: no past events, plan the first attempt");
  const a = new OpenClawAdapter();
  const input = a.buildCheckInput(baseAdapterEvent(1), {
    objective: {
      id: "obj_adapter_timeline",
      budget: { amount: 5, currency: "USD", hardLimit: false },
    },
  });
  const h = input.history!;
  const summary = {
    attempt_number: h.attempt_number,
    same_failure_count: h.same_failure_count,
    paid_attempts_on_same_failure: h.paid_attempts_on_same_failure,
    new_evidence_since_last_attempt: h.new_evidence_since_last_attempt,
    last_new_evidence_at_attempt: h.last_new_evidence_at_attempt ?? null,
    files_read_since_last_attempt: (h.evidence_signals ?? {}).files_read_since_last_attempt,
    tests_run_since_last_attempt: (h.evidence_signals ?? {}).tests_run_since_last_attempt,
    git_diff_changed_since_last_attempt: (h.evidence_signals ?? {}).git_diff_changed_since_last_attempt,
  };
  // eslint-disable-next-line no-console
  console.log("  derived input.history:");
  // eslint-disable-next-line no-console
  console.log("  " + JSON.stringify(summary, null, 2).replace(/\n/g, "\n  "));
  records.push({
    id: "TIMELINE-02",
    category: "adapter_timeline",
    description: "No prior history; planning the first paid attempt on this objective.",
    expected: "same_failure_count=0; new_evidence_since_last_attempt=null; last_new_evidence_at_attempt=null.",
    derivedInput: summary,
    verdict:
      h.same_failure_count === 0 &&
      h.new_evidence_since_last_attempt === null &&
      (h.last_new_evidence_at_attempt ?? null) === null
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
  });
}

function timeline03_fiveAttemptsNoEvidence(): void {
  divider("TIMELINE 03 — 5 attempts, none gathered evidence; plan attempt 6");
  const a = new OpenClawAdapter();
  for (let i = 1; i <= 5; i += 1) a.record(baseAdapterEvent(i));
  const input = a.buildCheckInput(baseAdapterEvent(6));
  const h = input.history!;
  const summary = {
    attempt_number: h.attempt_number,
    same_failure_count: h.same_failure_count,
    paid_attempts_on_same_failure: h.paid_attempts_on_same_failure,
    new_evidence_since_last_attempt: h.new_evidence_since_last_attempt,
    last_new_evidence_at_attempt: h.last_new_evidence_at_attempt ?? null,
    files_read_since_last_attempt: (h.evidence_signals ?? {}).files_read_since_last_attempt,
    tests_run_since_last_attempt: (h.evidence_signals ?? {}).tests_run_since_last_attempt,
  };
  // eslint-disable-next-line no-console
  console.log("  derived input.history:");
  // eslint-disable-next-line no-console
  console.log("  " + JSON.stringify(summary, null, 2).replace(/\n/g, "\n  "));
  records.push({
    id: "TIMELINE-03",
    category: "adapter_timeline",
    description: "Five same-failure attempts, none reading files or running tests. Adapter must report no evidence anywhere.",
    expected: "same_failure_count=5; new_evidence_since_last_attempt=false; last_new_evidence_at_attempt=null (no event ever gathered evidence).",
    derivedInput: summary,
    verdict:
      h.same_failure_count === 5 &&
      h.new_evidence_since_last_attempt === false &&
      (h.last_new_evidence_at_attempt ?? null) === null
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
    notes: "Detector should produce 'with no evidence gathered in any attempt' reason for this case.",
  });
}

function timeline04_testsRunInLatestOnly(): void {
  divider("TIMELINE 04 — attempt 1: nothing; attempt 2: tests run; plan attempt 3");
  const a = new OpenClawAdapter();
  a.record(baseAdapterEvent(1));
  a.record(baseAdapterEvent(2, { testsRun: ["service.spec.ts"], gitDiffChanged: true }));
  const input = a.buildCheckInput(baseAdapterEvent(3));
  const h = input.history!;
  const summary = {
    attempt_number: h.attempt_number,
    same_failure_count: h.same_failure_count,
    paid_attempts_on_same_failure: h.paid_attempts_on_same_failure,
    new_evidence_since_last_attempt: h.new_evidence_since_last_attempt,
    last_new_evidence_at_attempt: h.last_new_evidence_at_attempt ?? null,
    files_read_since_last_attempt: (h.evidence_signals ?? {}).files_read_since_last_attempt,
    tests_run_since_last_attempt: (h.evidence_signals ?? {}).tests_run_since_last_attempt,
    git_diff_changed_since_last_attempt: (h.evidence_signals ?? {}).git_diff_changed_since_last_attempt,
  };
  // eslint-disable-next-line no-console
  console.log("  derived input.history:");
  // eslint-disable-next-line no-console
  console.log("  " + JSON.stringify(summary, null, 2).replace(/\n/g, "\n  "));
  records.push({
    id: "TIMELINE-04",
    category: "adapter_timeline",
    description: "Latest same-failure attempt (event 2) ran tests and changed the git diff.",
    expected: "new_evidence_since_last_attempt=true; tests_run_since_last_attempt>=1; git_diff_changed_since_last_attempt=true; last_new_evidence_at_attempt=2.",
    derivedInput: summary,
    verdict:
      h.new_evidence_since_last_attempt === true &&
      (h.evidence_signals?.tests_run_since_last_attempt as number) >= 1 &&
      (h.evidence_signals?.git_diff_changed_since_last_attempt as boolean) === true &&
      h.last_new_evidence_at_attempt === 2
        ? "PASS"
        : "FAIL",
    humanAgrees: true,
  });
}

// ────────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────────

demo01_buildRetryStorm();
demo02_webSearchToolLoop();
demo03_modelEscalation();
demo04_objectiveDrift();
demo05_missingTelemetry();
fp01_writerRewriting();
fp02_researchIteration();
fp03_plannerRefining();
fp04_designerVariants();
fp05_debuggingWithEvidence();
timeline01_filesReadInMidLoop();
timeline02_coldStart();
timeline03_fiveAttemptsNoEvidence();
timeline04_testsRunInLatestOnly();

divider("SUMMARY");
let pass = 0;
let fail = 0;
for (const r of records) {
  const tag = r.verdict === "PASS" ? "✓" : "✗";
  if (r.verdict === "PASS") pass += 1;
  else fail += 1;
  // eslint-disable-next-line no-console
  console.log(`  ${tag} ${r.id.padEnd(14)} ${r.verdict}   ${r.description}`);
}
// eslint-disable-next-line no-console
console.log(`\n  total: ${records.length} scenarios — ${pass} pass / ${fail} fail`);

if (fail > 0) process.exitCode = 1;
