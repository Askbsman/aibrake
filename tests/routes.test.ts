import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { setLoggerSink } from "../src/core/logger.js";
import { withCodingFailure } from "./helpers/fixtures.js";

setLoggerSink({ emit: () => {} });

describe("HTTP routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns service descriptor", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    // Stage 0.3: branded as "agent-spend-guard" via env config default.
    expect(body.service).toBe("agent-spend-guard");
    expect(body.version).toBe("0.5.2-beta");
    expect(body.mode).toBe("hosted-beta");
  });

  it("POST /v1/check returns 200 with structured result", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/check",
      payload: withCodingFailure(7),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pattern).toBe("stale_context_retry_storm");
    expect(["warn", "require_confirmation"]).toContain(body.decision);
    expect(body.detector_version).toMatch(/@/);
    expect(body.policy_version).toBe("policy@0.1.0");
  });

  it("POST /v1/check returns 400 VALIDATION_ERROR on malformed body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/check",
      payload: { actor: { type: "agent" } /* next_action missing */ },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("POST /v1/check-deep falls through to runCheck and honestly marks deep_check_used=false + deep_check_stub=true", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/check-deep",
      payload: withCodingFailure(7),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // No real deep check runs in Stage 0.1; only the rules-only result is
    // returned, so deep_check_used must be false. deep_check_stub flags that
    // the endpoint exists and the stub fallback fired.
    expect(body.deep_check_used).toBe(false);
    expect(body.deep_check_stub).toBe(true);
  });
});
