// Connect job service: config/auth/ACL/validation/lifecycle/restart/lease/sanitization, using the fixture runner only.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, makeTree, SECRET, startService, stop, TOKENS, waitStatus } from "./helpers.mjs";
import { descriptorDigest } from "../../service/config.mjs";
import { processIdentity, signalRecordedGroup, groupAlive } from "../../service/proc.mjs";

const job = { profile: "pc-test", gate: "SG-2", reps: 1, pairs: [{ home: "ref-a", host: "ref-b" }] };

test("startup refuses malformed or unsafe configuration", async () => {
  const cases = [
    ["unknown target member", (c) => { c.targets[0].command = "rm -rf /"; }],
    ["bad base_url", (c) => { c.targets[0].base_url = "http://user:pw@127.0.0.1:1/path"; }],
    ["bad setup kind", (c) => { c.targets[0].setup.kind = "shell"; }],
    ["credentials outside secrets", (c) => { c.targets[0].credentials_ref = "../config/tokens.json"; }],
    ["non-loopback listen", (c) => { c.service.listen.host = "0.0.0.0"; }],
    ["two concurrent jobs", (c) => { c.service.limits.max_concurrent_jobs = 2; }],
    ["plaintext token", (c) => { c.tokens[0].token_sha256 = "secret"; }],
  ];
  for (const [what, mutate] of cases) {
    const svc = await startService(makeTree({ mutate }), { expectFail: true });
    assert.notEqual(svc.code, 0, `${what}: service started`);
  }
  const dirs = makeTree();
  chmodSync(join(dirs.secrets, "ref-a.json"), 0o644);
  const svc = await startService(dirs, { expectFail: true });
  assert.notEqual(svc.code, 0, "group/world-readable credentials accepted");
  assert.match(svc.stderr(), /must not be group\/world accessible/);
});

test("auth and owner ACL: no token 401, unknown 401; other submitters see 404; admin sees all", async (t) => {
  const svc = await startService(makeTree({ mode: "sleep" }));
  t.after(() => stop(svc));
  assert.equal((await api(svc.base, "POST", "/v1/jobs", { body: job })).status, 401);
  assert.equal((await api(svc.base, "POST", "/v1/jobs", { token: "nope", body: job })).status, 401);
  const created = await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job });
  assert.equal(created.status, 201, created.text);
  const id = created.json.id;
  assert.equal((await api(svc.base, "GET", `/v1/jobs/${id}`, { token: TOKENS.bob })).status, 404);
  assert.equal((await api(svc.base, "POST", `/v1/jobs/${id}/cancel`, { token: TOKENS.bob })).status, 404);
  assert.equal((await api(svc.base, "GET", `/v1/jobs/${id}/results`, { token: TOKENS.bob })).status, 404);
  assert.equal((await api(svc.base, "GET", `/v1/jobs/${id}`, { token: TOKENS.alice })).status, 200);
  assert.equal((await api(svc.base, "GET", `/v1/jobs/${id}`, { token: TOKENS.admin })).status, 200);
  assert.equal((await api(svc.base, "POST", `/v1/jobs/${id}/cancel`, { token: TOKENS.admin })).status, 202);
  await waitStatus(svc.base, id, TOKENS.admin, ["cancelled"]);
});

test("request validation: no URLs/commands/setup, registered targets and roles only, bounded reps/pairs/also", async (t) => {
  const dirs = makeTree({ mode: "pass" });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const bad = [
    { ...job, base_url: "http://evil.example" },
    { ...job, command: "id" },
    { ...job, pairs: [{ home: "ref-a", host: "http://evil.example" }] },
    { ...job, pairs: [{ home: "ref-a", host: "ref-b", url: "x" }] },
    { ...job, pairs: [{ home: "ref-b", host: "ref-a" }] }, // ref-b not registered for home
    { ...job, pairs: [{ home: "ref-a", host: "ref-a" }] },
    { ...job, reps: 3 },
    { ...job, pairs: Array(5).fill({ home: "ref-a", host: "ref-b" }) },
    { ...job, profile: "other" },
    { ...job, gate: "SG-9" },
    { ...job, also: ["PC-NOT-REAL"] },
  ];
  for (const b of bad) {
    const r = await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: b });
    assert.equal(r.status, 400, `${JSON.stringify(b)} → ${r.status}`);
    assert.match(r.json.type, /^urn:connect:error:/);
  }
  assert.deepEqual(readdirSync(join(dirs.state, "jobs")), [], "a rejected request must not create a job");
  const big = await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: { ...job, also: [], pad: "x".repeat(20000) } });
  assert.equal(big.status, 413);
});

for (const [mode, status, reason] of [
  ["pass", "succeeded", null], ["fail", "failed", "TEST_FAILURES"], ["empty", "failed", "RESULTS_EMPTY"], ["missing", "failed", "RESULTS_MISSING"],
  ["malformed", "failed", "RESULTS_MALFORMED line 1"], ["only-na", "failed", "NO_COUNTED_RESULTS"],
]) {
  test(`lifecycle (${mode}): terminal ${status}${reason ? ` / ${reason}` : ""}; results fail closed`, async (t) => {
    const dirs = makeTree({ mode });
    const svc = await startService(dirs);
    t.after(() => stop(svc));
    const id = (await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job })).json.id;
    const done = await waitStatus(svc.base, id, TOKENS.alice, ["succeeded", "failed"]);
    assert.equal(done.status, status);
    assert.equal(done.reason, reason);
    const rep = await api(svc.base, "GET", `/v1/jobs/${id}/results`, { token: TOKENS.alice });
    assert.equal(rep.status, 200);
    assert.equal(rep.json.status, status);
    // runner contract and private artifacts
    const jobDir = join(dirs.state, "jobs", id);
    assert.equal(statSync(jobDir).mode & 0o077, 0, "job dir private");
    assert.equal(statSync(join(jobDir, "raw")).mode & 0o077, 0, "raw dir private");
    assert.ok(!existsSync(join(jobDir, "private", "credentials.json")), "credentials file removed after the run");
    if (mode !== "missing" && existsSync(join(jobDir, "raw", "argv.json"))) {
      const a = JSON.parse(readFileSync(join(jobDir, "raw", "argv.json"), "utf8"));
      assert.ok(a.argv.includes("--targets") && a.argv.includes("--pairs") && a.argv.includes("ref-a:ref-b"));
      assert.ok(!a.argv.join(" ").includes(SECRET), "secret must not be in argv");
      assert.deepEqual(a.credential_targets, ["ref-a"]);
    }
  });
}

test("cancel a running job kills its verified process group; timeout ends a runner that ignores SIGTERM", async (t) => {
  const dirs = makeTree({ mode: "sleep" });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const id = (await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job })).json.id;
  const running = await waitStatus(svc.base, id, TOKENS.alice, ["running"]);
  const pgid = JSON.parse(readFileSync(join(dirs.state, "jobs", id, "job.json"), "utf8")).process.pgid;
  assert.ok(groupAlive(pgid));
  assert.equal((await api(svc.base, "POST", `/v1/jobs/${id}/cancel`, { token: TOKENS.alice })).status, 202);
  await waitStatus(svc.base, id, TOKENS.alice, ["cancelled"]);
  assert.ok(!groupAlive(pgid), "runner group still alive after cancel");
  assert.equal(running.status, "running");
  assert.equal((await api(svc.base, "POST", `/v1/jobs/${id}/cancel`, { token: TOKENS.alice })).status, 409);

  const d2 = makeTree({ mode: "sleep-ignore-term", limits: { job_timeout_s: 1 } });
  const s2 = await startService(d2);
  t.after(() => stop(s2));
  const id2 = (await api(s2.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job })).json.id;
  const j2 = await waitStatus(s2.base, id2, TOKENS.alice, ["timed_out"], 8000);
  assert.equal(j2.reason, "JOB_TIMEOUT");
  const pg2 = JSON.parse(readFileSync(join(d2.state, "jobs", id2, "job.json"), "utf8")).process?.pgid;
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!groupAlive(pg2), "SIGTERM-ignoring runner survived the timeout");
});

test("queue bound: excess submissions get 429", async (t) => {
  const svc = await startService(makeTree({ mode: "sleep", limits: { max_queued: 1 } }));
  t.after(() => stop(svc));
  const first = await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job });
  await waitStatus(svc.base, first.json.id, TOKENS.alice, ["running"]);
  assert.equal((await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job })).status, 201); // queued (1)
  assert.equal((await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job })).status, 429);
  await api(svc.base, "POST", `/v1/jobs/${first.json.id}/cancel`, { token: TOKENS.admin });
});

test("crash + restart: running job becomes interrupted, verified runner killed, not re-run; lease taken over", async () => {
  const dirs = makeTree({ mode: "sleep" });
  const svc = await startService(dirs);
  const id = (await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job })).json.id;
  await waitStatus(svc.base, id, TOKENS.alice, ["running"]);
  const rec = JSON.parse(readFileSync(join(dirs.state, "jobs", id, "job.json"), "utf8")).process;
  svc.child.kill("SIGKILL"); // service crash; the detached runner keeps running
  await svc.exited;
  assert.ok(groupAlive(rec.pgid), "runner should survive the service crash");
  const again = await startService(dirs);
  try {
    const j = (await api(again.base, "GET", `/v1/jobs/${id}`, { token: TOKENS.alice })).json;
    assert.equal(j.status, "interrupted");
    assert.equal(j.reason, "SERVICE_RESTART_KILLED_VERIFIED_RUNNER");
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!groupAlive(rec.pgid), "verified runner was not killed on restart");
    // append-only execution record: exactly one "running" transition, nothing after the interruption
    const ev = readFileSync(join(dirs.state, "jobs", id, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(ev.filter((e) => e.type === "running").length, 1, "job must not be re-run");
    assert.equal(ev.at(-1).status, "interrupted");
    assert.ok(readdirSync(dirs.state).some((f) => f.startsWith("service.lease.stale-")), "stale lease kept aside");
  } finally { await stop(again); }
});

test("lease: a second live service on the same state dir is refused", async (t) => {
  const dirs = makeTree();
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const second = await startService(dirs, { expectFail: true });
  assert.notEqual(second.code, 0);
  assert.match(second.stderr(), /leased by live service/);
});

test("identity-verified signalling refuses a process whose birth/command/group do not match the record", () => {
  const me = processIdentity(process.pid);
  assert.ok(me && me.birth && me.command);
  assert.equal(signalRecordedGroup({ ...me, birth: "Mon Jan 1 00:00:00 2001" }, 0), false);
  assert.equal(signalRecordedGroup({ ...me, command: "something else" }, 0), false);
  assert.equal(signalRecordedGroup({ ...me, pgid: me.pgid + 99999 }, 0), false);
  assert.equal(signalRecordedGroup({ pid: 999999999, pgid: 999999999, birth: me.birth, command: me.command }, 0), false);
});

test("sanitized results redact credential shapes and loaded secret values; job record exposes no secret or secret ref", async (t) => {
  const dirs = makeTree({ mode: "leak" });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const id = (await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job })).json.id;
  await waitStatus(svc.base, id, TOKENS.alice, ["succeeded"]);
  const rep = await api(svc.base, "GET", `/v1/jobs/${id}/results`, { token: TOKENS.alice });
  for (const leak of [SECRET, "ilpo_abcdefghijklmnop", "Bearer abcdefghijkl", "eyJhbGciOiJFZERTQSJ9."]) assert.ok(!rep.text.includes(leak), `report leaks ${leak}`);
  assert.equal(rep.json.redacted, true);
  const view = await api(svc.base, "GET", `/v1/jobs/${id}`, { token: TOKENS.alice });
  for (const s of [SECRET, "ref-a.json", "credentials_ref", dirs.secrets]) assert.ok(!view.text.includes(s), `job view exposes ${s}`);
  const target = JSON.parse(readFileSync(join(dirs.config, "targets.json"), "utf8"))[0];
  assert.equal(view.json.composition.target_descriptor_sha256["ref-a"], descriptorDigest({ ...target, capabilities: [] }));
  const { credentials_ref, ...pub } = target;
  assert.equal(descriptorDigest(target), descriptorDigest(pub), "credentials_ref does not affect the descriptor digest");
});

test("unique port leases: concurrent-safe pool skips busy ports and leased ports are released at terminal", async (t) => {
  const dirs = makeTree({ mode: "pass" });
  const svc = await startService(dirs);
  t.after(() => stop(svc));
  const ids = [];
  for (let i = 0; i < 2; i++) ids.push((await api(svc.base, "POST", "/v1/jobs", { token: TOKENS.alice, body: job })).json.id);
  for (const id of ids) await waitStatus(svc.base, id, TOKENS.alice, ["succeeded"]);
  const ports = ids.map((id) => JSON.parse(readFileSync(join(dirs.state, "jobs", id, "raw", "argv.json"), "utf8")).argv);
  for (const a of ports) assert.notEqual(a[a.indexOf("--ref-port") + 1], a[a.indexOf("--aux-port") + 1]);
  for (const id of ids) assert.deepEqual(JSON.parse(readFileSync(join(dirs.state, "jobs", id, "job.json"), "utf8")).ports, []);
  writeFileSync(join(dirs.base, "done"), "");
});
