// Stage 0.5.3 — public read-only aggregate stats.
//
// GET /v1/public/stats
//
// Returns anonymized aggregate statistics from the decision log. No auth,
// CORS-friendly, designed to be fetched from the marketing landing page's
// "savings counter" widget. Computes on-demand from the JSONL file.
//
// What this endpoint NEVER exposes:
//   - per-partner / per-objective / per-actor breakdowns
//   - request IDs, api_key hashes, raw payload data
//   - anything that would let one partner identify another partner's traffic
//
// What it exposes:
//   - total_checks               number of /v1/check calls processed
//   - total_savings_offered_usd  sum of projected_savings_usd
//   - savings_by_basis           breakdown by computation basis
//   - savings_by_pattern         breakdown by detector pattern (no objective ids)
//   - decisions                  histogram of allow/warn/req_confirm/block
//   - generated_at               ISO timestamp
//
// Caching: response is cached in-process for 30 seconds. The decision log
// only grows; recomputing every request would waste CPU at scale.

import { existsSync, readFileSync, statSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EnvConfig } from "../config/env.js";

interface PublicStats {
  service: string;
  version: string;
  total_checks: number;
  total_savings_offered_usd: number;
  total_cost_observed_usd: number;
  events_with_savings: number;
  decisions: {
    allow: number;
    warn: number;
    require_confirmation: number;
    block: number;
    delay: number;
    uncertain: number;
  };
  savings_by_pattern: Record<string, number>;
  savings_by_basis: Record<string, number>;
  generated_at: string;
  log_present: boolean;
}

interface CachedStats {
  stats: PublicStats;
  computed_at: number;
  log_size: number;
  log_mtime_ms: number;
}

const CACHE_TTL_MS = 30_000;

let cache: CachedStats | null = null;

function emptyStats(config: EnvConfig, logPresent: boolean): PublicStats {
  return {
    service: config.serviceName,
    version: config.serviceVersion,
    total_checks: 0,
    total_savings_offered_usd: 0,
    total_cost_observed_usd: 0,
    events_with_savings: 0,
    decisions: { allow: 0, warn: 0, require_confirmation: 0, block: 0, delay: 0, uncertain: 0 },
    savings_by_pattern: {},
    savings_by_basis: {},
    generated_at: new Date().toISOString(),
    log_present: logPresent,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeStats(filePath: string, config: EnvConfig): PublicStats {
  if (!existsSync(filePath)) {
    return emptyStats(config, false);
  }
  const out = emptyStats(config, true);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return out;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event.event_type !== "agent_spend_guard.check.completed") continue;
    out.total_checks += 1;
    const decision = event.decision as keyof PublicStats["decisions"] | undefined;
    if (decision && decision in out.decisions) {
      out.decisions[decision] += 1;
    }
    const cost = event.next_action_cost_usd;
    if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) {
      out.total_cost_observed_usd += cost;
    }
    const savings = event.projected_savings_usd;
    if (typeof savings === "number" && Number.isFinite(savings) && savings > 0) {
      out.total_savings_offered_usd += savings;
      out.events_with_savings += 1;
      const pattern = (event.pattern as string | undefined) ?? "unknown";
      out.savings_by_pattern[pattern] = (out.savings_by_pattern[pattern] ?? 0) + savings;
      const basis = (event.projected_savings_basis as string | undefined) ?? "unknown";
      out.savings_by_basis[basis] = (out.savings_by_basis[basis] ?? 0) + savings;
    }
  }

  // Round all $-fields to cents for clean wire format.
  out.total_savings_offered_usd = round2(out.total_savings_offered_usd);
  out.total_cost_observed_usd = round2(out.total_cost_observed_usd);
  for (const k of Object.keys(out.savings_by_pattern)) {
    out.savings_by_pattern[k] = round2(out.savings_by_pattern[k]!);
  }
  for (const k of Object.keys(out.savings_by_basis)) {
    out.savings_by_basis[k] = round2(out.savings_by_basis[k]!);
  }

  return out;
}

function getStats(config: EnvConfig): PublicStats {
  const filePath = config.logPath;
  const now = Date.now();

  // Quick file-state probe — if log hasn't been touched since last compute
  // and TTL hasn't expired, return cache.
  if (cache) {
    let mtime = 0;
    let size = 0;
    try {
      if (existsSync(filePath)) {
        const s = statSync(filePath);
        mtime = s.mtimeMs;
        size = s.size;
      }
    } catch {
      // ignore — treat as no log
    }
    const fresh = now - cache.computed_at < CACHE_TTL_MS;
    const fileUnchanged = mtime === cache.log_mtime_ms && size === cache.log_size;
    if (fresh || fileUnchanged) {
      return cache.stats;
    }
  }

  const stats = computeStats(filePath, config);
  let mtime = 0;
  let size = 0;
  try {
    if (existsSync(filePath)) {
      const s = statSync(filePath);
      mtime = s.mtimeMs;
      size = s.size;
    }
  } catch {
    // ignore
  }
  cache = { stats, computed_at: now, log_size: size, log_mtime_ms: mtime };
  return stats;
}

/**
 * Exposed for tests so they can reset cache between runs.
 */
export function _resetPublicStatsCache(): void {
  cache = null;
}

export async function registerPublicStatsRoute(
  app: FastifyInstance,
  config: EnvConfig
): Promise<void> {
  app.get(
    "/v1/public/stats",
    async (_req: FastifyRequest, reply: FastifyReply) => {
      // CORS: this is meant to be fetched from the marketing landing
      // (different origin). Allow any origin for a public GET.
      reply.header("access-control-allow-origin", "*");
      reply.header("access-control-allow-methods", "GET, OPTIONS");
      reply.header("cache-control", "public, max-age=30");
      return getStats(config);
    }
  );

  // Preflight — some browsers send OPTIONS even for simple GETs.
  app.options("/v1/public/stats", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET, OPTIONS");
    reply.header("access-control-max-age", "86400");
    return reply.code(204).send();
  });
}
