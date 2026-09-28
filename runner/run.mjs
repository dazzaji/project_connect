#!/usr/bin/env node
// Project Connect black-box runner for profile pc-0.1-s1.
//
//   node runner/run.mjs --harness http://127.0.0.1:4180 [--gate SG-2|SG-3|all] [--scenarios SC-1,SC-2] [--reps 2] [--out DIR]
//
// The runner is itself a node (R-CONF-3): it starts two reference nodes it owns (pc-ref, pc-aux). Nodes under
// test are reached only through their declared public interfaces; setup and the outage drill go through the
// local harness control API (outside the black-box phase).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalBytes } from "../lib/jcs.mjs";
import { sha256Hex } from "../lib/jws.mjs";
import { validate } from "../lib/schemas.mjs";
import { http, PC_ROOT, seenProblems, startReferenceNode, TestFailure } from "./lib.mjs";
import { adapter } from "./setup.mjs";
import { SG2_ORDER, TESTS } from "./tests.mjs";
import { SG3_ORDER, SG3_TESTS } from "./tests-sg3.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const harness = args.harness ?? "http://127.0.0.1:4180";
const gate = args.gate ?? "SG-2";
const reps = Number(args.reps ?? 2);
const out = args.out ?? join(PC_ROOT, ".run", `results-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });
const profile = JSON.parse(readFileSync(join(PC_ROOT, "profile", "pc-0.1-s1.json"), "utf8"));
const profileHash = sha256Hex(canonicalBytes(profile));
const scenarios = profile.scenarios.filter((s) => !args.scenarios || args.scenarios.split(",").includes(s.id));
const order = gate === "SG-2" ? SG2_ORDER : [...SG2_ORDER, ...SG3_ORDER];
const ALL = { ...TESTS, ...SG3_TESTS };
const byId = Object.fromEntries(profile.tests.map((t) => [t.id, t]));
const log = (...m) => console.error(`[runner ${new Date().toISOString().slice(11, 19)}]`, ...m);

const refPort = (base) => Number(new URL(base).port);
const pcRef = await startReferenceNode({ name: "pc-ref", port: refPort(profile.nodes["pc-ref"].base_url), work: out, bound: profile.parameters.revocation_bound_s });
const pcAux = await startReferenceNode({ name: "pc-aux", port: 4194, work: out, bound: profile.parameters.revocation_bound_s });
const betaNodes = (await http("GET", `${harness}/nodes`)).json;
const nodes = {
  "beta-one": adapter({ name: "beta-one", base: betaNodes["beta-one"].base_url, kind: "beta", adminHuman: betaNodes["beta-one"].admin_human }, { harness }),
  "beta-two": adapter({ name: "beta-two", base: betaNodes["beta-two"].base_url, kind: "beta", adminHuman: betaNodes["beta-two"].admin_human }, { harness }),
  "pc-ref": adapter(pcRef, { harness }),
  "pc-aux": adapter(pcAux, { harness }),
};
const creds = { peering: {}, provisioning: {} };
for (const n of Object.values(nodes)) {
  creds.peering[n.name] = await n.credential("peering");
  creds.provisioning[n.name] = await n.credential("provisioning");
}
const auxEvent = await nodes["pc-aux"].createEvent({ slug: "aux-audience-fixture" });
log(`nodes: ${Object.values(nodes).map((n) => `${n.name}=${n.base}`).join(" ")}; profile ${profileHash.slice(0, 12)}`);

const results = [];
const observedKids = {};
const activeKid = {}; // per node, run-wide (observed kids accumulate across scenarios)
for (const sc of scenarios) {
  for (let rep = 1; rep <= reps; rep++) {
    const home = nodes[sc.home];
    const host = nodes[sc.host];
    const tag = `${sc.id.toLowerCase()}-r${rep}-${Date.now().toString(36)}`;
    log(`== ${sc.id} rep ${rep}: home ${home.name} → host ${host.name}`);
    const events = { E1: await host.createEvent({ slug: `${tag}-e1` }) };
    const operator = { E1: await host.credential("operator", events.E1.id) };
    const ctx = {
      scenario: sc, rep, tag, profile, home, host, aux: nodes["pc-aux"], ref: nodes["pc-ref"], nodes, harness, auxEvent, events,
      creds: { peering: creds.peering, provisioning: creds.provisioning[home.name], provisioningOf: creds.provisioning, operator },
      identity: {}, activeKid, observedKids, deferred: [],
      observe: (node, kid) => (observedKids[node] ??= new Set()).add(kid),
    };
    if (gate !== "SG-2") await SG3_TESTS.__setup(ctx);
    for (const id of order) {
      const spec = byId[id];
      if (!spec) throw new Error(`test ${id} not in profile`);
      const started = Date.now();
      const r = { test_id: id, scenario: sc.id, repetition: rep, status: "pass", traces: spec.traces, started_at: new Date(started).toISOString(), elapsed_ms: 0, observations: {} };
      try {
        const obs = ALL[id].applies && !ALL[id].applies(ctx) ? null : await ALL[id](ctx);
        if (obs === null) r.status = "not_applicable";
        else r.observations = obs ?? {};
      } catch (e) {
        r.status = "fail";
        r.failure = e instanceof TestFailure ? e.message : `${e.name}: ${e.message}`;
      }
      r.elapsed_ms = Date.now() - started;
      results.push(r);
      log(`${r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "N/A "} ${id}${r.failure ? ` — ${r.failure}` : ""}`);
    }
    for (const fn of ctx.deferred) {
      try {
        fn();
      } catch (e) {
        const r = results.find((x) => x.test_id === "PC-DISC-4" && x.scenario === sc.id && x.repetition === rep);
        r.status = "fail";
        r.failure = e.message;
        log(`FAIL PC-DISC-4 (deferred) — ${e.message}`);
      }
    }
  }
}

// PC-CORE-1 (SG-3): every problem document seen in the run conforms
for (const r of results) {
  const v = validate("test-result", r);
  if (!v.ok) throw new Error(`result ${r.test_id} ${r.scenario} invalid: ${v.errors.join("; ")}`);
}
writeFileSync(join(out, "results.jsonl"), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(out, "problems.json"), JSON.stringify(seenProblems(), null, 2));
writeFileSync(join(out, "run.json"), JSON.stringify({ profile: profile.id, profile_sha256: profileHash, gate, reps, scenarios: scenarios.map((s) => s.id), nodes: Object.fromEntries(Object.values(nodes).map((n) => [n.name, n.base])) }, null, 2));

const summary = {};
for (const r of results) (summary[r.test_id] ??= {})[`${r.scenario}.${r.repetition}`] = r.status;
const cols = [...new Set(results.map((r) => `${r.scenario}.${r.repetition}`))];
console.log(["test".padEnd(16), ...cols.map((c) => c.padEnd(8))].join(" "));
for (const [id, row] of Object.entries(summary)) console.log([id.padEnd(16), ...cols.map((c) => (row[c] ?? "-").padEnd(8))].join(" "));
const failed = results.filter((r) => r.status === "fail").length;
console.log(`\n${results.length} results, ${results.filter((r) => r.status === "pass").length} pass, ${failed} fail, ${results.filter((r) => r.status === "not_applicable").length} n/a — ${out}`);
pcRef.stop();
pcAux.stop();
process.exit(failed ? 1 : 0);
