#!/usr/bin/env node
// Runner self-check (SG2V2-RUNNER-NEGATIVE-GAP): the runner's negative tests must FAIL against a host that performs a
// real write while rejecting a request. The host under test is an unmodified reference node behind a runner-owned
// proxy; on every rejected join or action the proxy injects a genuine side effect through the node's public and
// admin interfaces (a pending join by an aux-homed subject; a proposal by a fresh local participant) before it
// relays the rejection. No test hook exists in any node. Control mode runs the same tests without injection.
//   node runner/mutations.mjs [--out FILE] [--bound 20]   → exit 0 iff control passes and every targeted test fails under mutation
import http from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { http as call, PC_ROOT, startReferenceNode, TestFailure } from "./lib.mjs";
import { adapter } from "./setup.mjs";
import { SG2_ORDER, TESTS } from "./tests.mjs";
import { SG3_ORDER, SG3_TESTS } from "./tests-sg3.mjs";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const bound = Number(args.bound ?? 20);
const work = join(PC_ROOT, ".run", `mutations-${Date.now()}`);
const profile = JSON.parse(readFileSync(join(PC_ROOT, "profile", "pc-0.1-s1.json"), "utf8"));
const log = (...m) => console.error(`[mutations ${new Date().toISOString().slice(11, 19)}]`, ...m);
// tests whose negatives must detect an injected write
const TARGETED = ["PC-CORE-3", "PC-PEER-2", "PC-IDC-3", "PC-DIR-2", "PC-REV-3"];
const ALL = { ...TESTS, ...SG3_TESTS };

/** a proxy in front of `upstream` that injects a real side effect on rejected joins/actions, then relays the rejection */
function startProxy({ port, upstream, inject, enabled }) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = {};
    for (const h of ["authorization", "content-type", "ilp-grant", "idempotency-key", "cookie"]) if (req.headers[h]) headers[h] = req.headers[h];
    let up;
    try {
      up = await fetch(`${upstream}${req.url}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    } catch (e) {
      res.writeHead(502, { "content-type": "text/plain" });
      return res.end(String(e));
    }
    const text = await up.text();
    if (enabled() && up.status >= 400) {
      try {
        await inject(req.method, req.url, up.status);
      } catch (e) {
        log(`injection failed for ${req.method} ${req.url}: ${e.message}`);
      }
    }
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" });
    res.end(text);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

async function runMode(mode) {
  const ports = { proxy: 4290, host: 4291, home: 4292, aux: 4293 };
  const proxyBase = `http://pc-mut.localhost:${ports.proxy}`;
  const hostNode = await startReferenceNode({ name: `pc-mut-${mode}`, port: ports.proxy, work, bound, baseUrl: proxyBase, listenPort: ports.host });
  const homeNode = await startReferenceNode({ name: `pc-home-${mode}`, port: ports.home, work, bound });
  const auxNode = await startReferenceNode({ name: `pc-aux-${mode}`, port: ports.aux, work, bound });
  const upstream = `http://127.0.0.1:${ports.host}`;
  const auxProv = { value: null };
  let injections = 0;
  const inject = async (method, url, status) => {
    const m = /^\/ilp\/v1\/events\/([^/?]+)\/(join-requests|actions)(?:[/?]|$)/.exec(url);
    if (!m || method !== "POST") return;
    const eventId = m[1];
    // a proposal by a fresh local participant (admin interface): action + feed record + receipt
    const lp = await call("POST", `${upstream}/ilp/v1/admin/events/${eventId}/local-participants`, { bearer: hostNode.admin, body: {} });
    if (lp.status === 201) {
      const a = await call("POST", `${upstream}/ilp/v1/events/${eventId}/actions`, { bearer: lp.json.participant_token, body: { kind: "unconference.proposal", payload: { title: `injected ${Date.now()}`, content: "mutation" } } });
      if (a.status === 201) injections++;
    }
    if (m[2] === "join-requests" && auxProv.value) {
      // a pending join by an aux-homed subject (public interface, valid claim): join request + feed record + receipt
      const syn = await call("POST", `${auxNode.base}/ilp/v1/admin/synthetic/humans`, { bearer: auxProv.value, body: { display_name: `Injected ${Date.now()}` } });
      const claim = await call("POST", `${auxNode.base}/ilp/v1/claims`, { bearer: auxProv.value, body: { purpose: "event_join", event: `ilp:pc-mut.localhost:event:${eventId}`, aud: proxyBase, agent: null, on_behalf_of: syn.json?.human } });
      if (claim.status === 201) {
        const j = await call("POST", `${upstream}/ilp/v1/events/${eventId}/join-requests`, { body: { claim: claim.json.claim } });
        if (j.status === 202) injections++;
      }
    }
  };
  const proxy = await startProxy({ port: ports.proxy, upstream, inject, enabled: () => mode === "mutant" });
  const stop = () => { proxy.close(); for (const n of [hostNode, homeNode, auxNode]) n.stop(); };
  try {
    const host = adapter({ name: "pc-mut", base: proxyBase, kind: "ref", admin: hostNode.admin, key: hostNode.key }, { harness: "" });
    const home = adapter(homeNode, { harness: "" });
    const aux = adapter(auxNode, { harness: "" });
    const nodes = { [host.name]: host, [home.name]: home, [aux.name]: aux };
    const creds = { peering: {}, provisioning: {} };
    for (const n of Object.values(nodes)) {
      creds.peering[n.name] = await n.credential("peering");
      creds.provisioning[n.name] = await n.credential("provisioning");
    }
    auxProv.value = creds.provisioning[aux.name];
    const auxEvent = await aux.createEvent({ slug: "aux-audience-fixture" });
    const tag = `mut-${mode}-${Date.now().toString(36)}`;
    const results = [];
    const events = { E1: await host.createEvent({ slug: `${tag}-e1` }) };
    const operator = { E1: await host.credential("operator", events.E1.id) };
    const observedKids = {};
    const ctx = {
      scenario: { id: "MUT" }, rep: 1, tag, profile, home, host, aux, ref: host, nodes, harness: "", auxEvent, events,
      creds: { peering: creds.peering, provisioning: creds.provisioning[home.name], provisioningOf: creds.provisioning, operator },
      identity: {}, activeKid: {}, observedKids, deferred: [],
      observe: (node, kid) => (observedKids[node] ??= new Set()).add(kid),
      resultOf: (id) => results.find((x) => x.test_id === id)?.status,
    };
    await SG3_TESTS.__setup(ctx);
    for (const id of [...SG2_ORDER, ...SG3_ORDER]) {
      const fn = ALL[id];
      if (!fn) continue;
      if (fn.applies && !fn.applies(ctx)) { results.push({ test_id: id, status: "n/a" }); continue; } // as run.mjs does
      const before = injections;
      try {
        const obs = await fn(ctx);
        results.push({ test_id: id, status: "pass", obs, injections: injections - before });
      } catch (e) {
        results.push({ test_id: id, status: e instanceof TestFailure ? "fail" : "error", error: e.message, injections: injections - before });
      }
      log(`${mode} ${id}: ${results.at(-1).status}${results.at(-1).error ? ` — ${results.at(-1).error.slice(0, 160)}` : ""} (injections ${injections - before})`);
    }
    return results;
  } finally {
    stop();
    await new Promise((r) => setTimeout(r, 500));
  }
}

const control = await runMode("control");
const mutant = await runMode("mutant");
const verdicts = TARGETED.map((id) => {
  const c = control.find((r) => r.test_id === id), m = mutant.find((r) => r.test_id === id);
  return { test_id: id, control: c?.status ?? "missing", mutant: m?.status ?? "missing", mutant_injections: m?.injections ?? 0, ok: c?.status === "pass" && m?.status === "fail" && (m?.injections ?? 0) > 0 };
});
const controlFailures = control.filter((r) => !["pass", "n/a"].includes(r.status)).map((r) => r.test_id);
const out = args.out ?? join(work, "mutations.json");
writeFileSync(out, JSON.stringify({ bound, control, mutant, verdicts, control_failures: controlFailures }, null, 2));
for (const v of verdicts) console.log(`${v.ok ? "OK  " : "BAD "} ${v.test_id}: control=${v.control} mutant=${v.mutant} injections=${v.mutant_injections}`);
if (controlFailures.length) console.log(`control failures: ${controlFailures.join(", ")}`);
const ok = verdicts.every((v) => v.ok) && !controlFailures.length;
console.log(`${ok ? "MUTATION SELF-CHECK PASS" : "MUTATION SELF-CHECK FAIL"} — ${out}`);
process.exit(ok ? 0 : 1);
