// unit57: the service runner's own reference nodes (and its test targets) listen on loopback only, measured on the actual
// listening sockets (lsof), not inferred from arguments. Ports: targets 4544/4545, runner-owned 4546/4547 (lease 4500–4550).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";
import { startReferenceNode } from "../../runner/lib.mjs";
import { RUNNER_NODE_HOST } from "../../runner/service-run.mjs";

// lsof from an explicit system path (a clean runner PATH may omit /usr/sbin). An unavailable or failing lsof is an error,
// never "no listeners": only lsof's documented "nothing matched" exit (status 1, empty output) means none is listening.
const LSOF = ["/usr/sbin/lsof", "/usr/bin/lsof"].find((p) => existsSync(p)) ?? null;
/** The listening addresses of TCP `port` as lsof reports them (e.g. "127.0.0.1:4546", "*:4546", "[::1]:4546"). */
function listeners(port) {
  if (!LSOF) throw new Error("lsof is not available at /usr/sbin/lsof or /usr/bin/lsof: listeners cannot be measured");
  let out = "";
  try { out = execFileSync(LSOF, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fn"], { encoding: "utf8" }); }
  catch (e) {
    if (e.status === 1 && !String(e.stdout ?? "").trim() && !String(e.stderr ?? "").trim()) return [];
    throw new Error(`lsof failed for port ${port}: ${e.message}`);
  }
  return [...new Set(out.split("\n").filter((l) => l.startsWith("n")).map((l) => l.slice(1)))];
}
const externalV4 = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address ?? null;
const connects = (host, port) => new Promise((ok) => { const s = net.connect(port, host); s.once("connect", () => { s.destroy(); ok(true); }); s.once("error", () => ok(false)); setTimeout(() => { s.destroy(); ok(false); }, 1500); });

let targets = null;
before(async () => {
  const work = mkdtempSync(join(tmpdir(), "lb57-"));
  targets = { a: await startReferenceNode({ name: "ref-a", port: 4544, work, host: "127.0.0.1" }), b: await startReferenceNode({ name: "ref-b", port: 4545, work, host: "127.0.0.1" }) };
});
after(() => { for (const n of Object.values(targets ?? {})) n.stop(); });

test("unit57: reference fixtures started with host 127.0.0.1 listen only on 127.0.0.1 (measured)", async () => {
  assert.equal(RUNNER_NODE_HOST, "127.0.0.1");
  for (const port of [4544, 4545]) assert.deepEqual(listeners(port), [`127.0.0.1:${port}`], `port ${port}`);
  if (externalV4) assert.equal(await connects(externalV4, 4544), false, `reachable on external address ${externalV4}`);
});

test("unit57: the real runner's own pc-ref/pc-aux listen only on loopback while a job runs (measured)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lb57-run-"));
  writeFileSync(join(dir, "targets.json"), JSON.stringify([
    { id: "ref-a", implementation: "project-connect-reference-node", version: "t", base_url: targets.a.base, roles: ["home", "host"], setup: { kind: "reference-admin-v1" }, capabilities: [] },
    { id: "ref-b", implementation: "project-connect-reference-node", version: "t", base_url: targets.b.base, roles: ["home", "host"], setup: { kind: "reference-admin-v1" }, capabilities: [] }]));
  writeFileSync(join(dir, "creds.json"), JSON.stringify({ "ref-a": { admin_token: targets.a.admin }, "ref-b": { admin_token: targets.b.admin } }), { mode: 0o600 });
  const child = spawn(process.execPath, [join(ROOT, "runner", "service-run.mjs"), "--targets", join(dir, "targets.json"), "--pairs", "ref-a:ref-b", "--gate", "SG-2", "--reps", "1", "--profile", "pc-0.1-s1", "--out", join(dir, "out"), "--ref-port", "4546", "--aux-port", "4547"],
    { env: { PATH: "/usr/bin:/bin", CONNECT_CREDENTIALS_FILE: join(dir, "creds.json") }, stdio: ["ignore", "ignore", "pipe"] });
  const exited = new Promise((r) => child.once("exit", (code) => r(code)));
  const seen = { 4546: new Set(), 4547: new Set() };
  let done = false;
  exited.then(() => (done = true));
  while (!done) {
    for (const p of [4546, 4547]) for (const l of listeners(p)) seen[p].add(l);
    if (externalV4 && seen[4547].size && !seen.ext) seen.ext = { reachable: await connects(externalV4, 4547) };
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(await exited, 0, "runner job completed");
  assert.deepEqual([...seen[4546]], ["127.0.0.1:4546"], "pc-ref listener");
  assert.deepEqual([...seen[4547]], ["127.0.0.1:4547"], "pc-aux listener");
  if (seen.ext) assert.equal(seen.ext.reachable, false, `pc-aux reachable on external address ${externalV4}`);
});
