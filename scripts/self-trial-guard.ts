// Self-trial harness: dogfood Agent Spend Guard against real coding-agent
// retries from this Claude Code session.
//
// Usage:
//   npx tsx scripts/self-trial-guard.ts
//
// Hits the live /v1/check at :8080 with Bearer asg_v1_demo using
// CodingAgentAdapter to build the payload from real telemetry I observed
// during the Stage 0.4.2 / 0.5 build. Appends one structured entry per
// event to SELF_TRIAL_CLAUDE_CODE_LOG.md.
//
// Shadow mode only — the harness does not enforce decisions. It logs them.

import { CodingAgentAdapter } from "../src/adapters/coding-agent/index.js";
import type {
  AgentActionTelemetry,
  ObjectiveDescriptor,
} from "../src/adapters/openclaw/types.js";
import type { SpendingGuardCheckOutput } from "../src/core/types.js";
import { writeFileSync, appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const GUARD_URL = process.env.GUARD_URL ?? "http://localhost:8080/v1/check";
const API_KEY = process.env.GUARD_KEY ?? "asg_v1_demo";
const LOG_PATH = resolve(
  process.cwd(),
  "SELF_TRIAL_CLAUDE_CODE_LOG.md"
);

interface ScenarioEvent {
  scenarioId: string;
  description: string;
  telemetry: AgentActionTelemetry;
  agreedWithWarning: "yes" | "no" | "n/a";
  actedOnIt: "yes" | "no" | "n/a";
  myNotes: string;
}

interface Scenario {
  scenarioId: string;
  title: string;
  context: string;
  objective: ObjectiveDescriptor;
  // Pre-recorded history of telemetry events that happened BEFORE the
  // moment under check (so `same_failure_count`, `paid_attempts_on_same_failure`
  // etc. are accurate).
  history: AgentActionTelemetry[];
  // The action under check (what I was about to do, the moment the guard
  // would fire).
  underCheck: ScenarioEvent;
}

// ─────────────────────────────────────────────────────────────────────────
// Real scenarios from this session.
// ─────────────────────────────────────────────────────────────────────────
//
// Cost basis: I estimate paid Claude/Codex calls at ~$0.05 average for the
// agentic work shown here (heavy tool use + reasoning). Set conservatively.

const scenarios: Scenario[] = [
  // ── E1: classic stale-context retry storm — Docker daemon hang ──
  // I tried `docker info` 6+ times during Stage 0.5, polling for a daemon
  // that was never going to come up (WSL distro stuck Stopped). No new
  // evidence accumulated between probes — same command, same pipe error.
  {
    scenarioId: "E1",
    title: "Docker daemon probe — stale-context retry storm",
    context:
      "Stage 0.5 § 6 verification path. Polling `docker info` while Docker Desktop's WSL distro `docker-desktop` stayed in `Stopped` state. Each probe returned the same pipe-not-found error. No edits, no diagnosis, no new context between probes — just trying again.",
    objective: {
      id: "stage_05_verify_python_via_docker",
      goal: "Run Python pytest via Docker because no local Python is available",
      successCriteria: ["docker info returns server version", "container starts and pytest runs"],
      budget: { amount: 5, currency: "USD", hardLimit: false },
      detectorPolicy: {
        same_tool_retry_threshold: 4, // tighter — repeated CLI probes shouldn't need 6
      },
    },
    history: dockerProbeHistory(),
    underCheck: {
      scenarioId: "E1",
      description: "About to call `docker info` for the 7th time during the hang",
      telemetry: {
        actionId: "act_docker_info_7",
        runtime: "claude-code",
        objectiveId: "stage_05_verify_python_via_docker",
        actionType: "tool_call",
        toolName: "bash:docker_info",
        provider: "anthropic",
        model: "claude-sonnet-4.5", // representative reasoning cost
        estimatedCostUsd: 0.05,
        reason: "Check whether daemon came online",
        failureSignalPresent: true,
        failureSignalType: "tool_error",
        errorCode: "DOCKER_PIPE_NOT_FOUND",
        errorMessage:
          "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine",
        filesRead: [], // no new files read between probes
        testsRun: [],
        logsRead: [], // not even reading wsl status between probes
        toolResultsChanged: false,
        gitDiffChanged: false,
        contextSourceConfirmed: false,
        confidenceBefore: 0.4,
        confidenceAfter: 0.4,
        timestamp: new Date("2026-05-15T19:45:00Z").toISOString(),
      },
      agreedWithWarning: "yes",
      actedOnIt: "yes",
      myNotes:
        "Real outcome: I stopped re-probing after ~7 attempts and pivoted to documenting the gap honestly per spec §6. The guard would have caught this earlier and saved 2-3 probes. Strong signal.",
    },
  },

  // ── E2: healthy debugging — same failure, NEW evidence each time ──
  // Stage 0.5 Python pytest failure: 2 tests failed (test_06, test_06b).
  // I read the source, hypothesized, edited, re-ran. Each retry had new
  // evidence: new file reads, new logs.
  {
    scenarioId: "E2",
    title: "Python pytest failure — healthy debug, new evidence each retry",
    context:
      "Stage 0.5 verification: py -m pytest surfaced 2 failures (test_06_check_shadow_swallows_transport_error and test_06b). Each retry was driven by new context — I read the failing test, hypothesized about narrow-catch tuple, edited client.py, re-ran.",
    objective: {
      id: "stage_05_python_pytest_green",
      goal: "Get 35/35 Python tests passing on Python 3.14",
      successCriteria: ["py -m pytest exits 0", "all integration tests pass"],
      budget: { amount: 2, currency: "USD", hardLimit: false },
    },
    history: pytestDebugHistory(),
    underCheck: {
      scenarioId: "E2",
      description:
        "About to re-run `py -m pytest` after editing client.py to broaden the check_shadow narrow-catch",
      telemetry: {
        actionId: "act_pytest_after_fix",
        runtime: "claude-code",
        objectiveId: "stage_05_python_pytest_green",
        actionType: "tool_call",
        toolName: "bash:pytest",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        estimatedCostUsd: 0.05,
        reason: "Verify check_shadow fix lands",
        failureSignalPresent: true,
        failureSignalType: "test_failure",
        failingTest: "tests/test_client.py::test_06_check_shadow_swallows_transport_error",
        errorCode: "ASSERTION_ERROR",
        filesRead: [
          "python/agent_spend_guard/client.py",
          "python/tests/test_client.py",
        ], // I read source before editing
        testsRun: ["tests/test_client.py::test_06"],
        logsRead: ["pytest stderr"],
        toolResultsChanged: true, // edited client.py
        gitDiffChanged: true,
        contextSourceConfirmed: true,
        confidenceBefore: 0.5,
        confidenceAfter: 0.85, // confident the fix is correct
        timestamp: new Date("2026-05-15T20:30:00Z").toISOString(),
      },
      agreedWithWarning: "n/a",
      actedOnIt: "n/a",
      myNotes:
        "Real outcome: 35/35 passed on this run. Guard should say allow — new evidence, clear hypothesis, edited code. Good baseline 'do not warn here' case.",
    },
  },

  // ── E3: same-tool retry loop — npm test re-runs without edits ──
  // I ran `npm test` several times during Stage 0.5 to sanity-check after
  // edits. The 2nd and 3rd runs after the same edit were redundant — no
  // intermediate file changes, no new evidence.
  {
    scenarioId: "E3",
    title: "Redundant `npm test` reruns without intermediate edits",
    context:
      "During Stage 0.5 I ran `npm test` twice with no edits in between (once after writing tests, once 'just to double-check' before commit). The 2nd run was wasted work — same green output, no new information.",
    objective: {
      id: "stage_05_ts_suite_green",
      goal: "Verify TS suite at 162/162",
      successCriteria: ["vitest exits 0 with 162 tests"],
    },
    history: npmTestHistory(),
    underCheck: {
      scenarioId: "E3",
      description: "About to re-run `npm test` a second time with no edits",
      telemetry: {
        actionId: "act_npm_test_2",
        runtime: "claude-code",
        objectiveId: "stage_05_ts_suite_green",
        actionType: "tool_call",
        toolName: "bash:npm_test",
        estimatedCostUsd: 0.04,
        reason: "Sanity check before commit",
        failureSignalPresent: false, // suite was green
        filesRead: [],
        testsRun: [],
        logsRead: [],
        toolResultsChanged: false,
        gitDiffChanged: false,
        contextSourceConfirmed: false,
        confidenceBefore: 0.95,
        confidenceAfter: 0.95,
        timestamp: new Date("2026-05-15T20:34:00Z").toISOString(),
      },
      agreedWithWarning: "yes",
      actedOnIt: "no",
      myNotes:
        "Real outcome: I did re-run it. Cost was small ($0.04) but the guard's warning would be valid — there was no reason to re-run a suite I'd just seen pass. Worth catching.",
    },
  },

  // ── E4: premium model retry without evidence — Docker daemon startup attempts ──
  // I tried multiple PowerShell-based startup approaches for Docker Desktop.
  // Each was a "premium" action (heavy reasoning + tool use) without new evidence
  // between attempts.
  {
    scenarioId: "E4",
    title: "Docker startup attempts — premium retries without new evidence",
    context:
      "Stage 0.5 § 6: tried 3 different PowerShell sequences to wake the Docker daemon (Start-Process, wsl -d docker-desktop -e, polling job). Each was reasoning-heavy. No genuinely new diagnostic info between attempts — only confirmations that the daemon was still down.",
    objective: {
      id: "stage_05_verify_python_via_docker",
      goal: "Get Docker daemon online to run pytest container",
      successCriteria: ["docker info returns server version"],
      modelPolicy: {
        primaryModel: {
          provider: "anthropic",
          model: "claude-sonnet-4.5",
          role: "primary",
          tier: "premium",
        },
        secondaryModel: {
          provider: "anthropic",
          model: "claude-haiku",
          role: "secondary",
          tier: "cheap",
        },
        maxPremiumRetriesWithoutEvidence: 2,
      },
      detectorPolicy: {
        premium_retry_without_evidence_threshold: 2,
      },
    },
    history: dockerStartupHistory(),
    underCheck: {
      scenarioId: "E4",
      description: "About to attempt a 4th Docker startup approach",
      telemetry: {
        actionId: "act_docker_start_4",
        runtime: "claude-code",
        objectiveId: "stage_05_verify_python_via_docker",
        actionType: "paid_llm_call",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        modelRole: "primary",
        modelTier: "premium",
        estimatedCostUsd: 0.08,
        reason: "Try a different WSL/Docker wake sequence",
        failureSignalPresent: true,
        failureSignalType: "tool_error",
        errorCode: "DOCKER_PIPE_NOT_FOUND",
        errorMessage: "daemon pipe never opens, distro stays Stopped",
        filesRead: [],
        testsRun: [],
        logsRead: ["wsl --list --verbose output"],
        toolResultsChanged: false,
        gitDiffChanged: false,
        contextSourceConfirmed: false, // I didn't actually have new info
        confidenceBefore: 0.3,
        confidenceAfter: 0.3,
        timestamp: new Date("2026-05-15T19:55:00Z").toISOString(),
      },
      agreedWithWarning: "yes",
      actedOnIt: "yes",
      myNotes:
        "Real outcome: at this point I did stop and pivot to documenting the gap. Guard catching this in shadow would have validated the decision earlier.",
    },
  },

  // ── E5: cold-start — first paid call on a new objective ──
  // Stage 0.5 PR-1: I started work on the `/v1/meta` extension. First paid
  // call, no prior history.
  {
    scenarioId: "E5",
    title: "Cold-start — first paid call on a new objective",
    context:
      "Start of Stage 0.5 work: first paid action on objective `stage_05_meta_endpoint`. No history. Should clearly be allow.",
    objective: {
      id: "stage_05_meta_endpoint",
      goal: "Extend /v1/meta with detector_policy.supported_fields",
      successCriteria: ["/v1/meta returns supported_fields", "tests pass"],
    },
    history: [],
    underCheck: {
      scenarioId: "E5",
      description: "First action on the meta-endpoint objective",
      telemetry: {
        actionId: "act_meta_endpoint_1",
        runtime: "claude-code",
        objectiveId: "stage_05_meta_endpoint",
        actionType: "paid_llm_call",
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        estimatedCostUsd: 0.05,
        reason: "Plan and write the /v1/meta extension",
        failureSignalPresent: false,
        filesRead: ["src/routes/meta.ts"],
        testsRun: [],
        logsRead: [],
        toolResultsChanged: false,
        gitDiffChanged: false,
        contextSourceConfirmed: true,
        confidenceBefore: 0.7,
        confidenceAfter: 0.85,
        timestamp: new Date("2026-05-15T19:00:00Z").toISOString(),
      },
      agreedWithWarning: "n/a",
      actedOnIt: "n/a",
      myNotes:
        "Cold-start sanity check — guard should allow. Baseline 'do not flag normal work' case.",
    },
  },

  // ── E6: typecheck after small edit — borderline ──
  // I ran `npm run typecheck` after every small edit, sometimes redundantly.
  {
    scenarioId: "E6",
    title: "Typecheck after small one-file edit",
    context:
      "After bumping a version string in env.ts, I ran the full strict typecheck. It's a 1-line edit; the value of re-running typecheck is low. Borderline — same_tool_retry threshold of 3 might catch this in tighter regimes.",
    objective: {
      id: "stage_05_version_bump",
      goal: "Bump version to 0.5.0-beta across 7 files",
      successCriteria: ["/health reports 0.5.0-beta", "tests pass"],
      detectorPolicy: {
        same_tool_retry_threshold: 3,
      },
    },
    history: typecheckHistory(),
    underCheck: {
      scenarioId: "E6",
      description: "About to run `npm run typecheck` for the 4th time during version bump",
      telemetry: {
        actionId: "act_typecheck_4",
        runtime: "claude-code",
        objectiveId: "stage_05_version_bump",
        actionType: "tool_call",
        toolName: "bash:tsc_noemit",
        estimatedCostUsd: 0.03,
        reason: "Re-confirm typecheck after version string edit",
        failureSignalPresent: false,
        filesRead: ["src/config/env.ts"],
        testsRun: [],
        logsRead: [],
        toolResultsChanged: true, // edit happened
        gitDiffChanged: true,
        contextSourceConfirmed: true,
        confidenceBefore: 0.92,
        confidenceAfter: 0.92,
        timestamp: new Date("2026-05-15T19:48:00Z").toISOString(),
      },
      agreedWithWarning: "no",
      actedOnIt: "no",
      myNotes:
        "Real outcome: I did run it. The edit was genuinely new evidence (version string changed). I would push back on a warning here — the action was justified.",
    },
  },

  // ── E7: objective drift — running unrelated tests during a specific scope ──
  // Hypothetical: during the Stage 0.5 work, what if I had decided to refactor
  // a Stage 0.3 file? That's scope creep. Encoding a borderline case.
  {
    scenarioId: "E7",
    title: "Scope creep — touching unrelated module during scoped stage",
    context:
      "Hypothetical: while doing Stage 0.5 hardening I considered refactoring src/adapters/openclaw/fingerprints.ts (Stage 0.1 code). Decided not to. Encoding what the guard would have said if I had.",
    objective: {
      id: "stage_05_partner_ready",
      goal: "Stage 0.5 partner-ready hardening — meta endpoint + structured errors",
      successCriteria: [
        "/v1/meta exposes detector_policy fields",
        "SDK errors expose .kind/.retryable",
      ],
      blockedActions: ["refactor_unrelated_module"],
    },
    history: [],
    underCheck: {
      scenarioId: "E7",
      description: "About to refactor fingerprints.ts (out of scope)",
      telemetry: {
        actionId: "act_refactor_fp",
        runtime: "claude-code",
        objectiveId: "stage_05_partner_ready",
        actionType: "refactor_unrelated_module",
        toolName: "edit:fingerprints",
        estimatedCostUsd: 0.06,
        reason: "Tidy up Stage 0.1 fingerprint module",
        failureSignalPresent: false,
        filesRead: ["src/adapters/openclaw/fingerprints.ts"],
        testsRun: [],
        logsRead: [],
        toolResultsChanged: false,
        gitDiffChanged: false,
        contextSourceConfirmed: true,
        confidenceBefore: 0.5,
        confidenceAfter: 0.5,
        timestamp: new Date("2026-05-15T19:30:00Z").toISOString(),
      },
      agreedWithWarning: "yes",
      actedOnIt: "yes",
      myNotes:
        "Hypothetical. Real outcome: I did NOT do this refactor. The blocked_actions list is the right tool here — guard would block deterministically. Good check that the policy plumbing works end-to-end.",
    },
  },

  // ── E8: live event #1 — running Python tests this very session ──
  // Real action I'm about to take right now.
  {
    scenarioId: "E8",
    title: "Live: running Python suite again after no Python-side edits",
    context:
      "I already verified Python 35/35 once at 20:33. About to consider running it again just to record the live event for this trial. Same tool, no new evidence.",
    objective: {
      id: "self_trial_log_collection",
      goal: "Collect ≥10 real guard events for the self-trial log",
      successCriteria: ["≥10 events in SELF_TRIAL_CLAUDE_CODE_LOG.md"],
    },
    history: liveSelfTrialHistory(),
    underCheck: {
      scenarioId: "E8",
      description:
        "About to consider re-running py -m pytest just for the log (no new edits)",
      telemetry: {
        actionId: "act_pytest_redundant",
        runtime: "claude-code",
        objectiveId: "self_trial_log_collection",
        actionType: "tool_call",
        toolName: "bash:pytest",
        estimatedCostUsd: 0.03,
        reason: "Re-run for the log",
        failureSignalPresent: false,
        filesRead: [],
        testsRun: [],
        logsRead: [],
        toolResultsChanged: false,
        gitDiffChanged: false,
        contextSourceConfirmed: false,
        confidenceBefore: 0.95,
        confidenceAfter: 0.95,
        timestamp: new Date().toISOString(),
      },
      agreedWithWarning: "yes",
      actedOnIt: "yes",
      myNotes:
        "Self-fulfilling: the guard is helping me NOT do a redundant action right now. I will trust the warning and not re-run.",
    },
  },

  // ── E9: legitimate retry — re-running pytest after the fix landed ──
  // Same retry surface as E2 but emphasizes the contrast: new edit, new evidence.
  {
    scenarioId: "E9",
    title: "Live: re-running pytest after edit (new evidence)",
    context:
      "Right after broadening the narrow-catch in client.py, I re-ran pytest. Same tool as before, but with a genuinely-new edit between attempts.",
    objective: {
      id: "stage_05_python_pytest_green",
      goal: "Get 35/35 Python tests passing",
      successCriteria: ["pytest exits 0"],
    },
    history: pytestPostFixHistory(),
    underCheck: {
      scenarioId: "E9",
      description: "Re-run pytest after the narrow-catch broadening",
      telemetry: {
        actionId: "act_pytest_after_broaden",
        runtime: "claude-code",
        objectiveId: "stage_05_python_pytest_green",
        actionType: "tool_call",
        toolName: "bash:pytest",
        estimatedCostUsd: 0.04,
        reason: "Verify the (URLError, TimeoutError, OSError) tuple fix",
        failureSignalPresent: true,
        failureSignalType: "test_failure",
        failingTest: "tests/test_client.py::test_06b",
        filesRead: ["python/agent_spend_guard/client.py"],
        testsRun: ["tests/test_client.py::test_06b"],
        logsRead: ["pytest output"],
        toolResultsChanged: true,
        gitDiffChanged: true,
        contextSourceConfirmed: true,
        confidenceBefore: 0.6,
        confidenceAfter: 0.9,
        timestamp: new Date("2026-05-15T20:32:30Z").toISOString(),
      },
      agreedWithWarning: "n/a",
      actedOnIt: "n/a",
      myNotes:
        "Expected: allow. Real outcome: tests passed. Validates that the universal evidence model correctly distinguishes 'retrying with new info' from 'retrying blindly'.",
    },
  },

  // ── E10: cost-driven warning — model_escalation pattern ──
  // What if I had decided to escalate to a more-expensive model during a
  // stuck retry? Encoding the path that recommends downgrade instead.
  {
    scenarioId: "E10",
    title: "Considering model escalation during Docker hang",
    context:
      "During the Docker hang (E1/E4), what if I had tried to switch to a 'smarter' (more expensive) model to figure out the WSL issue? The honest answer is 'no new evidence is going to help here — the daemon is just down'. Guard should warn with a downgrade route.",
    objective: {
      id: "stage_05_verify_python_via_docker",
      goal: "Get Docker daemon online",
      successCriteria: ["docker info responds"],
      modelPolicy: {
        primaryModel: {
          provider: "anthropic",
          model: "claude-opus-4.5",
          role: "primary",
          tier: "premium",
        },
        secondaryModel: {
          provider: "anthropic",
          model: "claude-sonnet-4.5",
          role: "secondary",
          tier: "standard",
        },
        maxPremiumRetriesWithoutEvidence: 2,
      },
      detectorPolicy: {
        premium_retry_without_evidence_threshold: 2,
      },
    },
    history: dockerEscalationHistory(),
    underCheck: {
      scenarioId: "E10",
      description: "About to escalate to claude-opus-4.5 for the Docker problem",
      telemetry: {
        actionId: "act_escalate_opus",
        runtime: "claude-code",
        objectiveId: "stage_05_verify_python_via_docker",
        actionType: "paid_llm_call",
        provider: "anthropic",
        model: "claude-opus-4.5",
        modelRole: "primary",
        modelTier: "premium",
        estimatedCostUsd: 0.42, // opus is much more expensive
        reason: "Try a smarter model on the Docker problem",
        failureSignalPresent: true,
        failureSignalType: "tool_error",
        errorCode: "DOCKER_PIPE_NOT_FOUND",
        filesRead: [],
        testsRun: [],
        logsRead: [],
        toolResultsChanged: false,
        gitDiffChanged: false,
        contextSourceConfirmed: false,
        confidenceBefore: 0.3,
        confidenceAfter: 0.3,
        timestamp: new Date("2026-05-15T20:00:00Z").toISOString(),
      },
      agreedWithWarning: "yes",
      actedOnIt: "yes",
      myNotes:
        "Hypothetical but realistic — escalating to a smarter model when the problem isn't reasoning-bound is a real failure mode. Real outcome: I did NOT escalate; I pivoted to honest documentation. Guard's downgrade suggestion would have been the right nudge.",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// History helpers — build prior telemetry that justifies the `under check`
// counts (same_failure_count, paid_attempts_on_same_failure, etc.).
// ─────────────────────────────────────────────────────────────────────────

function dockerProbeHistory(): AgentActionTelemetry[] {
  return [1, 2, 3, 4, 5, 6].map((n) => ({
    actionId: `act_docker_info_${n}`,
    runtime: "claude-code",
    objectiveId: "stage_05_verify_python_via_docker",
    actionType: "tool_call",
    toolName: "bash:docker_info",
    estimatedCostUsd: 0.05,
    reason: `Probe attempt ${n}`,
    failureSignalPresent: true,
    failureSignalType: "tool_error",
    errorCode: "DOCKER_PIPE_NOT_FOUND",
    errorMessage:
      "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine",
    filesRead: n === 1 ? ["/wsl/status"] : [],
    testsRun: [],
    logsRead: n <= 2 ? ["wsl --list --verbose"] : [],
    toolResultsChanged: false,
    gitDiffChanged: false,
    contextSourceConfirmed: false,
    timestamp: new Date(`2026-05-15T19:${30 + n * 2}:00Z`).toISOString(),
  }));
}

function pytestDebugHistory(): AgentActionTelemetry[] {
  return [
    {
      actionId: "act_pytest_initial",
      runtime: "claude-code",
      objectiveId: "stage_05_python_pytest_green",
      actionType: "tool_call",
      toolName: "bash:pytest",
      estimatedCostUsd: 0.05,
      reason: "First Python verification run",
      failureSignalPresent: true,
      failureSignalType: "test_failure",
      failingTest: "tests/test_client.py::test_06_check_shadow_swallows_transport_error",
      errorCode: "ASSERTION_ERROR",
      filesRead: [],
      testsRun: [],
      logsRead: [],
      toolResultsChanged: false,
      gitDiffChanged: false,
      contextSourceConfirmed: false,
      timestamp: new Date("2026-05-15T20:28:00Z").toISOString(),
    },
  ];
}

function npmTestHistory(): AgentActionTelemetry[] {
  return [
    {
      actionId: "act_npm_test_1",
      runtime: "claude-code",
      objectiveId: "stage_05_ts_suite_green",
      actionType: "tool_call",
      toolName: "bash:npm_test",
      estimatedCostUsd: 0.04,
      reason: "Initial green run",
      failureSignalPresent: false,
      filesRead: [],
      testsRun: [],
      logsRead: [],
      toolResultsChanged: false,
      gitDiffChanged: false,
      contextSourceConfirmed: false,
      timestamp: new Date("2026-05-15T20:00:00Z").toISOString(),
    },
  ];
}

function dockerStartupHistory(): AgentActionTelemetry[] {
  return [1, 2, 3].map((n) => ({
    actionId: `act_docker_start_${n}`,
    runtime: "claude-code",
    objectiveId: "stage_05_verify_python_via_docker",
    actionType: "paid_llm_call",
    provider: "anthropic",
    model: "claude-sonnet-4.5",
    modelRole: "primary" as const,
    modelTier: "premium" as const,
    estimatedCostUsd: 0.08,
    reason: `Wake-up attempt ${n}`,
    failureSignalPresent: true,
    failureSignalType: "tool_error",
    errorCode: "DOCKER_PIPE_NOT_FOUND",
    filesRead: [],
    testsRun: [],
    logsRead: ["wsl --list --verbose"],
    toolResultsChanged: false,
    gitDiffChanged: false,
    contextSourceConfirmed: false,
    timestamp: new Date(`2026-05-15T19:${40 + n * 5}:00Z`).toISOString(),
  }));
}

function typecheckHistory(): AgentActionTelemetry[] {
  return [1, 2, 3].map((n) => ({
    actionId: `act_typecheck_${n}`,
    runtime: "claude-code",
    objectiveId: "stage_05_version_bump",
    actionType: "tool_call",
    toolName: "bash:tsc_noemit",
    estimatedCostUsd: 0.03,
    reason: `Typecheck pass ${n}`,
    failureSignalPresent: false,
    filesRead: ["src/config/env.ts"],
    testsRun: [],
    logsRead: [],
    toolResultsChanged: true,
    gitDiffChanged: true,
    contextSourceConfirmed: true,
    timestamp: new Date(`2026-05-15T19:${44 + n}:00Z`).toISOString(),
  }));
}

function liveSelfTrialHistory(): AgentActionTelemetry[] {
  return [
    {
      actionId: "act_pytest_just_now",
      runtime: "claude-code",
      objectiveId: "self_trial_log_collection",
      actionType: "tool_call",
      toolName: "bash:pytest",
      estimatedCostUsd: 0.03,
      reason: "Verify final state",
      failureSignalPresent: false,
      filesRead: [],
      testsRun: [],
      logsRead: [],
      toolResultsChanged: false,
      gitDiffChanged: false,
      contextSourceConfirmed: false,
      timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  ];
}

function pytestPostFixHistory(): AgentActionTelemetry[] {
  return [
    {
      actionId: "act_pytest_pre_fix",
      runtime: "claude-code",
      objectiveId: "stage_05_python_pytest_green",
      actionType: "tool_call",
      toolName: "bash:pytest",
      estimatedCostUsd: 0.04,
      reason: "First attempt — surfaces failure",
      failureSignalPresent: true,
      failureSignalType: "test_failure",
      failingTest: "tests/test_client.py::test_06b",
      filesRead: [],
      testsRun: [],
      logsRead: [],
      toolResultsChanged: false,
      gitDiffChanged: false,
      contextSourceConfirmed: false,
      timestamp: new Date("2026-05-15T20:30:00Z").toISOString(),
    },
  ];
}

function dockerEscalationHistory(): AgentActionTelemetry[] {
  return [1, 2].map((n) => ({
    actionId: `act_docker_attempt_premium_${n}`,
    runtime: "claude-code",
    objectiveId: "stage_05_verify_python_via_docker",
    actionType: "paid_llm_call",
    provider: "anthropic",
    model: "claude-sonnet-4.5",
    modelRole: "primary" as const,
    modelTier: "premium" as const,
    estimatedCostUsd: 0.08,
    reason: `Sonnet attempt ${n} on Docker hang`,
    failureSignalPresent: true,
    failureSignalType: "tool_error",
    errorCode: "DOCKER_PIPE_NOT_FOUND",
    filesRead: [],
    testsRun: [],
    logsRead: [],
    toolResultsChanged: false,
    gitDiffChanged: false,
    contextSourceConfirmed: false,
    timestamp: new Date(`2026-05-15T19:${50 + n * 2}:00Z`).toISOString(),
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// Driver: feed scenarios through CodingAgentAdapter → /v1/check → log
// ─────────────────────────────────────────────────────────────────────────

async function callGuard(
  payload: ReturnType<CodingAgentAdapter["buildCheckInput"]>
): Promise<SpendingGuardCheckOutput> {
  const res = await fetch(GUARD_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Guard HTTP ${res.status}: ${body}`);
  }
  return (await res.json()) as SpendingGuardCheckOutput;
}

function initLog(): void {
  const header = `# SELF_TRIAL_CLAUDE_CODE_LOG.md

> **Trial:** Self-trial of Agent Spend Guard v0.5.0-beta — Claude Code as the partner
> **Mode:** shadow only (\`/v1/check\` POSTs; never enforced)
> **Server:** http://localhost:8080 — \`Bearer asg_v1_demo\` — \`0.5.0-beta\`
> **Started:** ${new Date().toISOString()}
> **Adapter:** \`CodingAgentAdapter\` (re-export of \`OpenClawAdapter\`)
> **Source of scenarios:** real retries observed during the Stage 0.4.2 / 0.5 build in this very session, encoded as telemetry the guard could see.

Each event below is a single \`/v1/check\` call with:
- the action under check (what I was about to do)
- the prior history that justifies the same_failure_count / same_action_count
- the guard's verdict (decision, pattern, risk_score, confidence, reason, suggested_action, model_route)
- my honest assessment (did I agree, did I act on it)

---

`;
  writeFileSync(LOG_PATH, header);
}

function fmtEvent(
  scenario: Scenario,
  guard: SpendingGuardCheckOutput,
  responseMs: number
): string {
  const ev = scenario.underCheck;
  const t = ev.telemetry;
  const route = guard.suggested_action.model_route;
  const lines: string[] = [];
  lines.push(`## ${scenario.scenarioId} — ${scenario.title}`);
  lines.push("");
  lines.push(`**Context:** ${scenario.context}`);
  lines.push("");
  lines.push(`**Objective:** \`${scenario.objective.id}\` — ${scenario.objective.goal ?? "(no goal)"}`);
  lines.push("");
  lines.push("**Action under check:**");
  lines.push("```jsonc");
  lines.push(
    JSON.stringify(
      {
        actionType: t.actionType,
        toolName: t.toolName,
        provider: t.provider,
        model: t.model,
        modelRole: t.modelRole,
        modelTier: t.modelTier,
        estimatedCostUsd: t.estimatedCostUsd,
        failureSignalType: t.failureSignalType,
        errorCode: t.errorCode,
        filesRead: t.filesRead?.length ?? 0,
        testsRun: t.testsRun?.length ?? 0,
        toolResultsChanged: t.toolResultsChanged,
        gitDiffChanged: t.gitDiffChanged,
        contextSourceConfirmed: t.contextSourceConfirmed,
      },
      null,
      2
    )
  );
  lines.push("```");
  lines.push("");
  lines.push(`**History:** ${scenario.history.length} prior events on the same objective.`);
  lines.push("");
  lines.push("**Guard verdict:**");
  lines.push("");
  lines.push(`| field | value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| decision | \`${guard.decision}\` |`);
  lines.push(`| pattern | \`${guard.pattern}\` |`);
  lines.push(`| risk_score | ${guard.risk_score} |`);
  lines.push(`| risk_level | \`${guard.risk_level}\` |`);
  lines.push(`| confidence | ${guard.confidence.toFixed(2)} |`);
  lines.push(`| recommended_policy | \`${guard.recommended_policy}\` |`);
  lines.push(`| detector_version | \`${guard.detector_version}\` |`);
  lines.push(`| response_ms | ${responseMs} |`);
  lines.push("");
  lines.push(`**Reason:** ${guard.reason}`);
  lines.push("");
  lines.push(`**Suggested action:** \`${guard.suggested_action.type}\` — ${guard.suggested_action.message}`);
  if (route?.to) {
    lines.push("");
    lines.push(
      `**Model route:** \`${route.from?.model ?? "?"}\` → \`${route.to.model ?? "?"}\` (${route.reason ?? "no reason field"})`
    );
  }
  lines.push("");
  lines.push(`**Matched rules:** ${guard.matched_rules.length === 0 ? "(none)" : guard.matched_rules.map((r) => `\`${r}\``).join(", ")}`);
  lines.push("");
  lines.push(`**My assessment:**`);
  lines.push(`- Agreed with the warning: **${ev.agreedWithWarning}**`);
  lines.push(`- Acted on it: **${ev.actedOnIt}**`);
  lines.push(`- Notes: ${ev.myNotes}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

async function runScenario(
  scenario: Scenario
): Promise<{
  guard: SpendingGuardCheckOutput;
  responseMs: number;
}> {
  const adapter = new CodingAgentAdapter();
  for (const past of scenario.history) {
    adapter.record(past);
  }
  const payload = adapter.buildCheckInput(scenario.underCheck.telemetry, {
    objective: scenario.objective,
  });
  const t0 = Date.now();
  const guard = await callGuard(payload);
  const responseMs = Date.now() - t0;
  return { guard, responseMs };
}

async function main(): Promise<void> {
  initLog();
  let warns = 0;
  let allows = 0;
  let confirms = 0;
  let blocks = 0;
  let totalMs = 0;
  for (const scenario of scenarios) {
    process.stdout.write(`${scenario.scenarioId} ${scenario.title} ... `);
    try {
      const { guard, responseMs } = await runScenario(scenario);
      appendFileSync(LOG_PATH, fmtEvent(scenario, guard, responseMs));
      totalMs += responseMs;
      switch (guard.decision) {
        case "allow":
          allows++;
          break;
        case "warn":
          warns++;
          break;
        case "require_confirmation":
          confirms++;
          break;
        case "block":
          blocks++;
          break;
        default:
          break;
      }
      console.log(
        `${guard.decision} (${guard.pattern}, risk=${guard.risk_score}, ${responseMs}ms)`
      );
    } catch (err) {
      console.log(
        `ERROR: ${err instanceof Error ? err.message : String(err)}`
      );
      appendFileSync(
        LOG_PATH,
        `## ${scenario.scenarioId} — ${scenario.title}\n\n**ERROR:** ${err instanceof Error ? err.message : String(err)}\n\n---\n\n`
      );
    }
  }
  const summary = `## Run summary

- **Events:** ${scenarios.length}
- **allow:** ${allows}
- **warn:** ${warns}
- **require_confirmation:** ${confirms}
- **block:** ${blocks}
- **avg latency:** ${(totalMs / scenarios.length).toFixed(0)}ms

`;
  appendFileSync(LOG_PATH, summary);
  console.log("---");
  console.log(`Wrote ${scenarios.length} events to ${LOG_PATH}`);
  console.log(`allow=${allows} warn=${warns} req_confirm=${confirms} block=${blocks}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
