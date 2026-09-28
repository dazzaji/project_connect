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
import { LATE_ORDER, SG3_ORDER, SG3_TESTS } from "./tests-sg3.mjs";
import { sleep } from "./lib.mjs";
import { assemblePacket, checkExport, exportHostEvent, negativeCases, verifyPacket } from "./sg4.mjs";
import { execFileSync } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const harness = args.harness ?? "http://127.0.0.1:4180";
const gate = args.gate ?? "SG-2";
const reps = Number(args.reps ?? 2);
const out = args.out ?? join(PC_ROOT, ".run", `results-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });
const profile = JSON.parse(readFileSync(join(PC_ROOT, "profile", "pc-0.1-s1.json"), "utf8"));
const profileHash = sha256Hex(canonicalBytes(profile));
const scenarios = profile.scenarios.filter((s) => !args.scenarios || args.scenarios.split(",").includes(s.id));
// --also runs named later-gate tests alongside SG-2 (e.g. reruns required by an SCR ruling), nothing else
const also = args.also ? args.also.split(",") : [];
const ALL = { ...TESTS, ...SG3_TESTS };
const byId = Object.fromEntries(profile.tests.map((t) => [t.id, t]));
const log = (...m) => console.error(`[runner ${new Date().toISOString().slice(11, 19)}]`, ...m);

const refPort = (base) => Number(new URL(base).port);
const pcRef = await startReferenceNode({ name: "pc-ref", port: refPort(profile.nodes["pc-ref"].base_url), work: out, bound: profile.parameters.revocation_bound_s });
const pcAux = await startReferenceNode({ name: "pc-aux", port: 4194, work: out, bound: profile.parameters.revocation_bound_s });
// the runner's own nodes never outlive it, whatever happens
const stopOwn = () => { for (const n of [pcRef, pcAux]) { try { process.kill(-n.child.pid, "SIGCONT"); } catch {} n.stop(); } };
process.on("exit", stopOwn);
process.on("uncaughtException", (e) => { console.error(e); stopOwn(); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error(e); stopOwn(); process.exit(2); });
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
const lateCtxs = [];
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
    ctx.resultOf = (id) => results.find((x) => x.test_id === id && x.scenario === sc.id && x.repetition === rep)?.status;
    if (gate !== "SG-2" || also.length) await SG3_TESTS.__setup(ctx);
    await runTests(ctx, SG2_ORDER);
    if (gate === "SG-2" && also.length) await runTests(ctx, SG3_ORDER.filter((id) => also.includes(id)));
    if (gate !== "SG-2") {
      // admitted as soon as peering exists, so that one wait covers every short-TTL grant in the run
      try {
        ctx.shortExp = await SG3_TESTS.__admitShort(ctx);
        lateCtxs.push(ctx);
      } catch (e) {
        log(`short-TTL admission failed: ${e.message}`);
      }
      await runTests(ctx, SG3_ORDER);
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
if (lateCtxs.length) {
  const until = Math.max(...lateCtxs.map((c) => c.shortExp)) + profile.parameters.clock_skew_s + 5;
  const waitMs = Math.max(0, until * 1000 - Date.now());
  log(`late phase: waiting ${Math.round(waitMs / 1000)} s for short-TTL grants to pass exp + skew`);
  await sleep(waitMs);
  for (const ctx of lateCtxs) await runTests(ctx, LATE_ORDER);
}

async function runTests(ctx, ids) {
  const sc = ctx.scenario;
  const rep = ctx.rep;
    for (const id of ids) {
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
      log(`${r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "N/A "} ${sc.id}.${rep} ${id}${r.failure ? ` — ${r.failure}` : ""}`);
    }
}

// ---------------- SG-4: exports, packet, verification ----------------
const postPacket = [];
let packetInfo = null;
if (gate === "all" && lateCtxs.length) {
  const bundles = [];
  for (const ctx of lateCtxs) {
    const started = Date.now();
    const r = { test_id: "PC-EXP-1", scenario: ctx.scenario.id, repetition: ctx.rep, status: "pass", traces: byId["PC-EXP-1"].traces, started_at: new Date(started).toISOString(), elapsed_ms: 0, observations: {} };
    try {
      const b = await exportHostEvent(ctx);
      r.observations = await checkExport(ctx, b);
      bundles.push(b);
    } catch (e) {
      r.status = "fail";
      r.failure = e.message;
    }
    r.elapsed_ms = Date.now() - started;
    results.push(r);
    log(`${r.status === "pass" ? "PASS" : "FAIL"} ${ctx.scenario.id}.${ctx.rep} PC-EXP-1${r.failure ? ` — ${r.failure}` : ""}`);
  }
  const subjectNodes = ["beta-one", "beta-two", "pc-ref"].map((k) => nodes[k]);
  const subjects = [];
  for (const n of subjectNodes) subjects.push({ label: n.name, base_url: n.base, discovery: (await http("GET", `${n.base}/.well-known/interlateral.json`)).json, revocations: (await http("GET", `${n.base}/ilp/v1/federation/revocations?since=0`)).json });
  const runnerBuild = (() => { try { return `git:${execFileSync("git", ["-C", PC_ROOT, "rev-parse", "--short=12", "HEAD"]).toString().trim()}`; } catch { return "unknown"; } })();
  const attest = async (label, contentRoot) => {
    const n = nodes[label];
    const r = n.kind === "ref"
      ? await http("POST", `${n.base}/ilp/v1/admin/attestations`, { bearer: n.admin, body: { content_root: contentRoot, profile: profile.id } })
      : await http("POST", `${harness}/setup/attest`, { body: { node: label, content_root: contentRoot, profile: profile.id } });
    if (!r.json?.attestation) throw new Error(`attestation by ${label} failed: ${r.text.slice(0, 200)}`);
    return r.json.attestation;
  };
  for (const r of results) if (!validate("test-result", r).ok) throw new Error(`invalid result ${r.test_id}`);
  packetInfo = await assemblePacket({ dir: join(out, "packet"), runId: `pcs1-${Date.now().toString(36)}`, profile, profileRaw: readFileSync(join(PC_ROOT, "profile", "pc-0.1-s1.json"), "utf8"), results, subjects, exports: bundles, runnerBuild, attest });
  writeFileSync(join(out, "trust.json"), JSON.stringify(packetInfo.trust, null, 2) + "\n");
  const report = verifyPacket(packetInfo.dir, packetInfo.trust);
  writeFileSync(join(out, "verifier-report.json"), JSON.stringify(report, null, 2) + "\n");
  const negatives = negativeCases(packetInfo.dir, packetInfo.trust);
  writeFileSync(join(out, "negative-verification.json"), JSON.stringify(negatives, null, 2) + "\n");
  const verOk = report.ok && negatives.every((n) => n.rejected && n.right_reason);
  log(`packet ${packetInfo.contentRoot.slice(0, 16)}… verify: ${report.ok ? "PASS" : "FAIL"}; negatives rejected for the right reason: ${negatives.filter((n) => n.rejected && n.right_reason).length}/${negatives.length}`);
  for (const c of report.checks.filter((c) => !c.ok)) log(`  verifier: ${c.id}: ${c.detail}`);
  for (const n of negatives.filter((n) => !(n.rejected && n.right_reason))) log(`  negative not rejected correctly: ${n.id} (failed: ${n.failed_checks.join(",")})`);
  for (const sc of scenarios) for (let rp = 1; rp <= reps; rp++) postPacket.push({ test_id: "PC-VER-1", scenario: sc.id, repetition: rp, status: verOk ? "pass" : "fail", traces: byId["PC-VER-1"].traces, started_at: new Date().toISOString(), elapsed_ms: 0, observations: { content_root: packetInfo.contentRoot, negatives: negatives.length }, ...(verOk ? {} : { failure: "packet verification or a negative case failed; see verifier-report.json / negative-verification.json" }) });
  writeFileSync(join(out, "post-packet-results.jsonl"), postPacket.map((r) => JSON.stringify(r)).join("\n") + "\n");
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
const failed = results.filter((r) => r.status === "fail").length + postPacket.filter((r) => r.status === "fail").length;
console.log(`\n${results.length} results, ${results.filter((r) => r.status === "pass").length} pass, ${failed} fail, ${results.filter((r) => r.status === "not_applicable").length} n/a — ${out}`);
pcRef.stop();
pcAux.stop();
process.exit(failed ? 1 : 0);
