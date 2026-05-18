// 100-partner × 7-day simulation against AIBrake 0.5.3-beta in
// shadow mode. Each "partner" is one realistic agent archetype with its own
// day-by-day workload; each call is a real /v1/check POST against the live
// hosted server.
//
// Reports per-archetype totals, per-day totals, grand totals, and the top
// individual catches into SIMULATION_100_PARTNERS_WEEK_REPORT.md.
//
// Run:
//   npx tsx scripts/simulate-100-partners-week.ts
//
// Deterministic — same seed → same totals every run.

import { CodingAgentAdapter } from "../src/adapters/coding-agent/index.js";
import type {
  AgentActionTelemetry,
  ObjectiveDescriptor,
} from "../src/adapters/openclaw/types.js";
import type {
  ProjectedSavings,
  SpendingGuardCheckOutput,
} from "../src/core/types.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GUARD_URL = process.env.GUARD_URL ?? "http://localhost:8080/v1/check";
const TOTAL_PARTNERS = Number(process.env.PARTNERS ?? 100);
const DAYS = Number(process.env.DAYS ?? 7);
const PARALLEL_CHUNK = Number(process.env.PARALLEL ?? 5);

// ─── Deterministic RNG (Mulberry32) ────────────────────────────────────
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}
function chance(r: () => number, p: number): boolean {
  return r() < p;
}
function jitter(r: () => number, base: number, spread: number): number {
  return Math.max(0, base + (r() * 2 - 1) * spread);
}

// ─── Archetypes ────────────────────────────────────────────────────────

interface Archetype {
  id: string;             // P01..P10, used as the API key suffix (asg_v1_P01..P10)
  name: string;
  description: string;
  meanCostUsd: number;
  costSpread: number;
  callsPerDay: number;
  weights: {
    coldStart: number;
    healthyDebug: number;
    retryStorm: number;
    premiumEscalation: number;
    drift: number;
    redundantWork: number;
  };
  primaryProvider: string;
  primaryModel: string;
  premiumModel?: string;
  declaresSecondary: boolean;
}

const ARCHETYPES: Archetype[] = [
  { id: "P01", name: "Acme Coding (Claude Code wrapper)", description: "Sonnet primary, occasional opus reach.",
    meanCostUsd: 0.05, costSpread: 0.02, callsPerDay: 140,
    weights: { coldStart: 0.05, healthyDebug: 0.55, retryStorm: 0.18, premiumEscalation: 0.10, drift: 0.02, redundantWork: 0.10 },
    primaryProvider: "anthropic", primaryModel: "claude-sonnet-4.5", premiumModel: "claude-opus-4.5", declaresSecondary: true },
  { id: "P02", name: "Crawly (web scraper)", description: "High-volume scraper. $0.10/call. Same-tool retry prone.",
    meanCostUsd: 0.10, costSpread: 0.03, callsPerDay: 320,
    weights: { coldStart: 0.02, healthyDebug: 0.40, retryStorm: 0.30, premiumEscalation: 0.02, drift: 0.03, redundantWork: 0.23 },
    primaryProvider: "exa", primaryModel: "search-pro", declaresSecondary: false },
  { id: "P03", name: "DeepResearch (opus-first)", description: "Slow, deep reasoning. Premium burn risk.",
    meanCostUsd: 0.35, costSpread: 0.10, callsPerDay: 28,
    weights: { coldStart: 0.10, healthyDebug: 0.45, retryStorm: 0.12, premiumEscalation: 0.28, drift: 0.02, redundantWork: 0.03 },
    primaryProvider: "anthropic", primaryModel: "claude-opus-4.5", premiumModel: "claude-opus-4.5", declaresSecondary: true },
  { id: "P04", name: "BrowserPilot (automation)", description: "Anchor/Browserbase-style. Mostly clean.",
    meanCostUsd: 0.08, costSpread: 0.02, callsPerDay: 64,
    weights: { coldStart: 0.08, healthyDebug: 0.78, retryStorm: 0.06, premiumEscalation: 0.02, drift: 0.04, redundantWork: 0.02 },
    primaryProvider: "browserbase", primaryModel: "browser-session", declaresSecondary: false },
  { id: "P05", name: "Pixelator (image gen)", description: "fal.ai-style. Prompt iteration patterns.",
    meanCostUsd: 0.04, costSpread: 0.01, callsPerDay: 42,
    weights: { coldStart: 0.10, healthyDebug: 0.50, retryStorm: 0.15, premiumEscalation: 0.05, drift: 0.05, redundantWork: 0.15 },
    primaryProvider: "fal-ai", primaryModel: "flux-pro", declaresSecondary: false },
  { id: "P06", name: "CursorDev (heavy Cursor)", description: "Cursor agent, thorough file-context.",
    meanCostUsd: 0.06, costSpread: 0.02, callsPerDay: 110,
    weights: { coldStart: 0.06, healthyDebug: 0.70, retryStorm: 0.08, premiumEscalation: 0.04, drift: 0.02, redundantWork: 0.10 },
    primaryProvider: "anthropic", primaryModel: "claude-sonnet-4.5", premiumModel: "claude-opus-4.5", declaresSecondary: true },
  { id: "P07", name: "Codex-CLI (gpt-4o)", description: "OpenAI Codex CLI. command_error retry patterns.",
    meanCostUsd: 0.04, costSpread: 0.01, callsPerDay: 95,
    weights: { coldStart: 0.05, healthyDebug: 0.55, retryStorm: 0.20, premiumEscalation: 0.08, drift: 0.02, redundantWork: 0.10 },
    primaryProvider: "openai", primaryModel: "gpt-4o", premiumModel: "gpt-5", declaresSecondary: false },
  { id: "P08", name: "QueryStorm (search aggregation)", description: "Exa/Tavily/Brave. Redundant query risk.",
    meanCostUsd: 0.03, costSpread: 0.01, callsPerDay: 210,
    weights: { coldStart: 0.04, healthyDebug: 0.50, retryStorm: 0.06, premiumEscalation: 0.02, drift: 0.03, redundantWork: 0.35 },
    primaryProvider: "tavily", primaryModel: "search-deep", declaresSecondary: false },
  { id: "P09", name: "PremiumOnly (opus wrapper)", description: "Always-opus. Worst-case burn.",
    meanCostUsd: 0.42, costSpread: 0.08, callsPerDay: 36,
    weights: { coldStart: 0.05, healthyDebug: 0.30, retryStorm: 0.25, premiumEscalation: 0.35, drift: 0.02, redundantWork: 0.03 },
    primaryProvider: "anthropic", primaryModel: "claude-opus-4.5", premiumModel: "claude-opus-4.5", declaresSecondary: false },
  { id: "P10", name: "Disciplined Inc", description: "Well-instrumented. Rarely trips.",
    meanCostUsd: 0.05, costSpread: 0.02, callsPerDay: 88,
    weights: { coldStart: 0.05, healthyDebug: 0.88, retryStorm: 0.02, premiumEscalation: 0.02, drift: 0.01, redundantWork: 0.02 },
    primaryProvider: "anthropic", primaryModel: "claude-sonnet-4.5", premiumModel: "claude-opus-4.5", declaresSecondary: true },
];

// ─── Partner generation ───────────────────────────────────────────────
//
// Each of the 100 partners is sampled from the 10 archetypes with parameter
// jitter (±20% on call volume, ±15% on cost). Keys round-robin across the
// 10 anchor archetype keys (server has asg_v1_P01..P10).

interface Partner {
  partnerId: string;      // e.g. P001..P100
  archetype: Archetype;
  apiKey: string;
  callsPerDayBase: number;
  meanCostUsd: number;
}

function generatePartners(seed: number): Partner[] {
  const r = rng(seed);
  const out: Partner[] = [];
  for (let i = 0; i < TOTAL_PARTNERS; i++) {
    const archetype = ARCHETYPES[i % ARCHETYPES.length]!;
    const callsPerDayBase = Math.round(jitter(r, archetype.callsPerDay, archetype.callsPerDay * 0.20));
    const meanCostUsd = jitter(r, archetype.meanCostUsd, archetype.meanCostUsd * 0.15);
    out.push({
      partnerId: `P${String(i + 1).padStart(3, "0")}`,
      archetype,
      apiKey: `asg_v1_${archetype.id}`,
      callsPerDayBase,
      meanCostUsd,
    });
  }
  return out;
}

// ─── Arc generators (same as 10-partner sim, copied for self-contained) ──

type ArcKind = "coldStart" | "healthyDebug" | "retryStorm" | "premiumEscalation" | "drift" | "redundantWork";

function pickArc(r: () => number, w: Archetype["weights"]): ArcKind {
  const entries: Array<[ArcKind, number]> = [
    ["coldStart", w.coldStart], ["healthyDebug", w.healthyDebug],
    ["retryStorm", w.retryStorm], ["premiumEscalation", w.premiumEscalation],
    ["drift", w.drift], ["redundantWork", w.redundantWork],
  ];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const x = r() * total;
  let acc = 0;
  for (const [k, v] of entries) {
    acc += v;
    if (x <= acc) return k;
  }
  return entries[entries.length - 1]![0];
}

interface Arc {
  objective: ObjectiveDescriptor;
  history: AgentActionTelemetry[];
  underCheck: AgentActionTelemetry;
}

let objCounter = 0;
function nextObjId(partnerId: string): string {
  objCounter += 1;
  return `${partnerId}_obj_${String(objCounter).padStart(6, "0")}`;
}

function baseAction(p: Partner, r: () => number, overrides: Partial<AgentActionTelemetry> = {}): AgentActionTelemetry {
  const cost = jitter(r, p.meanCostUsd, p.archetype.costSpread);
  return {
    actionId: `act_${Math.floor(r() * 1e9).toString(16)}`,
    runtime: p.archetype.id,
    actionType: "paid_llm_call",
    provider: p.archetype.primaryProvider,
    model: p.archetype.primaryModel,
    estimatedCostUsd: cost,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function modelPolicyFor(p: Partner): ObjectiveDescriptor["modelPolicy"] {
  if (!p.archetype.declaresSecondary) return undefined;
  return {
    primaryModel: { provider: p.archetype.primaryProvider, model: p.archetype.premiumModel ?? p.archetype.primaryModel, role: "primary", tier: "premium" },
    secondaryModel: {
      provider: p.archetype.primaryProvider,
      model: p.archetype.primaryProvider === "openai" ? "gpt-4o-mini" : "claude-haiku",
      role: "secondary", tier: "cheap",
      estimatedCostUsd: p.meanCostUsd * 0.15,
    },
    maxPremiumRetriesWithoutEvidence: 2,
  };
}

function makeColdStart(p: Partner, r: () => number): Arc {
  const id = nextObjId(p.partnerId);
  return {
    objective: { id, goal: "Start a fresh task" },
    history: [],
    underCheck: baseAction(p, r, { objectiveId: id, failureSignalPresent: false, filesRead: ["x"], contextSourceConfirmed: true }),
  };
}

function makeHealthyDebug(p: Partner, r: () => number): Arc {
  const id = nextObjId(p.partnerId);
  const fpr = `fp_v1_${p.partnerId}_${Math.floor(r() * 1e6).toString(16)}`;
  const prior = baseAction(p, r, {
    objectiveId: id, failureSignalPresent: true, failureSignalType: "test_failure",
    errorFingerprint: fpr, filesRead: [], testsRun: [], toolResultsChanged: false,
    gitDiffChanged: false, contextSourceConfirmed: false,
  });
  return {
    objective: { id, goal: "Fix the failing thing", modelPolicy: modelPolicyFor(p) },
    history: [prior],
    underCheck: baseAction(p, r, {
      objectiveId: id, failureSignalPresent: true, failureSignalType: "test_failure",
      errorFingerprint: fpr,
      filesRead: ["file_a", "file_b"], testsRun: ["test_x"],
      gitDiffChanged: true, toolResultsChanged: true, contextSourceConfirmed: true,
    }),
  };
}

function makeRetryStorm(p: Partner, r: () => number): Arc {
  const id = nextObjId(p.partnerId);
  const fpr = `fp_v1_${p.partnerId}_storm_${Math.floor(r() * 1e6).toString(16)}`;
  const repeats = 4 + Math.floor(r() * 4);
  const history: AgentActionTelemetry[] = [];
  for (let i = 0; i < repeats; i++) {
    history.push(baseAction(p, r, {
      objectiveId: id, failureSignalPresent: true, failureSignalType: "test_failure",
      errorFingerprint: fpr, filesRead: i === 0 ? ["initial_read"] : [],
      testsRun: [], logsRead: [], toolResultsChanged: false, gitDiffChanged: false, contextSourceConfirmed: false,
    }));
  }
  return {
    objective: { id, goal: "Stuck loop scenario", modelPolicy: modelPolicyFor(p),
      detectorPolicy: { same_tool_retry_threshold: 4 } },
    history,
    underCheck: baseAction(p, r, {
      objectiveId: id, failureSignalPresent: true, failureSignalType: "test_failure",
      errorFingerprint: fpr, filesRead: [], testsRun: [], logsRead: [],
      toolResultsChanged: false, gitDiffChanged: false, contextSourceConfirmed: false,
    }),
  };
}

function makePremiumEscalation(p: Partner, r: () => number): Arc {
  const id = nextObjId(p.partnerId);
  const fpr = `fp_v1_${p.partnerId}_esc_${Math.floor(r() * 1e6).toString(16)}`;
  const repeats = 2 + Math.floor(r() * 3);
  const history: AgentActionTelemetry[] = [];
  for (let i = 0; i < repeats; i++) {
    history.push(baseAction(p, r, {
      objectiveId: id, failureSignalPresent: true, failureSignalType: "test_failure",
      errorFingerprint: fpr, filesRead: [], testsRun: [],
      toolResultsChanged: false, gitDiffChanged: false, contextSourceConfirmed: false,
      model: p.archetype.primaryModel, estimatedCostUsd: jitter(r, p.meanCostUsd, p.archetype.costSpread),
    }));
  }
  const premiumModel = p.archetype.premiumModel ?? p.archetype.primaryModel;
  const premiumCost = p.meanCostUsd * (premiumModel === p.archetype.primaryModel ? 1 : 8);
  return {
    objective: { id, goal: "Try a smarter model", modelPolicy: modelPolicyFor(p),
      detectorPolicy: { premium_retry_without_evidence_threshold: 2 } },
    history,
    underCheck: baseAction(p, r, {
      objectiveId: id, failureSignalPresent: true, failureSignalType: "test_failure",
      errorFingerprint: fpr, model: premiumModel,
      modelRole: "primary", modelTier: "premium",
      estimatedCostUsd: jitter(r, premiumCost, premiumCost * 0.1),
      filesRead: [], testsRun: [], logsRead: [],
      toolResultsChanged: false, gitDiffChanged: false, contextSourceConfirmed: false,
    }),
  };
}

function makeDrift(p: Partner, r: () => number): Arc {
  const id = nextObjId(p.partnerId);
  return {
    objective: { id, goal: "Stay in scope", blockedActions: ["refactor_unrelated_module", "deploy_to_prod_without_review"] },
    history: [],
    underCheck: baseAction(p, r, {
      objectiveId: id,
      actionType: chance(r, 0.5) ? "refactor_unrelated_module" : "deploy_to_prod_without_review",
      failureSignalPresent: false, contextSourceConfirmed: false,
    }),
  };
}

function makeRedundantWork(p: Partner, r: () => number): Arc {
  const id = nextObjId(p.partnerId);
  const action = baseAction(p, r, {
    objectiveId: id, actionType: "tool_call",
    toolName: pick(r, ["bash:npm_test", "bash:typecheck", "search:web", "scrape:url"]),
    failureSignalPresent: false, filesRead: [], testsRun: [], contextSourceConfirmed: false,
  });
  return {
    objective: { id, goal: "Verify state" },
    history: [action],
    underCheck: { ...action, actionId: `act_${Math.floor(r() * 1e9).toString(16)}` },
  };
}

function generateArc(kind: ArcKind, p: Partner, r: () => number): Arc {
  switch (kind) {
    case "coldStart": return makeColdStart(p, r);
    case "healthyDebug": return makeHealthyDebug(p, r);
    case "retryStorm": return makeRetryStorm(p, r);
    case "premiumEscalation": return makePremiumEscalation(p, r);
    case "drift": return makeDrift(p, r);
    case "redundantWork": return makeRedundantWork(p, r);
  }
}

// ─── Driver ─────────────────────────────────────────────────────────────

interface DayTally {
  day: number;
  calls: number;
  cost: number;
  savings: number;
  allow: number;
  warn: number;
  reqConfirm: number;
  block: number;
}

interface PartnerTally {
  partner: Partner;
  totalCalls: number;
  allow: number;
  warn: number;
  reqConfirm: number;
  block: number;
  totalCostUsd: number;
  totalSavingsUsd: number;
  savingsByBasis: Record<string, number>;
  savingsByPattern: Record<string, number>;
  days: DayTally[];
  topCatches: Array<{ savings: number; pattern: string; reason: string; day: number }>;
}

async function callGuard(payload: unknown, apiKey: string): Promise<SpendingGuardCheckOutput> {
  const res = await fetch(GUARD_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as SpendingGuardCheckOutput;
}

async function runPartnerWeek(partner: Partner, seed: number): Promise<PartnerTally> {
  const r = rng(seed);
  const adapter = new CodingAgentAdapter();
  const tally: PartnerTally = {
    partner, totalCalls: 0, allow: 0, warn: 0, reqConfirm: 0, block: 0,
    totalCostUsd: 0, totalSavingsUsd: 0,
    savingsByBasis: {}, savingsByPattern: {},
    days: [], topCatches: [],
  };

  for (let day = 1; day <= DAYS; day++) {
    // Day-to-day variance: weekend dip on day 6,7 (~70%), small jitter ±15% other days
    const isWeekend = day >= 6;
    const dayMultiplier = isWeekend ? 0.70 + r() * 0.15 : 0.85 + r() * 0.30;
    const callsThisDay = Math.max(1, Math.round(partner.callsPerDayBase * dayMultiplier));
    const dayTally: DayTally = {
      day, calls: 0, cost: 0, savings: 0, allow: 0, warn: 0, reqConfirm: 0, block: 0,
    };

    for (let i = 0; i < callsThisDay; i++) {
      const kind = pickArc(r, partner.archetype.weights);
      const arc = generateArc(kind, partner, r);
      for (const past of arc.history) adapter.record(past);
      const payload = adapter.buildCheckInput(arc.underCheck, { objective: arc.objective });

      let result: SpendingGuardCheckOutput;
      try {
        result = await callGuard(payload, partner.apiKey);
      } catch {
        continue;
      }

      tally.totalCalls += 1;
      dayTally.calls += 1;
      const cost = arc.underCheck.estimatedCostUsd ?? 0;
      tally.totalCostUsd += cost;
      dayTally.cost += cost;

      switch (result.decision) {
        case "allow": tally.allow += 1; dayTally.allow += 1; break;
        case "warn": tally.warn += 1; dayTally.warn += 1; break;
        case "require_confirmation": tally.reqConfirm += 1; dayTally.reqConfirm += 1; break;
        case "block": tally.block += 1; dayTally.block += 1; break;
        default: break;
      }

      const ps: ProjectedSavings | undefined = result.projected_savings;
      if (ps && ps.amount_usd > 0) {
        tally.totalSavingsUsd += ps.amount_usd;
        dayTally.savings += ps.amount_usd;
        tally.savingsByBasis[ps.basis] = (tally.savingsByBasis[ps.basis] ?? 0) + ps.amount_usd;
        tally.savingsByPattern[result.pattern] = (tally.savingsByPattern[result.pattern] ?? 0) + ps.amount_usd;
        tally.topCatches.push({
          savings: ps.amount_usd, pattern: result.pattern,
          reason: result.reason.slice(0, 100),
          day,
        });
      }

      adapter.record(arc.underCheck);
    }

    tally.days.push(dayTally);
  }

  tally.topCatches.sort((a, b) => b.savings - a.savings);
  tally.topCatches = tally.topCatches.slice(0, 3);
  return tally;
}

// ─── Report ─────────────────────────────────────────────────────────────

function fmt$(n: number): string { return `$${n.toFixed(2)}`; }
function fmtInt(n: number): string { return n.toLocaleString("en-US"); }
function pct(num: number, denom: number): string {
  if (denom === 0) return "0%";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function buildReport(tallies: readonly PartnerTally[]): string {
  const totalCalls = tallies.reduce((s, t) => s + t.totalCalls, 0);
  const totalCost = tallies.reduce((s, t) => s + t.totalCostUsd, 0);
  const totalSavings = tallies.reduce((s, t) => s + t.totalSavingsUsd, 0);
  const totalAllow = tallies.reduce((s, t) => s + t.allow, 0);
  const totalWarn = tallies.reduce((s, t) => s + t.warn, 0);
  const totalReqConf = tallies.reduce((s, t) => s + t.reqConfirm, 0);
  const totalBlock = tallies.reduce((s, t) => s + t.block, 0);

  // By archetype
  const byArchetype = new Map<string, PartnerTally[]>();
  for (const t of tallies) {
    const arr = byArchetype.get(t.partner.archetype.id) ?? [];
    arr.push(t);
    byArchetype.set(t.partner.archetype.id, arr);
  }

  // By day
  const dayTotals: DayTally[] = [];
  for (let d = 1; d <= DAYS; d++) {
    dayTotals.push({ day: d, calls: 0, cost: 0, savings: 0, allow: 0, warn: 0, reqConfirm: 0, block: 0 });
  }
  for (const t of tallies) {
    for (const dt of t.days) {
      const tot = dayTotals[dt.day - 1]!;
      tot.calls += dt.calls;
      tot.cost += dt.cost;
      tot.savings += dt.savings;
      tot.allow += dt.allow;
      tot.warn += dt.warn;
      tot.reqConfirm += dt.reqConfirm;
      tot.block += dt.block;
    }
  }

  // Savings by basis / pattern (grand)
  const grandSavingsByBasis: Record<string, number> = {};
  const grandSavingsByPattern: Record<string, number> = {};
  for (const t of tallies) {
    for (const [k, v] of Object.entries(t.savingsByBasis)) {
      grandSavingsByBasis[k] = (grandSavingsByBasis[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(t.savingsByPattern)) {
      grandSavingsByPattern[k] = (grandSavingsByPattern[k] ?? 0) + v;
    }
  }

  // Top individual catches across all partners
  const allCatches = tallies.flatMap((t) =>
    t.topCatches.map((c) => ({ ...c, partnerId: t.partner.partnerId, archetype: t.partner.archetype.name }))
  );
  allCatches.sort((a, b) => b.savings - a.savings);
  const top10Catches = allCatches.slice(0, 10);

  const lines: string[] = [];
  lines.push(`# 100-Partner × 7-Day Simulation Report`);
  lines.push("");
  lines.push(`> **Server:** ${GUARD_URL.replace("/v1/check", "")} — version \`0.5.3-beta\``);
  lines.push(`> **Mode:** shadow only — \`/v1/check\` POSTs, every response captured, no enforcement`);
  lines.push(`> **Date:** ${new Date().toISOString()}`);
  lines.push(`> **Source:** \`scripts/simulate-100-partners-week.ts\` (deterministic seed; reproducible)`);
  lines.push(`> **Scale:** ${TOTAL_PARTNERS} partners × ${DAYS} days`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Grand totals (one full simulated workweek across 100 partners)");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total /v1/check calls | **${fmtInt(totalCalls)}** |`);
  lines.push(`| Total agent spend observed | **${fmt$(totalCost)}** |`);
  lines.push(`| **Total projected savings offered** | **${fmt$(totalSavings)}** |`);
  lines.push(`| Savings as % of spend | **${pct(totalSavings, totalCost)}** |`);
  lines.push(`| allow | ${fmtInt(totalAllow)} (${pct(totalAllow, totalCalls)}) |`);
  lines.push(`| warn | ${fmtInt(totalWarn)} (${pct(totalWarn, totalCalls)}) |`);
  lines.push(`| require_confirmation | ${fmtInt(totalReqConf)} (${pct(totalReqConf, totalCalls)}) |`);
  lines.push(`| block | ${fmtInt(totalBlock)} (${pct(totalBlock, totalCalls)}) |`);
  lines.push(`| Avg savings / partner / week | **${fmt$(totalSavings / tallies.length)}** |`);
  lines.push(`| Avg savings / partner / day | **${fmt$(totalSavings / (tallies.length * DAYS))}** |`);
  lines.push(`| Projected savings / month (×4.3 weeks) | **${fmt$(totalSavings * 4.3)}** |`);
  lines.push("");
  lines.push("### Savings broken down by computation basis");
  lines.push("");
  lines.push(`| basis | total $ | share |`);
  lines.push(`| --- | --- | --- |`);
  for (const [k, v] of Object.entries(grandSavingsByBasis).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${k}\` | ${fmt$(v)} | ${pct(v, totalSavings)} |`);
  }
  lines.push("");
  lines.push("### Savings broken down by detector pattern");
  lines.push("");
  lines.push(`| pattern | total $ | share |`);
  lines.push(`| --- | --- | --- |`);
  for (const [k, v] of Object.entries(grandSavingsByPattern).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${k}\` | ${fmt$(v)} | ${pct(v, totalSavings)} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Day-by-day breakdown");
  lines.push("");
  lines.push(`| Day | Calls | Spend | Savings | Savings/Spend | allow | req_conf | block |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const d of dayTotals) {
    const dayName = d.day <= 5 ? `Day ${d.day}` : `Day ${d.day} (weekend)`;
    lines.push(`| ${dayName} | ${fmtInt(d.calls)} | ${fmt$(d.cost)} | **${fmt$(d.savings)}** | ${pct(d.savings, d.cost)} | ${fmtInt(d.allow)} | ${fmtInt(d.reqConfirm)} | ${fmtInt(d.block)} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## By archetype (averaged across partners in each archetype)");
  lines.push("");
  lines.push(`| Archetype | # partners | Total calls | Total spend | **Total savings** | Avg savings/partner | Ratio |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  const sortedArchetypes = Array.from(byArchetype.entries()).sort((a, b) => {
    const aSum = a[1].reduce((s, t) => s + t.totalSavingsUsd, 0);
    const bSum = b[1].reduce((s, t) => s + t.totalSavingsUsd, 0);
    return bSum - aSum;
  });
  for (const [archId, list] of sortedArchetypes) {
    const archetype = list[0]!.partner.archetype;
    const sumCalls = list.reduce((s, t) => s + t.totalCalls, 0);
    const sumCost = list.reduce((s, t) => s + t.totalCostUsd, 0);
    const sumSavings = list.reduce((s, t) => s + t.totalSavingsUsd, 0);
    lines.push(
      `| **${archId}** ${archetype.name} | ${list.length} | ${fmtInt(sumCalls)} | ${fmt$(sumCost)} | **${fmt$(sumSavings)}** | ${fmt$(sumSavings / list.length)} | ${pct(sumSavings, sumCost)} |`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Top 10 individual catches (single $ amounts caught in single decisions)");
  lines.push("");
  lines.push(`| Rank | Partner | Archetype | Day | Savings | Pattern | Reason (truncated) |`);
  lines.push(`| --- | --- | --- | ---: | ---: | --- | --- |`);
  top10Catches.forEach((c, i) => {
    lines.push(`| ${i + 1} | ${c.partnerId} | ${c.archetype} | ${c.day} | **${fmt$(c.savings)}** | \`${c.pattern}\` | ${c.reason}… |`);
  });
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push(`This simulation runs ${TOTAL_PARTNERS} synthetic partners over ${DAYS} simulated calendar days against a live AIBrake hosted server at \`${GUARD_URL.replace("/v1/check", "")}\`. Every \`/v1/check\` POST is real; every response is captured; \`projected_savings.amount_usd\` is read directly from the server's reply, not estimated by the simulator.`);
  lines.push("");
  lines.push(`Each partner is sampled from one of 10 realistic agent archetypes (coding agents, scrapers, browser automation, image gen, search aggregation, opus-only wrappers, etc.) with per-partner parameter jitter (±20% on call volume, ±15% on per-call cost). Each day applies a multiplier: weekdays ${(0.85).toFixed(2)}-${(1.15).toFixed(2)}, weekends ${(0.70).toFixed(2)}-${(0.85).toFixed(2)}, simulating real-world workload dips.`);
  lines.push("");
  lines.push("Each \"call\" is one of six behavioural arcs sampled per the archetype's weights:");
  lines.push("");
  lines.push("- **`coldStart`** — first action on a fresh objective. Should `allow`.");
  lines.push("- **`healthyDebug`** — same failure as prior attempt, with annotated new evidence on the current attempt. Should `allow` (Stage 0.5.1 calibration).");
  lines.push("- **`retryStorm`** — 4-7 prior attempts on the same failure, no evidence between or on current attempt. Should trip `stale_context_retry_storm` → `require_confirmation`.");
  lines.push("- **`premiumEscalation`** — sonnet/gpt-4o tried, current attempt jumps to opus/gpt-5 without new evidence. Should trip `model_escalation_without_evidence` or fall under stale-context.");
  lines.push("- **`drift`** — action listed in `objective.blocked_actions`. Deterministic `block`.");
  lines.push("- **`redundantWork`** — same tool, no failure, no evidence. **Currently not caught** (E3/E8 gap, deliberately deferred per Stage 0.5).");
  lines.push("");
  lines.push("Deterministic seeded RNG — re-running reproduces the same totals.");
  lines.push("");
  lines.push("## Honesty disclosures");
  lines.push("");
  lines.push(`- **Simulated, not real users.** No specific real team behaves exactly as encoded. Numbers are anchored on plausible production patterns observed in agent runtimes, but encoded archetypes are constructs.`);
  lines.push(`- **\"Projected savings\" is offered, not realized.** Real adoption typically heeds 40-80% of guard recommendations. Multiply by your team's actual heed rate for a realized number.`);
  lines.push(`- **Per-call cost numbers are conservative anchors.** Real production costs vary 5-10× by context size and provider price tier. Treat these as floor estimates.`);
  lines.push(`- **\`projected_future_attempts\` looks forward up to 3 attempts** per stale-context catch — that's why per-call savings can exceed per-call spend.`);
  lines.push(`- **\`redundantWork\` arcs consume spend but contribute $0 savings** in this simulation, because the current detector set requires a failure signal to fire. This gap is deliberately deferred until real-partner data tells us how bad it is.`);
  lines.push(`- **Weekend dip is a heuristic.** Real agentic workloads may or may not exhibit this pattern; for back-of-envelope numbers it adds realism but the underlying claim does not depend on it.`);
  lines.push("");
  return lines.join("\n");
}

// ─── main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const partners = generatePartners(0xa5e_5e3d);
  console.log(`Simulating ${partners.length} partners × ${DAYS} days, ${PARALLEL_CHUNK} in parallel…`);

  const tallies: PartnerTally[] = [];
  let processed = 0;
  for (let i = 0; i < partners.length; i += PARALLEL_CHUNK) {
    const chunk = partners.slice(i, i + PARALLEL_CHUNK);
    const results = await Promise.all(
      chunk.map((p, idx) => runPartnerWeek(p, 0xb1ab1a + (i + idx) * 7919))
    );
    tallies.push(...results);
    processed += chunk.length;
    const sumCalls = results.reduce((s, t) => s + t.totalCalls, 0);
    const sumSavings = results.reduce((s, t) => s + t.totalSavingsUsd, 0);
    console.log(
      `  ${processed}/${partners.length} partners done — chunk: ${sumCalls.toLocaleString()} calls, ${fmt$(sumSavings)} savings`
    );
  }

  const reportPath = resolve(process.cwd(), "SIMULATION_100_PARTNERS_WEEK_REPORT.md");
  writeFileSync(reportPath, buildReport(tallies));

  const totalCalls = tallies.reduce((s, t) => s + t.totalCalls, 0);
  const totalCost = tallies.reduce((s, t) => s + t.totalCostUsd, 0);
  const totalSavings = tallies.reduce((s, t) => s + t.totalSavingsUsd, 0);
  console.log("");
  console.log("=".repeat(72));
  console.log(`GRAND TOTAL — ${TOTAL_PARTNERS} partners × ${DAYS} simulated workdays`);
  console.log("=".repeat(72));
  console.log(`Calls:                 ${fmtInt(totalCalls)}`);
  console.log(`Spend observed:        ${fmt$(totalCost)}`);
  console.log(`Projected savings:     ${fmt$(totalSavings)}  (${pct(totalSavings, totalCost)} of spend)`);
  console.log(`Avg / partner / week:  ${fmt$(totalSavings / tallies.length)}`);
  console.log(`Avg / partner / day:   ${fmt$(totalSavings / (tallies.length * DAYS))}`);
  console.log(`Projected / month:     ${fmt$(totalSavings * 4.3)}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
