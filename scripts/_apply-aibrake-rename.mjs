#!/usr/bin/env node
// Brand rename: Agent Spend Guard → AIBrake.
// User-facing surfaces only — technical identifiers (npm package, env vars,
// API key prefix, event_type, SDK class names) stay as-is for backwards
// compat with the existing 0.5.x contract.
//
// What this changes:
//   "Agent Spend Guard"  → "AIBrake"
//   "agent spend guard"  → "aibrake"  (rare lowercase usage)
//
// What this preserves (DO NOT swap):
//   - npm package `spending-guard`
//   - SDK class `SpendingGuard` / Python `AgentSpendGuard`
//     (breaking SDK rename = 1.0 territory; not for a marketing rebrand)
//   - env prefix `AGENT_SPEND_GUARD_*`
//   - API key prefix `asg_v1_*`
//   - service slug `agent-spend-guard` (in /health)
//   - event_type `agent_spend_guard.check.completed`
//   - `agent-spend-guard` slug in deployment / Docker
//   - CHANGELOG entries < 0.5.4 (historical record)
//   - tests (they're fixtures, not branding)
//
// Safe to delete this file after the rebrand commit lands.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "validation-log", "logs", ".vitest", "coverage", "build"]);
const SKIP_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".docx", ".pyc", ".log"]);
const SKIP_FILES = new Set(["package-lock.json"]);

// Files where the brand reference is a fixture / historical record / technical
// identifier and MUST NOT be rebranded.
const PRESERVE = new Set([
  "tests/stage-04-2-sdk-fail-open-scope.test.ts",
  "tests/stage-05-partner-ready-hardening.test.ts",
  "python/tests/test_client.py",
  "python/tests/test_integration.py",
  "python/tests/conftest.py",
  "python/Dockerfile.test",
  // historical reports — keep the name they used at the time
  "SELF_TRIAL_CLAUDE_CODE_LOG.md",
  "SELF_TRIAL_CLAUDE_CODE_REPORT.md",
  "BENCHMARK_10_AGENTS.md",
  "SIMULATION_10_PARTNERS_REPORT.md",
  "SIMULATION_100_PARTNERS_WEEK_REPORT.md",
  // CHANGELOG — historical
  "CHANGELOG.md",
  // these one-shot rebrand scripts themselves
  "scripts/_apply-aibrake.mjs",
  "scripts/_apply-aibrake-rename.mjs",
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function rel(p) { return p.slice(repoRoot.length + 1).replaceAll("\\", "/"); }

// Brand swaps. Order: longer/more-specific first.
// Note: we deliberately do NOT touch `agent-spend-guard` (hyphenated slug —
// that's the service identifier) or `agent_spend_guard` (snake_case — event
// type). Only the human-readable brand text.
const swaps = [
  ["Agent Spend Guard", "AIBrake"],
  ["agent spend guard", "aibrake"], // lowercase brand (rare, mostly nav)
];

const allFiles = walk(repoRoot);
let changed = 0;
const list = [];

for (const abs of allFiles) {
  const r = rel(abs);
  if (PRESERVE.has(r)) continue;
  const ext = r.slice(r.lastIndexOf("."));
  if (SKIP_EXTS.has(ext)) continue;
  const base = r.split("/").pop();
  if (SKIP_FILES.has(base)) continue;

  let content;
  try { content = readFileSync(abs, "utf8"); } catch { continue; }
  let next = content;
  for (const [from, to] of swaps) {
    next = next.split(from).join(to);
  }
  if (next !== content) {
    writeFileSync(abs, next, "utf8");
    changed += 1;
    list.push(r);
  }
}

console.log(`Done. ${changed} files updated.`);
for (const f of list) console.log(`  ${f}`);
