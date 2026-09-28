#!/usr/bin/env node
// Offline rerun of pc-verify (SG-4, CDX2-06): a FRESH clone of this repository, no database or credentials in
// the environment, under a sandbox-exec profile that is deny-by-default for filesystem and network.
//   node runner/offline.mjs <run-out-dir>
// Reads <run-out-dir>/packet and <run-out-dir>/trust.json; writes <run-out-dir>/offline-verification.json.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PC_ROOT } from "./lib.mjs";

const runOut = process.argv[2];
if (!runOut) {
  console.error("usage: node runner/offline.mjs <run-out-dir>");
  process.exit(2);
}
const node = realpathSync(process.execPath);
const nodeDir = dirname(dirname(node));
const R = realpathSync(mkdtempSync(join(tmpdir(), "pc-offline-")));
const IN = join(R, "in");
const OUT = join(R, "out");
mkdirSync(OUT, { recursive: true });
execFileSync("git", ["clone", "-q", "--no-hardlinks", PC_ROOT, join(IN, "pc")]);
execFileSync("git", ["-C", join(IN, "pc"), "remote", "remove", "origin"]);
cpSync(join(PC_ROOT, "node_modules"), join(IN, "pc", "node_modules"), { recursive: true });
cpSync(join(runOut, "packet"), join(IN, "packet-copy"), { recursive: true });
cpSync(join(runOut, "trust.json"), join(IN, "trust.json"));
// canaries OUTSIDE the allowed paths: synthetic private state (the run's own node state lives outside too)
const canaryDir = join(R, "private");
mkdirSync(canaryDir);
writeFileSync(join(canaryDir, "canary.txt"), "private-state-canary");

const profile = `(version 1)
(deny default)
(allow process-exec (literal "${node}"))
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix-shm)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/usr") (subpath "/System") (subpath "/Library/Preferences") (subpath "/private/etc") (subpath "/private/var/db") (subpath "/dev") (subpath "${nodeDir}") (subpath "${IN}"))
(allow file-write* (subpath "${OUT}") (literal "/dev/null"))
(allow file-ioctl (subpath "/dev"))
(deny network*)
`;
const sb = join(R, "offline-verify.sb");
writeFileSync(sb, profile);
const run = (args) => spawnSync("sandbox-exec", ["-f", sb, node, ...args], { env: { PATH: "/usr/bin:/bin", HOME: OUT }, encoding: "utf8", timeout: 120000 });

// 1. canaries must be denied before the profile is trusted
const canary = run(["-e", `
const fs=require("fs");
let r="denied";try{fs.readFileSync(${JSON.stringify(join(canaryDir, "canary.txt"))});r="READ"}catch{}
require("net").connect(443,"1.1.1.1").on("error",()=>{console.log(JSON.stringify({private:r,network:"denied"}));process.exit(0)}).on("connect",()=>{console.log(JSON.stringify({private:r,network:"OPEN"}));process.exit(0)});
`]);
const canaries = JSON.parse(canary.stdout.trim() || "{}");
const trusted = canaries.private === "denied" && canaries.network === "denied";

// 2. the normal packet, then incomplete and tampered copies
const verify = (packet, name) => {
  const r = run([join(IN, "pc", "verifier", "cli.mjs"), packet, "--trust", join(IN, "trust.json"), "--out", join(OUT, name)]);
  return { exit: r.status, verdict: r.stdout.trim().split("\n").at(-1), failed: r.stdout.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5, 60)) };
};
const results = { profile_allow_list: { read: ["/", "/usr", "/System", "/Library/Preferences", "/private/etc", "/private/var/db", "/dev", nodeDir, IN], write: [OUT], network: "denied" }, canaries, trusted };
if (trusted) {
  results.normal = verify(join(IN, "packet-copy"), "normal");
  const incomplete = join(IN, "packet-incomplete");
  cpSync(join(IN, "packet-copy"), incomplete, { recursive: true });
  rmSync(join(incomplete, "results", "results.jsonl"));
  const tampered = join(IN, "packet-tampered");
  cpSync(join(IN, "packet-copy"), tampered, { recursive: true });
  execFileSync("sh", ["-c", `printf 'x' >> "${join(tampered, "profile", "pc-0.1-s1.json")}"`]);
  results.incomplete = verify(incomplete, "incomplete");
  results.tampered = verify(tampered, "tampered");
}
results.ok = trusted && results.normal?.exit === 0 && results.incomplete?.exit !== 0 && results.tampered?.exit !== 0;
writeFileSync(join(runOut, "offline-verification.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
rmSync(R, { recursive: true, force: true });
process.exit(results.ok ? 0 : 1);
