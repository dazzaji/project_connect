#!/usr/bin/env node
// Export the standalone Connect job service (service + real runner + reference node + profile + specification schemas)
// into an empty directory, with a sorted SHA-256 manifest. The export contains no Beta code and reads no Beta checkout.
//
//   node tools/export-service.mjs DEST        (DEST must not exist)
//   cd DEST && npm ci --offline   # or copy node_modules: the only dependencies are ajv and ajv-formats (package-lock.json)
//
// The manifest digest (printed, and the sha256 of DEST/MANIFEST.sha256) identifies the exported source bytes.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = process.argv[2];
if (!dest) { console.error("usage: node tools/export-service.mjs DEST"); process.exit(2); }
if (existsSync(dest)) { console.error(`${dest} exists; refusing to write into it`); process.exit(2); }
// every first-party module the service and runner import transitively (closure42 C42-1: packet/ and verifier/ were missing)
const INCLUDE = ["package.json", "package-lock.json", "LICENSE", "lib", "reference-node", "runner", "packet", "verifier", "profile", "specifications/ilp_spec.md", "specifications/schemas", "service", "tests/service", "tests/core-service-profile.test.mjs", "docs/core-service-profile.md", "tests/export-provenance.test.mjs", "tests/fixtures", "docs/export-provenance-verification.md", "tools/export-service.mjs",
  // connect242 (review180 packaging): the harness-control token document the service README/examples refer to, and the two
  // generator tools the exported package.json scripts ("vectors", "schemas") run; both import only lib/ (exported)
  "docs/harness-control-auth.md", "tools/gen-vectors.mjs", "tools/gen-schemas.mjs"];
// runner/walkthrough.mjs is a Beta-harness walkthrough script (it names a Beta checkout path); it is not part of the service
const EXCLUDE = new Set(["runner/walkthrough.mjs"]);
mkdirSync(dest, { recursive: true });
const files = [];
const walk = (rel) => {
  const abs = join(ROOT, rel);
  if (statSync(abs).isDirectory()) { for (const f of readdirSync(abs).sort()) if (f !== ".DS_Store") walk(join(rel, f)); return; }
  if (EXCLUDE.has(rel)) return;
  mkdirSync(dirname(join(dest, rel)), { recursive: true });
  cpSync(abs, join(dest, rel));
  files.push(rel);
};
for (const rel of INCLUDE) walk(rel);
const manifest = files.sort().map((f) => `${createHash("sha256").update(readFileSync(join(dest, f))).digest("hex")}  ${f}`).join("\n") + "\n";
writeFileSync(join(dest, "MANIFEST.sha256"), manifest);
console.log(`${files.length} files → ${relative(process.cwd(), dest) || dest}; manifest sha256 ${createHash("sha256").update(manifest).digest("hex")}`);
