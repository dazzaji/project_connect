// T-CORE cases — pattern example. Flesh out per ../../T-CORE.md.
// Each test declares its spec traceability in a `traces:` array literal that
// run.mjs --matrix greps. Keep the literal on one line.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(
  await readFile(new URL("../config.json", import.meta.url), "utf8"),
);
const A = config.A.base;

test("T-CORE-1 discovery document", { concurrency: false }, async () => {
  // traces: [R-CORE-20, R-CORE-21]
  const res = await fetch(`${A}/.well-known/interlateral.json`);
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.protocol, "ilp/1");
  assert.ok(Array.isArray(doc.keys) && doc.keys.length >= 1, "≥1 signing key");
  assert.ok(doc.keys.every((k) => k.crv === "Ed25519" && k.kid));
  for (const ep of ["api", "federation", "directory", "revocations"]) {
    assert.ok(doc.endpoints?.[ep], `endpoint ${ep} present`);
    const ping = await fetch(doc.endpoints[ep], { method: "GET" });
    assert.notEqual(ping.status, 404, `endpoint ${ep} resolves`);
  }
  const packIds = (doc.packs ?? []).map((p) => p.id);
  assert.ok(packIds.includes("unconference") && packIds.includes("parliamentary"));
});

test("T-CORE-3 UTF-8 byte fidelity", async () => {
  // traces: [R-CORE-1]
  const probe = "— → ✓ 你好 🜁 “quotes” …";
  // TODO(builder): create fixture event+token via lib/fixtures.mjs, submit a
  // proposal containing `probe`, read it back via the actions list, then:
  // assert.equal(fetchedTitle, probe)  // code-point-exact
  assert.ok(probe.length > 0, "flesh out with fixtures (see README)");
});

test("T-CORE-5 problem document shape", async () => {
  // traces: [R-CORE-9]
  const res = await fetch(`${A}/ilp/v1/events/00000000-0000-7000-8000-000000000000`);
  assert.ok([404, 403].includes(res.status));
  const body = await res.json();
  assert.match(body.type ?? "", /^urn:ilp:error:[A-Z0-9_]+$/);
  assert.equal(body.status, res.status);
  assert.ok(body.title);
});
