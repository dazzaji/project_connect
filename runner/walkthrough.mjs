#!/usr/bin/env node
// One command: start two Beta nodes, run the full pc-0.1-s1 matrix (SG-2..SG-4), verify the packet offline.
//   ILP_PG_ADMIN_URL=postgres://… node runner/walkthrough.mjs [--beta ../interlateral_platform_beta] [--keep]
// --keep leaves beta-one, beta-two, and the harness running afterwards so the operator console can be explored.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PC_ROOT, sleep } from "./lib.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const keep = argv.includes("--keep");
const beta = resolve(opt("beta", join(PC_ROOT, "..", "interlateral_platform_beta")));
if (!process.env.ILP_PG_ADMIN_URL) {
  console.error("set ILP_PG_ADMIN_URL to a PostgreSQL role that may CREATE DATABASE");
  process.exit(2);
}
const say = (m) => console.log(`\n=== ${m}`);

say(`starting beta-one and beta-two from ${beta}`);
const harness = spawn(process.execPath, ["scripts/federation-local.mjs", "up"], { cwd: beta, env: process.env, stdio: ["ignore", "pipe", "inherit"], detached: true });
await new Promise((res, rej) => {
  let buf = "";
  harness.stdout.on("data", (d) => {
    buf += d;
    if (buf.includes("READY")) res();
  });
  harness.on("exit", (c) => rej(new Error(`harness exited ${c}`)));
});
const stopHarness = () => { try { process.kill(-harness.pid, "SIGTERM"); } catch {} };
process.on("exit", () => { if (!keep) stopHarness(); });

say("running the matrix: SC-1..SC-4 × 2, gates SG-2..SG-4 (about 30 minutes; the outage and expiry drills wait on real time)");
const out = join(PC_ROOT, ".run", `walkthrough-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const run = spawnSync(process.execPath, [join(PC_ROOT, "runner", "run.mjs"), "--harness", "http://127.0.0.1:4180", "--gate", "all", "--out", out], { stdio: "inherit" });

say("offline verification (fresh clone, deny-by-default sandbox, network denied)");
const off = spawnSync(process.execPath, [join(PC_ROOT, "runner", "offline.mjs"), out], { encoding: "utf8" });
const offline = JSON.parse(readFileSync(join(out, "offline-verification.json"), "utf8"));
console.log(`canaries: private ${offline.canaries.private}, network ${offline.canaries.network}; normal packet exit ${offline.normal?.exit}; incomplete exit ${offline.incomplete?.exit}; tampered exit ${offline.tampered?.exit} → ${offline.ok ? "PASS" : "FAIL"}`);

const verdict = run.status === 0 && off.status === 0;
say(`${verdict ? "ALL GATES PASS" : "FAILURES — see the tables above"}  (evidence: ${out})`);
if (keep) {
  console.log(`
Nodes left running for the walkthrough:
  beta-one  http://beta-one.localhost:4101   (operator console: /events)
  beta-two  http://beta-two.localhost:4102
  harness   http://127.0.0.1:4180/nodes
Admin login uses the node's own mailbox (see the harness work dir). Stop with: kill ${harness.pid}`);
  await sleep(1e9);
}
process.exit(verdict ? 0 : 1);
