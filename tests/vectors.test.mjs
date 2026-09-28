// The reference library must agree with every published vector (R-CORE-37), and vectors must regenerate byte-identically.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../lib/jcs.mjs";
import { JwsError, verifyDetached, verifyJws } from "../lib/jws.mjs";
import { verifyReceiptChain } from "../lib/receipt.mjs";
import { validate } from "../lib/schemas.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const V = (name) => JSON.parse(readFileSync(join(ROOT, "vectors", name), "utf8"));
const SCHEMA_FOR = { claim: "identity-claim", grant: "authorization-grant", revocation: "revocation-record", attestation: "attestation" };

function jwsOutcome(c, keys) {
  try {
    const { payload } = verifyJws(c.jws, (kid, _h, p) => (keys[p.iss] ?? []).find((k) => k.kid === kid) ?? null, { typ: c.typ });
    return { code: "valid", payload };
  } catch (e) {
    if (e instanceof JwsError) return { code: e.code };
    throw e;
  }
}

test("JCS vectors", () => {
  for (const c of V("jcs.json").cases) {
    let out;
    try {
      out = canonicalize(JSON.parse(c.input));
    } catch {
      out = "reject";
    }
    assert.equal(out, c.expect, c.id);
  }
});

test("JWS vectors: good verify and validate against their schema; bad fail with the stated code", () => {
  const { keys, cases } = V("jws.json");
  for (const c of cases) {
    const got = jwsOutcome(c, keys);
    assert.equal(got.code, c.expect, `${c.id}: ${c.note ?? ""}`);
    if (got.code === "valid") {
      const r = validate(SCHEMA_FOR[c.kind], got.payload);
      assert.ok(r.ok, `${c.id} payload schema: ${r.errors.join("; ")}`);
    }
  }
});

test("Receipt vectors: the good chain verifies and validates; each bad chain is rejected", () => {
  const { good, bad } = V("receipts.json");
  const g = verifyReceiptChain(good.chain);
  assert.ok(g.ok, JSON.stringify(g.errors));
  assert.equal(g.head, good.head);
  for (const r of good.chain) assert.ok(validate("receipt", r).ok, `schema ${r.id}`);
  for (const b of bad) {
    if (b.expect === "schema_reject") {
      assert.ok(b.chain.some((r) => !validate("receipt", r).ok), b.id);
    } else {
      assert.equal(verifyReceiptChain(b.chain).ok, false, `${b.id}: ${b.note}`);
    }
  }
});

test("Detached-signature vectors", () => {
  const { keys, good, bad } = V("detached.json");
  const resolve = (o, signer) => (keys[signer] ?? []).find((k) => k.kid === o.kid);
  assert.ok(verifyDetached(good.object, resolve(good.object, good.signer)));
  assert.ok(validate("export-manifest", good.object).ok);
  for (const b of bad) {
    const jwk = resolve(b.object, b.signer);
    if (!jwk) {
      assert.equal(b.expect, "UNKNOWN_SIGNER", b.id);
      continue;
    }
    assert.throws(() => verifyDetached(b.object, jwk), (e) => e.code === b.expect, b.id);
  }
});

test("Credential binding vector", () => {
  const ctx = V("context.json");
  assert.equal(createHash("sha256").update(ctx.participant_token, "utf8").digest("base64url"), ctx.expected_binding);
});

test("Vectors, schemas, and profile regenerate byte-identically", () => {
  const files = ["vectors/jcs.json", "vectors/jws.json", "vectors/receipts.json", "vectors/detached.json", "vectors/context.json", "profile/pc-0.1-s1.json", "profile/pc-0.1-s1.sha256"];
  const before = files.map((f) => readFileSync(join(ROOT, f), "utf8"));
  for (const tool of ["gen-schemas.mjs", "gen-vectors.mjs", "gen-profile.mjs"]) execFileSync(process.execPath, [join(ROOT, "tools", tool)], { stdio: "ignore" });
  files.forEach((f, i) => assert.equal(readFileSync(join(ROOT, f), "utf8"), before[i], `${f} changed on regeneration`));
});
