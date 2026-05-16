// CLI: npm run logs:summary
//
// Reads the JSONL decision log from AGENT_SPEND_GUARD_LOG_PATH (or
// ./logs/decisions.jsonl by default) and prints a beta-style aggregate
// summary. No HTTP dependency; no Core dependency. Read-only.
//
// Stage 0.5.2 — savings aggregation. Sums `projected_savings_usd` from
// every warn / require_confirmation / block / delay event and reports it
// as "savings the guard offered to the operator if they heeded the
// recommendation." Partners decide whether they heeded each one — the
// CLI cannot know that without the partner's outcome log.

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
  // Stage 0.5.2: $-denominated savings.
  totalNextActionCostUsd: number; // total partner-supplied cost across all events with cost
  costSampleCount: number;        // how many events carried a cost number
  totalSavingsOfferedUsd: number; // sum of projected_savings_usd
  savingsByPattern: Record<string, number>;
  savingsByBasis: Record<string, number>;
  savingsSampleCount: number;
}

function bumpCounter(map: Record<string, number>, key: string | undefined): void {
  const k = key ?? "(unknown)";
  map[k] = (map[k] ?? 0) + 1;
}

function addToBucket(
  map: Record<string, number>,
  key: string | undefined,
  amount: number
): void {
  const k = key ?? "(unknown)";
  map[k] = (map[k] ?? 0) + amount;
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
    totalNextActionCostUsd: 0,
    costSampleCount: 0,
    totalSavingsOfferedUsd: 0,
    savingsByPattern: {},
    savingsByBasis: {},
    savingsSampleCount: 0,
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

    // Stage 0.5.2 — savings + cost aggregation
    const cost = event.next_action_cost_usd;
    if (typeof cost === "number" && Number.isFinite(cost)) {
      acc.totalNextActionCostUsd += cost;
      acc.costSampleCount += 1;
    }
    const savings = event.projected_savings_usd;
    if (typeof savings === "number" && Number.isFinite(savings) && savings > 0) {
      acc.totalSavingsOfferedUsd += savings;
      acc.savingsSampleCount += 1;
      addToBucket(acc.savingsByPattern, pattern, savings);
      const basis = event.projected_savings_basis as string | undefined;
      addToBucket(acc.savingsByBasis, basis, savings);
    }
  }

  return acc;
}

function formatCounts(map: Record<string, number>, indent = "- "): string {
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return `${indent}(none)`;
  return sorted.map(([k, v]) => `${indent}${k}: ${v}`).join("\n");
}

function formatMoney(map: Record<string, number>, indent = "- "): string {
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return `${indent}(none)`;
  return sorted.map(([k, v]) => `${indent}${k}: $${v.toFixed(2)}`).join("\n");
}

function fmt$(n: number): string {
  return `$${n.toFixed(2)}`;
}

export interface SummaryOutput {
  text: string;
  aggregates: Aggregates;
}

export function summarize(lines: readonly string[]): SummaryOutput {
  const a = aggregate(lines);
  const avgCost =
    a.costSampleCount > 0 ? a.totalNextActionCostUsd / a.costSampleCount : 0;
  const text =
    `Agent Spend Guard — Beta Summary\n\n` +
    `total_checks: ${a.total}\n` +
    `allow: ${a.byDecision.allow ?? 0}\n` +
    `warn: ${a.warnCount}\n` +
    `require_confirmation: ${a.requireConfirmationCount}\n` +
    `block: ${a.blockCount}\n\n` +
    `patterns:\n${formatCounts(a.byPattern)}\n\n` +
    `top_recommended_policies:\n${formatCounts(a.byPolicy)}\n\n` +
    `savings_offered (sum of projected_savings_usd on warn/req_confirm/block):\n` +
    `- total: ${fmt$(a.totalSavingsOfferedUsd)}\n` +
    `- events_with_savings: ${a.savingsSampleCount}\n` +
    `- avg_per_event: ${fmt$(a.savingsSampleCount > 0 ? a.totalSavingsOfferedUsd / a.savingsSampleCount : 0)}\n\n` +
    `savings_by_pattern:\n${formatMoney(a.savingsByPattern)}\n\n` +
    `savings_by_basis:\n${formatMoney(a.savingsByBasis)}\n\n` +
    `cost_observed (sum of next_action_cost_usd across all events):\n` +
    `- total: ${fmt$(a.totalNextActionCostUsd)}\n` +
    `- avg_per_event: ${fmt$(avgCost)}\n` +
    `- events_with_cost: ${a.costSampleCount}\n\n` +
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
