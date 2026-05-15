// CLI: npm run logs:summary
//
// Reads the JSONL decision log from AGENT_SPEND_GUARD_LOG_PATH (or
// ./logs/decisions.jsonl by default) and prints a beta-style aggregate
// summary. No HTTP dependency; no Core dependency. Read-only.

import { existsSync, readFileSync } from "node:fs";
import { loadEnvConfig } from "../config/env.js";

interface Aggregates {
  total: number;
  byDecision: Record<string, number>;
  byPattern: Record<string, number>;
  byPolicy: Record<string, number>;
  warnCount: number;
  requireConfirmationCount: number;
  blockCount: number;
}

function bumpCounter(map: Record<string, number>, key: string | undefined): void {
  const k = key ?? "(unknown)";
  map[k] = (map[k] ?? 0) + 1;
}

function aggregate(lines: readonly string[]): Aggregates {
  const acc: Aggregates = {
    total: 0,
    byDecision: {},
    byPattern: {},
    byPolicy: {},
    warnCount: 0,
    requireConfirmationCount: 0,
    blockCount: 0,
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.event_type !== "agent_spend_guard.check.completed") continue;
    acc.total += 1;
    const decision = event.decision as string | undefined;
    const pattern = event.pattern as string | undefined;
    const policy = event.recommended_policy as string | undefined;
    bumpCounter(acc.byDecision, decision);
    bumpCounter(acc.byPattern, pattern);
    bumpCounter(acc.byPolicy, policy);
    if (decision === "warn") acc.warnCount += 1;
    if (decision === "require_confirmation") acc.requireConfirmationCount += 1;
    if (decision === "block") acc.blockCount += 1;
  }

  return acc;
}

function formatCounts(map: Record<string, number>, indent = "- "): string {
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return `${indent}(none)`;
  return sorted.map(([k, v]) => `${indent}${k}: ${v}`).join("\n");
}

export interface SummaryOutput {
  text: string;
  aggregates: Aggregates;
}

export function summarize(lines: readonly string[]): SummaryOutput {
  const a = aggregate(lines);
  const text =
    `Agent Spend Guard — Beta Summary\n\n` +
    `total_checks: ${a.total}\n` +
    `allow: ${a.byDecision.allow ?? 0}\n` +
    `warn: ${a.warnCount}\n` +
    `require_confirmation: ${a.requireConfirmationCount}\n` +
    `block: ${a.blockCount}\n\n` +
    `patterns:\n${formatCounts(a.byPattern)}\n\n` +
    `top_recommended_policies:\n${formatCounts(a.byPolicy)}\n\n` +
    `false_positive_review_needed:\n` +
    `- warn: ${a.warnCount}\n` +
    `- require_confirmation: ${a.requireConfirmationCount}\n`;
  return { text, aggregates: a };
}

function main(): void {
  const config = loadEnvConfig();
  const path = config.logPath;
  if (!existsSync(path)) {
    // eslint-disable-next-line no-console
    console.error(
      `No log file at ${path}. Set AGENT_SPEND_GUARD_LOG_PATH or run the server with AGENT_SPEND_GUARD_LOG_SINK=jsonl first.`
    );
    process.exit(1);
  }
  const raw = readFileSync(path, "utf8");
  const out = summarize(raw.split("\n"));
  // eslint-disable-next-line no-console
  console.log(out.text);
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /logs-summary\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  main();
}
