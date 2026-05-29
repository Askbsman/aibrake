#!/usr/bin/env tsx
// LCR Benchmark Runner
//
// Loads the corpus, runs each scenario through AIBrake's Core (`runCheck`),
// and computes:
//   - LCR (Loop Catch Rate) — % of scenarios where the decision agrees with
//     the label. For "positive" scenarios, "catch" = decision in {warn,
//     require_confirmation, block} OR risk_score >= 50. For "negative"
//     scenarios, "correct" = decision == "allow" AND risk_score < 50.
//   - Per-detector-family breakdown
//   - False positive rate (negatives caught as positives)
//   - False negative rate (positives missed)
//   - p50 / p95 latency
//
// Run:
//   npm test &&  npx tsx benchmarks/run-lcr.ts
//
// Output:
//   - Pretty table to stdout
//   - benchmarks/RESULTS.md updated with the latest snapshot
//   - benchmarks/lcr-history.jsonl appended (one JSON line per run)

import { writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../src/core/check.js";
import { setLoggerSink } from "../src/core/logger.js";
import { generateCorpus, type LabeledScenario } from "./corpus.js";

setLoggerSink({ emit: () => {} }); // silent for clean output

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(__dirname, "RESULTS.md");
const HISTORY_PATH = join(__dirname, "lcr-history.jsonl");
const CORPUS_VERSION = "v1";
const RISK_THRESHOLD = 50;

interface ScenarioResult {
  id: string;
  label: "positive" | "negative";
  expectedDetectorFamily?: string;
  decision: string;
  risk_score: number;
  pattern: string;
  reason: string;
  caught: boolean;          // decision in {warn, require_confirm, block} OR risk_score >= 50
  correct: boolean;         // catch matches label
  latency_ms: number;
}

function evaluate(scenario: LabeledScenario): ScenarioResult {
  const t0 = process.hrtime.bigint();
  const out = runCheck(scenario.input, { emitLog: false });
  const t1 = process.hrtime.bigint();
  const latencyMs = Number(t1 - t0) / 1_000_000;

  const caughtByDecision =
    out.decision === "warn" ||
    out.decision === "require_confirmation" ||
    out.decision === "block";
  const caughtByScore = out.risk_score >= RISK_THRESHOLD;
  const caught = caughtByDecision || caughtByScore;

  const correct = scenario.label === "positive" ? caught : !caught;

  return {
    id: scenario.id,
    label: scenario.label,
    expectedDetectorFamily: scenario.expectedDetectorFamily,
    decision: out.decision,
    risk_score: out.risk_score,
    pattern: out.pattern,
    reason: out.reason,
    caught,
    correct,
    latency_ms: latencyMs,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

interface FamilyStats {
  total: number;
  caught: number;
  correct: number;
}

function main(): void {
  const corpus = generateCorpus();
  const results = corpus.map(evaluate);

  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const lcr = (correct / total) * 100;

  const positives = results.filter((r) => r.label === "positive");
  const negatives = results.filter((r) => r.label === "negative");

  const positivesCaught = positives.filter((r) => r.caught).length;
  const negativesFalselyCaught = negatives.filter((r) => r.caught).length;

  const recall = (positivesCaught / positives.length) * 100;
  const falsePositiveRate =
    (negativesFalselyCaught / negatives.length) * 100;
  const precision =
    positivesCaught + negativesFalselyCaught > 0
      ? (positivesCaught / (positivesCaught + negativesFalselyCaught)) * 100
      : 0;

  // Per-family breakdown (only for scenarios with expectedDetectorFamily hint)
  const byFamily = new Map<string, FamilyStats>();
  for (const r of results) {
    if (!r.expectedDetectorFamily) continue;
    const stats = byFamily.get(r.expectedDetectorFamily) ?? {
      total: 0,
      caught: 0,
      correct: 0,
    };
    stats.total += 1;
    if (r.caught) stats.caught += 1;
    if (r.correct) stats.correct += 1;
    byFamily.set(r.expectedDetectorFamily, stats);
  }

  // Latency
  const latencies = results.map((r) => r.latency_ms).sort((a, b) => a - b);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const meanLatency = latencies.reduce((s, n) => s + n, 0) / latencies.length;

  // ───── Print to stdout ─────
  const c = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
  };

  console.log(`\n${c.bold}${c.cyan}━━━ AIBrake LCR Benchmark — corpus ${CORPUS_VERSION} ━━━${c.reset}\n`);
  console.log(`${c.bold}Loop Catch Rate (LCR):${c.reset}    ${c.green}${c.bold}${fmt(lcr, 1)}%${c.reset}  ${c.dim}(${correct}/${total} correct)${c.reset}`);
  console.log(`${c.dim}Recall (sensitivity):    ${fmt(recall, 1)}%  (${positivesCaught}/${positives.length} positives caught)${c.reset}`);
  console.log(`${c.dim}False positive rate:     ${fmt(falsePositiveRate, 1)}%  (${negativesFalselyCaught}/${negatives.length} negatives falsely caught)${c.reset}`);
  console.log(`${c.dim}Precision:               ${fmt(precision, 1)}%${c.reset}`);
  console.log();
  console.log(`${c.bold}Latency:${c.reset}`);
  console.log(`  ${c.dim}mean:${c.reset}  ${fmt(meanLatency, 3)} ms`);
  console.log(`  ${c.dim}p50:${c.reset}   ${fmt(p50, 3)} ms`);
  console.log(`  ${c.dim}p95:${c.reset}   ${fmt(p95, 3)} ms`);
  console.log();
  console.log(`${c.bold}Per-detector-family breakdown:${c.reset}`);
  for (const [family, stats] of byFamily.entries()) {
    const pct = (stats.caught / stats.total) * 100;
    const color = pct >= 90 ? c.green : pct >= 70 ? c.yellow : c.red;
    console.log(
      `  ${family.padEnd(40)} ${color}${fmt(pct, 1).padStart(5)}%${c.reset} ${c.dim}(${stats.caught}/${stats.total})${c.reset}`
    );
  }
  console.log();

  // ───── Write RESULTS.md ─────
  const now = new Date().toISOString();
  const familyTable = Array.from(byFamily.entries())
    .map(
      ([f, s]) =>
        `| ${f} | ${((s.caught / s.total) * 100).toFixed(1)}% | ${s.caught}/${s.total} |`
    )
    .join("\n");

  const md = `# AIBrake LCR Benchmark Results

> Snapshot: ${now}
> Corpus: ${CORPUS_VERSION} (${total} scenarios, ${positives.length} positive / ${negatives.length} negative)
> Risk threshold for "caught": >= ${RISK_THRESHOLD}

## Headline

**Loop Catch Rate (LCR): ${fmt(lcr, 1)}%**

${correct} of ${total} scenarios produced a decision that agreed with the label. Of the ${positives.length} positive scenarios (real loop / unverified deploy / budget breach / drift / escalation patterns), AIBrake correctly flagged **${positivesCaught}** (recall ${fmt(recall, 1)}%). Of the ${negatives.length} negative scenarios (legitimate retry with new evidence, verified deploys, under-budget calls, allowed actions, first-attempt premium calls), AIBrake correctly let **${negatives.length - negativesFalselyCaught}** through (precision ${fmt(precision, 1)}%, false-positive rate ${fmt(falsePositiveRate, 1)}%).

## Latency

| Percentile | Time |
| --- | --- |
| mean | ${fmt(meanLatency, 3)} ms |
| p50 | ${fmt(p50, 3)} ms |
| p95 | ${fmt(p95, 3)} ms |

## Per-detector-family recall

| Detector family | Recall | Caught / Total |
| --- | --- | --- |
${familyTable}

## How to reproduce

\`\`\`bash
git clone https://github.com/Askbsman/aibrake.git
cd aibrake
npm install
npm test
npx tsx benchmarks/run-lcr.ts
\`\`\`

Output should match this file (within latency variance).

## Corpus notes

\`benchmarks/corpus.ts\` programmatically generates ${total} scenarios across the
5 paid-LLM-call detectors plus the success-assertion detector. The corpus is
SYNTHETIC — exercises detector decision boundaries in a reproducible way.

Future v2 corpus: real-world traces from beta partners, human-reviewed labels,
broader coverage of edge cases (semantically-different errors that look similar,
multi-objective interleaved sessions, agent runtimes that don't emit clean
failure signals).

## Comparison context

| System | Metric | Score |
| --- | --- | --- |
| **AIBrake LCR (this corpus)** | retry-storm / loop catch | **${fmt(lcr, 1)}%** |
| Webwright (Microsoft) | Odysseys browser-task benchmark | 60.8% |

Different benchmarks measure different things — Webwright tests browser-task
COMPLETION, AIBrake tests loop-pattern CATCH. The two systems are
complementary in a production stack (do the task better + don't waste
budget when it's not working).

---

Generated by \`benchmarks/run-lcr.ts\` on ${now}.
`;

  writeFileSync(RESULTS_PATH, md);
  console.log(`${c.green}✓${c.reset} Wrote ${RESULTS_PATH}`);

  // ───── Append history ─────
  const historyLine = JSON.stringify({
    ts: now,
    corpus_version: CORPUS_VERSION,
    total,
    correct,
    lcr_pct: lcr,
    recall_pct: recall,
    precision_pct: precision,
    false_positive_rate_pct: falsePositiveRate,
    p50_ms: p50,
    p95_ms: p95,
    mean_ms: meanLatency,
  });
  appendFileSync(HISTORY_PATH, historyLine + "\n");
  console.log(`${c.green}✓${c.reset} Appended snapshot to ${HISTORY_PATH}\n`);
}

main();
