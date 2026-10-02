#!/usr/bin/env node
/**
 * Performance budget gate (Readiness List §11).
 *
 * A large share of this user base is on lower-end Android devices over
 * mobile data. Bundle size there is not a nicety: it is the difference
 * between an app that opens and one that people give up on. Budgets only
 * work if something enforces them, because every individual dependency
 * looks affordable in isolation and the regression is always gradual.
 *
 * Reads Next's own build manifest rather than measuring the .next directory,
 * so the number matches what a browser actually downloads for a route
 * (shared chunks counted once) rather than what happens to be on disk.
 *
 * Usage: node scripts/check-bundle-budget.mjs <app-dir> [--budget-kb=N]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const appDir = args.find((a) => !a.startsWith("--"));

if (!appDir) {
  console.error("Usage: node scripts/check-bundle-budget.mjs <app-dir> [--budget-kb=N]");
  process.exit(2);
}

// Budget is on GZIPPED bytes, because that is what actually crosses the
// network and therefore what a user on metered mobile data pays for and
// waits on. Measuring raw bytes on disk overstates the real cost by roughly
// 3x and would produce a budget that either fails everything on day one or
// gets quietly disabled.
//
// 200 KB gzipped of first-load JavaScript. Chosen against the target device
// rather than a blog post: on a low-end Android over 3G that is a few
// seconds to interactive. The public app currently sits near 175 KB, so
// this is real headroom rather than an aspiration — tight enough to catch a
// careless dependency, loose enough not to block ordinary work.
//
// Raise it deliberately, with a reason, never to make a build pass.
const DEFAULT_BUDGET_KB = 200;
const budgetArg = args.find((a) => a.startsWith("--budget-kb="));
const budgetKb = budgetArg ? Number(budgetArg.split("=")[1]) : DEFAULT_BUDGET_KB;

const manifestPath = path.join(appDir, ".next", "app-build-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`No build manifest at ${manifestPath} — run 'next build' first.`);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pages = manifest.pages || {};

// Gzipped size, cached per file — shared chunks appear on most routes and
// re-compressing them per route would make this needlessly slow.
const gzipCache = new Map();

function sizeOf(file) {
  if (gzipCache.has(file)) return gzipCache.get(file);
  const full = path.join(appDir, ".next", file);
  let size = 0;
  try {
    size = zlib.gzipSync(fs.readFileSync(full), { level: 9 }).length;
  } catch {
    size = 0;
  }
  gzipCache.set(file, size);
  return size;
}

const results = [];
for (const [route, files] of Object.entries(pages)) {
  const jsFiles = files.filter((f) => f.endsWith(".js"));
  // Deduplicated: a shared chunk is downloaded once, so counting it per
  // route would overstate every page and make the budget meaningless.
  const unique = [...new Set(jsFiles)];
  const bytes = unique.reduce((sum, f) => sum + sizeOf(f), 0);
  results.push({ route, kb: bytes / 1024, chunks: unique.length });
}

results.sort((a, b) => b.kb - a.kb);

console.log(`\nFirst-load JavaScript per route — ${appDir}`);
console.log(`Budget: ${budgetKb} KB gzipped (what actually crosses the network)\n`);

let failed = 0;
for (const { route, kb, chunks } of results) {
  const over = kb > budgetKb;
  if (over) failed += 1;
  const marker = over ? "OVER  " : "ok    ";
  console.log(`  ${marker} ${kb.toFixed(1).padStart(8)} KB  ${String(chunks).padStart(3)} chunks  ${route}`);
}

if (failed > 0) {
  console.error(
    `\n${failed} route(s) exceed the ${budgetKb} KB budget.\n` +
      "Reduce what those routes import, or raise the budget deliberately with a stated reason.\n" +
      "Common causes: a map or chart library imported at module scope instead of dynamically,\n" +
      "or a client component that only needed to be a server component.\n",
  );
  process.exit(1);
}

console.log(`\nAll ${results.length} route(s) within budget.\n`);
