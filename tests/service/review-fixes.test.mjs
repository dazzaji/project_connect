// Fresh regressions for the independent service review's reproduced defects (author-written; the reviewer's own
// scratch tests are not used or modified).
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { api, makeTree, SECRET, SHORT_SECRET, startService, stop, TOKENS, waitStatus } from "./helpers.mjs";
import { loadConfig } from "../../service/config.mjs";
import { createStore } from "../../service/store.mjs";
import { createSupervisor } from "../../service/supervisor.mjs";
import { acquireLease, LeaseHeld } from "../../service/lease.mjs";
import { decideOutcome, expectedCoverage, sanitizedReport, secretValues } from "../../service/results.mjs";
import { groupAlive } from "../../service/proc.mjs";

const job = { profile: "pc-test", gate: "SG-2", reps: 1, pairs: [{ home: "ref-a", host: "ref-b" }] };
const runJob = async (svc, body = job) => (await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body })).json.id;

for (const [mode, prefix] of [["partial", "INCOMPLETE_RESULTS"], ["unknown", "UNEXPECTED_RESULT"], ["duplicate", "DUPLICATE_RESULT"]]) {
  test(`coverage: ${mode} result set fails (${prefix})`, async (t) => {
    const svc = await startService(makeTree({ mode }));
    t.after(() => stop(svc));
    const done = await waitStatus(svc.base, await runJob(svc), TOKENS.alice, ["succeeded", "failed"]);
    assert.equal(done.status, "failed");
    assert.ok(done.reason.startsWith(prefix), done.reason);
  });
}

test("coverage unit: exact (test, pair, repetition) set; gate selection and also; empty expectation fails", () => {
  const profile = { tests: [{ id: "A", gate: "SG-2" }, { id: "B", gate: "SG-3" }] };
  const exp = expectedCoverage({ profile, request: { gate: "SG-2", reps: 2, pairs: [{ home: "x", host: "y" }], also: ["B"] } });
  assert.deepEqual([...exp].sort(), ["A|x:y|1", "A|x:y|2", "B|x:y|1", "B|x:y|2"]);
  const rows = [...exp].map((k) => { const [test_id, scenario, rep] = k.split("|"); return { test_id, scenario, repetition: Number(rep), status: "pass" }; });
  assert.equal(decideOutcome({ exitCode: 0, parsed: { ok: true, rows }, expected: exp }).status, "succeeded");
  assert.equal(decideOutcome({ exitCode: 0, parsed: { ok: true, rows }, expected: new Set() }).reason, "NO_EXPECTED_COVERAGE");
});

test("redaction happens before truncation and covers short secrets", () => {
  const secret = "SYNTHETIC-CREDENTIAL-123456";
  const r = sanitizedReport({ job: { id: "j" }, outcome: { status: "succeeded" }, secrets: secretValues([{ token: secret, pin: "12345" }]),
    rows: [{ test_id: "A", status: "pass", scenario: "x:y", repetition: 1, detail: "x".repeat(490) + secret }, { test_id: "B", status: "pass", scenario: "x:y", repetition: 1, detail: "pin=12345" }] });
  assert.ok(!r.results[0].detail.includes(secret.slice(0, 10)), "a truncated prefix of the secret survived");
  assert.equal(r.results[1].detail, "pin=[REDACTED]");
  assert.equal(r.redacted, true);
});

test("short secret and loaded secret are redacted end to end", async (t) => {
  const svc = await startService(makeTree({ mode: "short-secret" }));
  t.after(() => stop(svc));
  const id = await runJob(svc);
  await waitStatus(svc.base, id, TOKENS.alice, ["succeeded"]);
  const rep = await api(svc.base, "GET", `/v1/jobs/${id}/results`, { token: TOKENS.alice });
  assert.ok(!rep.text.includes(`pin=${SHORT_SECRET}`), rep.text);
});

test("profile and target names: inherited and non-string names are rejected over HTTP", async (t) => {
  const svc = await startService(makeTree({ mode: "pass" }));
  t.after(() => stop(svc));
  for (const profile of ["__proto__", "toString", "constructor", "hasOwnProperty", 7, null, ["pc-test"]]) {
    const r = await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: { ...job, profile } });
    assert.equal(r.status, 400, `profile ${JSON.stringify(profile)} → ${r.status}`);
  }
  for (const host of ["__proto__", "constructor", "toString", 7]) {
    const r = await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: { ...job, pairs: [{ home: "ref-a", host }] } });
    assert.equal(r.status, 400, `target ${JSON.stringify(host)} → ${r.status}`);
  }
});

test("startup refuses group/world-accessible state and secrets directories", async () => {
  for (const which of ["state", "secrets"]) {
    const dirs = makeTree();
    chmodSync(dirs[which], 0o777);
    const svc = await startService(dirs, { expectFail: true });
    assert.notEqual(svc.code, 0, `${which} 0777 accepted`);
    assert.match(svc.stderr(), /must not be group\/world accessible/);
  }
});

test("dispatch races: two kicks start one runner; cancel during the port probe prevents spawning", async () => {
  const dirs = makeTree({ mode: "sleep" });
  const config = loadConfig(dirs.config);
  const store = createStore(config.state_dir);
  const sup = createSupervisor({ config, store });
  const a = store.create({ owner: "alice", request: { ...job, also: [] }, composition: {} });
  sup.kick(); sup.kick(); sup.kick();
  for (let i = 0; i < 100 && store.get(a.id).status !== "running"; i++) await new Promise((r) => setTimeout(r, 20));
  const events = readFileSync(join(store.dirOf(a.id), "events.jsonl"), "utf8").split("\n").filter((l) => l.includes('"type":"running"'));
  assert.equal(events.length, 1, "job started more than once");
  sup.cancel(store.get(a.id));
  for (let i = 0; i < 200 && store.get(a.id).status !== "cancelled"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.get(a.id).status, "cancelled");

  const b = store.create({ owner: "alice", request: { ...job, also: [] }, composition: {} });
  sup.kick();
  sup.cancel(store.get(b.id)); // synchronously, while the port probe is pending
  for (let i = 0; i < 200 && !["cancelled", "failed", "succeeded"].includes(store.get(b.id).status); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.get(b.id).status, "cancelled", `status ${store.get(b.id).status}`);
  assert.ok(!existsSync(join(store.dirOf(b.id), "raw", "argv.json")), "a cancelled-before-spawn job must not start its runner");
  sup.stop();
});

test("descendants that outlive the leader are terminated and the job fails", async (t) => {
  const dirs = makeTree({ mode: "orphan" });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const id = await runJob(svc);
  const done = await waitStatus(svc.base, id, TOKENS.alice, ["succeeded", "failed"]);
  assert.equal(done.status, "failed");
  assert.equal(done.reason, "RUNNER_LEFT_DESCENDANTS");
  const dpid = Number(readFileSync(join(dirs.state, "jobs", id, "raw", "descendant.pid"), "utf8"));
  let alive = true; try { process.kill(dpid, 0); } catch { alive = false; }
  assert.equal(alive, false, "descendant still running");
});

test("an async spawn error fails the job and the service stays up", async (t) => {
  const dirs = makeTree({ mutate: (c) => { c.service.runner.node = "/nonexistent/connect-node"; } });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const done = await waitStatus(svc.base, await runJob(svc), TOKENS.alice, ["failed"]);
  assert.equal(done.reason, "SPAWN_ERROR");
  assert.equal((await api(svc.base, "GET", "/healthz")).status, 200);
});

test("credentials: rotation after start still redacts what the runner received; a swapped path is rejected at use", async (t) => {
  const dirs = makeTree({ mode: "leak-slow" });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const id = await runJob(svc);
  await waitStatus(svc.base, id, TOKENS.alice, ["running"]);
  writeFileSync(join(dirs.secrets, "ref-a.json.new"), JSON.stringify({ admin_token: "rotated-token-value-999", pin: "99999" }), { mode: 0o600 });
  renameSync(join(dirs.secrets, "ref-a.json.new"), join(dirs.secrets, "ref-a.json"));
  await waitStatus(svc.base, id, TOKENS.alice, ["succeeded"]);
  const rep = await api(svc.base, "GET", `/v1/jobs/${id}/results`, { token: TOKENS.alice });
  assert.ok(!rep.text.includes(SECRET), "the original per-job secret leaked after rotation");

  // replace the credentials file with a symlink to a file outside secrets_dir after startup validation
  const outside = join(dirs.base, "outside.json");
  writeFileSync(outside, JSON.stringify({ admin_token: "outside-secret-value" }), { mode: 0o600 });
  renameSync(join(dirs.secrets, "ref-a.json"), join(dirs.base, "moved.json"));
  symlinkSync(outside, join(dirs.secrets, "ref-a.json"));
  const id2 = await runJob(svc);
  const d2 = await waitStatus(svc.base, id2, TOKENS.alice, ["failed"]);
  assert.equal(d2.reason, "CREDENTIALS_REJECTED");
  assert.ok(!existsSync(join(dirs.state, "jobs", id2, "raw", "argv.json")), "runner must not start with rejected credentials");
});

test("lease: an existing lease that is unreadable is never stolen; a live holder blocks a second acquire", () => {
  const dirs = makeTree();
  writeFileSync(join(dirs.state, "service.lease"), "", { mode: 0o600 });
  assert.throws(() => acquireLease(dirs.state), LeaseHeld);
  const d2 = makeTree();
  const l = acquireLease(d2.state);
  assert.throws(() => acquireLease(d2.state), /leased by live service/);
  l.release();
  assert.ok(!readdirSync(d2.state).some((f) => f.startsWith(".service.lease.")), "temporary lease records are cleaned up");
});

test("a malformed request target is answered 400 and the service stays up", async (t) => {
  const svc = await startService(makeTree());
  t.after(() => stop(svc));
  const port = Number(new URL(svc.base).port);
  const reply = await new Promise((ok) => {
    const s = net.connect(port, "127.0.0.1", () => s.write("GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
    let buf = ""; s.on("data", (d) => (buf += d)); s.on("end", () => ok(buf)); s.on("error", () => ok(buf));
  });
  assert.match(reply, /^HTTP\/1\.1 (400|401)/, reply.slice(0, 80));
  assert.equal((await api(svc.base, "GET", "/healthz")).status, 200);
  assert.equal(svc.child.exitCode, null);
  void groupAlive;
});

test("test helper: an expected startup failure cannot be satisfied by a service that actually starts", async () => {
  await assert.rejects(startService(makeTree(), { expectFail: true }), /started although startup failure was expected/);
});

test("a descendant ignoring SIGTERM after its leader exits is SIGKILLed before the job is finalized", async (t) => {
  const dirs = makeTree({ mode: "orphan-ignore-term" });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const id = await runJob(svc);
  const done = await waitStatus(svc.base, id, TOKENS.alice, ["succeeded", "failed"], 15000);
  assert.equal(done.reason, "RUNNER_LEFT_DESCENDANTS");
  const dpid = Number(readFileSync(join(dirs.state, "jobs", id, "raw", "descendant.pid"), "utf8"));
  let alive = true; try { process.kill(dpid, 0); } catch { alive = false; }
  assert.equal(alive, false, "SIGTERM-ignoring descendant survived");
  assert.deepEqual(JSON.parse(readFileSync(join(dirs.state, "jobs", id, "job.json"), "utf8")).ports, [], "ports released only after cleanup");
});

test("ports: a busy pool port is skipped by the lease", async (t) => {
  const dirs = makeTree({ mode: "pass" });
  const config = loadConfig(dirs.config);
  const busy = net.createServer();
  await new Promise((r) => busy.listen(config.port_pool.from, "127.0.0.1", r));
  t.after(() => new Promise((r) => busy.close(r)));
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const id = await runJob(svc);
  await waitStatus(svc.base, id, TOKENS.alice, ["succeeded"]);
  const a = JSON.parse(readFileSync(join(dirs.state, "jobs", id, "raw", "argv.json"), "utf8")).argv;
  const leased = [Number(a[a.indexOf("--ref-port") + 1]), Number(a[a.indexOf("--aux-port") + 1])];
  assert.ok(!leased.includes(config.port_pool.from), `busy port ${config.port_pool.from} leased: ${leased}`);
  assert.notEqual(leased[0], leased[1]);
});

test("lease: stale takeover is serialized by a guard; a leftover guard refuses startup", () => {
  const dirs = makeTree();
  writeFileSync(join(dirs.state, "service.lease"), JSON.stringify({ pid: 999999999, pgid: 999999999, birth: "Mon Jan 1 00:00:00 2001", command: "gone", nonce: "old" }), { mode: 0o600 });
  writeFileSync(join(dirs.state, "service.lease.reclaim"), "{}", { mode: 0o600 }); // another starter mid-reclaim (or crashed)
  assert.throws(() => acquireLease(dirs.state), /reclaiming the lease/);
  rmGuard(dirs.state);
  const l = acquireLease(dirs.state); // stale record reclaimed once the guard is clear
  assert.ok(readdirSync(dirs.state).some((f) => f.startsWith("service.lease.stale-")));
  l.release();
});
const rmGuard = (d) => { try { unlinkSync(join(d, "service.lease.reclaim")); } catch {} };

test("store: a terminal status is never rewritten", () => {
  const dirs = makeTree();
  const store = createStore(dirs.state);
  const j = store.create({ owner: "alice", request: job, composition: {} });
  store.update(j, { status: "failed" }, "finished");
  assert.throws(() => store.update(store.get(j.id), { status: "succeeded" }), /already failed/);
  assert.throws(() => store.update(store.get(j.id), { status: "running" }), /already failed/);
  assert.equal(store.get(j.id).status, "failed");
});
