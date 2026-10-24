#!/usr/bin/env node
// Connect job service CLI.
//   node service/cli.mjs serve --config DIR
//   CONNECT_TOKEN=… node service/cli.mjs submit|status|results|cancel --url http://127.0.0.1:4300 [--job ID] [--file request.json]
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { acquireLease } from "./lease.mjs";
import { createStore } from "./store.mjs";
import { createSupervisor } from "./supervisor.mjs";
import { createApi } from "./server.mjs";
import { atomicWriteJson, sha256Hex } from "./util.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const log = (m) => console.error(`[connect-service ${new Date().toISOString()}] ${m}`);

function composition(config) {
  let commit = null;
  try { commit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  const fileHash = (p) => { try { return sha256Hex(readFileSync(p)); } catch { return null; } };
  return { service_commit: commit, package_lock_sha256: fileHash(join(ROOT, "package-lock.json")), runner_node_sha256: fileHash(config.runner.node), runner_entry_sha256: fileHash(config.runner.entry) };
}

async function serve() {
  if (!args.config) throw new Error("--config DIR is required");
  const config = loadConfig(args.config);
  const lease = acquireLease(config.state_dir);
  const store = createStore(config.state_dir);
  const supervisor = createSupervisor({ config, store, log });
  supervisor.reconcile();
  const server = createApi({ config, store, supervisor, composition: composition(config) });
  await new Promise((ok) => server.listen(config.listen.port, config.listen.host, ok));
  const port = server.address().port;
  atomicWriteJson(join(config.state_dir, "ready.json"), { pid: process.pid, host: config.listen.host, port });
  log(`listening on ${config.listen.host}:${port}`);
  supervisor.kick();
  const shutdown = () => {
    supervisor.stop();
    server.close();
    rmSync(join(config.state_dir, "ready.json"), { force: true });
    lease.release();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function client() {
  const url = (args.url ?? "http://127.0.0.1:4300").replace(/\/$/, "");
  const token = process.env.CONNECT_TOKEN;
  if (!token) throw new Error("CONNECT_TOKEN is required");
  const call = async (method, path, body) => {
    const r = await fetch(url + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    console.log(JSON.stringify(await r.json(), null, 2));
    process.exitCode = r.ok ? 0 : 1;
  };
  if (cmd === "submit") return call("POST", "/v1/jobs", JSON.parse(readFileSync(args.file, "utf8")));
  if (!args.job) throw new Error("--job ID is required");
  if (cmd === "status") return call("GET", `/v1/jobs/${args.job}`);
  if (cmd === "results") return call("GET", `/v1/jobs/${args.job}/results`);
  if (cmd === "cancel") return call("POST", `/v1/jobs/${args.job}/cancel`);
}

try {
  if (cmd === "serve") await serve();
  else if (["submit", "status", "results", "cancel"].includes(cmd)) await client();
  else { console.error("usage: cli.mjs serve --config DIR | submit|status|results|cancel --url URL [--job ID] [--file F]"); process.exit(2); }
} catch (e) { log(e.message); process.exit(1); }
