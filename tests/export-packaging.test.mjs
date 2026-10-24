// Standalone service export packaging (review180): the exported tree must be self-contained. Every relative import and
// every file a package.json script or a shipped Markdown link names must be inside the export; the only bare dependencies
// are the declared ajv/ajv-formats; no checkout-local path, Beta script or private runtime file is shipped.
// Runs tools/export-service.mjs into a new temporary directory (no listener, no network). The directory is left in place.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { builtinModules } from "node:module";
import { dirname, join, normalize, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(mkdtempSync(join(tmpdir(), "pc-export-packaging-")), "export");
const run = spawnSync(process.execPath, [join(ROOT, "tools", "export-service.mjs"), OUT], { encoding: "utf8" });
const files = () => readFileSync(join(OUT, "MANIFEST.sha256"), "utf8").trim().split("\n").map((l) => l.split("  ")[1]);

test("export: the exporter succeeds and its manifest lists exactly the exported files", () => {
  assert.equal(run.status, 0, run.stderr);
  const listed = files();
  const walk = (d) => readdirSync(join(OUT, d)).flatMap((n) => { const r = d ? `${d}/${n}` : n; return statSync(join(OUT, r)).isDirectory() ? walk(r) : [r]; });
  assert.deepEqual(walk("").filter((f) => f !== "MANIFEST.sha256").sort(), [...listed].sort());
});

test("export: ships the harness-control token document and the tools its package scripts run", () => {
  const listed = new Set(files());
  for (const f of ["docs/harness-control-auth.md", "tools/gen-vectors.mjs", "tools/gen-schemas.mjs", "tools/export-service.mjs", "service/README.md", "service/examples/README.md"]) assert.ok(listed.has(f), f);
  assert.ok(!listed.has("runner/walkthrough.mjs"), "the Beta walkthrough script is not part of the service");
  const pkg = JSON.parse(readFileSync(join(OUT, "package.json"), "utf8"));
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const m of cmd.matchAll(/node(?: --[a-z-]+(?:=\S+)?)* (\S+\.mjs)/g)) {
      if (m[1].includes("*")) { const dir = dirname(m[1]); assert.ok(readdirSync(join(OUT, dir)).some((f) => f.endsWith(".test.mjs")), `script ${name}: no ${m[1]}`); }
      else assert.ok(listed.has(m[1]), `script ${name} runs ${m[1]}, which is not exported`);
    }
  }
});

test("export: every relative import resolves inside the export; bare imports are only the declared dependencies", () => {
  const pkg = JSON.parse(readFileSync(join(OUT, "package.json"), "utf8"));
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));
  assert.deepEqual([...declared].sort(), ["ajv", "ajv-formats"]);
  const builtins = new Set(builtinModules);
  for (const f of files().filter((x) => /\.(mjs|js)$/.test(x))) {
    const src = readFileSync(join(OUT, f), "utf8");
    for (const m of src.matchAll(/(?:^|\n)\s*import\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith("node:") || builtins.has(spec)) continue;
      if (spec.startsWith(".")) { const target = normalize(join(dirname(f), spec)); assert.ok(existsSync(join(OUT, target)), `${f} imports ${spec}, missing from the export`); continue; }
      assert.ok(declared.has(spec.split("/")[0]), `${f} imports undeclared package ${spec}`);
    }
  }
});

test("export: shipped Markdown links to repository files resolve; no checkout-local paths or token-shaped secrets", () => {
  for (const f of files().filter((x) => x.endsWith(".md"))) {
    const text = readFileSync(join(OUT, f), "utf8");
    for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      const target = normalize(join(dirname(f), m[1]));
      if (relative(".", target).startsWith("..")) continue; // a link above the export root is outside its scope
      assert.ok(existsSync(join(OUT, target)), `${f} links ${m[1]}, missing from the export`);
    }
  }
  for (const f of files().filter((x) => /\.(mjs|js|json|md)$/.test(x))) {
    const text = readFileSync(join(OUT, f), "utf8");
    assert.ok(!/\/Users\/|\/home\/[a-z]/.test(text), `${f} contains a checkout-local path`);
    // the only allowed token-shaped string is the public conformance-vector constant (tools/gen-vectors.mjs, vectors/*.json)
    const tokens = [...text.matchAll(/\b(?:ilph|ilpo|ilpf|ilpt)_[A-Za-z0-9_-]{24,}/g)].map((m) => m[0]).filter((t) => t !== "ilpt_VECTORONLY-0000000000000000000000000000");
    assert.deepEqual(tokens, [], `${f} contains a token-shaped secret`);
  }
});
