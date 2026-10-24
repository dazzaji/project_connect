// Job supervisor: one job at a time (a dispatch mutex prevents double starts), the configured runner as a child in its own
// process group, unique port leases, identity-verified cancellation/timeout, cleanup of descendants that outlive the
// leader, fail-closed result evaluation against exact expected coverage, and restart reconciliation.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { readCredentialFile } from "./config.mjs";
import { groupAlive, processIdentity, signalRecordedGroup } from "./proc.mjs";
import { decideOutcome, expectedCoverage, readRunnerResults, sanitizedReport, sanitizeReason, secretValues } from "./results.mjs";
import { TERMINAL } from "./store.mjs";
import { atomicWriteJson, jcsSha256 } from "./util.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (port) => new Promise((ok) => {
  const s = net.createServer();
  s.once("error", () => ok(false));
  s.listen({ port, host: "127.0.0.1", exclusive: true }, () => s.close(() => ok(true)));
});

export function createSupervisor({ config, store, log = () => {} }) {
  let running = null;      // { job, child, pgid, secrets, cancelRequested, timedOut, timer, killTimer }
  let dispatching = null;  // { id, cancelRequested } while a job is between "queued" and "running"
  let stopped = false;

  const heldPorts = () => new Set(store.list().flatMap((j) => [...(!TERMINAL.includes(j.status) ? j.ports ?? [] : []), ...(j.ports_quarantined ?? [])]));
  async function leasePorts(n) {
    const held = heldPorts(), got = [];
    for (let p = config.port_pool.from; p <= config.port_pool.to && got.length < n; p++)
      if (!held.has(p) && (await portFree(p))) got.push(p);
    return got.length === n ? got : null;
  }

  /** Credentials are re-validated and read at the moment of use (path containment, no symlink, mode, owner, inode). */
  function loadCredentials(job) {
    const creds = {};
    for (const id of new Set(job.request.pairs.flatMap((p) => [p.home, p.host]))) {
      const t = config.targets[id];
      if (t?.credentialsRef) creds[id] = readCredentialFile(config.secrets_dir, t.credentialsRef, `target ${id}`);
    }
    return creds;
  }

  function finish(job, outcome, { parsed = null, secrets = [], quarantinePorts = false } = {}) {
    const cur = store.get(job.id);
    if (cur && TERMINAL.includes(cur.status)) { log(`job ${job.id} already ${cur.status}; ignoring ${outcome.status}`); return; }
    const dir = store.dirOf(job.id);
    rmSync(join(dir, "private", "credentials.json"), { force: true });
    const rows = parsed?.ok ? parsed.rows : [];
    const report = sanitizedReport({ job, rows, secrets, outcome, profileTestIds: config.profiles[job.request?.profile]?.test_ids ?? [], runRecord: readRunRecord(dir), currentProfileSha256: config.profiles[job.request?.profile]?.sha256 ?? null });
    atomicWriteJson(join(dir, "report.json"), report);
    const reason = sanitizeReason(outcome.reason, secrets); // the same bounded, redacted reason in job.json and events.jsonl
    // ports of a job whose processes could not be verified gone stay out of the pool (operator must clear them)
    store.update(job, { status: outcome.status, reason, qualification: { scope: report.qualification.scope, full_profile_qualified: report.qualification.full_profile_qualified, reasons: report.qualification.reasons }, ports: [], ...(quarantinePorts ? { ports_quarantined: cur?.ports ?? job.ports ?? [] } : {}), finished_at: new Date().toISOString() }, "finished", { reason });
  }

  /** The runner's private run record (raw/run.json), or null when missing or unreadable. */
  function readRunRecord(dir) {
    try { const r = JSON.parse(readFileSync(join(dir, "raw", "run.json"), "utf8")); return r && typeof r === "object" ? r : null; } catch { return null; }
  }

  /** After the leader exits, any remaining member of its group is a descendant we started: terminate the group. A process
   *  group id cannot be reused while the group still has members, and we are the parent of its leader. */
  async function reapGroup(pgid) {
    if (!groupAlive(pgid)) return false;
    try { process.kill(-pgid, "SIGTERM"); } catch {}
    for (let waited = 0; waited < config.limits.cancel_grace_ms && groupAlive(pgid); waited += 50) await sleep(50);
    if (groupAlive(pgid)) { try { process.kill(-pgid, "SIGKILL"); } catch {} await sleep(50); }
    return true;
  }

  /** The operator-side job manifest (pc-job-manifest/1): exact pairs, descriptor digests, roles, implementations, capabilities,
   *  trust pins, repetitions, selected tests and profile digest, all from the job's pinned composition and the service config.
   *  Its JCS SHA-256 is pinned on the job and handed to the runner; offline verification trusts that pin, not the packet.
   *  Throws if a target's current descriptor no longer matches the digest pinned at submission. */
  function jobManifest(job) {
    // no descriptor digests pinned at submission: no manifest (such a job can never qualify; the core profile refuses to run)
    if (!job.composition?.target_descriptor_sha256 || !job.composition?.profile_sha256) return null;
    const prof = config.profiles[job.request.profile];
    const ids = [...new Set(job.request.pairs.flatMap((p) => [p.home, p.host]))];
    const targets = {};
    for (const id of ids) {
      const t = config.targets[id];
      if (!t || t.digest !== job.composition?.target_descriptor_sha256?.[id]) throw new Error(`target ${id} changed since submission`);
      const d = t.descriptor;
      targets[id] = { descriptor_sha256: t.digest, implementation: d.implementation, version: d.version, base_url: d.base_url, roles: d.roles, capabilities: d.capabilities ?? [], trusted_key_thumbprints: d.trusted_key_thumbprints ?? [] };
    }
    const selected = prof.tests.filter((t) => job.request.gate === "all" || t.gate === job.request.gate).map((t) => t.id);
    for (const id of job.request.also) if (!selected.includes(id)) selected.push(id);
    return { format: "pc-job-manifest/1", job_id: job.id, profile: { id: job.request.profile, sha256: job.composition.profile_sha256 }, gate: job.request.gate, also: job.request.also, selected_tests: selected, repetitions: job.request.reps, targets, pairs: job.request.pairs.map((p) => ({ home: p.home, host: p.host })) };
  }

  async function startNext() {
    if (running || dispatching || stopped) return;
    const job = store.list().find((j) => j.status === "queued");
    if (!job) return;
    const d = { id: job.id, cancelRequested: false };
    dispatching = d;
    try {
      await dispatch(job, d);
    } catch (e) {
      log(`dispatch error for ${job.id}: ${e.message}`);
      const cur = store.get(job.id);
      if (cur && !TERMINAL.includes(cur.status) && !(running && running.job.id === job.id)) finish(cur, { status: "failed", reason: "DISPATCH_ERROR" });
    } finally {
      if (dispatching === d) dispatching = null;
    }
    if (!running) setImmediate(() => startNext().catch((e) => log(`supervisor error: ${e.message}`)));
  }

  async function dispatch(job, d) {
    const ports = await leasePorts(2);
    if (d.cancelRequested) return finish(job, { status: "cancelled", reason: "CANCELLED" });
    if (!ports) return finish(job, { status: "failed", reason: "NO_FREE_PORTS" });
    const dir = store.dirOf(job.id), priv = join(dir, "private"), raw = join(dir, "raw");
    mkdirSync(priv, { recursive: true, mode: 0o700 });
    mkdirSync(raw, { recursive: true, mode: 0o700 });
    let manifest;
    try { manifest = jobManifest(job); } catch (e) { return finish(job, { status: "failed", reason: "COMPOSITION_CHANGED" }); }
    const manifestSha = manifest ? jcsSha256(manifest) : null;
    if (manifest) atomicWriteJson(join(priv, "job-manifest.json"), manifest);
    store.update(job, { status: "starting", ports, ...(manifestSha ? { manifest_sha256: manifestSha } : {}) }, "starting");
    let creds;
    try { creds = loadCredentials(job); } catch (e) { return finish(job, { status: "failed", reason: "CREDENTIALS_REJECTED" }); }
    const secrets = secretValues(Object.values(creds)); // per-job snapshot: what this runner received is what gets redacted
    const ids = [...new Set(job.request.pairs.flatMap((p) => [p.home, p.host]))];
    atomicWriteJson(join(priv, "targets.json"), ids.map((id) => { const { credentials_ref, ...pub } = config.targets[id].descriptor; return pub; }));
    atomicWriteJson(join(priv, "credentials.json"), creds);
    if (d.cancelRequested) return finish(job, { status: "cancelled", reason: "CANCELLED" }, { secrets });
    const args = [config.runner.entry, "--targets", join(priv, "targets.json"), "--pairs", job.request.pairs.map((p) => `${p.home}:${p.host}`).join(","),
      "--gate", job.request.gate, "--reps", String(job.request.reps), "--profile", job.request.profile, "--out", raw,
      "--ref-port", String(ports[0]), "--aux-port", String(ports[1]), ...(job.request.also.length ? ["--also", job.request.also.join(",")] : [])];
    const out = openSync(join(priv, "runner.stdout.log"), "a", 0o600), err = openSync(join(priv, "runner.stderr.log"), "a", 0o600);
    let child;
    try {
      child = spawn(config.runner.node, args, { detached: true, stdio: ["ignore", out, err],
        env: { PATH: "/usr/bin:/bin", ...config.runner.env, CONNECT_CREDENTIALS_FILE: join(priv, "credentials.json"), CONNECT_JOB_ID: job.id, CONNECT_PROFILE_SHA256: job.composition?.profile_sha256 ?? "", ...(manifestSha ? { CONNECT_JOB_MANIFEST_FILE: join(priv, "job-manifest.json"), CONNECT_JOB_MANIFEST_SHA256: manifestSha } : {}) } });
    } catch (e) { closeSync(out); closeSync(err); return finish(job, { status: "failed", reason: "SPAWN_ERROR" }, { secrets }); }
    closeSync(out); closeSync(err);
    // listeners first: a fast exit or an async spawn error must never be missed
    const ended = new Promise((resolve) => {
      child.once("error", (e) => resolve({ spawnError: e }));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const state = { job, child, pgid: child.pid ?? null, secrets, cancelRequested: d.cancelRequested, timedOut: false };
    running = state; // set first: if journalling throws, dispatch error handling must not release this job's ports
    // exit handling is installed before any write that can fail (closure31 O1): a failed journal write can no longer leave
    // `running` set forever and stall the queue; the job is finished (and the next one started) when the child exits
    ended.then((res) => onEnded(state, res)).catch((e) => log(`end handling error: ${e.message}`));
    // journal the spawned pid/pgid before any await: a crash from here on leaves a recorded (unverified) group for restart
    // reconciliation to quarantine instead of an untracked runner whose ports would be released
    if (child.pid) store.update(job, { process: { pid: child.pid, pgid: child.pid, birth: null, command: null } }, "spawned", { pid: child.pid });
    const ident = child.pid ? await identityOrNull(child.pid) : null;
    store.update(job, { status: "running", started_at: new Date().toISOString(), process: ident ?? { pid: child.pid ?? null, pgid: child.pid ?? null, birth: null, command: null } }, "running", { pid: child.pid ?? null });
    if (state.cancelRequested || d.cancelRequested) { state.cancelRequested = true; terminate(state); }
    if (running === state) state.timer = setTimeout(() => { state.timedOut = true; terminate(state); }, config.limits.job_timeout_s * 1000); // not for a runner that already ended
  }

  async function identityOrNull(pid) {
    for (let i = 0; i < 25; i++) { const id = processIdentity(pid); if (id) return id; await sleep(20); }
    return null; // the leader may already have exited; its group is still reaped by pgid on exit
  }

  async function onEnded(state, res) {
    clearTimeout(state.timer);
    const descendants = state.pgid ? await reapGroup(state.pgid) : false;
    clearTimeout(state.killTimer);
    running = null;
    if (stopped) return; // a stopping service leaves the job for restart reconciliation
    const { job } = state;
    if (res.spawnError) finish(job, { status: "failed", reason: "SPAWN_ERROR" }, { secrets: state.secrets });
    else if (state.cancelRequested) finish(job, { status: "cancelled", reason: "CANCELLED" }, { secrets: state.secrets });
    else if (state.timedOut) finish(job, { status: "timed_out", reason: "JOB_TIMEOUT" }, { secrets: state.secrets });
    else {
      const parsed = readRunnerResults(join(store.dirOf(job.id), "raw"));
      const expected = expectedCoverage({ profile: config.profiles[job.request.profile], request: job.request });
      const outcome = decideOutcome({ exitCode: res.code, signal: res.signal, parsed, expected });
      if (descendants && outcome.status === "succeeded") { outcome.status = "failed"; outcome.reason = "RUNNER_LEFT_DESCENDANTS"; }
      finish(job, outcome, { parsed, secrets: state.secrets });
    }
    store.update(store.get(job.id), {}, "group_reaped", { descendants_terminated: descendants });
    setImmediate(() => startNext().catch((e) => log(`supervisor error: ${e.message}`)));
  }

  function terminate(state) {
    const rec = store.get(state.job.id)?.process;
    const signal = (sig) => {
      if (rec && signalRecordedGroup(rec, sig)) return;
      // leader identity unavailable (exited early or not yet recorded): signal our own child directly
      try { state.child.kill(sig); } catch {}
    };
    signal("SIGTERM");
    clearTimeout(state.killTimer);
    state.killTimer = setTimeout(() => signal("SIGKILL"), config.limits.cancel_grace_ms);
  }

  return {
    /** Mark jobs left starting/running by a previous service instance as interrupted; kill their runner only if verified. */
    reconcile() {
      for (const job of store.list().filter((j) => j.status === "running" || j.status === "starting")) {
        const rec = job.process;
        const killed = !!(rec && signalRecordedGroup(rec, "SIGKILL"));
        const orphaned = !killed && rec?.pgid && groupAlive(rec.pgid);
        // a starting job with no process record may have spawned a runner that was never journalled: its ports are not
        // provably free, so they are quarantined too (nothing is signalled without a verified identity)
        const unknown = !killed && !orphaned && !rec && job.status === "starting";
        finish(job, { status: "interrupted", reason: killed ? "SERVICE_RESTART_KILLED_VERIFIED_RUNNER" : orphaned ? "SERVICE_RESTART_UNVERIFIED_GROUP_REMAINS" : unknown ? "SERVICE_RESTART_STARTING_UNRECORDED" : "SERVICE_RESTART" }, { quarantinePorts: !!(orphaned || unknown) });
        log(`reconciled job ${job.id}: interrupted (${killed ? "verified runner killed" : orphaned ? "group remains but leader unverifiable; not signalled" : unknown ? "starting without a process record; ports quarantined" : "no live runner"})`);
      }
    },
    kick: () => { startNext().catch((e) => log(`supervisor error: ${e.message}`)); },
    cancel(job) {
      if (dispatching && dispatching.id === job.id) { dispatching.cancelRequested = true; if (running?.job.id === job.id) { running.cancelRequested = true; terminate(running); } store.update(store.get(job.id), {}, "cancel_requested"); return true; }
      if (running && running.job.id === job.id) { running.cancelRequested = true; store.update(store.get(job.id), {}, "cancel_requested"); terminate(running); return true; }
      if (job.status === "queued") { finish(job, { status: "cancelled", reason: "CANCELLED" }); return true; }
      return false;
    },
    queuedCount: () => store.list().filter((j) => j.status === "queued").length,
    stop() { stopped = true; },
    _state: () => ({ running: running?.job.id ?? null, dispatching: dispatching?.id ?? null }),
  };
}
