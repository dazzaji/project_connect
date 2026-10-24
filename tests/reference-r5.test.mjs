// SG-2 r5 reference regressions observable only in process (deterministic held fetches; no ports):
// SG2R3-W-FEED-RESET refresh overlap (R-FED-21/21a) and ASTRA-R5-EXPORT-1A step-1a classification (R-CORE-29).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateKey } from "../lib/jws.mjs";
import { STATUS } from "../reference-node/http.mjs";
import { createNode } from "../reference-node/node.mjs";

const ADMIN = "admin-token-for-r5-tests";
const admin = { authorization: `Bearer ${ADMIN}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function caller(getNode) {
  return async (method, path, { headers = admin, body = {} } = {}) => {
    const u = new URL(path, "http://unused");
    const node = getNode();
    for (const [m, pattern, fn] of node.routes) {
      if (m !== method) continue;
      const names = [];
      const hit = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)"))}$`).exec(u.pathname);
      if (!hit) continue;
      const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])]));
      try {
        const r = await fn({ headers, params, body, query: Object.fromEntries(u.searchParams) });
        return { status: r.status ?? 200, json: r.body };
      } catch (e) {
        if (!e.code || !(e.code in STATUS)) throw e;
        return { status: STATUS[e.code], json: { title: e.code, ...(e.extra ?? {}) } };
      }
    }
    throw new Error(`no route ${method} ${path}`);
  };
}
const ok = async (p, status) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r)); return r.json; };

/** A host with two homes. The host's fetches of home `race` revocations can be held, failed or counted; `other` is never held. */
function federation() {
  const keys = { race: generateKey("race").privateJwk, other: generateKey("other").privateJwk, host: generateKey("host").privateJwk };
  const nodes = {};
  const opts = (name) => ({ baseUrl: `http://${name}.localhost:4990`, name, key: keys[name], build: "test", deploymentId: "t", adminToken: ADMIN, log: () => {} });
  const ctl = { hold: false, held: null, onHeld: null, failNext: false, raceFetches: 0, logs: [] };
  const byHost = (url) => ({ "race.localhost": () => nodes.race, "other.localhost": () => nodes.other, "host.localhost": () => nodes.host })[new URL(url).hostname];
  const fetchFrom = (target) => async (url) => {
    const u = new URL(url);
    const node = byHost(url)();
    const body = u.pathname === "/.well-known/interlateral.json" ? node.discovery() : (await caller(() => node)("GET", u.pathname + u.search)).json;
    if (target === "host" && u.hostname === "race.localhost" && u.pathname.endsWith("/revocations")) {
      ctl.raceFetches++;
      if (ctl.failNext) { ctl.failNext = false; throw new Error("simulated fetch failure"); }
      if (ctl.hold) { ctl.hold = false; await new Promise((release) => { ctl.held = release; ctl.onHeld?.(); }); }
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  nodes.race = createNode({ ...opts("race"), fetchImpl: fetchFrom("race") });
  nodes.other = createNode({ ...opts("other"), fetchImpl: fetchFrom("other") });
  nodes.host = createNode({ ...opts("host"), log: (m) => ctl.logs.push(m), fetchImpl: fetchFrom("host") });
  const call = { race: caller(() => nodes.race), other: caller(() => nodes.other), host: caller(() => nodes.host) };
  const restartRace = () => { nodes.race = createNode({ ...opts("race"), fetchImpl: fetchFrom("race") }); }; // same keys, EMPTY feed
  return { nodes, call, ctl, restartRace, base: (n) => opts(n).baseUrl };
}

async function setup() {
  const f = federation();
  const { call, base } = f;
  for (let i = 0; i < 3; i++) await ok(call.race("POST", "/ilp/v1/admin/revocations", { body: { kind: "human", subject: `ilp:race.localhost:human:00000000-0000-7000-8000-00000000000${i}` } }), 201);
  for (const h of ["race", "other"]) {
    await ok(call.host("POST", "/ilp/v1/federation/peers", { body: { base_url: base(h) } }), 201);
    await ok(call[h]("POST", "/ilp/v1/federation/peers", { body: { base_url: base("host") } }), 201);
  }
  const ev = await ok(call.host("POST", "/ilp/v1/admin/events", { body: { slug: "r5", visibility: "federated", remote_participants: "allowed" } }), 201);
  const mint = async (home, name) => {
    const s = await ok(call[home]("POST", "/ilp/v1/admin/synthetic/humans", { body: { display_name: name } }), 201);
    const c = await ok(call[home]("POST", "/ilp/v1/claims", { body: { purpose: "event_join", event: ev.global_id, aud: base("host"), agent: null, on_behalf_of: s.human } }), 201);
    return { sub: s.human, claim: c.claim };
  };
  const join = (c) => call.host("POST", `/ilp/v1/events/${ev.id}/join-requests`, { headers: {}, body: { claim: c.claim } });
  const joins = async () => (await ok(call.host("GET", `/ilp/v1/events/${ev.id}/join-requests`), 200)).items.map((j) => `${j.join_request_id}:${j.status}:${j.subject}`).sort();
  return { ...f, ev, mint, join, joins };
}

const settledWithin = (p, ms) => Promise.race([p.then(() => true, () => true), sleep(ms).then(() => false)]);

test("SG2R3-W-FEED-RESET overlap: a held pre-reset refresh can never restore freshness or deliver a revoked subject's token", async () => {
  const { call, ctl, restartRace, ev, mint, join, joins } = await setup();
  const [S, A, B, O] = [await mint("race", "S"), await mint("race", "A"), await mint("race", "B"), await mint("other", "O")];
  const jS = await ok(join(S), 202);
  // A's refresh fetches the pre-reset feed and is held there
  ctl.hold = true;
  const heldNow = new Promise((r) => (ctl.onHeld = r));
  const pA = join(A);
  await heldNow;
  // a different peer progresses while race's refresh is held (coordination is per peer)
  assert.equal(await settledWithin(join(O).then((r) => assert.equal(r.status, 202, JSON.stringify(r))), 2000), true, "another peer's admission was blocked by a held refresh");
  // the home restarts with an empty feed and revokes S (seq 1 of the replacement feed)
  restartRace();
  await ok(call.race("POST", "/ilp/v1/admin/revocations", { body: { kind: "human", subject: S.sub } }), 201);
  const joinsBefore = await joins();
  const pB = join(B);
  await settledWithin(pB, 300); // vulnerable: B discovers the reset now; serialized: B waits for A
  ctl.held(); // the stale pre-reset reply arrives late
  const [rA, rB] = await Promise.all([pA, pB]);
  assert.equal(rA.status, 202, `held admission: ${JSON.stringify(rA)}`);
  assert.equal(rB.status, 503, `reset-discovering admission: ${JSON.stringify(rB)}`);
  assert.equal(rB.json.title, "REVOCATION_STATE_UNKNOWN");
  assert.ok(rB.json.retry_after != null);
  // the rejected admission added nothing: only A's own (earlier-started) join may appear
  const joinsAfter = await joins();
  assert.ok(!joinsAfter.some((j) => j.endsWith(`:${B.sub}`)), "the rejected admission inserted a join");
  assert.deepEqual(joinsAfter.filter((j) => !j.endsWith(`:${A.sub}`)), joinsBefore.filter((j) => !j.endsWith(`:${A.sub}`)), "join ids/statuses changed by the rejected admission");
  // freshness was not restored by the late reply: S (revoked on the replacement feed) is neither approved nor given a token
  const id = jS.join_request_id.split(":").pop();
  const approve = await call.host("POST", `/ilp/v1/events/${ev.id}/join-requests/${id}/approve`);
  assert.notEqual(approve.status, 200, `revoked subject approved after the reset: ${JSON.stringify(approve)}`);
  const retrieve = await call.host("GET", `/ilp/v1/events/${ev.id}/join-requests/${id}`, { headers: { authorization: `Bearer ${jS.retrieval_key}` } });
  assert.ok(!retrieve.json?.participant_token, "a participant token was delivered to a subject revoked on the replacement feed");
});

test("SG2R3-W-FEED-RESET: a failed refresh releases coordination; the next refresh re-reads from 0 and admits a clean subject", async () => {
  const { call, ctl, restartRace, mint, join } = await setup();
  const [S, C, D] = [await mint("race", "S"), await mint("race", "C"), await mint("race", "D")];
  restartRace();
  await ok(call.race("POST", "/ilp/v1/admin/revocations", { body: { kind: "human", subject: S.sub } }), 201);
  // the reset is discovered (cursor 3, replacement feed latest 1): not fresh, 503
  const discover = await join(C);
  assert.deepEqual([discover.status, discover.json.title], [503, "REVOCATION_STATE_UNKNOWN"]);
  // the next refresh fails outright: still 503, and it must not leave the peer's queue blocked
  ctl.failNext = true;
  const failed = await join(C);
  assert.deepEqual([failed.status, failed.json.title], [503, "REVOCATION_STATE_UNKNOWN"]);
  // coordination released: the following refresh re-reads the replacement feed from 0 and admission recovers
  assert.equal(await settledWithin(join(D).then((r) => assert.equal(r.status, 202, `clean subject after recovery: ${JSON.stringify(r)}`)), 2000), true, "a failed refresh left the peer's refresh queue blocked");
  assert.equal((await join(S)).json.title, "SUBJECT_REVOKED", "the replacement feed's revocation was applied");
  assert.equal((await join(C)).status, 202, "the 503s did not consume C's claim (positive control)");
});

test("SG2R3-W-FEED-RESET: a peer replaced while its refresh is held is never written by the stale refresh", async () => {
  const { nodes, call, ctl, mint, join, base } = await setup();
  const A = await mint("race", "A");
  ctl.hold = true;
  const heldNow = new Promise((r) => (ctl.onHeld = r));
  const pA = join(A);
  await heldNow;
  // re-adding the peer replaces its record (cursor 0, not fresh until its own queued read completes)
  const re = call.host("POST", "/ilp/v1/federation/peers", { body: { base_url: base("race") } });
  await sleep(50);
  ctl.held();
  const rA = await pA;
  assert.equal(rA.status, 503, `admission judged on a replaced peer record: ${JSON.stringify(rA)}`);
  await ok(re, 201);
  const fresh = await join(await mint("race", "A2"));
  assert.equal(fresh.status, 202, `replacement record serves admissions after its own read: ${JSON.stringify(fresh)}`);
  void nodes;
});

test("ASTRA-R5-EXPORT-1A: a verifying identity claim on POST exports is AUTHZ_REQUIRED; invalid bearers stay AUTH_INVALID; operator unaffected", async () => {
  const { call, ev, mint } = await setup();
  const exportsOf = (headers) => call.host("POST", `/ilp/v1/events/${ev.id}/exports`, { headers });
  const feed = async () => JSON.stringify((await call.host("GET", `/ilp/v1/events/${ev.id}/feed?since=0`)).json);
  const before = await feed();
  const { claim } = await mint("race", "Claimant");
  const r = await exportsOf({ authorization: `Bearer ${claim}` });
  assert.deepEqual([r.status, r.json.title], [403, "AUTHZ_REQUIRED"]);
  const tampered = claim.slice(0, -4) + (claim.endsWith("AAAA") ? "BBBB" : "AAAA");
  for (const bad of ["random-bearer-value", "a.b.c", tampered]) {
    const x = await exportsOf({ authorization: `Bearer ${bad}` });
    assert.deepEqual([x.status, x.json.title], [401, "AUTH_INVALID"], bad);
  }
  // a valid operator credential still reaches the event checks (not closed → VALIDATION_FAILED), and exports once closed
  const op = (await ok(call.host("POST", "/ilp/v1/admin/credentials", { body: { kind: "operator", event: ev.id } }), 201)).credential;
  assert.equal((await exportsOf({ authorization: `Bearer ${op}` })).json.title, "VALIDATION_FAILED");
  assert.equal(await feed(), before, "rejected export requests changed the event");
  await ok(call.host("POST", `/ilp/v1/admin/events/${ev.id}/state`, { body: { status: "closed" } }), 200);
  assert.equal((await exportsOf({ authorization: `Bearer ${op}` })).status, 201);
});
