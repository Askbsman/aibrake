#!/usr/bin/env node
// Quick DNS-based domain availability filter.
//
// Usage:
//   npm run check:domains
//   npm run check:domains -- --tlds=com,dev,ai,io
//   npm run check:domains -- --names=loopkit,halt,loopless
//
// What it does:
//   For each <name>.<tld> candidate, runs:
//     - DNS NS lookup (does anyone own this zone?)
//     - DNS A  lookup (is there a parked page?)
//     - Reports MAYBE FREE / LIKELY TAKEN / UNKNOWN
//
// Caveat: this is a 30-second filter, not WHOIS truth.
//   * Registered-but-parked → has NS, reads as "taken" (correct).
//   * Registered-no-DNS     → no records, reads as "free" (false positive).
//   * Freshly-expired       → may show stale NS for hours (false positive in either direction).
//   Final check should always be a real registrar lookup (Namecheap / Porkbun).
//
// Exit code 0 always — this is a filter, not a gate.

import { Resolver } from "node:dns/promises";

const args = process.argv.slice(2);
function arg(name, def) {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : def;
}

const DEFAULT_NAMES = [
  // Direction A — keep "Agent Spend Guard", shorter domain
  "spendguard", "agentguard", "asg", "aspend", "nospend",
  // Direction B — invented / one-word rebrand
  "halt", "loopkit", "loopless", "reroute", "veer", "cinch", "vet",
  "trim", "pivly", "quench", "curb", "sift", "reverb", "spendly",
  "echo", "no7th",
  // Direction C — sound-driven coined
  "halto", "pauly", "veerly", "loopa", "brakefly", "stallium", "curbex",
  // Current
  "agentspendguard", "spending-guard",
];

const DEFAULT_TLDS = ["com", "dev", "ai", "io"];

const names = arg("names", "").length ? arg("names", "").split(",") : DEFAULT_NAMES;
const tlds = arg("tlds", "").length ? arg("tlds", "").split(",") : DEFAULT_TLDS;

// Use a fast public resolver so we don't depend on the OS resolver caching.
const resolver = new Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

async function lookup(domain) {
  let hasNS = false;
  let hasA = false;
  let errors = [];

  try {
    const ns = await resolver.resolveNs(domain);
    if (Array.isArray(ns) && ns.length > 0) hasNS = true;
  } catch (err) {
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") {
      errors.push(`NS:${err.code}`);
    }
  }

  try {
    const a = await resolver.resolve4(domain);
    if (Array.isArray(a) && a.length > 0) hasA = true;
  } catch (err) {
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") {
      errors.push(`A:${err.code}`);
    }
  }

  let verdict;
  if (hasNS || hasA) {
    verdict = "LIKELY TAKEN";
  } else if (errors.length > 0) {
    verdict = "UNKNOWN";
  } else {
    verdict = "MAYBE FREE";
  }

  return { domain, hasNS, hasA, errors, verdict };
}

async function main() {
  console.log("");
  console.log(`Probing ${names.length} names × ${tlds.length} TLDs = ${names.length * tlds.length} candidates`);
  console.log("(DNS-only filter; final check at the registrar)");
  console.log("");

  const allDomains = [];
  for (const n of names) for (const t of tlds) allDomains.push(`${n}.${t}`);

  // Throttle: 20 concurrent DNS queries.
  const results = [];
  for (let i = 0; i < allDomains.length; i += 20) {
    const chunk = allDomains.slice(i, i + 20);
    const r = await Promise.all(chunk.map(lookup));
    results.push(...r);
  }

  // Group by verdict for readability.
  const free = results.filter((r) => r.verdict === "MAYBE FREE");
  const taken = results.filter((r) => r.verdict === "LIKELY TAKEN");
  const unknown = results.filter((r) => r.verdict === "UNKNOWN");

  if (free.length > 0) {
    console.log("─".repeat(72));
    console.log(`MAYBE FREE (${free.length})  — check these on a registrar first`);
    console.log("─".repeat(72));
    free.sort((a, b) => a.domain.localeCompare(b.domain));
    for (const r of free) console.log(`  ${r.domain.padEnd(28)}`);
    console.log("");
  }

  if (unknown.length > 0) {
    console.log("─".repeat(72));
    console.log(`UNKNOWN (${unknown.length})  — DNS error, retry or check manually`);
    console.log("─".repeat(72));
    for (const r of unknown) console.log(`  ${r.domain.padEnd(28)}  ${r.errors.join(", ")}`);
    console.log("");
  }

  if (taken.length > 0) {
    console.log("─".repeat(72));
    console.log(`LIKELY TAKEN (${taken.length})`);
    console.log("─".repeat(72));
    taken.sort((a, b) => a.domain.localeCompare(b.domain));
    for (const r of taken) {
      const flags = [];
      if (r.hasNS) flags.push("NS");
      if (r.hasA) flags.push("A");
      console.log(`  ${r.domain.padEnd(28)}  ${flags.join("+")}`);
    }
    console.log("");
  }

  console.log("─".repeat(72));
  console.log(`Summary: ${free.length} maybe free · ${taken.length} taken · ${unknown.length} unknown`);
  console.log("─".repeat(72));
  console.log("");
  console.log("Next: verify the top 3-5 MAYBE FREE candidates at Namecheap or Porkbun.");
  console.log("DNS state can lag WHOIS by hours, so trust the registrar's answer over this script.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
