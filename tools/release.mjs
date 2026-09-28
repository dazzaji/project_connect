// Writes specifications/releases/<version>.json: the release record pinning every normative artifact by SHA-256.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2] ?? JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const list = (dir, ext) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => join(ROOT, dir, f));
const files = [join(ROOT, "specifications", "ilp_spec.md"), ...list("specifications/schemas", ".json"), ...list("vectors", ".json"), join(ROOT, "profile", "pc-0.1-s1.json")];
const record = {
  version,
  status: "working-draft",
  date: new Date().toISOString().slice(0, 10),
  claim_label: "exploratory",
  artifacts: files.map((f) => ({ path: relative(ROOT, f), sha256: sha(f) })),
};
mkdirSync(join(ROOT, "specifications", "releases"), { recursive: true });
writeFileSync(join(ROOT, "specifications", "releases", `${version}.json`), JSON.stringify(record, null, 2) + "\n");
console.log(`release ${version}: ${record.artifacts.length} artifacts pinned`);
