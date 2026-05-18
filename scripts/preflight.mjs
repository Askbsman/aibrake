#!/usr/bin/env node
// Pre-deploy preflight check.
//
// Run:
//   npm run preflight
//
// What it does (in order, fails fast on any red):
//   1. TypeScript compile (`npm run typecheck`)
//   2. TypeScript unit + integration tests (`npm test`)
//   3. Production build (`npm run build`)
//   4. Boots the built server on a free port
//   5. Smoke: GET /health, GET /v1/meta, GET /v1/public/stats, POST /v1/check
//   6. Shuts the server down cleanly
//   7. Reports green/red
//
// Does NOT run Python tests automatically — the maintainer machine may not
// have Python on PATH. If you have py / python3 available, run them
// separately: `cd python && py -m pytest`.
//
// Exit codes:
//   0 — all green
//   1 — any step failed (with detail)
//   2 — server died during smoke

import { spawnSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");

function section(label) {
  console.log("");
  console.log("─".repeat(72));
  console.log(label);
  console.log("─".repeat(72));
}

function run(label, cmd, args, opts = {}) {
  section(label);
  const r = spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} FAILED (exit ${r.status})`);
    process.exit(1);
  }
  console.log(`\n✓ ${label} OK`);
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function waitForHealth(url, deadlineMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      // not ready yet
    }
    await sleep(300);
  }
  throw new Error(`server did not become ready at ${url} within ${deadlineMs}ms`);
}

async function smokeTest(baseUrl, apiKey) {
  section("4. Smoke test");

  // 4a. /health
  const health = await fetch(`${baseUrl}/health`).then((r) => r.json());
  if (!health.ok) throw new Error("health check failed");
  console.log(`  /health           → ok=${health.ok} version=${health.version}`);

  // 4b. /v1/meta (authed)
  const meta = await fetch(`${baseUrl}/v1/meta`, {
    headers: { authorization: `Bearer ${apiKey}` },
  }).then((r) => r.json());
  if (!meta.endpoints || !meta.endpoints.public_stats) throw new Error("/v1/meta missing endpoints.public_stats");
  if (!meta.default_downgrade_map || meta.default_downgrade_map.length === 0)
    throw new Error("/v1/meta missing default_downgrade_map");
  console.log(`  /v1/meta          → name="${meta.name}" patterns=${meta.supported_patterns.length}`);

  // 4c. /v1/public/stats
  const stats = await fetch(`${baseUrl}/v1/public/stats`).then((r) => r.json());
  if (typeof stats.total_checks !== "number") throw new Error("/v1/public/stats malformed");
  console.log(
    `  /v1/public/stats  → total_checks=${stats.total_checks} savings=$${stats.total_savings_offered_usd}`
  );

  // 4d. POST /v1/check — a real allow case
  const allowResp = await fetch(`${baseUrl}/v1/check`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      actor: { type: "agent", runtime: "preflight" },
      next_action: { type: "paid_llm_call", estimated_cost: { amount: 0.05, currency: "USD" } },
    }),
  }).then((r) => r.json());
  if (allowResp.decision !== "allow") throw new Error(`expected allow on cold-start, got ${allowResp.decision}`);
  console.log(`  POST /v1/check    → decision=${allowResp.decision} (cold-start) ✓`);

  // 4e. POST /v1/check — a retry storm case (should require_confirmation)
  const stormResp = await fetch(`${baseUrl}/v1/check`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      actor: { type: "agent", runtime: "preflight" },
      next_action: {
        type: "paid_llm_call",
        model: "claude-opus-4.5",
        estimated_cost: { amount: 0.42, currency: "USD" },
        model_tier: "premium",
      },
      history: {
        attempt_number: 7,
        same_action_count: 6,
        paid_attempts_on_same_failure: 6,
        failure_signal_present: true,
        failure_signal_type: "test_failure",
        failure_fingerprint: "fp_v1_preflight_storm",
        same_failure_count: 6,
        new_evidence_since_last_attempt: false,
        evidence_kind: "code",
        evidence_signals: {
          files_read_since_last_attempt: 0,
          tests_run_since_last_attempt: 0,
          context_source_confirmed: false,
        },
      },
      telemetry_quality: { completeness: "high" },
    }),
  }).then((r) => r.json());
  if (stormResp.decision !== "require_confirmation")
    throw new Error(`expected require_confirmation on storm, got ${stormResp.decision}`);
  if (!stormResp.projected_savings || stormResp.projected_savings.amount_usd <= 0)
    throw new Error("storm response missing projected_savings");
  console.log(
    `  POST /v1/check    → decision=${stormResp.decision} pattern=${stormResp.pattern} savings=$${stormResp.projected_savings.amount_usd} ✓`
  );

  console.log("\n✓ Smoke test OK");
}

async function main() {
  console.log("AIBrake — preflight\n");

  // 1. Typecheck
  run("1. TypeScript typecheck", "npm", ["run", "typecheck"]);

  // 2. Tests
  run("2. TypeScript test suite", "npm", ["test"]);

  // 3. Production build
  run("3. Production build (tsc)", "npm", ["run", "build"]);

  // 4. Boot, smoke, shut down
  section("4. Boot dist/server.js for smoke test");
  const PORT = 8090;
  const API_KEY = "asg_v1_preflight";
  const server = spawn(
    "node",
    ["dist/server.js"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(PORT),
        AGENT_SPEND_GUARD_AUTH_MODE: "required",
        AGENT_SPEND_GUARD_API_KEYS: API_KEY,
        AGENT_SPEND_GUARD_LOG_SINK: "none",
      },
      stdio: "ignore",
    }
  );
  const baseUrl = `http://127.0.0.1:${PORT}`;
  let failure = null;
  try {
    await waitForHealth(`${baseUrl}/health`, 10000);
    console.log(`  server up on :${PORT}`);
    await smokeTest(baseUrl, API_KEY);
  } catch (err) {
    failure = err;
  } finally {
    server.kill();
  }
  if (failure) {
    console.error(`\n✗ ${failure.message}`);
    process.exit(2);
  }

  // 5. Done
  section("PREFLIGHT GREEN");
  console.log("  TS typecheck ✓");
  console.log("  TS tests     ✓");
  console.log("  Build        ✓");
  console.log("  Smoke        ✓");
  console.log("");
  console.log("Ready to deploy. See PRODUCTION_DEPLOY_RUNBOOK.md § Phase 2.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
