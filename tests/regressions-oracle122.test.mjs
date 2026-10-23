// oracle122: assertion-strength regressions for two runner/regressions.mjs probes (verifier98 V4 findings). The exact
// probe bodies are extracted from the source text and driven with SYNTHETIC responses: no network, no product. These
// tests measure what the probes accept, not product behaviour. ORACLE122_SOURCE may point at another regressions.mjs
// (used to show the pre-repair probes accept the counterexamples).
import test from "node:test";
import assert from "node:assert/strict";
import { joinOrder as actualJoinOrder, oversize as actualOversize, feed, receipt, join as joinRow } from "./oracle140-fixtures.mjs";
const REG = { AUTH_MISSING: 401, AUTH_INVALID: 401, AUTH_REVOKED: 401, PAYLOAD_TOO_LARGE: 413 };
const problem = (code) => ({ status: REG[code], contentType: "application/problem+json", json: { type: `urn:ilp:error:${code}`, title: code, status: REG[code], detail: "synthetic" }, text: "synthetic" });

// ---- SG2R2-JOIN-ORDER: the invalid-session answers ----
const joinOrder = actualJoinOrder;

test("SG2R2-JOIN-ORDER rejects a 401 that is not a registered ILP problem envelope (verifier98 counterexample)", async () => {
  const malformed = { status: 401, contentType: "text/html", json: { title: "UNREGISTERED_SYNTHETIC_CODE" }, text: "not an ILP problem" };
  await assert.rejects(joinOrder(() => malformed));
});
test("SG2R2-JOIN-ORDER rejects a registered 401 code that is not the credential step's (AUTH_REVOKED on both)", async () => {
  await assert.rejects(joinOrder(() => problem("AUTH_REVOKED")));
});
test("SG2R2-JOIN-ORDER rejects different answers for the private and the absent event (existence oracle)", async () => {
  await assert.rejects(joinOrder((i) => problem(i === 0 ? "AUTH_INVALID" : "AUTH_MISSING")));
});
test("SG2R2-JOIN-ORDER keeps accepting the correct answers (AUTH_INVALID or AUTH_MISSING, identical, full envelope)", async () => {
  for (const code of ["AUTH_INVALID", "AUTH_MISSING"]) {
    const r = await joinOrder(() => problem(code));
    assert.deepEqual(r, { unauthenticated: "AUTH_MISSING", invalid_bearer: "AUTH_INVALID", invalid_session: code });
  }
});

// ---- ASTRA-R2-09: no effect from an oversized payload ----
// oracle140 retains these seven assertions but now executes the real HTTP/observer/probe bodies.
const oversize = effect => actualOversize({ effect });

test("ASTRA-R2-09 rejects a correct PAYLOAD_TOO_LARGE that nevertheless wrote an action/receipt (verifier98 counterexample)", async () => {
  await assert.rejects(oversize((s) => { s.feed.items.push(feed()); s.feed.latest_seq=1; s.receipts.items.push(receipt()); }), /side effects/);
});
test("ASTRA-R2-09 rejects a hidden change of operator-visible admission state", async () => {
  await assert.rejects(oversize((s) => { s.joins.items.push(joinRow()); }), /admission state changed/);
});
test("ASTRA-R2-09 keeps accepting the correct refusal with no effect", async () => {
  const r = await oversize(() => {});
  assert.equal(r.reported, "PAYLOAD_TOO_LARGE");
});
