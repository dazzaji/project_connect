// Draft core-service profile (pc-core-service-0.1): frozen derivation from pc-0.1-s1, job-manifest checks, applicability
// rules from the pinned manifest, exact offline coverage, explicit mode selection. Deterministic; no ports, no packets signed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalBytes } from "../lib/jcs.mjs";
import { sha256Hex } from "../lib/jws.mjs";
import { checkJobManifest, coreResults, isCoreServiceTrust, ruleFor } from "../verifier/core-service.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const S1 = read("profile/pc-0.1-s1.json"), CORE = read("profile/pc-core-service-0.1.json");
const digest = (v) => sha256Hex(canonicalBytes(v));
// frozen digests (S4C profile46): the historical profile is unchanged, the draft core profile is pinned
const S1_SHA = "c35f36ea69a971470d59f0dbc2522412cf619771319c12ac8571199a41e80445";

test("profile: historical pc-0.1-s1 unchanged; draft core profile derives from it with identical tests", () => {
  assert.equal(digest(S1), S1_SHA, "pc-0.1-s1 bytes changed");
  assert.deepEqual([CORE.id, CORE.version, CORE.status, CORE.scenario_binding], ["pc-core-service-0.1", "0.1.0", "draft", "job-pairs"]);
  assert.equal(CORE.derived_from.sha256, S1_SHA);
  assert.deepEqual(CORE.tests, S1.tests, "normative tests, traces and expectations are the historical ones");
  assert.deepEqual(CORE.parameters, S1.parameters);
  assert.equal(CORE.scenarios, undefined, "no fixed scenarios");
  assert.equal(CORE.nodes, undefined, "no fixed node names");
});

const target = (impl, caps = [], roles = ["home", "host"]) => ({ descriptor_sha256: "a".repeat(64), implementation: impl, version: "t", base_url: "http://x.localhost:1", roles, capabilities: caps, trusted_key_thumbprints: ["A".repeat(43)] });
const manifest = (over = {}) => ({ format: "pc-job-manifest/1", job_id: "j", profile: { id: "pc-core-service-0.1", sha256: digest(CORE) }, gate: "all", also: [], selected_tests: CORE.tests.map((t) => t.id), repetitions: 2,
  targets: { "alpha-1": target("alpha"), "beta-1": target("beta"), "ref-1": target("project-connect-reference-node") }, pairs: [{ home: "alpha-1", host: "beta-1" }, { home: "beta-1", host: "alpha-1" }, { home: "ref-1", host: "alpha-1" }], ...over });

test("job manifest: structure, roles and unique pairs are enforced", () => {
  assert.ok(checkJobManifest(manifest()));
  for (const [what, m] of [["duplicate pair", manifest({ pairs: [{ home: "alpha-1", host: "beta-1" }, { home: "alpha-1", host: "beta-1" }] })],
    ["self pair", manifest({ pairs: [{ home: "alpha-1", host: "alpha-1" }] })],
    ["unknown endpoint", manifest({ pairs: [{ home: "alpha-1", host: "gamma-1" }] })],
    ["host-only target as home", manifest({ targets: { ...manifest().targets, "beta-1": target("beta", [], ["host"]) }, pairs: [{ home: "beta-1", host: "alpha-1" }] })],
    ["no pairs", manifest({ pairs: [] })], ["other profile", manifest({ profile: { id: "pc-0.1-s1", sha256: S1_SHA } })], ["zero repetitions", manifest({ repetitions: 0 })]])
    assert.throws(() => checkJobManifest(m), undefined, what);
});

test("applicability: decided from the pinned implementation pair and capabilities, never from labels", () => {
  const m = manifest();
  const ab = { home: "alpha-1", host: "beta-1" }, refHome = { home: "ref-1", host: "alpha-1" };
  assert.equal(ruleFor(CORE, m, "PC-INTEROP-AB", ab), null, "distinct pinned implementations: AB applies");
  assert.equal(ruleFor(CORE, m, "PC-INTEROP-BA", ab), null, "reverse pair pinned: BA applies");
  assert.equal(ruleFor(CORE, m, "PC-INTEROP-BA", refHome).kind, "not_applicable", "reverse of ref-1→alpha-1 not pinned");
  const same = manifest({ targets: { ...m.targets, "beta-1": target("alpha") } });
  assert.equal(ruleFor(CORE, same, "PC-INTEROP-AB", ab).when, "same_implementation", "same implementation label: no interop verdict");
  assert.equal(ruleFor(CORE, m, "PC-DISC-5", ab).kind, "unsupported", "capability absent is partial evidence");
  const drill = manifest({ targets: { ...m.targets, "alpha-1": target("alpha", ["key-drill"]), "beta-1": target("beta", ["key-drill"]) } });
  assert.equal(ruleFor(CORE, drill, "PC-DISC-5", ab), null, "both declare key-drill: applies");
  assert.equal(ruleFor(CORE, m, "PC-PROV-1", refHome).kind, "not_applicable");
  assert.equal(ruleFor(CORE, m, "PC-PROV-1", ab), null);
  assert.equal(ruleFor(CORE, m, "PC-CORE-4", ab), null, "ordinary tests have no N/A rule");
});

/** results-only fixture: rows for every selected test × pair × rep, then a mutation; coreResults judges it */
function judge(m, mutate = (rows) => rows) {
  const dir = mkdtempSync(join(tmpdir(), "core-res-"));
  mkdirSync(join(dir, "results"));
  let rows = [];
  for (const p of m.pairs) for (let rep = 1; rep <= m.repetitions; rep++) for (const id of m.selected_tests.filter((x) => x !== "PC-VER-1")) {
    const rule = ruleFor(CORE, m, id, p);
    rows.push({ test_id: id, scenario: `${p.home}:${p.host}`, repetition: rep, status: rule ? "not_applicable" : "pass", traces: [], started_at: new Date().toISOString(), elapsed_ms: 0, observations: {} });
  }
  rows = mutate(rows);
  writeFileSync(join(dir, "results/results.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const content = { summary: { tests: rows.length, passed: rows.filter((r) => r.status === "pass").length, failed: rows.filter((r) => r.status === "fail").length } };
  return coreResults((p) => join(dir, p), CORE, m, content);
}

test("offline coverage: exact pinned pairs × repetitions × selected tests; N/A only by rule; full vs partial", () => {
  const drillAll = manifest({ targets: { "alpha-1": target("alpha", ["key-drill", "outage-drill"]), "beta-1": target("beta", ["key-drill", "outage-drill"]) }, pairs: [{ home: "alpha-1", host: "beta-1" }, { home: "beta-1", host: "alpha-1" }] });
  assert.equal(judge(drillAll).qualification.scope, "full_profile", "all tests, both directions, capabilities declared");
  const partial = judge(manifest());
  assert.equal(partial.qualification.scope, "partial", "capability absent → partial");
  assert.ok(partial.qualification.unsupported.length > 0);
  assert.equal(judge(manifest({ selected_tests: ["PC-DISC-1", "PC-CORE-4"] })).qualification.scope, "partial", "subset selection is never full_profile");
  const m = manifest();
  const reject = [
    ["omitted pair", (rows) => rows.filter((r) => r.scenario !== "ref-1:alpha-1")],
    ["extra unpinned pair", (rows) => [...rows, { ...rows[0], scenario: "alpha-1:ref-1" }]],
    ["duplicate row", (rows) => [...rows, rows[0]]],
    ["unexpected test id", (rows) => [...rows, { ...rows[0], test_id: "PC-CORE-99" }]],
    ["unexpected repetition", (rows) => [...rows, { ...rows[0], repetition: 3 }]],
    ["N/A without a rule", (rows) => rows.map((r, i) => (r.test_id === "PC-CORE-4" && i < 200 ? { ...r, status: "not_applicable" } : r))],
    ["failing row", (rows) => rows.map((r) => (r.test_id === "PC-ENF-1" ? { ...r, status: "fail" } : r))],
    ["all not_applicable", (rows) => rows.map((r) => ({ ...r, status: "not_applicable" }))],
    ["zero rows", () => []],
    ["historical scenario label", (rows) => rows.map((r, i) => (i === 0 ? { ...r, scenario: "SC-1" } : r))],
  ];
  for (const [what, mut] of reject) assert.throws(() => judge(m, mut), undefined, what);
});

test("mode selection: only the exact explicit trust mode selects the core-service branch", () => {
  assert.equal(isCoreServiceTrust({ profile_mode: "pc-core-service-0.1" }), true);
  for (const t of [{}, { profile_mode: "pc-core-service" }, { profile_mode: "PC-CORE-SERVICE-0.1" }, { profile_sha256: "x" }, null]) assert.equal(isCoreServiceTrust(t), false);
});

test("runner: the core profile refuses to run without an operator-pinned job manifest, or with a digest mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "core-run-"));
  writeFileSync(join(dir, "targets.json"), JSON.stringify([{ id: "ref-a", implementation: "x", version: "t", base_url: "http://ref-a.localhost:4598", roles: ["home", "host"], setup: { kind: "reference-admin-v1" }, capabilities: [] }, { id: "ref-b", implementation: "x", version: "t", base_url: "http://ref-b.localhost:4599", roles: ["home", "host"], setup: { kind: "reference-admin-v1" }, capabilities: [] }]));
  const run = (env) => spawnSync(process.execPath, [join(ROOT, "runner", "service-run.mjs"), "--targets", join(dir, "targets.json"), "--pairs", "ref-a:ref-b", "--gate", "SG-2", "--reps", "1", "--profile", "pc-core-service-0.1", "--out", join(dir, "out"), "--ref-port", "4546", "--aux-port", "4547"], { env: { PATH: "/usr/bin:/bin", CONNECT_PROFILE_SHA256: digest(CORE), ...env }, encoding: "utf8", timeout: 20000 });
  const none = run({});
  assert.equal(none.status, 2); assert.match(none.stderr, /JOB_MANIFEST_REQUIRED/);
  writeFileSync(join(dir, "m.json"), JSON.stringify(manifest()));
  const wrong = run({ CONNECT_JOB_MANIFEST_FILE: join(dir, "m.json"), CONNECT_JOB_MANIFEST_SHA256: "0".repeat(64) });
  assert.equal(wrong.status, 2); assert.match(wrong.stderr, /JOB_MANIFEST_DIGEST_MISMATCH/);
  const inconsistent = run({ CONNECT_JOB_MANIFEST_FILE: join(dir, "m.json"), CONNECT_JOB_MANIFEST_SHA256: digest(manifest()) });
  assert.equal(inconsistent.status, 2); assert.match(inconsistent.stderr, /JOB_MANIFEST_INCONSISTENT/, "a manifest for other pairs/targets is refused");
});

test("closure42 C42-2: a deferred prerequisite failure turns already-emitted dependent rows into SETUP_FAILED", async () => {
  const { failDependents } = await import("../runner/service-run.mjs");
  const ctx = { scenario: { id: "a:b" }, rep: 1 };
  const row = (test_id, scenario = "a:b", repetition = 1) => ({ test_id, scenario, repetition, status: "pass" });
  const records = [row("PC-ENF-1"), row("PC-CORE-4"), row("PC-REV-1"), row("PC-CORE-4", "b:a"), row("PC-CORE-4", "a:b", 2)];
  const meta = new Map();
  failDependents(ctx, records, meta, new Error("prerequisite PC-DISC-4 (not requested) failed: x"));
  assert.deepEqual(records.map((r) => r.status), ["pass", "fail", "fail", "pass", "pass"], "only this pair/rep's non-SG-2 rows");
  assert.equal(meta.get(records[1]).reason, "SETUP_FAILED");
  assert.match(records[1].failure, /setup failed: prerequisite PC-DISC-4/);
  assert.ok(ctx.prereqError, "later late/SG-4 rows of this pair/rep become SETUP_FAILED too");
});

test("fix59 P46-1: BA reads the reverse context; a deferred prerequisite failure there is SETUP_FAILED, never a pass", async () => {
  const { coreDerivedVerdict, failDependents } = await import("../runner/service-run.mjs");
  const m = manifest({ pairs: [{ home: "alpha-1", host: "beta-1" }, { home: "beta-1", host: "alpha-1" }] });
  const thread = ["PC-PEER-1", "PC-IDC-1", "PC-IDC-2", "PC-IDC-3", "PC-GRANT-1", "PC-GRANT-2", "PC-ENF-1", "PC-ENF-2", "PC-RCPT-1"];
  const mk = (home, host) => { const prereq = Object.fromEntries(thread.map((t) => [t, "pass"])); return { scenario: { id: `${home}:${host}`, home, host }, rep: 1, prereq, resultOf: (t) => prereq[t] }; };
  const ab = mk("alpha-1", "beta-1"), ba = mk("beta-1", "alpha-1");
  // control: both contexts clean → both derived verdicts pass from the pinned distinct implementations
  assert.equal(coreDerivedVerdict("PC-INTEROP-AB", ab, [ab, ba], CORE, m).status, "pass");
  assert.equal(coreDerivedVerdict("PC-INTEROP-BA", ab, [ab, ba], CORE, m).status, "pass");
  // the reverse context's unrequested PC-DISC-4 deferred check fails: the runner records it with failDependents (its golden-
  // thread prerequisite statuses stay "pass", which is exactly what the old BA check looked at)
  const records = [{ test_id: "PC-CORE-4", scenario: ba.scenario.id, repetition: 1, status: "pass" }];
  failDependents(ba, records, new Map(), new Error("prerequisite PC-DISC-4 (not requested) failed: observed kid is not the active kid"));
  assert.ok(thread.every((t) => ba.resultOf(t) === "pass"), "the reverse golden-thread statuses are still pass");
  const v = coreDerivedVerdict("PC-INTEROP-BA", ab, [ab, ba], CORE, m);
  assert.deepEqual([v.status, v.reason], ["fail", "SETUP_FAILED"], "BA from an invalidated reverse context must not pass");
  assert.match(v.failure, /setup failed in beta-1:alpha-1: prerequisite PC-DISC-4/);
  assert.equal(coreDerivedVerdict("PC-INTEROP-AB", ab, [ab, ba], CORE, m).status, "pass", "AB reads only its own clean context");
  assert.equal(coreDerivedVerdict("PC-INTEROP-AB", ba, [ab, ba], CORE, m).reason, "SETUP_FAILED", "the failed context's own verdicts are SETUP_FAILED");
  assert.equal(coreDerivedVerdict("PC-INTEROP-BA", ba, [ab, ba], CORE, m).reason, "SETUP_FAILED");
});
