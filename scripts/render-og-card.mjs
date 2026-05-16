#!/usr/bin/env node
// Render web/og-card.svg → web/og-card.png at 1200×630.
//
// Why this script exists:
//   Most social crawlers (Twitter, Facebook, LinkedIn, Slack) do NOT render
//   SVG as og:image — they want PNG or JPG. We ship the SVG as the source
//   of truth (versionable, editable in any text editor), and rasterize to
//   PNG before deploying.
//
// Dependency: @resvg/resvg-js (pure-WASM SVG renderer, ~3 MB, no native
// bindings). This script does NOT install it for you — it's intentionally
// an opt-in tool so the main package stays light.
//
// One-time setup:
//   npm install --save-dev @resvg/resvg-js
//
// Run:
//   node scripts/render-og-card.mjs
//   # or
//   npm run render:og   (if you wire a package.json script)
//
// After running, swap the og:image meta in web/index.html from .svg to .png:
//   <meta property="og:image"   content="https://yoursite.com/og-card.png" />
//   <meta name="twitter:image"  content="https://yoursite.com/og-card.png" />

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");
const svgPath = resolve(repoRoot, "web", "og-card.svg");
const pngPath = resolve(repoRoot, "web", "og-card.png");

let Resvg;
try {
  ({ Resvg } = await import("@resvg/resvg-js"));
} catch (err) {
  console.error("");
  console.error("  Missing dev dependency: @resvg/resvg-js");
  console.error("");
  console.error("  This script needs a WASM SVG renderer. Install it once:");
  console.error("");
  console.error("    npm install --save-dev @resvg/resvg-js");
  console.error("");
  console.error("  Then re-run:");
  console.error("");
  console.error("    node scripts/render-og-card.mjs");
  console.error("");
  process.exit(1);
}

const svg = readFileSync(svgPath, "utf8");

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  background: "#0b0d10",
  font: {
    // Use system fonts; the OG card text falls back gracefully through
    // -apple-system / Segoe UI / Inter / sans-serif. If the rendered text
    // looks off on your machine, install Inter or set loadSystemFonts: true.
    loadSystemFonts: true,
  },
});

const png = resvg.render();
const pngBuffer = png.asPng();
writeFileSync(pngPath, pngBuffer);

const sizeKb = (pngBuffer.length / 1024).toFixed(1);
console.log(`✓ Wrote ${pngPath} (1200×630, ${sizeKb} KB)`);
console.log(`  Next: update <meta property="og:image"> in web/index.html`);
console.log(`        from "/og-card.svg" to "/og-card.png".`);
