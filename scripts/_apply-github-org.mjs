#!/usr/bin/env node
// Final placeholder swap: your-username/aibrake → Askbsman/aibrake.
// Run once after rebrand, delete after commit.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "validation-log", "logs", ".vitest", "coverage", "build"]);
const SKIP_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".docx", ".pyc", ".log"]);

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

const FROM = "your-username/aibrake";
const TO = "Askbsman/aibrake";

let changed = 0;
for (const abs of walk(repoRoot)) {
  const r = abs.slice(repoRoot.length + 1).replaceAll("\\", "/");
  const ext = r.slice(r.lastIndexOf("."));
  if (SKIP_EXTS.has(ext)) continue;
  if (r === "scripts/_apply-github-org.mjs") continue; // self
  let content;
  try { content = readFileSync(abs, "utf8"); } catch { continue; }
  if (!content.includes(FROM)) continue;
  writeFileSync(abs, content.split(FROM).join(TO), "utf8");
  changed += 1;
  console.log(`  ${r}`);
}
console.log(`\n${changed} files updated.`);
