#!/usr/bin/env node
// ILP conformance harness runner.
// - discovers cases/*.test.mjs, filters by --env tag, runs via node:test
// - --matrix: two-level traceability check.
//     Level 1 (SPEC coverage, must pass NOW): every R-id defined in the spec
//       suite is traced by a `traces:` line in tests/*.md (T-* case files,
//       the coverage supplement in 00-CONFORMANCE-PLAN.md, or T-ACCEPT.md),
//       or carries a [verify: …] tag on its trace line.
//     Level 2 (EXECUTABLE coverage, the builder's gate): every R-id is traced
//       by a `traces: [...]` literal inside cases/*.test.mjs. Reported always;
//       enforced only with --strict (G7 uses --matrix --strict).
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const args = new Set(argv);
const envArg = argv.includes("--env") ? argv[argv.indexOf("--env") + 1] : "single";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SPEC_ROOT = path.resolve(HERE, "..", "..");
const TESTS_DIR = path.resolve(HERE, "..");

const R_ID = /R-[A-Z]+-\d+[a-z]?/g;
// Expand "R-CORE-1..27" style ranges into individual ids.
function expandRanges(text) {
  return text.replace(/R-([A-Z]+)-(\d+)\.\.(\d+)/g, (_, area, a, b) => {
    const out = [];
    for (let i = Number(a); i <= Number(b); i++) out.push(`R-${area}-${i}`);
    return out.join(", ");
  });
}

async function mdFiles(dir, { skipHarness = true } = {}) {
  const found = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
        if (skipHarness && e.name === "harness") continue;
        if (e.name === "codex_helper" || e.name === "node_modules") continue;
        await walk(p);
      } else if (e.name.endsWith(".md")) found.push(p);
    }
  }
  await walk(dir);
  return found;
}

async function collectRequirementIds() {
  const ids = new Set();
  for (const p of await mdFiles(SPEC_ROOT)) {
    if (p.startsWith(TESTS_DIR)) continue; // tests trace, they don't define
    const text = await readFile(p, "utf8");
    for (const m of text.matchAll(/\*\*(R-[A-Z]+-\d+[a-z]?)\b/g)) ids.add(m[1]);
  }
  return ids;
}

async function collectSpecTraces() {
  // trace lines in tests/*.md: any line containing "traces:"; verify-tagged
  // lines count as exempt-style coverage too (they ARE the coverage record).
  const traced = new Set();
  for (const p of await mdFiles(TESTS_DIR, { skipHarness: true })) {
    const text = expandRanges(await readFile(p, "utf8"));
    for (const line of text.split("\n")) {
      if (!/traces:/.test(line)) continue;
      for (const id of line.matchAll(R_ID)) traced.add(id[0]);
    }
  }
  return traced;
}

async function collectExecutableTraces() {
  const traced = new Set();
  const casesDir = path.join(HERE, "cases");
  for (const f of (await readdir(casesDir).catch(() => []))) {
    if (!f.endsWith(".test.mjs")) continue;
    const text = expandRanges(await readFile(path.join(casesDir, f), "utf8"));
    for (const m of text.matchAll(/traces:\s*\[([^\]]*)\]/g))
      for (const id of m[1].matchAll(R_ID)) traced.add(id[0]);
  }
  return traced;
}

if (args.has("--matrix")) {
  const [ids, specTraced, execTraced] = await Promise.all([
    collectRequirementIds(), collectSpecTraces(), collectExecutableTraces()]);

  const specUncovered = [...ids].filter((id) => !specTraced.has(id)).sort();
  const execUncovered = [...ids].filter((id) => !execTraced.has(id)).sort();

  console.log(`requirements defined:   ${ids.size}`);
  console.log(`spec-traced (tests/*.md traces lines):   ${ids.size - specUncovered.length}/${ids.size}`);
  console.log(`executable-traced (harness cases):       ${ids.size - execUncovered.length}/${ids.size}`);

  if (specUncovered.length) {
    console.error(`\nSPEC COVERAGE GAPS (${specUncovered.length}) — must be zero:\n  ` +
      specUncovered.join("\n  "));
    process.exit(1);
  }
  console.log("spec-level matrix OK — every requirement is traced in tests/*.md");

  if (args.has("--strict")) {
    if (execUncovered.length) {
      console.error(`\nEXECUTABLE COVERAGE GAPS (${execUncovered.length}) — G7 requires zero:\n  ` +
        execUncovered.join("\n  "));
      process.exit(1);
    }
    console.log("executable matrix OK");
  } else if (execUncovered.length) {
    console.log(`note: ${execUncovered.length} requirements lack executable cases ` +
      `(expected until the builder fleshes out cases/; enforce with --strict at G7)`);
  }
  process.exit(0);
}

// run suites
const casesDir = path.join(HERE, "cases");
const files = (await readdir(casesDir).catch(() => []))
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => (envArg === "duo" ? true : f !== "fed.test.mjs"))
  .map((f) => path.join(casesDir, f));

if (!files.length) {
  console.error("no case files found — flesh out cases/ per tests/*.md");
  process.exit(1);
}
const child = spawn(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, ILP_ENV: envArg },
});
child.on("exit", (code) => process.exit(code ?? 1));
