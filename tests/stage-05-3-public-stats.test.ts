// Stage 0.5.3 — GET /v1/public/stats tests.
//
// The endpoint:
//   - is unauthenticated (no Bearer required)
//   - returns CORS-friendly headers (access-control-allow-origin: *)
//   - aggregates only from the JSONL decision log; no per-partner data
//   - handles a missing log file gracefully
//   - respects the in-process 30s cache

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildServerWithDeps } from "../src/server.js";
import { loadEnvConfig } from "../src/config/env.js";
import { setLoggerSink } from "../src/core/logger.js";
import { _resetPublicStatsCache } from "../src/routes/public-stats.js";

setLoggerSink({ emit: () => {} });

function writeLog(logPath: string, events: ReadonlyArray<Record<string, unknown>>): void {
  const lines = events.map((e) => JSON.stringify(e));
  writeFileSync(logPath, lines.join("\n") + "\n", "utf8");
}

function sampleAllow(): Record<string, unknown> {
  return {
    event_type: "agent_spend_guard.check.completed",
    decision: "allow",
    pattern: "none",
    recommended_policy: "continue",
    next_action_cost_usd: 0.05,
    projected_savings_usd: null,
    projected_savings_basis: null,
    timestamp: new Date().toISOString(),
  };
}

function sampleStaleStorm(): Record<string, unknown> {
  return {
    event_type: "agent_spend_guard.check.completed",
    decision: "require_confirmation",
    pattern: "stale_context_retry_storm",
    recommended_policy: "ask_human",
    next_action_cost_usd: 0.42,
    projected_savings_usd: 1.26,
    projected_savings_basis: "projected_future_attempts",
    timestamp: new Date().toISOString(),
  };
}

function sampleBlock(): Record<string, unknown> {
  return {
    event_type: "agent_spend_guard.check.completed",
    decision: "block",
    pattern: "objective_drift",
    recommended_policy: "stop_action",
    next_action_cost_usd: 0.07,
    projected_savings_usd: 0.07,
    projected_savings_basis: "next_attempt_avoided",
    timestamp: new Date().toISOString(),
  };
}

describe("Stage 0.5.3 — GET /v1/public/stats", () => {
  let tmp: string;
  let logPath: string;
  let app: FastifyInstance;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "asg-public-stats-"));
    logPath = join(tmp, "decisions.jsonl");
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(async () => {
    _resetPublicStatsCache();
    const config = {
      ...loadEnvConfig({}),
      authMode: "required" as const,
      apiKeys: new Set<string>(["asg_v1_test"]),
      logSink: "none" as const,
      logPath,
    };
    const built = await buildServerWithDeps({
      logger: false,
      installLogSink: false,
      config,
    });
    app = built.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Endpoint shape ────────────────────────────────────────────────────

  it("PS01: returns 200 with the expected schema even when log file is missing", async () => {
    // No log file written yet.
    const res = await app.inject({ method: "GET", url: "/v1/public/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe("agent-spend-guard");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.total_checks).toBe(0);
    expect(body.total_savings_offered_usd).toBe(0);
    expect(body.total_cost_observed_usd).toBe(0);
    expect(body.events_with_savings).toBe(0);
    expect(body.decisions).toMatchObject({
      allow: 0,
      warn: 0,
      require_confirmation: 0,
      block: 0,
    });
    expect(body.savings_by_pattern).toEqual({});
    expect(body.savings_by_basis).toEqual({});
    expect(typeof body.generated_at).toBe("string");
    expect(body.log_present).toBe(false);
  });

  it("PS02: is unauthenticated — no Authorization header required even in auth=required mode", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/public/stats" });
    expect(res.statusCode).toBe(200);
    // The check endpoint would have 401'd; this one must not.
    const checkRes = await app.inject({
      method: "POST",
      url: "/v1/check",
      payload: { actor: { type: "agent" }, next_action: { type: "x", estimated_cost: { amount: 0.01, currency: "USD" } } },
    });
    expect(checkRes.statusCode).toBe(401);
  });

  it("PS03: returns CORS-permissive headers for browser fetches", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/public/stats" });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toMatch(/GET/);
    // Cache-Control hint so the landing's CDN can edge-cache.
    expect(String(res.headers["cache-control"])).toMatch(/max-age=30/);
  });

  it("PS04: OPTIONS preflight returns 204 with the same CORS headers", async () => {
    const res = await app.inject({ method: "OPTIONS", url: "/v1/public/stats" });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toMatch(/GET/);
  });

  // ── Aggregation correctness ──────────────────────────────────────────

  it("PS05: aggregates total_checks, decisions histogram, and total cost", async () => {
    writeLog(logPath, [sampleAllow(), sampleAllow(), sampleStaleStorm(), sampleBlock()]);
    const res = await app.inject({ method: "GET", url: "/v1/public/stats" });
    const body = res.json();
    expect(body.log_present).toBe(true);
    expect(body.total_checks).toBe(4);
    expect(body.decisions.allow).toBe(2);
    expect(body.decisions.require_confirmation).toBe(1);
    expect(body.decisions.block).toBe(1);
    // 0.05 + 0.05 + 0.42 + 0.07 = 0.59
    expect(body.total_cost_observed_usd).toBeCloseTo(0.59, 2);
  });

  it("PS06: sums projected_savings_usd into total + by-pattern + by-basis", async () => {
    writeLog(logPath, [sampleAllow(), sampleStaleStorm(), sampleStaleStorm(), sampleBlock()]);
    const res = await app.inject({ method: "GET", url: "/v1/public/stats" });
    const body = res.json();
    // 1.26 + 1.26 + 0.07 = 2.59
    expect(body.total_savings_offered_usd).toBeCloseTo(2.59, 2);
    expect(body.events_with_savings).toBe(3);
    expect(body.savings_by_pattern.stale_context_retry_storm).toBeCloseTo(2.52, 2);
    expect(body.savings_by_pattern.objective_drift).toBeCloseTo(0.07, 2);
    expect(body.savings_by_basis.projected_future_attempts).toBeCloseTo(2.52, 2);
    expect(body.savings_by_basis.next_attempt_avoided).toBeCloseTo(0.07, 2);
  });

  it("PS07: ignores malformed lines and events of other event_type", async () => {
    writeLog(logPath, [
      sampleAllow(),
      { event_type: "agent_spend_guard.something_else", foo: 1 } as Record<string, unknown>,
    ]);
    // Append junk that JSON.parse will reject.
    writeFileSync(logPath, "\n{not json\n" + JSON.stringify(sampleStaleStorm()) + "\n", { flag: "a" });
    const res = await app.inject({ method: "GET", url: "/v1/public/stats" });
    const body = res.json();
    // 2 valid agent_spend_guard.check.completed lines.
    expect(body.total_checks).toBe(2);
    expect(body.total_savings_offered_usd).toBeCloseTo(1.26, 2);
  });

  it("PS08: does NOT leak per-partner identifiers in the response", async () => {
    writeLog(logPath, [
      {
        ...sampleStaleStorm(),
        request_id: "req_should_not_leak",
        api_key_hash: "key_v1_should_not_leak",
        objective_id: "obj_should_not_leak",
        actor_runtime: "agent_should_not_leak",
        input_hash: "input_v1_should_not_leak",
      },
    ]);
    const res = await app.inject({ method: "GET", url: "/v1/public/stats" });
    const bodyText = res.body;
    expect(bodyText).not.toMatch(/should_not_leak/);
    expect(bodyText).not.toMatch(/request_id/);
    expect(bodyText).not.toMatch(/api_key_hash/);
    expect(bodyText).not.toMatch(/objective_id/);
    expect(bodyText).not.toMatch(/actor_runtime/);
  });

  // ── Caching ───────────────────────────────────────────────────────────

  it("PS09: serves a cached response when called rapidly after a fresh compute", async () => {
    writeLog(logPath, [sampleStaleStorm()]);
    const a = await app.inject({ method: "GET", url: "/v1/public/stats" });
    const b = await app.inject({ method: "GET", url: "/v1/public/stats" });
    expect(a.json().generated_at).toBe(b.json().generated_at);
  });

  // ── Meta advertises the endpoint ─────────────────────────────────────

  it("PS10: /v1/meta lists public_stats under endpoints", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.endpoints.public_stats).toBe("/v1/public/stats");
  });
});
