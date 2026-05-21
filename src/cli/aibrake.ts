#!/usr/bin/env node
// AIBrake CLI entrypoint.
//
//   npx aibrake demo         — run the canonical "$40 retry storm" demo
//   npx aibrake check <file> — run a check against a JSON payload file
//   npx aibrake version      — print version
//   npx aibrake help         — print help
//
// Designed for zero setup: `npm install aibrake` then `npx aibrake demo`
// just works. No API key, no network — the demo runs the stateless Core
// check in-process so partners can see exactly what AIBrake would say
// before signing up for a hosted API key.

import { readFileSync } from "node:fs";
import { runCheck } from "../core/check.js";
import type { SpendingGuardCheckInput } from "../core/types.js";
import { runMcpServer } from "./mcp.js";

// ──────────────────────────────────────────────────────────────────────────
// Color helpers (no deps — raw ANSI codes).
// ──────────────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function colorForDecision(decision: string): string {
  switch (decision) {
    case "allow": return C.green;
    case "warn": return C.yellow;
    case "require_confirm":
    case "require_confirmation": return C.cyan;
    case "delay": return C.yellow;
    case "block": return C.red;
    default: return C.reset;
  }
}

function iconForDecision(decision: string): string {
  switch (decision) {
    case "allow": return "✓";
    case "warn": return "⚠";
    case "require_confirm":
    case "require_confirmation": return "?";
    case "delay": return "⏸";
    case "block": return "⛔";
    default: return "·";
  }
}

// ──────────────────────────────────────────────────────────────────────────
// The canonical "$40 retry storm" — agent retrying the same failing TS
// build for the 7th time without new evidence. This is exactly the
// pattern AIBrake's stale_context_retry_storm detector exists to catch.
// ──────────────────────────────────────────────────────────────────────────
const RETRY_STORM_DEMO: SpendingGuardCheckInput = {
  actor: {
    type: "agent",
    runtime: "openclaw",
    id: "agent_001",
    name: "OpenClaw Coding Agent",
  },
  objective: {
    id: "obj_ts_build",
    goal: "Fix failing TypeScript build",
    success_criteria: ["npm run build passes", "npm test passes"],
    budget: { amount: 5, currency: "USD", hard_limit: false },
    max_paid_attempts: 8,
    allowed_actions: ["paid_llm_call", "read_file", "run_test", "inspect_logs"],
    blocked_actions: ["buy_subscription", "start_new_architecture"],
  },
  next_action: {
    id: "act_007",
    type: "paid_llm_call",
    provider: "anthropic",
    model: "claude-opus",
    estimated_cost: { amount: 0.42, currency: "USD" },
    reason: "Retry the same TypeScript build fix",
  },
  history: {
    attempt_number: 7,
    same_action_count: 6,
    paid_attempts_on_same_failure: 6,
    failure_signal_present: true,
    failure_signal_type: "build_error",
    failure_fingerprint: "fp_v1_failure_ts2307_payment_guard",
    same_failure_count: 6,
    last_new_evidence_at_attempt: 2,
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
  spend: {
    spent_on_objective: { amount: 4.61, currency: "USD" },
    spent_today: { amount: 38.42, currency: "USD" },
    daily_budget: { amount: 50, currency: "USD" },
  },
  telemetry_quality: { completeness: "high" },
};

// ──────────────────────────────────────────────────────────────────────────
// Output formatting
// ──────────────────────────────────────────────────────────────────────────
function printScenario(input: SpendingGuardCheckInput): void {
  const c = C;
  console.log(`${c.bold}${c.cyan}┌─────────────────────────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.bold}${c.cyan}│  AIBrake — loop detection + model stop-loss for AI agents  │${c.reset}`);
  console.log(`${c.bold}${c.cyan}└─────────────────────────────────────────────────────────────┘${c.reset}`);
  console.log();
  console.log(`${c.bold}Scenario:${c.reset} the canonical "$40 retry storm"`);
  console.log();
  console.log(`  ${c.dim}Agent:${c.reset}        ${input.actor.name ?? input.actor.id} (${input.actor.runtime})`);
  console.log(`  ${c.dim}Task:${c.reset}         ${input.objective?.goal}`);
  console.log(`  ${c.dim}Attempt #:${c.reset}    ${c.bold}${input.history?.attempt_number}${c.reset} (${input.history?.paid_attempts_on_same_failure} paid retries on the same failure)`);
  console.log(`  ${c.dim}Next call:${c.reset}    ${input.next_action.model} @ $${input.next_action.estimated_cost?.amount}`);
  console.log(`  ${c.dim}Spent so far:${c.reset} $${input.spend?.spent_on_objective?.amount} / $${input.objective?.budget?.amount} on this task`);
  console.log(`  ${c.dim}Evidence:${c.reset}     ${c.red}no new files read, no new tests run, no diff change${c.reset}`);
  console.log();
  console.log(`  ${c.gray}↓ asking AIBrake whether attempt #7 is worth $0.42…${c.reset}`);
  console.log();
}

function printResult(result: ReturnType<typeof runCheck>): void {
  const c = C;
  const decColor = colorForDecision(result.decision);
  const icon = iconForDecision(result.decision);

  console.log(`${c.bold}┌─ AIBrake decision ──────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.bold}│${c.reset}  ${decColor}${c.bold}${icon}  ${result.decision.toUpperCase().padEnd(20)}${c.reset}  ${c.dim}risk: ${result.risk_level} (score ${result.risk_score.toFixed(2)})${c.reset}`);
  console.log(`${c.bold}│${c.reset}`);
  console.log(`${c.bold}│${c.reset}  ${c.dim}Pattern:${c.reset}   ${result.pattern}`);
  console.log(`${c.bold}│${c.reset}  ${c.dim}Reason:${c.reset}    ${result.reason}`);
  if (result.projected_savings) {
    const ps = result.projected_savings;
    console.log(`${c.bold}│${c.reset}`);
    console.log(`${c.bold}│${c.reset}  ${c.green}${c.bold}💰  $${ps.amount_usd.toFixed(2)} ${ps.currency}${c.reset} saved by ${result.decision === "block" ? "blocking" : "questioning"} this call`);
    console.log(`${c.bold}│${c.reset}  ${c.dim}basis:     ${ps.basis}${c.reset}`);
    console.log(`${c.bold}│${c.reset}  ${c.dim}explanation: ${ps.explanation}${c.reset}`);
  }
  console.log(`${c.bold}└─────────────────────────────────────────────────────────────┘${c.reset}`);
  console.log();
  console.log(`${c.dim}What just happened:${c.reset}`);
  console.log(`  This decision came from the AIBrake Core, running in-process.`);
  console.log(`  The full hosted API at ${c.cyan}https://api.aibrake.dev${c.reset} does the same`);
  console.log(`  plus per-key auth, decision logs, public stats, and shadow mode.`);
  console.log();
  console.log(`${c.bold}Try it on YOUR agent:${c.reset}`);
  console.log(`  ${c.cyan}https://aibrake.dev${c.reset}                  ← grab a beta API key`);
  console.log(`  ${c.cyan}https://github.com/Askbsman/aibrake${c.reset}  ← integration examples`);
  console.log();
}

// ──────────────────────────────────────────────────────────────────────────
// Subcommands
// ──────────────────────────────────────────────────────────────────────────
function cmdDemo(): void {
  printScenario(RETRY_STORM_DEMO);
  // emitLog: false — silence the structured decision log so the demo
  // output stays clean. Logging is the right default for production use
  // (sink-to-file or to stderr) but pollutes the terminal demo.
  const result = runCheck(RETRY_STORM_DEMO, { emitLog: false });
  printResult(result);
}

function cmdCheck(filePath: string | undefined): void {
  if (!filePath) {
    console.error("Usage: npx aibrake check <path-to-input.json>");
    process.exit(1);
  }
  let input: SpendingGuardCheckInput;
  try {
    input = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`Failed to read ${filePath}: ${(e as Error).message}`);
    process.exit(1);
  }
  const result = runCheck(input, { emitLog: false });
  console.log(JSON.stringify(result, null, 2));
}

function cmdMcp(): void {
  runMcpServer();
  // Don't exit — stdin loop keeps the process alive.
}

function cmdVersion(): void {
  // package.json version is the source of truth; CLI prints it from a constant
  // baked at build time. For now, hardcode and bump alongside package.json.
  console.log("aibrake 0.6.0-beta");
}

function cmdHelp(): void {
  console.log(`
${C.bold}AIBrake${C.reset} — loop detection and model stop-loss for paid AI agents

${C.bold}Usage:${C.reset}
  npx aibrake <command>

${C.bold}Commands:${C.reset}
  demo                Run the canonical "$40 retry storm" demo (no setup)
  check <file.json>   Run AIBrake Core against a JSON input file
  mcp                 Start AIBrake as an MCP server (stdio) — register
                      in Claude Code / OpenClaw / Cursor / Cline config
  version             Print the installed version
  help                Print this message

${C.bold}Try it:${C.reset}
  ${C.cyan}npx aibrake demo${C.reset}

${C.bold}Plug into your agent (Claude Code / OpenClaw / Cline / Cursor):${C.reset}
  Add to your MCP config:
    "mcpServers": {
      "aibrake": { "command": "npx", "args": ["-y", "aibrake@beta", "mcp"] }
    }

${C.bold}Learn more:${C.reset}
  ${C.cyan}https://aibrake.dev${C.reset}
  ${C.cyan}https://github.com/Askbsman/aibrake${C.reset}
`);
}

// ──────────────────────────────────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────────────────────────────────
const [, , cmd, ...args] = process.argv;
switch (cmd) {
  case "demo":            cmdDemo(); break;
  case "check":           cmdCheck(args[0]); break;
  case "mcp":             cmdMcp(); break;
  case "version":
  case "-v":
  case "--version":       cmdVersion(); break;
  case undefined:
  case "help":
  case "-h":
  case "--help":          cmdHelp(); break;
  default:
    console.error(`Unknown command: ${cmd}`);
    cmdHelp();
    process.exit(1);
}
