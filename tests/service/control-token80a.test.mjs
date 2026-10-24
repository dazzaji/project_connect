// 80a: per-target harness-control-v1 control tokens. Tokens come only from the job's credential file map (target id →
// { control_token }), go as Bearer only to that target's registered control origin, never follow redirects, and never
// appear in errors, results or adapter objects. Targets without a token keep the legacy unauthenticated calls.
// Fake harness control APIs on ephemeral loopback ports (port 0); no targets, no database.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { keyDrillPerTarget, targetAdapters } from "../../runner/service-run.mjs";
import { SG3_TESTS } from "../../runner/tests-sg3.mjs";

/** A fake harness: records every request with its Authorization header; when `token` is set, anything else → 401. */
async function fakeHarness(label, names, { token = null, echo = false, redirectTo = null } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const path = new URL(req.url, "http://x").pathname;
    const auth = req.headers.authorization ?? null;
    seen.push({ path, node: body.node ?? null, auth });
    if (redirectTo && path !== "/nodes") return res.writeHead(307, { location: `${redirectTo}${path}` }).end();
    if (token && auth !== `Bearer ${token}`) return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized", ...(echo ? { got: auth } : {}) }));
    const out = path === "/nodes" ? Object.fromEntries(names.map((n) => [n, { base_url: `http://${n}.localhost:1`, admin_human: `${label}-admin` }]))
      : path === "/setup/event" ? { id: body.slug, global_id: `ilp:${label}:event:1`, slug: body.slug }
      : path === "/setup/credential" ? { credential: `${label}:${body.node}:${body.kind}` }
      : ["/setup/phase", "/setup/close", "/ops/stop", "/ops/start"].includes(path) ? { ok: true }
      : path === "/ops/key-drill" ? { refused: true, dev_with_key_unchanged: true }
      : path === "/setup/attest" ? { attestation: `${label}-attestation` }
      : null;
    if (echo && path === "/setup/phase") return res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "boom", got: auth }));
    res.writeHead(out ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(out ?? { error: "no route" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}
const harnessDesc = (id, url, node, base = `http://${id}.localhost:1`) => ({ id, implementation: "interlateral-platform-alpha", version: "t", base_url: base, roles: ["home", "host"], setup: { kind: "harness-control-v1", control_url: url, node }, capabilities: ["key-drill"] });
const T1 = "ilph_" + "a".repeat(43), T2 = "ilph_" + "b".repeat(43);

async function driveAll(n) {
  const ev = await n.createEvent({ slug: "e1" });
  await n.credential("operator", ev.id);
  await n.setPhase(ev, "voting");
  await n.close(ev);
  await n.stop();
  await n.start();
  return (await n.harnessControl("/setup/attest", { node: n.harnessNode, content_root: "x", profile: "p" })).json.attestation;
}

test("two harnesses with different tokens: every call (nodes, setup, ops, attest, key drill) carries only its own target's token", async (t) => {
  const h1 = await fakeHarness("h1", ["alpha-one"], { token: T1 }), h2 = await fakeHarness("h2", ["alpha-one"], { token: T2 });
  t.after(() => Promise.all([h1.close(), h2.close()]));
  const nodes = await targetAdapters([harnessDesc("x", h1.url, "alpha-one"), harnessDesc("y", h2.url, "alpha-one")], { x: { control_token: T1 }, y: { control_token: T2 } });
  assert.equal(await driveAll(nodes.x), "h1-attestation");
  assert.equal(await driveAll(nodes.y), "h2-attestation");
  await keyDrillPerTarget({ home: nodes.x, host: nodes.y }, SG3_TESTS["PC-DISC-5"]);
  for (const [h, tok] of [[h1, T1], [h2, T2]]) {
    assert.ok(h.seen.length >= 9, `${h.url} saw the whole sequence`);
    assert.deepEqual([...new Set(h.seen.map((s) => s.auth))], [`Bearer ${tok}`], "only this target's token, on every request");
  }
  assert.deepEqual(h1.seen.map((s) => s.path), ["/nodes", "/setup/event", "/setup/credential", "/setup/phase", "/setup/close", "/ops/stop", "/ops/start", "/setup/attest", "/ops/key-drill"]);
  // the token lives only in the adapter's closure
  for (const n of Object.values(nodes)) { const s = JSON.stringify(n); assert.ok(!s.includes(T1) && !s.includes(T2)); assert.ok(!Object.values(n).includes(T1) && !Object.values(n).includes(T2)); }
});

test("wrong or missing token: refused before any setup; errors never contain a token", async (t) => {
  const h = await fakeHarness("h", ["alpha-one"], { token: T1, echo: true });
  t.after(() => h.close());
  await assert.rejects(targetAdapters([harnessDesc("x", h.url, "alpha-one")], { x: { control_token: T2 } }), (e) => /harness \/nodes: 401/.test(e.message) && !e.message.includes(T2) && !e.message.includes(T1));
  await assert.rejects(targetAdapters([harnessDesc("x", h.url, "alpha-one")], {}), /has no node alpha-one/, "no token: legacy call, refused by an authenticating harness");
  assert.deepEqual(h.seen.map((s) => s.path), ["/nodes", "/nodes"], "nothing beyond discovery was attempted");
  assert.equal(h.seen[1].auth, null, "legacy call carries no Authorization");
});

test("a harness that echoes the Authorization header: the token is redacted from the thrown error", async (t) => {
  const h = await fakeHarness("h", ["alpha-one"], { token: T1, echo: true });
  t.after(() => h.close());
  const { x } = await targetAdapters([harnessDesc("x", h.url, "alpha-one")], { x: { control_token: T1 } });
  await assert.rejects(x.setPhase({ slug: "e1" }, "voting"), (e) => /harness \/setup\/phase: 500/.test(e.message) && e.message.includes("[redacted]") && !e.message.includes(T1));
});

test("redirects are never followed with a token, so it cannot reach another origin", async (t) => {
  const other = await fakeHarness("other", ["alpha-one"]);
  const h = await fakeHarness("h", ["alpha-one"], { token: T1, redirectTo: other.url });
  t.after(() => Promise.all([h.close(), other.close()]));
  const { x } = await targetAdapters([harnessDesc("x", h.url, "alpha-one")], { x: { control_token: T1 } });
  await assert.rejects(x.createEvent({ slug: "e1" }), /harness \/setup\/event: 307/);
  assert.equal(other.seen.length, 0, "the redirect target received nothing");
});

test("no cross-target leak and no token to the target product API; legacy targets mixed with token targets stay unauthenticated", async (t) => {
  const product = await fakeHarness("product", []);
  const h1 = await fakeHarness("h1", ["alpha-one"], { token: T1 }), legacy = await fakeHarness("legacy", ["beta-one"]);
  t.after(() => Promise.all([h1.close(), legacy.close(), product.close()]));
  const nodes = await targetAdapters([harnessDesc("x", h1.url, "alpha-one", product.url), harnessDesc("b", legacy.url, "beta-one", product.url)], { x: { control_token: T1 }, b: { admin_token: "unrelated" } });
  await driveAll(nodes.x); await driveAll(nodes.b);
  await keyDrillPerTarget({ home: nodes.x, host: nodes.b }, SG3_TESTS["PC-DISC-5"]);
  assert.ok(legacy.seen.length >= 9 && legacy.seen.every((s) => s.auth === null), "legacy harness: unchanged, no Authorization");
  assert.equal(product.seen.length, 0, "setup never calls the target product API");
});

test("control_token validation: only an RFC 6750 bearer token, only to a bare control origin; messages carry no value", async (t) => {
  const h = await fakeHarness("h", ["alpha-one"], { token: T1 });
  t.after(() => h.close());
  for (const bad of [42, "", "has space", "x".repeat(4097), null, 'quo"te', "back\\slash", "a=b"]) {
    await assert.rejects(targetAdapters([harnessDesc("x", h.url, "alpha-one")], { x: { control_token: bad } }), (e) => /control_token must be/.test(e.message) && !(typeof bad === "string" && bad && e.message.includes(bad)));
  }
  await assert.rejects(targetAdapters([harnessDesc("x", `${h.url}/sub`, "alpha-one")], { x: { control_token: T1 } }), /bare control origin/);
  assert.equal(h.seen.length, 0, "an invalid credential sends nothing");
});

test("adapter96 R91-3: a JSON response carrying the token in escaped forms (\\/ and \\u) is redacted in json, text and errors, on success and failure", async (t) => {
  const T3 = "ilph_ab/cd+ef==";
  const esc = (v) => v.replace(/\//g, "\\/").replace(/^i/, "\\u0069");
  const seen = [];
  const server = createServer(async (req, res) => {
    for await (const _ of req); // drain
    const path = new URL(req.url, "http://x").pathname;
    seen.push(req.headers.authorization);
    if (req.headers.authorization !== `Bearer ${T3}`) return res.writeHead(401).end("{}");
    if (path === "/nodes") return res.writeHead(200, { "content-type": "application/json" }).end('{"alpha-one":{"base_url":"http://a.localhost:1","admin_human":"h"}}');
    if (path === "/setup/credential") return res.writeHead(200, { "content-type": "application/json" }).end(`{"credential":"${esc(T3)}","${esc(T3)}":["${esc(T3)}"]}`);
    if (path === "/setup/close") return res.writeHead(200, { "content-type": "text/plain" }).end(`plain ${T3} text`);
    return res.writeHead(500, { "content-type": "application/json" }).end(`{"error":"boom","got":"Bearer ${esc(T3)}"}`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const { x } = await targetAdapters([harnessDesc("x", url, "alpha-one")], { x: { control_token: T3 } });
  const forms = [T3, esc(T3), T3.replace(/\//g, "\\/")];
  const clean = (s) => forms.every((f) => !s.includes(f));
  const ok = await x.harnessControl("/setup/credential", { node: "alpha-one", kind: "peering" });
  assert.equal(ok.status, 200);
  assert.ok(clean(JSON.stringify(ok.json)) && clean(ok.text), "success: json and text redacted");
  assert.equal(ok.json.credential, "[redacted]");
  assert.equal(await x.credential("peering"), "[redacted]");
  await assert.rejects(x.setPhase({ slug: "e1" }, "voting"), (e) => /harness \/setup\/phase: 500/.test(e.message) && e.message.includes("[redacted]") && clean(e.message));
  const plain = await x.harnessControl("/setup/close", { node: "alpha-one", slug: "e1" });
  assert.equal(plain.text, "plain [redacted] text", "non-JSON: literal redaction");
  assert.ok(seen.every((a) => a === `Bearer ${T3}`));
});
