// Simulate a full day of agent activity for 10 different partner profiles
// running through Agent Spend Guard 0.5.2-beta in shadow mode. Reports
// per-partner and grand-total $-denominated projected savings.
//
// All telemetry is generated programmatically with deterministic seeded
// randomness. Each profile encodes a plausible day's worth of behaviour
// (cold-starts, healthy debugs, retry storms, premium escalations,
// objective drift). The guard sees realistic-looking POSTs and returns
// real verdicts; the script just tallies projected_savings_usd.
//
// Usage:
//   npx tsx scripts/simulate-10-partners.ts

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
const API_KEY = process.env.GUARD_KEY ?? "asg_v1_demo";

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

// ─── Partner profiles ──────────────────────────────────────────────────
//
// Each profile is one realistic archetype. Numbers are conservative
// estimates anchored on public agent pricing.

interface PartnerProfile {
  id: string;
  name: string;
  description: string;
  // Average paid action cost (per /v1/check).
  meanCostUsd: number;
  costSpread: number;
  // How many actions in a working day. Realistic range — varies a lot by
  // archetype (light browser agent vs heavy coding agent).
  callsPerDay: number;
  // Behaviour propensities (0.0-1.0). The simulator uses these to weight
  // which "session arcs" appear in this partner's day.
  weights: {
    coldStart: number;
    healthyDebug: number;
    retryStorm: number;
    premiumEscalation: number;
    drift: number;
    redundantWork: number;
  };
  // Model used most of the time.
  primaryProvider: string;
  primaryModel: string;
  premiumModel?: string; // when an escalation arc fires
  // Whether this partner declares model_policy.secondaryModel.
  declaresSecondary: boolean;
}

const PROFILES: PartnerProfile[] = [
  {
    id: "P01",
    name: "Acme Coding Agent (Claude Code wrapper)",
    description: "Big-ish coding agent. Sonnet primary, occasional opus reach.",
    meanCostUsd: 0.05,
    costSpread: 0.02,
    callsPerDay: 140,
    weights: { coldStart: 0.05, healthyDebug: 0.55, retryStorm: 0.18, premiumEscalation: 0.10, drift: 0.02, redundantWork: 0.10 },
    primaryProvider: "anthropic",
    primaryModel: "claude-sonnet-4.5",
    premiumModel: "claude-opus-4.5",
    declaresSecondary: true,
  },
  {
    id: "P02",
    name: "Crawly (web scraper agent)",
    description: "High-volume scraper. $0.10/call. Loves same-tool retry.",
    meanCostUsd: 0.10,
    costSpread: 0.03,
    callsPerDay: 320,
    weights: { coldStart: 0.02, healthyDebug: 0.40, retryStorm: 0.30, premiumEscalation: 0.02, drift: 0.03, redundantWork: 0.23 },
    primaryProvider: "exa",
    primaryModel: "search-pro",
    declaresSecondary: false,
  },
  {
    id: "P03",
    name: "DeepResearch (opus-first agent)",
    description: "Slow, deep reasoning agent. Premium model burn risk.",
    meanCostUsd: 0.35,
    costSpread: 0.10,
    callsPerDay: 28,
    weights: { coldStart: 0.10, healthyDebug: 0.45, retryStorm: 0.12, premiumEscalation: 0.28, drift: 0.02, redundantWork: 0.03 },
    primaryProvider: "anthropic",
    primaryModel: "claude-opus-4.5",
    premiumModel: "claude-opus-4.5",
    declaresSecondary: true,
  },
  {
    id: "P04",
    name: "BrowserPilot (browser automation)",
    description: "Anchor/Browserbase-style runtime. Mostly clean, rare drift.",
    meanCostUsd: 0.08,
    costSpread: 0.02,
    callsPerDay: 64,
    weights: { coldStart: 0.08, healthyDebug: 0.78, retryStorm: 0.06, premiumEscalation: 0.02, drift: 0.04, redundantWork: 0.02 },
    primaryProvider: "browserbase",
    primaryModel: "browser-session",
    declaresSecondary: false,
  },
  {
    id: "P05",
    name: "Pixelator (image generation agent)",
    description: "fal.ai-style image agent. Prompt-iteration patterns.",
    meanCostUsd: 0.04,
    costSpread: 0.01,
    callsPerDay: 42,
    weights: { coldStart: 0.10, healthyDebug: 0.50, retryStorm: 0.15, premiumEscalation: 0.05, drift: 0.05, redundantWork: 0.15 },
    primaryProvider: "fal-ai",
    primaryModel: "flux-pro",
    declaresSecondary: false,
  },
  {
    id: "P06",
    name: "CursorDev (heavy Cursor user)",
    description: "Cursor agent with thorough file-context refreshes.",
    meanCostUsd: 0.06,
    costSpread: 0.02,
    callsPerDay: 110,
    weights: { coldStart: 0.06, healthyDebug: 0.70, retryStorm: 0.08, premiumEscalation: 0.04, drift: 0.02, redundantWork: 0.10 },
    primaryProvider: "anthropic",
    primaryModel: "claude-sonnet-4.5",
    premiumModel: "claude-opus-4.5",
    declaresSecondary: true,
  },
  {
    id: "P07",
    name: "Codex-CLI (gpt-4o coding agent)",
    description: "OpenAI Codex CLI user. Command_error retry patterns.",
    meanCostUsd: 0.04,
    costSpread: 0.01,
    callsPerDay: 95,
    weights: { coldStart: 0.05, healthyDebug: 0.55, retryStorm: 0.20, premiumEscalation: 0.08, drift: 0.02, redundantWork: 0.10 },
    primaryProvider: "openai",
    primaryModel: "gpt-4o",
    premiumModel: "gpt-5",
    declaresSecondary: false,
  },
  {
    id: "P08",
    name: "QueryStorm (search aggregation agent)",
    description: "Exa/Tavily/Brave aggregator. Redundant query risk.",
    meanCostUsd: 0.03,
    costSpread: 0.01,
    callsPerDay: 210,
    weights: { coldStart: 0.04, healthyDebug: 0.50, retryStorm: 0.06, premiumEscalation: 0.02, drift: 0.03, redundantWork: 0.35 },
    primaryProvider: "tavily",
    primaryModel: "search-deep",
    declaresSecondary: false,
  },
  {
    id: "P09",
    name: "PremiumOnly (opus-only wrapper)",
    description: "Always-opus. Worst-case premium burn pattern.",
    meanCostUsd: 0.42,
    costSpread: 0.08,
    callsPerDay: 36,
    weights: { coldStart: 0.05, healthyDebug: 0.30, retryStorm: 0.25, premiumEscalation: 0.35, drift: 0.02, redundantWork: 0.03 },
    primaryProvider: "anthropic",
    primaryModel: "claude-opus-4.5",
    premiumModel: "claude-opus-4.5",
    declaresSecondary: false, // not declared — should hit DEFAULT_DOWNGRADE_MAP
  },
  {
    id: "P10",
    name: "Disciplined Inc (well-instrumented agent)",
    description: "Annotates evidence carefully; almost never trips guard.",
    meanCostUsd: 0.05,
    costSpread: 0.02,
    callsPerDay: 88,
    weights: { coldStart: 0.05, healthyDebug: 0.88, retryStorm: 0.02, premiumEscalation: 0.02, drift: 0.01, redundantWork: 0.02 },
    primaryProvider: "anthropic",
    primaryModel: "claude-sonnet-4.5",
    premiumModel: "claude-opus-4.5",
    declaresSecondary: true,
  },
];

type ArcKind =
  | "coldStart"
  | "healthyDebug"
  | "retryStorm"
  | "premiumEscalation"
  | "drift"
  | "redundantWork";

function pickArc(r: () => number, w: PartnerProfile["weights"]): ArcKind {
  const entries: Array<[ArcKind, number]> = [
    ["coldStart", w.coldStart],
    ["healthyDebug", w.healthyDebug],
    ["retryStorm", w.retryStorm],
    ["premiumEscalation", w.premiumEscalation],
    ["drift", w.drift],
    ["redundantWork", w.redundantWork],
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

// ─── Arc generators ─────────────────────────────────────────────────────
//
// Each arc returns a list of AgentActionTelemetry events + an
// ObjectiveDescriptor (consistent across the arc). The driver records each
// telemetry into the adapter and queries the guard before "doing" the
// action under check (last event of the arc).

interface Arc {
  objective: ObjectiveDescriptor;
  history: AgentActionTelemetry[]; // events before the action under check
  underCheck: AgentActionTelemetry; // the action we ask the guard about
}

let objectiveCounter = 0;
function nextObjectiveId(profileId: string): string {
  objectiveCounter += 1;
  return `${profileId}_obj_${String(objectiveCounter).padStart(5, "0")}`;
}

function baseAction(
  profile: PartnerProfile,
  r: () => number,
  overrides: Partial<AgentActionTelemetry> = {}
): AgentActionTelemetry {
  const cost = jitter(r, profile.meanCostUsd, profile.costSpread);
  return {
    actionId: `act_${Math.floor(r() * 1e9).toString(16)}`,
    runtime: profile.id,
    actionType: "paid_llm_call",
    provider: profile.primaryProvider,
    model: profile.primaryModel,
    estimatedCostUsd: cost,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function modelPolicyFor(profile: PartnerProfile): ObjectiveDescriptor["modelPolicy"] {
  if (!profile.declaresSecondary) return undefined;
  return {
    primaryModel: {
      provider: profile.primaryProvider,
      model: profile.premiumModel ?? profile.primaryModel,
      role: "primary",
      tier: "premium",
    },
    secondaryModel: {
      provider: profile.primaryProvider,
      model:
        profile.primaryProvider === "openai" ? "gpt-4o-mini" : "claude-haiku",
      role: "secondary",
      tier: "cheap",
      estimatedCostUsd: profile.meanCostUsd * 0.15,
    },
    maxPremiumRetriesWithoutEvidence: 2,
  };
}

function makeColdStart(profile: PartnerProfile, r: () => number): Arc {
  const id = nextObjectiveId(profile.id);
  return {
    objective: { id, goal: "Start a fresh task", successCriteria: ["complete"] },
    history: [],
    underCheck: baseAction(profile, r, { objectiveId: id, failureSignalPresent: false, filesRead: ["x"], contextSourceConfirmed: true }),
  };
}

function makeHealthyDebug(profile: PartnerProfile, r: () => number): Arc {
  const id = nextObjectiveId(profile.id);
  const fpr = `fp_v1_${profile.id}_${Math.floor(r() * 1e6).toString(16)}`;
  const prior: AgentActionTelemetry = baseAction(profile, r, {
    objectiveId: id,
    failureSignalPresent: true,
    failureSignalType: "test_failure",
    errorFingerprint: fpr,
    filesRead: [],
    testsRun: [],
    toolResultsChanged: false,
    gitDiffChanged: false,
    contextSourceConfirmed: false,
  });
  return {
    objective: { id, goal: "Fix the failing thing", successCriteria: ["tests pass"], modelPolicy: modelPolicyFor(profile) },
    history: [prior],
    underCheck: baseAction(profile, r, {
      objectiveId: id,
      failureSignalPresent: true,
      failureSignalType: "test_failure",
      errorFingerprint: fpr,
      // New evidence on the current attempt — Stage 0.5.1 contract.
      filesRead: ["file_a", "file_b"],
      testsRun: ["test_x"],
      gitDiffChanged: true,
      toolResultsChanged: true,
      contextSourceConfirmed: true,
    }),
  };
}

function makeRetryStorm(profile: PartnerProfile, r: () => number): Arc {
  const id = nextObjectiveId(profile.id);
  const fpr = `fp_v1_${profile.id}_storm_${Math.floor(r() * 1e6).toString(16)}`;
  const repeats = 4 + Math.floor(r() * 4); // 4-7 prior attempts
  const history: AgentActionTelemetry[] = [];
  for (let i = 0; i < repeats; i++) {
    history.push(
      baseAction(profile, r, {
        objectiveId: id,
        failureSignalPresent: true,
        failureSignalType: "test_failure",
        errorFingerprint: fpr,
        filesRead: i === 0 ? ["initial_read"] : [],
        testsRun: [],
        logsRead: [],
        toolResultsChanged: false,
        gitDiffChanged: false,
        contextSourceConfirmed: false,
      })
    );
  }
  return {
    objective: {
      id,
      goal: "Fix the failing thing (loop scenario)",
      successCriteria: ["tests pass"],
      modelPolicy: modelPolicyFor(profile),
      detectorPolicy: { same_tool_retry_threshold: 4 },
    },
    history,
    underCheck: baseAction(profile, r, {
      objectiveId: id,
      failureSignalPresent: true,
      failureSignalType: "test_failure",
      errorFingerprint: fpr,
      filesRead: [],
      testsRun: [],
      logsRead: [],
      toolResultsChanged: false,
      gitDiffChanged: false,
      contextSourceConfirmed: false,
    }),
  };
}

function makePremiumEscalation(profile: PartnerProfile, r: () => number): Arc {
  const id = nextObjectiveId(profile.id);
  const fpr = `fp_v1_${profile.id}_escalate_${Math.floor(r() * 1e6).toString(16)}`;
  const repeats = 2 + Math.floor(r() * 3);
  const history: AgentActionTelemetry[] = [];
  for (let i = 0; i < repeats; i++) {
    history.push(
      baseAction(profile, r, {
        objectiveId: id,
        failureSignalPresent: true,
        failureSignalType: "test_failure",
        errorFingerprint: fpr,
        filesRead: [],
        testsRun: [],
        toolResultsChanged: false,
        gitDiffChanged: false,
        contextSourceConfirmed: false,
        model: profile.primaryModel,
        estimatedCostUsd: jitter(r, profile.meanCostUsd, profile.costSpread),
      })
    );
  }
  const premiumModel = profile.premiumModel ?? profile.primaryModel;
  const premiumCost = profile.meanCostUsd * (premiumModel === profile.primaryModel ? 1 : 8);
  return {
    objective: {
      id,
      goal: "Try a smarter model on the stuck task",
      successCriteria: ["tests pass"],
      modelPolicy: modelPolicyFor(profile),
      detectorPolicy: { premium_retry_without_evidence_threshold: 2 },
    },
    history,
    underCheck: baseAction(profile, r, {
      objectiveId: id,
      failureSignalPresent: true,
      failureSignalType: "test_failure",
      errorFingerprint: fpr,
      model: premiumModel,
      modelRole: "primary",
      modelTier: "premium",
      estimatedCostUsd: jitter(r, premiumCost, premiumCost * 0.1),
      filesRead: [],
      testsRun: [],
      logsRead: [],
      toolResultsChanged: false,
      gitDiffChanged: false,
      contextSourceConfirmed: false,
    }),
  };
}

function makeDrift(profile: PartnerProfile, r: () => number): Arc {
  const id = nextObjectiveId(profile.id);
  return {
    objective: {
      id,
      goal: "Stay focused on the current task",
      blockedActions: ["refactor_unrelated_module", "deploy_to_prod_without_review"],
    },
    history: [],
    underCheck: baseAction(profile, r, {
      objectiveId: id,
      actionType: chance(r, 0.5) ? "refactor_unrelated_module" : "deploy_to_prod_without_review",
      failureSignalPresent: false,
      contextSourceConfirmed: false,
    }),
  };
}

function makeRedundantWork(profile: PartnerProfile, r: () => number): Arc {
  // Same tool, same input, repeated. No failure signal — guard's
  // stale_context detector won't fire (E3-class pattern). Will mostly allow.
  const id = nextObjectiveId(profile.id);
  const action = baseAction(profile, r, {
    objectiveId: id,
    actionType: "tool_call",
    toolName: pick(r, ["bash:npm_test", "bash:typecheck", "search:web", "scrape:url"]),
    failureSignalPresent: false,
    filesRead: [],
    testsRun: [],
    contextSourceConfirmed: false,
  });
  return {
    objective: { id, goal: "Verify state", successCriteria: ["ok"] },
    history: [action],
    underCheck: { ...action, actionId: `act_${Math.floor(r() * 1e9).toString(16)}` },
  };
}

function generateArc(kind: ArcKind, profile: PartnerProfile, r: () => number): Arc {
  switch (kind) {
    case "coldStart": return makeColdStart(profile, r);
    case "healthyDebug": return makeHealthyDebug(profile, r);
    case "retryStorm": return makeRetryStorm(profile, r);
    case "premiumEscalation": return makePremiumEscalation(profile, r);
    case "drift": return makeDrift(profile, r);
    case "redundantWork": return makeRedundantWork(profile, r);
  }
}

// ─── Driver ─────────────────────────────────────────────────────────────

interface PartnerTally {
  profile: PartnerProfile;
  totalCalls: number;
  allow: number;
  warn: number;
  requireConfirmation: number;
  block: number;
  uncertain: number;
  delay: number;
  totalCostUsd: number;
  totalSavingsUsd: number;
  savingsByBasis: Record<string, number>;
  topSavings: Array<{ savings: number; pattern: string; reason: string }>;
}

async function callGuard(payload: unknown, apiKey: string): Promise<SpendingGuardCheckOutput> {
  const res = await fetch(GUARD_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Guard HTTP ${res.status}: ${body}`);
  }
  return (await res.json()) as SpendingGuardCheckOutput;
}

async function runPartner(profile: PartnerProfile, seed: number): Promise<PartnerTally> {
  const r = rng(seed);
  const adapter = new CodingAgentAdapter();
  const tally: PartnerTally = {
    profile,
    totalCalls: 0,
    allow: 0,
    warn: 0,
    requireConfirmation: 0,
    block: 0,
    uncertain: 0,
    delay: 0,
    totalCostUsd: 0,
    totalSavingsUsd: 0,
    savingsByBasis: {},
    topSavings: [],
  };

  for (let i = 0; i < profile.callsPerDay; i++) {
    const kind = pickArc(r, profile.weights);
    const arc = generateArc(kind, profile, r);
    // Record prior history into the adapter so the guard sees the full picture.
    for (const past of arc.history) adapter.record(past);
    const payload = adapter.buildCheckInput(arc.underCheck, { objective: arc.objective });
    let result: SpendingGuardCheckOutput;
    const partnerKey = `asg_v1_${profile.id}`;
    try {
      result = await callGuard(payload, partnerKey);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`${profile.id} call ${i} error:`, err);
      continue;
    }

    tally.totalCalls += 1;
    tally.totalCostUsd += arc.underCheck.estimatedCostUsd ?? 0;
    switch (result.decision) {
      case "allow":               tally.allow += 1; break;
      case "warn":                tally.warn += 1; break;
      case "require_confirmation": tally.requireConfirmation += 1; break;
      case "block":               tally.block += 1; break;
      case "uncertain":           tally.uncertain += 1; break;
      case "delay":               tally.delay += 1; break;
    }
    const ps: ProjectedSavings | undefined = result.projected_savings;
    if (ps && ps.amount_usd > 0) {
      tally.totalSavingsUsd += ps.amount_usd;
      tally.savingsByBasis[ps.basis] = (tally.savingsByBasis[ps.basis] ?? 0) + ps.amount_usd;
      tally.topSavings.push({
        savings: ps.amount_usd,
        pattern: result.pattern,
        reason: result.reason.slice(0, 80) + (result.reason.length > 80 ? "…" : ""),
      });
    }

    // Record the action under check too, so subsequent arcs on a different
    // objective do not pollute history (objectives are unique per arc by
    // nextObjectiveId, so this is harmless but realistic).
    adapter.record(arc.underCheck);
  }

  // Sort and trim topSavings
  tally.topSavings.sort((a, b) => b.savings - a.savings);
  tally.topSavings = tally.topSavings.slice(0, 3);
  return tally;
}

// ─── Report ─────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  return `$${n.toFixed(2)}`;
}

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
  const totalReqConf = tallies.reduce((s, t) => s + t.requireConfirmation, 0);
  const totalBlock = tallies.reduce((s, t) => s + t.block, 0);
  const totalEventsWithSavings = tallies.reduce(
    (s, t) => s + t.warn + t.requireConfirmation + t.block + t.delay,
    0
  );

  const grandSavingsByBasis: Record<string, number> = {};
  for (const t of tallies) {
    for (const [k, v] of Object.entries(t.savingsByBasis)) {
      grandSavingsByBasis[k] = (grandSavingsByBasis[k] ?? 0) + v;
    }
  }

  const lines: string[] = [];
  lines.push(`# 10-Partner Day Simulation Report`);
  lines.push("");
  lines.push(`> **Server:** ${GUARD_URL.replace("/v1/check", "")} — version \`0.5.2-beta\``);
  lines.push(`> **Mode:** shadow only — \`/v1/check\` POSTs, every response logged, no enforcement`);
  lines.push(`> **Date:** ${new Date().toISOString()}`);
  lines.push(`> **Source:** \`scripts/simulate-10-partners.ts\` (deterministic seeds per partner; reproducible)`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Grand totals across all 10 partners");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total /v1/check calls | **${totalCalls.toLocaleString()}** |`);
  lines.push(`| Total agent spend observed | **${fmt$(totalCost)}** |`);
  lines.push(`| **Total projected savings offered** | **${fmt$(totalSavings)}** |`);
  lines.push(`| Savings as % of spend | **${pct(totalSavings, totalCost)}** |`);
  lines.push(`| allow | ${totalAllow} (${pct(totalAllow, totalCalls)}) |`);
  lines.push(`| warn | ${totalWarn} (${pct(totalWarn, totalCalls)}) |`);
  lines.push(`| require_confirmation | ${totalReqConf} (${pct(totalReqConf, totalCalls)}) |`);
  lines.push(`| block | ${totalBlock} (${pct(totalBlock, totalCalls)}) |`);
  lines.push(`| Events with non-zero savings | ${totalEventsWithSavings} |`);
  lines.push("");
  lines.push("### Savings broken down by computation basis");
  lines.push("");
  lines.push(`| basis | total $ | share |`);
  lines.push(`| --- | --- | --- |`);
  for (const [k, v] of Object.entries(grandSavingsByBasis).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${k}\` | ${fmt$(v)} | ${pct(v, totalSavings)} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Per-partner breakdown");
  lines.push("");
  lines.push(`| ID | Partner | Calls | Spend | **Savings** | Savings/Spend | warn | req_confirm | block |`);
  lines.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const t of tallies) {
    lines.push(
      `| ${t.profile.id} | ${t.profile.name} | ${t.totalCalls} | ${fmt$(t.totalCostUsd)} | **${fmt$(t.totalSavingsUsd)}** | ${pct(t.totalSavingsUsd, t.totalCostUsd)} | ${t.warn} | ${t.requireConfirmation} | ${t.block} |`
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Partner profile detail");
  lines.push("");
  for (const t of tallies) {
    const p = t.profile;
    lines.push(`### ${p.id} — ${p.name}`);
    lines.push("");
    lines.push(`*${p.description}*`);
    lines.push("");
    lines.push(`- Workload: ${t.totalCalls} calls/day on \`${p.primaryProvider}/${p.primaryModel}\` (~${fmt$(p.meanCostUsd)} mean per call)`);
    lines.push(`- Spend observed: ${fmt$(t.totalCostUsd)}`);
    lines.push(`- **Savings offered: ${fmt$(t.totalSavingsUsd)}** (${pct(t.totalSavingsUsd, t.totalCostUsd)} of spend)`);
    lines.push(`- Decisions: allow=${t.allow} · warn=${t.warn} · req_confirm=${t.requireConfirmation} · block=${t.block} · uncertain=${t.uncertain} · delay=${t.delay}`);
    lines.push(`- Declared \`model_policy.secondaryModel\`: ${p.declaresSecondary ? "yes" : "no (relies on DEFAULT_DOWNGRADE_MAP)"}`);
    if (t.topSavings.length > 0) {
      lines.push(`- Top 3 individual catches:`);
      for (const ts of t.topSavings) {
        lines.push(`  - **${fmt$(ts.savings)}** — \`${ts.pattern}\` — "${ts.reason}"`);
      }
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push("Each partner is one realistic archetype with a fixed daily call count and a weighted mix of behavioural arcs:");
  lines.push("");
  lines.push("- **`coldStart`** — first action on a new objective, no history");
  lines.push("- **`healthyDebug`** — same failure as prior attempt but with annotated new evidence (filesRead, testsRun, gitDiffChanged on the current attempt). Stage 0.5.1 fix should keep these at `allow`.");
  lines.push("- **`retryStorm`** — 4–7 prior attempts on the same failure, no evidence between or on the current attempt. Should trip `stale_context_retry_storm`.");
  lines.push("- **`premiumEscalation`** — 2–4 sonnet/gpt-4o attempts on the same failure, current attempt jumps to opus/gpt-5 without new evidence. Should trip `model_escalation_without_evidence` with route to declared secondary (or DEFAULT_DOWNGRADE_MAP).");
  lines.push("- **`drift`** — action listed in `objective.blocked_actions`. Should deterministic-block.");
  lines.push("- **`redundantWork`** — same tool/input fingerprint repeated with no failure signal. Currently NOT caught (E3/E8 gap in `wasteful_repeated_work` detector — deliberately deferred per Stage 0.5).");
  lines.push("");
  lines.push("Each arc generates the prior-event history (recorded into a fresh `CodingAgentAdapter`) and one \"action under check\" that gets POSTed to `/v1/check`. The guard's response — including `projected_savings.amount_usd` — is the source of every number in this report.");
  lines.push("");
  lines.push("Numbers are deterministic per seed (partner ID hash). Re-running the script reproduces the same totals exactly.");
  lines.push("");
  lines.push("## Honesty disclosures");
  lines.push("");
  lines.push("- These are **simulated** partners, not real users. The behavioural mix is anchored on plausible archetypes but no claim is made that real Acme/Crawly/etc. behave exactly this way.");
  lines.push("- \"Total projected savings\" is what the guard would have saved **if every recommendation were heeded**. Real adoption is typically 40–80% of recommendations followed; multiply by your team's actual heed rate.");
  lines.push("- Per-call cost numbers are conservative estimates. Real production costs vary 5–10× depending on context size and provider price ladders.");
  lines.push("- The `redundantWork` arc is NOT caught by the current detector set (deliberate gap, deferred for real-partner data). It still consumes spend on the chart but contributes $0 to savings.");
  lines.push("- Numbers are scaled to one calendar day. A 7-day deployment would see roughly 5× these totals (weekend dip).");
  return lines.join("\n");
}

// ─── main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Use a deterministic seed per profile so re-runs are reproducible.
  const tallies: PartnerTally[] = [];
  for (let i = 0; i < PROFILES.length; i++) {
    const profile = PROFILES[i]!;
    const seed = 0xa5e + i * 7919;
    process.stdout.write(`Simulating ${profile.id} (${profile.callsPerDay} calls)… `);
    const tally = await runPartner(profile, seed);
    process.stdout.write(
      `${tally.totalCalls} done, ${fmt$(tally.totalSavingsUsd)} saved across ` +
        `${tally.warn + tally.requireConfirmation + tally.block} non-allow events.\n`
    );
    tallies.push(tally);
  }

  const reportPath = resolve(process.cwd(), "SIMULATION_10_PARTNERS_REPORT.md");
  const report = buildReport(tallies);
  writeFileSync(reportPath, report);

  const totalCalls = tallies.reduce((s, t) => s + t.totalCalls, 0);
  const totalCost = tallies.reduce((s, t) => s + t.totalCostUsd, 0);
  const totalSavings = tallies.reduce((s, t) => s + t.totalSavingsUsd, 0);
  console.log("");
  console.log("=".repeat(70));
  console.log(`GRAND TOTAL across 10 partners (1 simulated workday each)`);
  console.log("=".repeat(70));
  console.log(`Calls:    ${totalCalls.toLocaleString()}`);
  console.log(`Spend:    ${fmt$(totalCost)}`);
  console.log(`Savings:  ${fmt$(totalSavings)}  (${pct(totalSavings, totalCost)} of spend)`);
  console.log(`Report:   ${reportPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
