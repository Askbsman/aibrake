#!/usr/bin/env tsx
// Odyssey Benchmark Runner
//
// For each Odyssey:
//   - Step through every action in order
//   - Call runCheck() at each step
//   - Classify each step as:
//       hit_loop   — expected loop_should_catch AND AIBrake caught
//       miss_loop  — expected loop_should_catch AND AIBrake allowed
//       false_pos  — expected progress_should_allow AND AIBrake caught
//       true_neg   — expected progress_should_allow AND AIBrake allowed
//       setup      — expected setup (not scored)
//   - Compute: first-catch step, sensitivity, precision, projected savings
//
// Aggregate across odysseys: macro-averaged metrics, total projected
// $ saved, mean p50/p95 latency.
//
// Run:
//   npx tsx benchmarks/run-odyssey.ts

import { writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../src/core/check.js";
import { setLoggerSink } from "../src/core/logger.js";
import { generateOdysseys, type Odyssey, type OdysseyStep } from "./odyssey-corpus.js";

setLoggerSink({ emit: () => {} });

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(__dirname, "ODYSSEY_RESULTS.md");
const HISTORY_PATH = join(__dirname, "odyssey-history.jsonl");
const RISK_THRESHOLD = 50;

type StepClass = "hit_loop" | "miss_loop" | "false_pos" | "true_neg" | "setup";

interface StepResult {
  index: number;
  expected: OdysseyStep["expected"];
  decision: string;
  risk_score: number;
  caught: boolean;
  classification: StepClass;
  estimated_cost: number;
  latency_ms: number;
  pattern: string;
  note: string;
}

interface OdysseyResult {
  id: string;
  title: string;
  totalSteps: number;
  firstCatchStep: number | null;
  expectedFirstCatchStep: number | null;
  hit_loop: number;
  miss_loop: number;
  false_pos: number;
  true_neg: number;
  sensitivity: number; // hit_loop / (hit_loop + miss_loop)
  precision: number;   // hit_loop / (hit_loop + false_pos)
  savings_realized: number;
  savings_potential: number;
  mean_latency_ms: number;
  steps: StepResult[];
}

function isCaught(decision: string, risk_score: number): boolean {
  return (
    decision === "warn" ||
    decision === "require_confirmation" ||
    decision === "block" ||
    risk_score >= RISK_THRESHOLD
  );
}

function classify(expected: OdysseyStep["expected"], caught: boolean): StepClass {
  if (expected === "setup") return "setup";
  if (expected === "loop_should_catch") return caught ? "hit_loop" : "miss_loop";
  return caught ? "false_pos" : "true_neg";
}

function runOdyssey(o: Odyssey): OdysseyResult {
  const results: StepResult[] = [];
  let firstCatchStep: number | null = null;
  let realized = 0;

  for (let i = 0; i < o.steps.length; i++) {
    const step = o.steps[i]!;
    const t0 = performance.now();
    const decision = runCheck(step.input, { emitLog: false });
    const latency_ms = performance.now() - t0;
    const caught = isCaught(decision.decision, decision.risk_score);
    const cls = classify(step.expected, caught);
    const cost = step.input.next_action.estimated_cost?.amount ?? 0;

    if (caught && firstCatchStep === null) firstCatchStep = i;
    if (cls === "hit_loop") realized += cost;

    results.push({
      index: i,
      expected: step.expected,
      decision: decision.decision,
      risk_score: decision.risk_score,
      caught,
      classification: cls,
      estimated_cost: cost,
      latency_ms,
      pattern: decision.pattern,
      note: step.note,
    });
  }

  const hits = results.filter((r) => r.classification === "hit_loop").length;
  const misses = results.filter((r) => r.classification === "miss_loop").length;
  const fps = results.filter((r) => r.classification === "false_pos").length;
  const tns = results.filter((r) => r.classification === "true_neg").length;
  const sensitivity = hits + misses > 0 ? hits / (hits + misses) : 1;
  const precision = hits + fps > 0 ? hits / (hits + fps) : 1;
  const meanLat =
    results.reduce((s, r) => s + r.latency_ms, 0) / Math.max(1, results.length);

  return {
    id: o.id,
    title: o.title,
    totalSteps: o.steps.length,
    firstCatchStep,
    expectedFirstCatchStep: o.expectedFirstCatchStep,
    hit_loop: hits,
    miss_loop: misses,
    false_pos: fps,
    true_neg: tns,
    sensitivity,
    precision,
    savings_realized: realized,
    savings_potential: o.projectedSavingsIfCaught,
    mean_latency_ms: meanLat,
    steps: results,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Run + report
// ─────────────────────────────────────────────────────────────────────────

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};
const C = ANSI;

function fmt(n: number, digits = 1): string {
  return (n * 100).toFixed(digits);
}

const odysseys = generateOdysseys();
const results = odysseys.map(runOdyssey);

console.log(
  `${C.bold}${C.cyan}━━━ AIBrake Odyssey Benchmark — multi-step journeys ━━━${C.reset}\n`
);

// Per-odyssey table
console.log(
  `${C.bold}Per-Odyssey results:${C.reset}\n`
);
for (const r of results) {
  const sensColor = r.sensitivity >= 0.9 ? C.green : r.sensitivity >= 0.7 ? C.yellow : C.red;
  const precColor = r.precision >= 0.95 ? C.green : r.precision >= 0.8 ? C.yellow : C.red;
  const catchTiming =
    r.expectedFirstCatchStep === null
      ? r.firstCatchStep === null
        ? `${C.green}none (correct: happy path)${C.reset}`
        : `${C.red}caught at step ${r.firstCatchStep + 1} (expected none — false positive)${C.reset}`
      : r.firstCatchStep === null
      ? `${C.red}MISSED — expected at step ${r.expectedFirstCatchStep + 1}${C.reset}`
      : r.firstCatchStep <= r.expectedFirstCatchStep + 2
      ? `${C.green}caught at step ${r.firstCatchStep + 1} (expected ${r.expectedFirstCatchStep + 1})${C.reset}`
      : `${C.yellow}caught at step ${r.firstCatchStep + 1} (late vs expected ${r.expectedFirstCatchStep + 1})${C.reset}`;

  console.log(`  ${C.bold}${r.title}${C.reset}`);
  console.log(
    `    steps: ${r.totalSteps}  |  first catch: ${catchTiming}`
  );
  console.log(
    `    sensitivity: ${sensColor}${fmt(r.sensitivity)}%${C.reset} (${r.hit_loop}/${r.hit_loop + r.miss_loop}) | precision: ${precColor}${fmt(r.precision)}%${C.reset} (${r.hit_loop}/${r.hit_loop + r.false_pos})`
  );
  console.log(
    `    savings: ${C.green}$${r.savings_realized.toFixed(2)}${C.reset} / $${r.savings_potential.toFixed(2)} potential  |  mean latency: ${r.mean_latency_ms.toFixed(3)} ms`
  );
  console.log("");
}

// Aggregate
const totalHits = results.reduce((s, r) => s + r.hit_loop, 0);
const totalMisses = results.reduce((s, r) => s + r.miss_loop, 0);
const totalFps = results.reduce((s, r) => s + r.false_pos, 0);
const totalTns = results.reduce((s, r) => s + r.true_neg, 0);
const microSens = totalHits / Math.max(1, totalHits + totalMisses);
const microPrec = totalHits / Math.max(1, totalHits + totalFps);
const macroSens = results.reduce((s, r) => s + r.sensitivity, 0) / results.length;
const macroPrec = results.reduce((s, r) => s + r.precision, 0) / results.length;
const realized = results.reduce((s, r) => s + r.savings_realized, 0);
const potential = results.reduce((s, r) => s + r.savings_potential, 0);
const meanLat =
  results.reduce((s, r) => s + r.mean_latency_ms * r.totalSteps, 0) /
  results.reduce((s, r) => s + r.totalSteps, 0);

console.log(`${C.bold}Aggregate (micro-averaged):${C.reset}`);
console.log(
  `  sensitivity: ${C.green}${C.bold}${fmt(microSens)}%${C.reset} (${totalHits}/${totalHits + totalMisses} loop steps caught)`
);
console.log(
  `  precision:   ${C.green}${C.bold}${fmt(microPrec)}%${C.reset} (${totalHits}/${totalHits + totalFps} catches correct)`
);
console.log(
  `  false-positive rate on progress steps: ${C.yellow}${fmt(totalFps / Math.max(1, totalFps + totalTns))}%${C.reset} (${totalFps}/${totalFps + totalTns})`
);
console.log(`  macro sensitivity: ${fmt(macroSens)}%   macro precision: ${fmt(macroPrec)}%`);
console.log(
  `  ${C.bold}$${realized.toFixed(2)} realized${C.reset} / $${potential.toFixed(2)} potential savings`
);
console.log(`  mean latency: ${meanLat.toFixed(3)} ms\n`);

// Markdown report
const totalSteps = results.reduce((s, r) => s + r.totalSteps, 0);
const md = `# AIBrake Odyssey Benchmark — multi-step agent journeys

> **TL;DR.** AIBrake runs as a guardrail across realistic multi-step agent sessions.
> ${(microSens * 100).toFixed(1)}% sensitivity (catches ${totalHits} of ${totalHits + totalMisses} loop-region steps),
> ${(microPrec * 100).toFixed(1)}% precision (${totalFps}/${totalFps + totalTns} false positives on legitimate progress),
> $${realized.toFixed(2)} of $${potential.toFixed(2)} potential burn saved.

Where the LCR benchmark scores AIBrake on **isolated** scenarios, Odyssey scores
it on a **session**: a 15–40-step trajectory mixing loop-prone behavior with
legitimate progress. The runner asks AIBrake at every step and grades each
decision against a ground-truth label.

## Snapshot

| Metric | Value |
| --- | --- |
| Odysseys run | ${results.length} |
| Total steps | ${totalSteps} |
| Sensitivity (micro) | **${(microSens * 100).toFixed(1)}%** (${totalHits}/${totalHits + totalMisses}) |
| Precision (micro) | **${(microPrec * 100).toFixed(1)}%** (${totalHits}/${totalHits + totalFps}) |
| False-positive rate on progress | ${(totalFps / Math.max(1, totalFps + totalTns) * 100).toFixed(1)}% (${totalFps}/${totalFps + totalTns}) |
| Realized savings | $${realized.toFixed(2)} |
| Potential savings | $${potential.toFixed(2)} |
| Mean latency / step | ${meanLat.toFixed(3)} ms |

## Per-Odyssey

${results
  .map(
    (r) => `### ${r.title}

- Steps: ${r.totalSteps}
- First catch: ${
      r.firstCatchStep === null
        ? r.expectedFirstCatchStep === null
          ? "none ✅ (happy path)"
          : "❌ missed entirely"
        : `step ${r.firstCatchStep + 1}` +
          (r.expectedFirstCatchStep === null
            ? ` ❌ (expected none — false positive)`
            : r.firstCatchStep <= r.expectedFirstCatchStep + 2
            ? ` ✅ (expected ~${r.expectedFirstCatchStep + 1})`
            : ` ⚠️ (late — expected ~${r.expectedFirstCatchStep + 1})`)
    }
- Sensitivity: ${(r.sensitivity * 100).toFixed(1)}% (${r.hit_loop}/${r.hit_loop + r.miss_loop})
- Precision: ${(r.precision * 100).toFixed(1)}% (${r.hit_loop}/${r.hit_loop + r.false_pos})
- Savings: $${r.savings_realized.toFixed(2)} of $${r.savings_potential.toFixed(2)} potential
- Mean latency / step: ${r.mean_latency_ms.toFixed(3)} ms
`
  )
  .join("\n")}

## What "Odyssey" measures vs LCR

- **LCR (corpus v1):** 100 isolated scenarios, each one step long. Tests detector decision boundaries.
- **Odyssey:** 5 long agent sessions (15–40 steps each). Tests AIBrake's behavior under realistic context drift: a session is a mix of legitimate progress and loop-prone regions, and AIBrake must catch the loops without flagging the legitimate progress.

## Reproduce

\`\`\`bash
npm install
npx tsx benchmarks/run-odyssey.ts
\`\`\`

Corpus is \`benchmarks/odyssey-corpus.ts\` — 5 hand-crafted journeys with
ground-truth labels per step. Same MIT license as the rest of AIBrake.
`;

writeFileSync(RESULTS_PATH, md);
console.log(`${C.green}✓${C.reset} Wrote ${RESULTS_PATH}`);

const snapshot = {
  ts: new Date().toISOString(),
  total_odysseys: results.length,
  total_steps: totalSteps,
  micro_sensitivity: microSens,
  micro_precision: microPrec,
  fps_rate_on_progress: totalFps / Math.max(1, totalFps + totalTns),
  realized_savings_usd: realized,
  potential_savings_usd: potential,
  mean_latency_ms: meanLat,
  per_odyssey: results.map((r) => ({
    id: r.id,
    steps: r.totalSteps,
    first_catch_step: r.firstCatchStep,
    expected_first_catch_step: r.expectedFirstCatchStep,
    sensitivity: r.sensitivity,
    precision: r.precision,
    realized_savings: r.savings_realized,
  })),
};
appendFileSync(HISTORY_PATH, JSON.stringify(snapshot) + "\n");
console.log(`${C.green}✓${C.reset} Appended snapshot to ${HISTORY_PATH}`);
