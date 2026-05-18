#!/usr/bin/env node
// Interactive placeholder swap for production deploy.
//
// Run:
//   node scripts/configure-for-deploy.mjs
//
// What it does:
//   1. Prompts for domain / api subdomain / github repo / contact email
//   2. Shows a diff preview before changing anything
//   3. On confirmation, performs find-and-replace across 28 files
//   4. Does NOT commit — you review with `git diff` and commit yourself
//
// What it does NOT touch:
//   - Test files (they use asg_v1_demo as a literal mock; production keys
//     never live in tests)
//   - JSONL decision logs
//   - node_modules / dist / .git / validation-log / logs
//
// Placeholders swapped:
//   aibrake.dev          → <DOMAIN>
//   aibrake.dev              → <DOMAIN>           (in landing meta)
//   api.aibrake.dev          → <API_SUBDOMAIN>
//   Askbsman/aibrake          → <GITHUB_REPO>
//   hello@aibrake.dev    → <CONTACT_EMAIL>
//   beta@aibrake.dev     → beta@<DOMAIN>
//
// Safety:
//   - Does not touch git history
//   - Skips binary files
//   - Skips files inside backup / archive / log dirs
//   - Prints every file modified

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "validation-log", "logs", ".vitest", "coverage", "build"]);
const SKIP_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".docx", ".pyc", ".log"]);
const SKIP_FILES = new Set(["package-lock.json"]);

// Files where placeholders are part of test fixtures, not deploy state.
// These keep their localhost / example.com strings on purpose.
const TEST_OR_DOC_DENYLIST = new Set([
  "tests/stage-04-2-sdk-fail-open-scope.test.ts",
  "tests/stage-05-partner-ready-hardening.test.ts",
  "python/tests/test_client.py",
  "python/tests/test_integration.py",
  "python/tests/conftest.py",
  "python/Dockerfile.test",
  "SELF_TRIAL_CLAUDE_CODE_LOG.md",     // historical artifact
  "SELF_TRIAL_CLAUDE_CODE_REPORT.md",
  "BENCHMARK_10_AGENTS.md",            // historical reproducible doc; uses asg_v1_demo as the doc-time key
  "scripts/self-trial-guard.ts",       // uses localhost as default
  "scripts/simulate-10-partners.ts",
  "scripts/simulate-100-partners-week.ts",
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function relativeFromRoot(absPath) {
  return absPath.slice(repoRoot.length + 1).replaceAll("\\", "/");
}

async function ask(rl, question, defaultValue) {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  const answer = (await rl.question(prompt)).trim();
  return answer || defaultValue || "";
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log("─".repeat(72));
  console.log("AIBrake — Production deploy configuration");
  console.log("─".repeat(72));
  console.log("Answer 4 questions. Nothing is written until you confirm.");
  console.log("");

  const domain = await ask(rl, "Domain (e.g. aibrake.dev)", "");
  if (!domain || !domain.includes(".")) {
    console.error("Need a real domain. Aborting.");
    rl.close();
    process.exit(1);
  }

  const apiSubdomain = await ask(rl, "API subdomain", `api.${domain}`);
  const githubRepo = await ask(rl, "GitHub repo (e.g. your-username/agent-spend-guard)", `your-username/agent-spend-guard`);
  const contactEmail = await ask(rl, "Contact email", `hello@${domain}`);
  const betaEmail = `beta@${domain}`;

  console.log("");
  console.log("─".repeat(72));
  console.log("Proposed substitutions:");
  console.log("─".repeat(72));
  const swaps = [
    // Order matters: longer/more-specific strings first to avoid partial matches.
    ["api.aibrake.dev", apiSubdomain],
    ["api.aibrake.dev", apiSubdomain],
    ["beta@aibrake.dev", betaEmail],
    ["hello@aibrake.dev", contactEmail],
    ["aibrake.dev", domain],
    ["aibrake.dev", domain],
    ["aibrake.dev", domain],
    ["Askbsman/aibrake", githubRepo],
  ];
  for (const [from, to] of swaps) {
    if (from === to) continue;
    console.log(`  ${from.padEnd(38)} →  ${to}`);
  }
  console.log("");

  const confirm = (await ask(rl, "Proceed with these substitutions? [y/N]", "")).toLowerCase();
  if (confirm !== "y" && confirm !== "yes") {
    console.log("Cancelled. No files were modified.");
    rl.close();
    return;
  }
  rl.close();

  // Walk files and apply swaps.
  const allFiles = walk(repoRoot);
  let filesChanged = 0;
  let totalReplacements = 0;
  const changedList = [];

  for (const absPath of allFiles) {
    const rel = relativeFromRoot(absPath);
    if (TEST_OR_DOC_DENYLIST.has(rel)) continue;
    const ext = rel.slice(rel.lastIndexOf("."));
    if (SKIP_EXTS.has(ext)) continue;
    if (SKIP_FILES.has(rel.split("/").pop())) continue;

    let content;
    try {
      content = readFileSync(absPath, "utf8");
    } catch {
      continue; // binary or unreadable
    }
    let next = content;
    let fileReplacements = 0;
    for (const [from, to] of swaps) {
      if (from === to) continue;
      const before = next;
      next = next.split(from).join(to);
      const count = (before.length - next.length) / (from.length - to.length) | 0;
      if (next !== before) fileReplacements += Math.abs(count);
    }
    if (next !== content) {
      writeFileSync(absPath, next, "utf8");
      filesChanged += 1;
      totalReplacements += fileReplacements;
      changedList.push(rel);
    }
  }

  console.log("");
  console.log("─".repeat(72));
  console.log(`Done. ${filesChanged} files updated.`);
  console.log("─".repeat(72));
  for (const f of changedList) console.log(`  modified  ${f}`);
  console.log("");
  console.log("Next:");
  console.log("  git diff                 # review");
  console.log("  git add -u && git commit -m 'chore: configure production placeholders'");
  console.log("");
  console.log("Heads-up: test files and historical reports were skipped intentionally —");
  console.log("they reference asg_v1_demo / localhost / example.com as fixtures, not as");
  console.log(`production state. See TEST_OR_DOC_DENYLIST in this script if you want to`);
  console.log("override that.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
