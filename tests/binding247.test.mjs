// connect247: the NEG-8 catalog (runner/sg4.mjs) binds the exact composed verifier bytes. This pins WHY that rebinding is
// sound: the verifier's envelope + content-manifest guard region, where the traversal entry is rejected, is byte-identical
// to the region of the reviewed a0ae1a verifier (sha256 below), and the schema binding is unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (b) => createHash("sha256").update(b).digest("hex");
test("247 NEG-8 guard region of the composed verifier equals the reviewed a0ae1a region; binding is exact", () => {
  const v = readFileSync(join(ROOT, "verifier/verify.mjs"), "utf8");
  const region = v.slice(v.indexOf("  // 1. envelope and content manifest"), v.indexOf("  // 2. file inventory"));
  assert.ok(region.length > 500, "guard region located");
  assert.equal(sha(region), "586fa128696bc4e38fb57ed3bde04d44abe7f2cc2e6c49b6cb4f6789d514e560", "envelope + content-manifest guard region changed: re-review NEG-8 before rebinding");
  const sg4 = readFileSync(join(ROOT, "runner/sg4.mjs"), "utf8");
  assert.ok(sg4.includes(`"verifier/verify.mjs": "${sha(readFileSync(join(ROOT, "verifier/verify.mjs")))}"`), "catalog binds the exact composed verifier bytes");
  assert.ok(sg4.includes(`"specifications/schemas/evidence-packet-manifest.schema.json": "${sha(readFileSync(join(ROOT, "specifications/schemas/evidence-packet-manifest.schema.json")))}"`), "schema binding exact and unchanged");
});
