// Test helpers: a throwaway config + state + secrets tree under the OS temp dir, a service child process on a loopback
// ephemeral port, and a small HTTP client.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
export const TOKENS = { alice: "tok-alice-0123456789abcdef", bob: "tok-bob-0123456789abcdef", admin: "tok-admin-0123456789abcdef" };
export const SECRET = "super-secret-admin-token-value-42";
export const SHORT_SECRET = "12345";
const sha = (s) => createHash("sha256").update(s).digest("hex");

export function makeTree({ mode = "pass", limits = {}, targets = null, mutate = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), "connect-svc-"));
  const dirs = { base, config: join(base, "config"), state: join(base, "state"), secrets: join(base, "secrets") };
  for (const d of [dirs.config, dirs.state, dirs.secrets]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(join(dirs.secrets, "ref-a.json"), JSON.stringify({ admin_token: SECRET, pin: SHORT_SECRET }), { mode: 0o600 });
  const profile = join(base, "profile.json");
  writeFileSync(profile, JSON.stringify({ id: "pc-test", tests: [{ id: "PC-CORE-1", gate: "SG-2" }, { id: "PC-CORE-2", gate: "SG-2" }, { id: "PC-DRILL-1", gate: "SG-2" }, { id: "PC-LATE-1", gate: "SG-3" }] }));
  const service = {
    state_dir: dirs.state, secrets_dir: dirs.secrets, listen: { host: "127.0.0.1", port: 0 },
    limits: { job_timeout_s: 30, cancel_grace_ms: 300, max_queued: 3, ...limits },
    profiles: { "pc-test": profile },
    runner: { node: process.execPath, entry: join(ROOT, "tests/service/fixtures/fake-runner.mjs"), env: { FAKE_RUNNER_MODE: mode, FAKE_PROFILE: profile } },
    // a bounded, configurable pool per tree: CONNECT_TEST_PORT_BASE / CONNECT_TEST_PORT_SLOTS (4 ports per slot); default as before
    port_pool: { from: Number(process.env.CONNECT_TEST_PORT_BASE ?? 47100) + Math.floor(Math.random() * Number(process.env.CONNECT_TEST_PORT_SLOTS ?? 400)) * 4, to: 0 },
  };
  service.port_pool.to = service.port_pool.from + 3;
  const tokens = [
    { id: "alice", role: "submitter", token_sha256: sha(TOKENS.alice) },
    { id: "bob", role: "submitter", token_sha256: sha(TOKENS.bob) },
    { id: "ops", role: "admin", token_sha256: sha(TOKENS.admin) },
  ];
  const tgts = targets ?? [
    { id: "ref-a", implementation: "project-connect-reference-node", version: "test", base_url: "http://127.0.0.1:47001", roles: ["home", "host"], setup: { kind: "reference-admin-v1" }, credentials_ref: "ref-a.json" },
    { id: "ref-b", implementation: "project-connect-reference-node", version: "test", base_url: "http://127.0.0.1:47002", roles: ["host"], setup: { kind: "reference-admin-v1" } },
  ];
  const cfg = { service, tokens, targets: tgts };
  if (mutate) mutate(cfg, dirs);
  writeFileSync(join(dirs.config, "service.json"), JSON.stringify(cfg.service));
  writeFileSync(join(dirs.config, "tokens.json"), JSON.stringify(cfg.tokens));
  writeFileSync(join(dirs.config, "targets.json"), JSON.stringify(cfg.targets));
  return dirs;
}

export async function startService(dirs, { expectFail = false } = {}) {
  const readyFile = join(dirs.state, "ready.json");
  const child = spawn(process.execPath, [join(ROOT, "service/cli.mjs"), "serve", "--config", dirs.config], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((r) => child.once("exit", (code) => r(code)));
  for (let i = 0; i < 200; i++) {
    if (existsSync(readyFile)) {
      const ready = JSON.parse(readFileSync(readyFile, "utf8"));
      if (ready.pid === child.pid) {
        if (expectFail) { child.kill("SIGKILL"); await exited; throw new Error(`service started although startup failure was expected: ${stderr}`); }
        return { child, base: `http://127.0.0.1:${ready.port}`, stderr: () => stderr, exited };
      }
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 2000))]);
  if (expectFail) {
    // an expected startup failure must be an actual non-zero exit, never a timeout or an unknown state
    if (!Number.isInteger(code) || code === 0) { child.kill("SIGKILL"); throw new Error(`expected a non-zero startup exit, got ${code}: ${stderr}`); }
    return { child, code, stderr: () => stderr };
  }
  child.kill("SIGKILL");
  throw new Error(`service did not start (code ${code}): ${stderr}`);
}

export async function api(base, method, path, { token, body } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

export async function waitStatus(base, id, token, statuses, ms = 10000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = await api(base, "GET", `/v1/jobs/${id}`, { token });
    if (statuses.includes(r.json?.status)) return r.json;
    if (Date.now() > until) throw new Error(`job ${id} stuck in ${r.json?.status}`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

export const stop = async (svc) => { if (svc?.child && svc.child.exitCode === null) { svc.child.kill("SIGTERM"); await svc.exited; } };
export const chmod600 = (p) => chmodSync(p, 0o600);
