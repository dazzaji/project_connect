// fix64: background revocation polling must not accumulate queued refreshes while a home is unreachable (each failed
// fetch is slow), so an admission's own serialized refresh is not stuck behind them; recovery after the home returns;
// another peer is polled independently. In process, deterministic fetch control, no ports.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateKey } from "../lib/jws.mjs";
import { STATUS } from "../reference-node/http.mjs";
import { createNode } from "../reference-node/node.mjs";

const ADMIN = "admin-token-for-poll64";
const admin = { authorization: `Bearer ${ADMIN}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function caller(getNode) {
  return async (method, path, { headers = admin, body = {} } = {}) => {
    const u = new URL(path, "http://unused");
    for (const [m, pattern, fn] of getNode().routes) {
      if (m !== method) continue;
      const names = [];
      const hit = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)"))}$`).exec(u.pathname);
      if (!hit) continue;
      try {
        const r = await fn({ headers, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])])), body, query: Object.fromEntries(u.searchParams) });
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

/** host + homes "race" (can be taken down: each revocation fetch then fails after SLOW_MS) and "other" (always up) */
async function setup(SLOW_MS) {
  const keys = { race: generateKey("race").privateJwk, other: generateKey("other").privateJwk, host: generateKey("host").privateJwk };
  const nodes = {};
  const ctl = { down: false, raceFetches: 0, otherFetches: 0 };
  const opts = (name) => ({ baseUrl: `http://${name}.localhost:4990`, name, key: keys[name], build: "test", deploymentId: "t", adminToken: ADMIN, log: () => {}, bound: 20 });
  const fetchFrom = (target) => async (url) => {
    const u = new URL(url);
    const node = nodes[u.hostname.split(".")[0]];
    if (target === "host" && u.pathname.endsWith("/revocations")) {
      if (u.hostname === "race.localhost") { ctl.raceFetches++; if (ctl.down) { await sleep(SLOW_MS); throw new Error("home unreachable (simulated timeout)"); } }
      else ctl.otherFetches++;
    }
    const body = u.pathname === "/.well-known/interlateral.json" ? node.discovery() : (await caller(() => node)("GET", u.pathname + u.search)).json;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  for (const n of ["race", "other", "host"]) nodes[n] = createNode({ ...opts(n), fetchImpl: fetchFrom(n) });
  const call = { race: caller(() => nodes.race), other: caller(() => nodes.other), host: caller(() => nodes.host) };
  for (const h of ["race", "other"]) {
    await ok(call.host("POST", "/ilp/v1/federation/peers", { body: { base_url: opts(h).baseUrl } }), 201);
    await ok(call[h]("POST", "/ilp/v1/federation/peers", { body: { base_url: opts("host").baseUrl } }), 201);
  }
  const ev = await ok(call.host("POST", "/ilp/v1/admin/events", { body: { slug: "p64", visibility: "federated", remote_participants: "allowed" } }), 201);
  const mint = async (home, name) => {
    const s = await ok(call[home]("POST", "/ilp/v1/admin/synthetic/humans", { body: { display_name: name } }), 201);
    return (await ok(call[home]("POST", "/ilp/v1/claims", { body: { purpose: "event_join", event: ev.global_id, aud: opts("host").baseUrl, agent: null, on_behalf_of: s.human } }), 201)).claim;
  };
  const join = (claim) => call.host("POST", `/ilp/v1/events/${ev.id}/join-requests`, { headers: {}, body: { claim } });
  return { nodes, ctl, mint, join };
}

test("fix64: polling during an outage does not accumulate refreshes; admission's own refresh is prompt; recovery after resume", async (t) => {
  const SLOW_MS = 150, TICK_MS = 10;
  const { nodes, ctl, mint, join } = await setup(SLOW_MS);
  t.after(() => nodes.host.stop());
  const [c1, c2] = [await mint("race", "A"), await mint("race", "B")];
  ctl.down = true;
  nodes.host.startPolling(TICK_MS);
  await sleep(1500); // ~150 ticks during an outage in which each refresh takes SLOW_MS to fail
  const fetchesDuringOutage = ctl.raceFetches;
  // serial, coalesced: at most about one refresh per SLOW_MS was ever attempted (no tick-rate queue)
  assert.ok(fetchesDuringOutage <= Math.ceil(1500 / SLOW_MS) + 2, `refresh attempts ${fetchesDuringOutage} track ticks, not refresh completion`);
  // the admission queues one serialized refresh behind at most the one in flight: it answers within ~2 × SLOW_MS
  const t0 = Date.now();
  const r = await join(c1);
  const waited = Date.now() - t0;
  assert.ok(waited < 4 * SLOW_MS + 200, `admission waited ${waited} ms behind accumulated background refreshes`);
  assert.ok([202, 503].includes(r.status), JSON.stringify(r)); // fresh-enough → 202, else fail-closed 503 (bound-dependent)
  // the background queue drains at once when polling stops: no backlog left to run
  nodes.host.stop();
  const before = ctl.raceFetches;
  await sleep(3 * SLOW_MS);
  assert.ok(ctl.raceFetches - before <= 1, `backlog of ${ctl.raceFetches - before} queued background refreshes kept running after polling stopped`);
  // recovery: the home is back; the next admission's refresh succeeds
  ctl.down = false;
  assert.equal((await join(c2)).status, 202, "admission after the home resumes");
});

test("fix64: another peer keeps being polled while one home is down; explicit refreshes are never skipped", async (t) => {
  const SLOW_MS = 200, TICK_MS = 20;
  const { nodes, ctl, mint, join } = await setup(SLOW_MS);
  t.after(() => nodes.host.stop());
  ctl.down = true;
  nodes.host.startPolling(TICK_MS);
  const before = ctl.otherFetches;
  await sleep(600);
  assert.ok(ctl.otherFetches - before >= 3, `the healthy peer was polled only ${ctl.otherFetches - before} times`);
  // an admission for the healthy home is unaffected by the outage of the other home
  const t0 = Date.now();
  assert.equal((await join(await mint("other", "O"))).status, 202);
  assert.ok(Date.now() - t0 < SLOW_MS, "healthy-home admission delayed by another peer's outage");
  // an explicit admission refresh for the down home is still performed (a fetch happens for it), not coalesced away
  const f0 = ctl.raceFetches;
  await join(await mint("race", "R"));
  assert.ok(ctl.raceFetches > f0, "the admission's own refresh was skipped");
});
