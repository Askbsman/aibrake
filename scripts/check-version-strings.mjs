#!/usr/bin/env node
// Pre-publish guard: ensure every hardcoded version string in the
// codebase matches package.json#version. Stops the 0.5.4 → 0.5.11
// drift class of bugs at publish time.
//
// Run as part of `prepublishOnly`:
//   "prepublishOnly": "node scripts/check-version-strings.mjs && npm run build"

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const expected = pkg.version;

// Map of: source file → regex that should match expected version.
// If a file has the version string in multiple places, list each pattern.
const CHECKS = [
  {
    file: "src/cli/aibrake.ts",
    label: "CLI cmdVersion()",
    pattern: /console\.log\("aibrake ([0-9]+\.[0-9]+\.[0-9]+-beta)"\)/,
  },
  {
    file: "src/cli/mcp.ts",
    label: "MCP SERVER_VERSION",
    pattern: /const SERVER_VERSION = "([0-9]+\.[0-9]+\.[0-9]+-beta)"/,
  },
  {
    file: "src/config/env.ts",
    label: "Server serviceVersion",
    pattern: /serviceVersion: "([0-9]+\.[0-9]+\.[0-9]+-beta)"/,
  },
];

let failed = false;

for (const { file, label, pattern } of CHECKS) {
  const path = resolve(repoRoot, file);
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (e) {
    console.error(`✗ ${file} (${label}) — could not read: ${e.message}`);
    failed = true;
    continue;
  }
  const m = content.match(pattern);
  if (!m) {
    console.error(`✗ ${file} (${label}) — pattern not found`);
    failed = true;
    continue;
  }
  const found = m[1];
  if (found !== expected) {
    console.error(
      `✗ ${file} (${label}) — got "${found}", expected "${expected}" (from package.json)`
    );
    failed = true;
  } else {
    console.log(`✓ ${file} (${label}) — ${found}`);
  }
}

if (failed) {
  console.error("");
  console.error(`Version drift detected. Bump these locations to "${expected}" before publishing.`);
  process.exit(1);
}

console.log("");
console.log(`All version strings agree on ${expected}.`);
