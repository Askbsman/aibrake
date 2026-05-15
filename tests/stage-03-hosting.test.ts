// Stage 0.3 hosting tests.
//
// Covers the new product-layer surfaces: API key auth, rate limiting,
// /v1/meta, JSONL log sink, and the logs:summary aggregator. None of these
// touch Core — Core remains stateless and unaware of hosting concerns.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer, buildServerWithDeps } from "../src/server.js";
import { loadEnvConfig } from "../src/config/env.js";
import { hashApiKey } from "../src/middleware/auth.js";
import { createJsonlSink } from "../src/sinks/jsonl-sink.js";
import { summarize } from "../src/cli/logs-summary.js";
import { setLoggerSink } from "../src/core/logger.js";
import { withCodingFailure } from "./helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

// ────────────────────────────────────────────────────────────────────────
// /v1/meta + /health new shape
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.3 — /v1/meta and /health", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildServer({ logger: false, installLogSink: false });
    await app.ready();
  });
  afterAll(async () => app.close());

  it("01. GET /v1/meta returns product metadata with all four SDK modes", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Agent Spend Guard");
    expect(body.version).toBe("0.4.0-beta");
    expect(body.policy_version).toBe("policy@0.1.0");
    expect(body.modes).toEqual(["check", "shadow", "confirm", "downgrade"]);
    expect(body.supported_patterns).toContain("stale_context_retry_storm");
    expect(body.supported_patterns).toContain(
      "model_escalation_without_evidence"
    );
  });

  it("02. /v1/meta is public (no Authorization required even if some other route is)", async () => {
    const built = await buildServerWithDeps({
      logger: false,
      installLogSink: false,
      config: {
        ...loadEnvConfig({ AGENT_SPEND_GUARD_AUTH_MODE: "required" }),
        // Note: no apiKeys set; required mode would reject everything
        // protected. /v1/meta must remain open.
      },
    });
    await built.app.ready();
    const res = await built.app.inject({ method: "GET", url: "/v1/meta" });
    expect(res.statusCode).toBe(200);
    await built.app.close();
  });

  it("03. /health includes service, version, and mode", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json();
    expect(body.service).toBe("agent-spend-guard");
    expect(body.mode).toBe("hosted-beta");
  });
});

// ────────────────────────────────────────────────────────────────────────
// API key auth
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.3 — API key auth", () => {
  it("04. authMode=required + no Authorization header → 401", async () => {
    const built = await buildServerWithDeps({
      logger: false,
      installLogSink: false,
      config: loadEnvConfig({
        AGENT_SPEND_GUARD_AUTH_MODE: "required",
        AGENT_SPEND_GUARD_API_KEYS: "asg_v1_test_key_1",
      }),
    });
    await built.app.ready();
    const res = await built.app.inject({
      method: "POST",
      url: "/v1/check",
      payload: withCodingFailure(7),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
    await built.app.close();
  });

  it("05. authMode=required + invalid key → 401", async () => {
    const built = await buildServerWithDeps({
      logger: false,
      installLogSink: false,
      config: loadEnvConfig({
        AGENT_SPEND_GUARD_AUTH_MODE: "required",
        AGENT_SPEND_GUARD_API_KEYS: "asg_v1_test_key_1",
      }),
    });
    await built.app.ready();
    const res = await built.app.inject({
      method: "POST",
      url: "/v1/check",
      payload: withCodingFailure(7),
      headers: { authorization: "Bearer wrong_key" },
    });
    expect(res.statusCode).toBe(401);
    await built.app.close();
  });

  it("06. authMode=required + valid key → /v1/check works", async () => {
    const built = await buildServerWithDeps({
      logger: false,
      installLogSink: false,
      config: loadEnvConfig({
        AGENT_SPEND_GUARD_AUTH_MODE: "required",
        AGENT_SPEND_GUARD_API_KEYS: "asg_v1_test_key_1,asg_v1_test_key_2",
      }),
    });
    await built.app.ready();
    const res = await built.app.inject({
      method: "POST",
      url: "/v1/check",
      payload: withCodingFailure(7),
      headers: { authorization: "Bearer asg_v1_test_key_2" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pattern).toBe("stale_context_retry_storm");
    await built.app.close();
  });

  it("07. authMode=optional allows requests without an Authorization header", async () => {
    const built = await buildServerWithDeps({
      logger: false,
      installLogSink: false,
      config: loadEnvConfig({
        AGENT_SPEND_GUARD_AUTH_MODE: "optional",
      }),
    });
    await built.app.ready();
    const res = await built.app.inject({
      method: "POST",
      url: "/v1/check",
      payload: withCodingFailure(7),
    });
    expect(res.statusCode).toBe(200);
    await built.app.close();
  });

  it("08. hashApiKey returns key_v1_-prefixed hash; equal input → equal hash; different input → different hash", () => {
    const a = hashApiKey("asg_v1_some_key");
    const b = hashApiKey("asg_v1_some_key");
    const c = hashApiKey("asg_v1_other_key");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("key_v1_")).toBe(true);
    // Raw key must not appear in the hash (sanity).
    expect(a).not.toContain("some_key");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Rate limit
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.3 — rate limit per API key", () => {
  it("09. exceeding the limit returns 429 with Retry-After", async () => {
    const built = await buildServerWithDeps({
      logger: false,
      installLogSink: false,
      config: loadEnvConfig({
        AGENT_SPEND_GUARD_AUTH_MODE: "required",
        AGENT_SPEND_GUARD_API_KEYS: "asg_v1_rate_key",
        AGENT_SPEND_GUARD_RATE_LIMIT_PER_KEY_PER_MIN: "3",
      }),
    });
    await built.app.ready();
    const headers = { authorization: "Bearer asg_v1_rate_key" };
    const payload = withCodingFailure(7);
    const first = await built.app.inject({ method: "POST", url: "/v1/check", payload, headers });
    const second = await built.app.inject({ method: "POST", url: "/v1/check", payload, headers });
    const third = await built.app.inject({ method: "POST", url: "/v1/check", payload, headers });
    const fourth = await built.app.inject({ method: "POST", url: "/v1/check", payload, headers });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(200);
    expect(fourth.statusCode).toBe(429);
    expect(fourth.headers["retry-after"]).toBeDefined();
    expect(fourth.json().error.code).toBe("RATE_LIMITED");
    await built.app.close();
  });

  it("10. limit is per-key — a different key gets its own bucket", async () => {
    const built = await buildServerWithDeps({
      logger: false,
      installLogSink: false,
      config: loadEnvConfig({
        AGENT_SPEND_GUARD_AUTH_MODE: "required",
        AGENT_SPEND_GUARD_API_KEYS: "k1,k2",
        AGENT_SPEND_GUARD_RATE_LIMIT_PER_KEY_PER_MIN: "1",
      }),
    });
    await built.app.ready();
    const payload = withCodingFailure(7);
    const a1 = await built.app.inject({ method: "POST", url: "/v1/check", payload, headers: { authorization: "Bearer k1" } });
    const a2 = await built.app.inject({ method: "POST", url: "/v1/check", payload, headers: { authorization: "Bearer k1" } });
    const b1 = await built.app.inject({ method: "POST", url: "/v1/check", payload, headers: { authorization: "Bearer k2" } });
    expect(a1.statusCode).toBe(200);
    expect(a2.statusCode).toBe(429);
    expect(b1.statusCode).toBe(200);
    await built.app.close();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Safe logging — JSONL sink + payload redaction
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.3 — safe decision logging", () => {
  let tmpDir: string;
  let logPath: string;
  let originalCapture: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "asg-test-"));
    logPath = join(tmpDir, "decisions.jsonl");
    originalCapture = [];
  });

  afterEach(() => {
    setLoggerSink({ emit: (e) => originalCapture.push(e) });
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("11. JSONL sink writes one line per emit and auto-creates the parent directory", () => {
    // Use a nested path that does not exist yet.
    const nested = join(tmpDir, "nested", "deeper", "decisions.jsonl");
    const sink = createJsonlSink({ filePath: nested });
    sink.emit({ event_type: "agent_spend_guard.check.completed", decision: "allow" });
    sink.emit({ event_type: "agent_spend_guard.check.completed", decision: "warn" });
    expect(existsSync(nested)).toBe(true);
    const contents = readFileSync(nested, "utf8");
    const lines = contents.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).decision).toBe("allow");
    expect(JSON.parse(lines[1]!).decision).toBe("warn");
  });

  it("12. JSONL sink write failure does not throw — calls the onError hook instead", () => {
    let errSeen = false;
    const sink = createJsonlSink({
      // Intentionally invalid path — Windows reserved name to force a failure.
      filePath: process.platform === "win32"
        ? "Z:\\\\does\\not\\exist\\decisions.jsonl"
        : "/proc/0/decisions.jsonl",
      onError: () => {
        errSeen = true;
      },
    });
    expect(() => {
      sink.emit({ event_type: "agent_spend_guard.check.completed" });
    }).not.toThrow();
    expect(errSeen).toBe(true);
  });

  it("13. /v1/check decision log contains api_key_hash but never the raw key", async () => {
    setLoggerSink(createJsonlSink({ filePath: logPath }));
    const built = await buildServerWithDeps({
      logger: false,
      installLogSink: false,
      config: loadEnvConfig({
        AGENT_SPEND_GUARD_AUTH_MODE: "required",
        AGENT_SPEND_GUARD_API_KEYS: "asg_v1_super_secret_key_xyz",
      }),
    });
    await built.app.ready();
    await built.app.inject({
      method: "POST",
      url: "/v1/check",
      payload: withCodingFailure(7),
      headers: { authorization: "Bearer asg_v1_super_secret_key_xyz" },
    });
    await built.app.close();

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    const event = JSON.parse(lines[0]!);
    expect(typeof event.api_key_hash).toBe("string");
    expect(event.api_key_hash.startsWith("key_v1_")).toBe(true);
    // Raw key must not appear anywhere in the log line.
    expect(lines[0]).not.toContain("asg_v1_super_secret_key_xyz");
    expect(lines[0]).not.toContain("super_secret_key");
    // request_id is present and prefixed.
    expect(typeof event.request_id).toBe("string");
    expect(event.request_id.startsWith("req_")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// logs:summary CLI
// ────────────────────────────────────────────────────────────────────────

describe("Stage 0.3 — logs:summary aggregator", () => {
  it("14. summarize() counts decisions, patterns, and policies; ignores non-target events", () => {
    const lines = [
      JSON.stringify({ event_type: "agent_spend_guard.check.completed", decision: "allow", pattern: "none", recommended_policy: "continue" }),
      JSON.stringify({ event_type: "agent_spend_guard.check.completed", decision: "warn", pattern: "same_tool_retry_loop", recommended_policy: "shadow_log" }),
      JSON.stringify({ event_type: "agent_spend_guard.check.completed", decision: "warn", pattern: "model_escalation_without_evidence", recommended_policy: "downgrade" }),
      JSON.stringify({ event_type: "agent_spend_guard.check.completed", decision: "require_confirmation", pattern: "stale_context_retry_storm", recommended_policy: "ask_human" }),
      JSON.stringify({ event_type: "agent_spend_guard.check.completed", decision: "require_confirmation", pattern: "stale_context_retry_storm", recommended_policy: "ask_human" }),
      // ignored — different event_type
      JSON.stringify({ event_type: "agent_spend_guard.server.started" }),
      // ignored — bad JSON
      "not json",
      "",
    ];
    const out = summarize(lines);
    expect(out.aggregates.total).toBe(5);
    expect(out.aggregates.byDecision.allow).toBe(1);
    expect(out.aggregates.warnCount).toBe(2);
    expect(out.aggregates.requireConfirmationCount).toBe(2);
    expect(out.aggregates.blockCount).toBe(0);
    expect(out.aggregates.byPattern.stale_context_retry_storm).toBe(2);
    expect(out.text).toContain("Agent Spend Guard — Beta Summary");
    expect(out.text).toContain("total_checks: 5");
  });
});
