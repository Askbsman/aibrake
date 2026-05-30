# AIBrake Odyssey Benchmark — multi-step agent journeys

> **TL;DR.** AIBrake runs as a guardrail across realistic multi-step agent sessions.
> 100.0% sensitivity (catches 37 of 37 loop-region steps),
> 100.0% precision (0/88 false positives on legitimate progress),
> $6.28 of $6.12 potential burn saved.

Where the LCR benchmark scores AIBrake on **isolated** scenarios, Odyssey scores
it on a **session**: a 15–40-step trajectory mixing loop-prone behavior with
legitimate progress. The runner asks AIBrake at every step and grades each
decision against a ground-truth label.

## Snapshot

| Metric | Value |
| --- | --- |
| Odysseys run | 5 |
| Total steps | 130 |
| Sensitivity (micro) | **100.0%** (37/37) |
| Precision (micro) | **100.0%** (37/37) |
| False-positive rate on progress | 0.0% (0/88) |
| Realized savings | $6.28 |
| Potential savings | $6.12 |
| Mean latency / step | 0.044 ms |

## Per-Odyssey

### The Failing Build Odyssey

- Steps: 30
- First catch: step 4 ✅ (expected ~6)
- Sensitivity: 100.0% (14/14)
- Precision: 100.0% (14/14)
- Savings: $1.12 of $1.12 potential
- Mean latency / step: 0.106 ms

### The Deploy Theater Odyssey

- Steps: 15
- First catch: step 5 ✅ (expected ~5)
- Sensitivity: 100.0% (3/3)
- Precision: 100.0% (3/3)
- Savings: $0.00 of $0.00 potential
- Mean latency / step: 0.026 ms

### The Premium Burn Odyssey

- Steps: 20
- First catch: step 4 ✅ (expected ~4)
- Sensitivity: 100.0% (12/12)
- Precision: 100.0% (12/12)
- Savings: $4.36 of $4.20 potential
- Mean latency / step: 0.082 ms

### The Scope Creep Odyssey

- Steps: 25
- First catch: step 6 ✅ (expected ~6)
- Sensitivity: 100.0% (8/8)
- Precision: 100.0% (8/8)
- Savings: $0.80 of $0.80 potential
- Mean latency / step: 0.013 ms

### The Happy Path Odyssey

- Steps: 40
- First catch: none ✅ (happy path)
- Sensitivity: 100.0% (0/0)
- Precision: 100.0% (0/0)
- Savings: $0.00 of $0.00 potential
- Mean latency / step: 0.006 ms


## What "Odyssey" measures vs LCR

- **LCR (corpus v1):** 100 isolated scenarios, each one step long. Tests detector decision boundaries.
- **Odyssey:** 5 long agent sessions (15–40 steps each). Tests AIBrake's behavior under realistic context drift: a session is a mix of legitimate progress and loop-prone regions, and AIBrake must catch the loops without flagging the legitimate progress.

## Reproduce

```bash
npm install
npx tsx benchmarks/run-odyssey.ts
```

Corpus is `benchmarks/odyssey-corpus.ts` — 5 hand-crafted journeys with
ground-truth labels per step. Same MIT license as the rest of AIBrake.
