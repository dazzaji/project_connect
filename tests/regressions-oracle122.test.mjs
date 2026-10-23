// oracle122: assertion-strength regressions for two runner/regressions.mjs probes (verifier98 V4 findings). The exact
// probe bodies are extracted from the source text and driven with SYNTHETIC responses: no network, no product. These
// tests measure what the probes accept, not product behaviour. ORACLE122_SOURCE may point at another regressions.mjs
// (used to show the pre-repair probes accept the counterexamples).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, expectProblem, PC_ROOT } from "../runner/lib.mjs";

const SOURCE = process.env.ORACLE122_SOURCE ?? join(PC_ROOT, "runner", "regressions.mjs");
const src = readFileSync(SOURCE, "utf8");
function probe(id, scope) {
  const start = src.indexOf(`  async "${id}"(host) {`);
  assert.ok(start >= 0, `probe ${id} not found`);
  const body = src.slice(start, src.indexOf("\n  },", start) + 5);
  const names = Object.keys(scope);
  return new Function(...names, `return ({${body}})[${JSON.stringify(id)}];`)(...Object.values(scope));
}
const REG = { AUTH_MISSING: 401, AUTH_INVALID: 401, AUTH_REVOKED: 401, PAYLOAD_TOO_LARGE: 413 };
const problem = (code) => ({ status: REG[code], contentType: "application/problem+json", json: { type: `urn:ilp:error:${code}`, title: code, status: REG[code], detail: "synthetic" }, text: "synthetic" });

// ---- SG2R2-JOIN-ORDER: the invalid-session answers ----
const joinOrder = (sessionAnswer) => {
  let n = 0;
  const http = async (_m, _u, o = {}) => (o.headers?.cookie ? structuredClone(sessionAnswer(n++)) : problem(o.bearer ? "AUTH_INVALID" : "AUTH_MISSING"));
  return probe("SG2R2-JOIN-ORDER", { http, expectProblem, check })({ createEvent: async () => ({ id: "synthetic-private" }), base: "http://no-network.invalid" });
};

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
// observe / expectNoSideEffects / joinState are synthetic stand-ins with lib.mjs semantics over a synthetic event state;
// the live run uses the real lib.mjs helpers against the node's public feed/receipts and operator join listing
const oversize = (effect) => {
  const state = { feed: 0, receipts: 0, joins: [] };
  const observe = async () => ({ latest_seq: state.feed, receipts: state.receipts });
  const expectNoSideEffects = async (_n, _e, before, what) => { const after = await observe(); check(JSON.stringify(after) === JSON.stringify(before), `${what}: side effects observed`); };
  const joinState = async () => [...state.joins].sort();
  const http = async (method) => { if (method === "POST") effect(state); return problem("PAYLOAD_TOO_LARGE"); };
  const host = { base: "http://no-network.invalid", createEvent: async () => ({ id: "synthetic-event" }), credential: async () => "ilpo_synthetic" };
  return probe("ASTRA-R2-09", { http, expectProblem, check, observe, expectNoSideEffects, joinState })(host);
};

test("ASTRA-R2-09 rejects a correct PAYLOAD_TOO_LARGE that nevertheless wrote an action/receipt (verifier98 counterexample)", async () => {
  await assert.rejects(oversize((s) => { s.feed += 1; s.receipts += 1; }), /side effects/);
});
test("ASTRA-R2-09 rejects a hidden change of operator-visible admission state", async () => {
  await assert.rejects(oversize((s) => { s.joins.push("j1:pending"); }), /admission state changed/);
});
test("ASTRA-R2-09 keeps accepting the correct refusal with no effect", async () => {
  const r = await oversize(() => {});
  assert.equal(r.reported, "PAYLOAD_TOO_LARGE");
});
