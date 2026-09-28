// Reference-node regressions observable only in process: expired-token visibility (ASTRA-R3-03) and salted token
// storage (ASTRA-R3-05). Everything else is probed over HTTP by runner/regressions.mjs.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { generateKey } from "../lib/jws.mjs";
import { STATUS } from "../reference-node/http.mjs";
import { createNode } from "../reference-node/node.mjs";

function harness() {
  const k = generateKey("ref-test-a");
  const node = createNode({ baseUrl: "http://pc-test.localhost:4999", name: "pc-test", key: k.privateJwk, build: "git:test", deploymentId: "t", adminToken: "admin-token-for-tests" });
  const call = (method, path, { headers = {}, body = {}, query = {} } = {}) => {
    for (const [m, pattern, fn] of node.routes) {
      if (m !== method) continue;
      const names = [];
      const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)"))}$`);
      const hit = re.exec(path);
      if (!hit) continue;
      const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])]));
      try {
        return Promise.resolve(fn({ headers, params, body, query })).then((r) => ({ status: r.status ?? 200, body: r.body }));
      } catch (e) {
        if (!e.code || !(e.code in STATUS)) throw e;
        return Promise.resolve({ status: STATUS[e.code], body: { title: e.code } });
      }
    }
    throw new Error(`no route ${method} ${path}`);
  };
  return { node, call, admin: { authorization: "Bearer admin-token-for-tests" } };
}

test("ASTRA-R3-03: an expired participant token sees nothing of a private event", async (t) => {
  const { call, admin } = harness();
  const ev = (await call("POST", "/ilp/v1/admin/events", { headers: admin, body: { slug: "priv", title: "priv", visibility: "private" } })).body;
  const lp = (await call("POST", `/ilp/v1/admin/events/${ev.id}/local-participants`, { headers: admin })).body;
  const auth = { authorization: `Bearer ${lp.participant_token}` };
  assert.equal((await call("GET", `/ilp/v1/events/${ev.id}/feed`, { headers: auth, query: { since: "0" } })).status, 200, "live token reads its private feed");
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() + 11 * 86400 * 1000;
  for (const path of ["feed", "receipts"]) {
    const r = await call("GET", `/ilp/v1/events/${ev.id}/${path}`, { headers: auth, query: { since: "0" } });
    assert.equal(r.status, 404, `expired token read private ${path}: HTTP ${r.status}`);
  }
});

test("ASTRA-R3-05: tokens, credentials and retrieval keys are held only as salted verifiers", async () => {
  const { node, call, admin } = harness();
  const ev = (await call("POST", "/ilp/v1/admin/events", { headers: admin, body: { slug: "pub", title: "pub" } })).body;
  const lp = (await call("POST", `/ilp/v1/admin/events/${ev.id}/local-participants`, { headers: admin })).body;
  const cred = (await call("POST", "/ilp/v1/admin/credentials", { headers: admin, body: { kind: "operator", event: ev.id } })).body.credential;
  // authentication still works through the lookup prefix and salted verifier
  assert.equal((await call("GET", "/ilp/v1/auth/grant", { headers: { authorization: `Bearer ${lp.participant_token}` } })).status, 200);
  assert.equal((await call("GET", `/ilp/v1/events/${ev.id}/join-requests`, { headers: { authorization: `Bearer ${cred}` } })).status, 200);
  // a one-character change to the secret tail fails, even with the same lookup prefix
  const tamper = (s) => s.slice(0, -1) + (s.at(-1) === "A" ? "B" : "A");
  assert.equal((await call("GET", "/ilp/v1/auth/grant", { headers: { authorization: `Bearer ${tamper(lp.participant_token)}` } })).status, 401);
  // nothing the node holds for these secrets is the secret itself or its unsalted hash; each carries its own salt
  const { keys, records } = node.secretsAtRest();
  const held = JSON.stringify({ keys, records }, (k, v) => (Buffer.isBuffer(v) || v?.type === "Buffer" ? Buffer.from(v).toString("hex") : v));
  for (const s of [lp.participant_token, cred]) {
    assert.ok(!held.includes(s), "a secret is held in clear");
    assert.ok(!held.includes(createHash("sha256").update(s).digest("hex")), "a secret is held as an unsalted hash");
  }
  assert.ok(records.filter((r) => r.verifier).every((r) => /^[0-9a-f]{32}$/.test(r.verifier.salt)), "every verifier has a 128-bit salt");
  assert.ok(records.filter((r) => r.verifier).length >= 2);
});

test("SG2V2-EXPIRY-WRITE: rejecting an expired grant writes nothing; the status is derived on read", async (t) => {
  const { call, admin } = harness();
  const ev = (await call("POST", "/ilp/v1/admin/events", { headers: admin, body: { slug: "exp", title: "exp" } })).body;
  const lp = (await call("POST", `/ilp/v1/admin/events/${ev.id}/local-participants`, { headers: admin })).body;
  const auth = { authorization: `Bearer ${lp.participant_token}`, "ilp-grant": lp.grant };
  const status = async () => (await call("GET", "/ilp/v1/auth/grant", { headers: { authorization: auth.authorization } })).body.status;
  const feedLen = async () => (await call("GET", `/ilp/v1/events/${ev.id}/feed`, { query: { since: "0" } })).body.items.length;
  assert.equal(await status(), "active");
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() + 3600 * 1000; // past the grant's exp (+ skew), before the token's own expiry
  const before = await feedLen();
  const r = await call("POST", `/ilp/v1/events/${ev.id}/actions`, { headers: auth, body: { kind: "unconference.proposal", payload: { title: "late", content: "x" } } });
  assert.equal(r.body.title, "GRANT_EXPIRED");
  assert.equal(await feedLen(), before, "the rejected action wrote a feed record");
  // derived on read, and still derived (not persisted) once the clock returns
  assert.equal(await status(), "expired");
  Date.now = realNow;
  assert.equal(await status(), "active", "the rejection persisted an expired status");
});
