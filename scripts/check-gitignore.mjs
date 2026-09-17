#!/usr/bin/env node
/**
 * Flags tracked files that look secret-shaped, so a repo scan catches the
 * gap that made committing a secret possible in the first place, not just
 * the secret after the fact (gitleaks already does that part).
 *
 * A hint, not a gate: prints findings and exits non-zero only so it's
 * useful in a pre-commit hook if someone wires it up, but nothing in this
 * repo currently calls it automatically.
 */
import { execSync } from "node:child_process";

const SAFE_SUFFIXES = /\.(example|sample|template)$/i;

const SUSPECT_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /credentials.*\.json$/i,
  /service-account.*\.json$/i,
  /\.p12$/i,
  /id_rsa$/,
  /\.sqlite3?$/i, // dev DBs shouldn't be tracked either
];

const tracked = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const hits = tracked.filter((f) => {
  const base = f.split("/").pop();
  if (SAFE_SUFFIXES.test(base)) return false;
  return SUSPECT_PATTERNS.some((re) => re.test(base));
});

if (hits.length === 0) {
  console.log("check-gitignore: no secret-shaped tracked files found.");
  process.exit(0);
}

console.log("check-gitignore: these tracked files look secret-shaped — verify they should be committed:");
for (const f of hits) console.log(`  ${f}`);
process.exit(1);
