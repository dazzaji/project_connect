// Regressions for the independent closure02 review (F1, F2, F4, F5). Author-written; the reviewer's scratch tests are not
// used. Only processes these tests start are signalled, and only after their identity is checked.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, makeTree, SECRET, startService, stop, TOKENS, waitStatus } from "./helpers.mjs";
import { loadConfig } from "../../service/config.mjs";
import { createStore } from "../../service/store.mjs";
import { createSupervisor } from "../../service/supervisor.mjs";
import { acquireLease, LeaseHeld } from "../../service/lease.mjs";
import { sanitizedReport, secretValues } from "../../service/results.mjs";
import { groupAlive, processIdentity } from "../../service/proc.mjs";

const job = { profile: "pc-test", gate: "SG-2", reps: 1, pairs: [{ home: "ref-a", host: "ref-b" }] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, what, ms = 10000) {
  for (const end = Date.now() + ms; !cond();) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(20); }
}

// F1 — runner text never reaches a persisted or served reason
for (const [mode, reason] of [["unexpected-secret", "UNEXPECTED_RESULT row 4"], ["duplicate-secret", "DUPLICATE_RESULT row 4"]]) {
  test(`F1: ${mode}: the synthetic secret appears in no job/result view or retained job file; reason is structural`, async (t) => {
    const dirs = makeTree({ mode });
    const svc = await startService(dirs);
    t.after(() => stop(svc));
    const id = (await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job })).json.id;
    const done = await waitStatus(svc.base, id, TOKENS.alice, ["succeeded", "failed"]);
    assert.equal(done.status, "failed");
    assert.equal(done.reason, reason);
    const views = [(await api(svc.base, "GET", `/v1/jobs/${id}`, { token: TOKENS.alice })).text, (await api(svc.base, "GET", `/v1/jobs/${id}/results`, { token: TOKENS.alice })).text];
    const jobDir = join(dirs.state, "jobs", id);
    const files = ["job.json", "events.jsonl", "report.json"].map((f) => readFileSync(join(jobDir, f), "utf8"));
    for (const text of [...views, ...files]) assert.ok(!text.includes(SECRET), "synthetic secret leaked");
    const report = JSON.parse(files[2]);
    assert.equal(report.reason, reason);
    assert.equal(JSON.parse(files[0]).reason, reason, "job.json carries the same sanitized reason");
  });
}

test("F1 unit: a reason is redacted before it is bounded, and a redacted reason marks the report redacted", () => {
  const secrets = secretValues([{ token: SECRET }]);
  const r = sanitizedReport({ job: { id: "j" }, rows: [], secrets, outcome: { status: "failed", reason: `X ${SECRET} ${"y".repeat(600)}` } });
  assert.ok(!r.reason.includes(SECRET));
  assert.ok(r.reason.startsWith("X [REDACTED]"));
  assert.ok(r.reason.length <= 200, `reason length ${r.reason.length}`);
  assert.equal(r.redacted, true);
  const plain = sanitizedReport({ job: { id: "j" }, rows: [], secrets, outcome: { status: "failed", reason: "TEST_FAILURES" } });
  assert.equal(plain.reason, "TEST_FAILURES");
  assert.equal(plain.redacted, false, "nothing redacted is not labelled redacted");
});

// F2 — crash between spawn and the running record (deterministic: the store "crashes" on the running write)
test("F2: a crash after spawn but before the running record leaves a journalled group; restart quarantines its ports and signals nothing", async (t) => {
  const dirs = makeTree({ mode: "sleep" });
  const config = loadConfig(dirs.config);
  const store = createStore(dirs.state);
  const crashing = { ...store, update(j, patch, type, detail) { if (type === "running") throw new Error("simulated crash before the running record"); return store.update(j, patch, type, detail); } };
  const j = store.create({ owner: "alice", request: { ...job, also: [] }, composition: {} });
  const first = createSupervisor({ config, store: crashing });
  let runnerPid = null;
  t.after(async () => {
    // tear down only our own fixture runner, after checking it is still that process leading its own group
    const id = runnerPid && processIdentity(runnerPid);
    if (id && id.pgid === runnerPid && id.command.includes("fake-runner.mjs")) { try { process.kill(-runnerPid, "SIGKILL"); } catch {} }
    for (let i = 0; i < 50 && runnerPid && groupAlive(runnerPid); i++) await sleep(20);
  });
  first.kick();
  const argv = join(dirs.state, "jobs", j.id, "raw", "argv.json");
  await until(() => existsSync(argv) && first._state().dispatching === null, "spawn and the simulated crash");
  runnerPid = JSON.parse(readFileSync(argv, "utf8")).pid;
  first.stop(); // the crashed instance takes no further part
  const crashed = store.get(j.id);
  assert.equal(crashed.status, "starting");
  assert.equal(crashed.process?.pid, runnerPid, "spawned pid journalled before the first await");
  assert.equal(crashed.process?.pgid, runnerPid);
  const ports = crashed.ports;
  assert.equal(ports.length, 2);
  createSupervisor({ config, store }).reconcile();
  const after = store.get(j.id);
  assert.equal(after.status, "interrupted");
  assert.equal(after.reason, "SERVICE_RESTART_UNVERIFIED_GROUP_REMAINS");
  assert.deepEqual(after.ports_quarantined, ports, "ports of the unverified live runner are quarantined, not released");
  assert.equal(groupAlive(runnerPid), true, "an unverified group is never signalled");
});

test("F2: a starting job with no process record is quarantined on restart (its runner may exist unjournalled)", () => {
  const dirs = makeTree();
  const config = loadConfig(dirs.config);
  const store = createStore(dirs.state);
  const j = store.create({ owner: "alice", request: { ...job, also: [] }, composition: {} });
  const ports = [config.port_pool.from, config.port_pool.from + 1];
  store.update(j, { status: "starting", ports }, "starting");
  createSupervisor({ config, store }).reconcile();
  const after = store.get(j.id);
  assert.equal(after.status, "interrupted");
  assert.equal(after.reason, "SERVICE_RESTART_STARTING_UNRECORDED");
  assert.deepEqual(after.ports_quarantined, ports);
  assert.deepEqual(after.ports, []);
});

// F4 — terminal jobs are immutable
test("F4: no field of a terminal job can be rewritten, including the same status; an empty patch only logs", () => {
  const dirs = makeTree();
  const store = createStore(dirs.state);
  const j = store.create({ owner: "alice", request: job, composition: {} });
  store.update(j, { status: "failed", reason: "TEST_FAILURES", ports: [], finished_at: "2026-10-23T00:00:00.000Z" }, "finished");
  const file = join(dirs.state, "jobs", j.id, "job.json");
  const before = readFileSync(file, "utf8");
  for (const patch of [{ status: "failed" }, { status: "failed", reason: "OTHER" }, { reason: "OTHER" }, { ports: [1, 2] }, { ports_quarantined: [1] }, { finished_at: "x" }])
    assert.throws(() => store.update(store.get(j.id), patch), /already failed/, JSON.stringify(patch));
  const stale = { ...store.get(j.id), status: "running" };
  assert.throws(() => store.update(stale, { reason: "OTHER" }), /already failed/, "a stale non-terminal copy cannot rewrite either");
  const events = () => readFileSync(join(dirs.state, "jobs", j.id, "events.jsonl"), "utf8").trim().split("\n").length;
  const n = events();
  store.update(store.get(j.id), {}, "group_reaped", { descendants_terminated: false });
  assert.equal(events(), n + 1, "bookkeeping event appended");
  assert.equal(readFileSync(file, "utf8"), before, "job.json unchanged by any post-terminal update");
});

// F5 — a failed identity lookup is not proof that the lease holder died
test("F5: lease holder whose identity cannot be read but whose pid exists is never reclaimed", () => {
  const dirs = makeTree();
  const lease = join(dirs.state, "service.lease");
  const rec = JSON.stringify({ pid: process.pid, pgid: process.pid, birth: "unknown", command: "unknown", nonce: "held" });
  writeFileSync(lease, rec, { mode: 0o600 });
  // simulated `ps` failure; the pid probed is this test process itself (no other process is touched)
  assert.throws(() => acquireLease(dirs.state, { holderIdentity: () => null }), (e) => e instanceof LeaseHeld && /cannot be verified/.test(e.message));
  assert.equal(readFileSync(lease, "utf8"), rec, "lease untouched");
  assert.ok(!readdirSync(dirs.state).some((f) => f.startsWith("service.lease.stale-")), "nothing moved aside");
  assert.ok(!existsSync(join(dirs.state, "service.lease.reclaim")), "no guard left behind");
});

test("F5: with the identity unreadable and no such pid, the stale lease is still reclaimed", async () => {
  const dirs = makeTree();
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  await new Promise((r) => child.once("exit", r));
  writeFileSync(join(dirs.state, "service.lease"), JSON.stringify({ pid, pgid: pid, birth: "gone", command: "gone", nonce: "old" }), { mode: 0o600 });
  const l = acquireLease(dirs.state, { holderIdentity: () => null });
  assert.ok(readdirSync(dirs.state).some((f) => f.startsWith("service.lease.stale-")));
  l.release();
});
