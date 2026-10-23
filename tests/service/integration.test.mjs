// Service ↔ real runner integration (S4B integration36). The service runs runner/service-run.mjs, the real conformance
// runner, against two registered reference-node targets this file starts on loopback 4404/4405; the runner's own nodes use
// the service's leased pool 4410–4413. No Beta checkout, no database. Also the closure31 O1 discriminator.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { api, makeTree, ROOT, startService, stop, TOKENS, waitStatus } from "./helpers.mjs";
import { loadConfig } from "../../service/config.mjs";
import { createStore, TERMINAL } from "../../service/store.mjs";
import { createSupervisor } from "../../service/supervisor.mjs";
import { startReferenceNode } from "../../runner/lib.mjs";
import { decideOutcome, expectedCoverage, profileQualification } from "../../service/results.mjs";

const PROFILE = join(ROOT, "profile", "pc-0.1-s1.json");
// ports are configurable (defaults unchanged): CONNECT_IT_TARGET_PORTS="a,b", CONNECT_IT_POOL="from-to"
const [TA, TB] = (process.env.CONNECT_IT_TARGET_PORTS ?? "4404,4405").split(",").map(Number);
const POOL = (() => { const [from, to] = (process.env.CONNECT_IT_POOL ?? "4410-4413").split("-").map(Number); return { from, to }; })();
const job = { profile: "pc-0.1-s1", gate: "SG-2", reps: 1, pairs: [{ home: "ref-a", host: "ref-b" }] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listening = (port) => new Promise((ok) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); ok(true); }); s.once("error", () => ok(false)); });
async function poolFree(ms = 10000) {
  for (const end = Date.now() + ms; ;) {
    const busy = [];
    for (let p = POOL.from; p <= POOL.to; p++) if (await listening(p)) busy.push(p);
    if (!busy.length) return true;
    if (Date.now() > end) return busy;
    await sleep(100);
  }
}

let targets = null;
before(async () => {
  const work = join(makeTree().base, "targets");
  const a = await startReferenceNode({ name: "ref-a", port: TA, work, host: "127.0.0.1" });
  const b = await startReferenceNode({ name: "ref-b", port: TB, work, host: "127.0.0.1" });
  targets = { a, b };
});
after(() => { for (const n of Object.values(targets ?? {})) n.stop(); });

/** A service tree whose runner is the real runner and whose targets are the two reference nodes. */
function realTree({ adminA = null, capsB = [], roleB = ["home", "host"], limits = {} } = {}) {
  const dirs = makeTree({
    limits: { job_timeout_s: 300, cancel_grace_ms: 2000, ...limits },
    mutate: (cfg) => {
      cfg.service.runner = { node: process.execPath, entry: join(ROOT, "runner", "service-run.mjs"), env: {} };
      cfg.service.profiles = { "pc-0.1-s1": PROFILE };
      cfg.service.port_pool = { ...POOL };
      cfg.targets = [
        { id: "ref-a", implementation: "project-connect-reference-node", version: "test", base_url: targets.a.base, roles: ["home", "host"], setup: { kind: "reference-admin-v1" }, capabilities: [], credentials_ref: "ref-a.json" },
        { id: "ref-b", implementation: "project-connect-reference-node", version: "test", base_url: targets.b.base, roles: roleB, setup: { kind: "reference-admin-v1" }, capabilities: capsB, credentials_ref: "ref-b.json" },
      ];
    },
  });
  writeFileSync(join(dirs.secrets, "ref-a.json"), JSON.stringify({ admin_token: adminA ?? targets.a.admin }), { mode: 0o600 });
  writeFileSync(join(dirs.secrets, "ref-b.json"), JSON.stringify({ admin_token: targets.b.admin }), { mode: 0o600 });
  return dirs;
}
const submit = (svc, body = job) => api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body });

test("real runner: a service-submitted reference/reference SG-2 job runs the normative tests with exact coverage and composition", async (t) => {
  const dirs = realTree({ capsB: ["key-drill"] });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const r = await submit(svc, { ...job, also: ["PC-DISC-5"] });
  assert.equal(r.status, 201, r.text);
  const done = await waitStatus(svc.base, r.json.id, TOKENS.alice, TERMINAL, 180000);
  const res = await api(svc.base, "GET", `/v1/jobs/${r.json.id}/results`, { token: TOKENS.alice });
  assert.equal(done.status, "succeeded", `${done.reason} ${JSON.stringify(res.json?.results?.filter((x) => x.status === "fail"))}`);
  const rows = res.json.results;
  const sg2 = JSON.parse(readFileSync(PROFILE, "utf8")).tests.filter((x) => x.gate === "SG-2").map((x) => x.id);
  assert.deepEqual(rows.map((x) => x.test_id).sort(), [...sg2, "PC-DISC-5"].sort(), "exactly the selected tests");
  assert.ok(rows.every((x) => x.scenario === "ref-a:ref-b" && x.repetition === 1));
  assert.deepEqual(res.json.counts, { pass: sg2.length, fail: 0, not_applicable: 1 });
  const na = rows.find((x) => x.test_id === "PC-DISC-5");
  assert.deepEqual([na.status, na.reason], ["not_applicable", "CAPABILITY_ABSENT"], "key-drill declared by only one target is not applicable");
  assert.ok(rows.filter((x) => x.status === "pass").every((x) => x.requirement_ids.length > 0), "requirement ids carried");
  // the runner's composition record agrees with the service's (profile digest, descriptors) and the admin tokens never leak
  const run = JSON.parse(readFileSync(join(dirs.state, "jobs", r.json.id, "raw", "run.json"), "utf8"));
  const view = (await api(svc.base, "GET", `/v1/jobs/${r.json.id}`, { token: TOKENS.alice })).json;
  assert.equal(run.profile.sha256, loadConfig(dirs.config).profiles["pc-0.1-s1"].sha256, "runner and service use the same profile bytes");
  assert.deepEqual(run.pairs, ["ref-a:ref-b"]);
  assert.deepEqual(run.selected_tests.sort(), [...sg2, "PC-DISC-5"].sort());
  assert.deepEqual(run.targets["ref-b"].capabilities, ["key-drill"]);
  for (const text of [JSON.stringify(view), res.text]) for (const s of [targets.a.admin, targets.b.admin]) assert.ok(!text.includes(s), "admin token leaked");
  assert.equal(await poolFree(), true, "runner-owned nodes released the leased ports");
  // job success is not profile conformance: an SG-2 slice with a not_applicable row is partial evidence, never full-profile
  const all = JSON.parse(readFileSync(PROFILE, "utf8")).tests.map((x) => x.id);
  for (const q of [res.json.qualification, view.qualification]) {
    assert.equal(q.scope, "partial");
    assert.equal(q.full_profile_qualified, false);
    assert.deepEqual([...q.reasons].sort(), ["NOT_APPLICABLE_ROWS", "PROFILE_TESTS_NOT_SELECTED"]);
  }
  assert.deepEqual(res.json.qualification.not_applicable, ["PC-DISC-5"]);
  assert.deepEqual([...res.json.qualification.not_selected].sort(), all.filter((id) => !sg2.includes(id) && id !== "PC-DISC-5").sort());
});

test("real runner: unknown target and wrong role are refused at submission; a wrong credential fails the job", async (t) => {
  const svc = await startService(realTree({ roleB: ["host"] }));
  t.after(() => stop(svc));
  assert.equal((await submit(svc, { ...job, pairs: [{ home: "ref-a", host: "ref-x" }] })).status, 400, "unknown target");
  assert.equal((await submit(svc, { ...job, pairs: [{ home: "ref-b", host: "ref-a" }] })).status, 400, "host-only target as home");
  const bad = await startService(realTree({ adminA: "not-the-admin-token" }));
  t.after(() => stop(bad));
  const r = await submit(bad);
  const done = await waitStatus(bad.base, r.json.id, TOKENS.alice, TERMINAL, 60000);
  assert.equal(done.status, "failed");
  assert.ok(["RESULTS_MISSING", "RUNNER_EXIT 2", "RESULTS_EMPTY"].includes(done.reason), done.reason);
  assert.equal(await poolFree(), true);
});

test("real runner: cancel terminates the runner and its own nodes; restart after a service crash kills the verified runner", async (t) => {
  const dirs = realTree({ limits: { max_reps: 10 } });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const long = { ...job, reps: 10 }; // long enough to still be running when cancelled / crashed
  const c = await submit(svc, long);
  await waitStatus(svc.base, c.json.id, TOKENS.alice, ["running"], 30000);
  await sleep(800); // the runner's own nodes are up
  assert.equal((await api(svc.base, "POST", `/v1/jobs/${c.json.id}/cancel`, { token: TOKENS.alice })).status, 202);
  assert.equal((await waitStatus(svc.base, c.json.id, TOKENS.alice, TERMINAL, 30000)).status, "cancelled");
  assert.equal(await poolFree(), true, "cancel left runner-owned nodes listening");
  // crash: SIGKILL the service while a real job runs, then start a new service on the same state
  const k = await submit(svc, long);
  await waitStatus(svc.base, k.json.id, TOKENS.alice, ["running"], 30000);
  await sleep(800);
  svc.child.kill("SIGKILL");
  await svc.exited;
  const again = await startService(dirs);
  t.after(() => stop(again));
  const after = (await api(again.base, "GET", `/v1/jobs/${k.json.id}`, { token: TOKENS.alice })).json;
  assert.equal(after.status, "interrupted");
  assert.equal(after.reason, "SERVICE_RESTART_KILLED_VERIFIED_RUNNER");
  assert.equal(await poolFree(), true, "the verified runner group (with its own nodes) was killed");
});

test("O1: a failing journal write after spawn no longer stalls the queue; the job finishes when its runner exits", async () => {
  const dirs = makeTree({ mode: "pass" });
  const config = loadConfig(dirs.config);
  const store = createStore(dirs.state);
  let injected = false;
  const failing = { ...store, update(j, patch, type, detail) { if (type === "running" && !injected) { injected = true; throw new Error("simulated disk write failure"); } return store.update(j, patch, type, detail); } };
  const j1 = store.create({ owner: "alice", request: { profile: "pc-test", gate: "SG-2", reps: 1, pairs: [{ home: "ref-a", host: "ref-b" }], also: [] }, composition: {} });
  const j2 = store.create({ owner: "alice", request: { profile: "pc-test", gate: "SG-2", reps: 1, pairs: [{ home: "ref-a", host: "ref-b" }], also: [] }, composition: {} });
  const sup = createSupervisor({ config, store: failing });
  sup.kick();
  for (const end = Date.now() + 20000; !(TERMINAL.includes(store.get(j1.id).status) && TERMINAL.includes(store.get(j2.id).status));) {
    if (Date.now() > end) assert.fail(`queue stalled: ${store.get(j1.id).status} / ${store.get(j2.id).status}, running=${sup._state().running}`);
    await sleep(50);
  }
  assert.equal(injected, true, "the write failure was injected");
  assert.equal(store.get(j2.id).status, "succeeded", "the next job ran");
  assert.equal(sup._state().running, null);
  assert.ok(existsSync(join(dirs.state, "jobs", j1.id, "report.json")), "the first job was finalized");
});

test("qualification: only every profile test selected and passed is full-profile; N/A, unselected, failed or missing rows never are", () => {
  const profile = { tests: [{ id: "A", gate: "SG-2" }, { id: "B", gate: "SG-2" }, { id: "C", gate: "SG-3" }] };
  const ids = profile.tests.map((t) => t.id);
  const row = (test_id, status = "pass") => ({ test_id, status, scenario: "x:y", repetition: 1 });
  const ok = { status: "succeeded" };
  assert.deepEqual(profileQualification({ profileTestIds: ids, rows: ids.map((i) => row(i)), outcome: ok }).scope, "full_profile");
  const na = profileQualification({ profileTestIds: ids, rows: [row("A"), row("B"), row("C", "not_applicable")], outcome: ok });
  assert.deepEqual([na.scope, na.full_profile_qualified, na.reasons, na.not_applicable], ["partial", false, ["NOT_APPLICABLE_ROWS"], ["C"]]);
  const slice = profileQualification({ profileTestIds: ids, rows: [row("A"), row("B")], outcome: ok });
  assert.deepEqual([slice.scope, slice.reasons, slice.not_selected], ["partial", ["PROFILE_TESTS_NOT_SELECTED"], ["C"]]);
  assert.equal(profileQualification({ profileTestIds: ids, rows: ids.map((i) => row(i)), outcome: { status: "failed" } }).full_profile_qualified, false);
  assert.equal(profileQualification({ profileTestIds: [], rows: [], outcome: ok }).full_profile_qualified, false, "unknown profile never qualifies");
  // a requested test cannot disappear: a missing row fails the job (and so it is not qualified either)
  const expected = expectedCoverage({ profile, request: { gate: "all", reps: 1, pairs: [{ home: "x", host: "y" }], also: [] } });
  const missing = decideOutcome({ exitCode: 0, parsed: { ok: true, rows: [row("A"), row("B")] }, expected });
  assert.deepEqual([missing.status, missing.reason], ["failed", "INCOMPLETE_RESULTS 2/3"]);
  assert.equal(profileQualification({ profileTestIds: ids, rows: [row("A"), row("B")], outcome: missing }).full_profile_qualified, false);
});
