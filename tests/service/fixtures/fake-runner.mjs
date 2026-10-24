// Fixture runner for service tests (not the conformance runner). Behavior is chosen by the operator-config env
// FAKE_RUNNER_MODE; it records its argv and the credentials it was handed, then writes results under --out covering every
// (test, home:host, repetition) of the job (FAKE_PROFILE names the profile file so it can enumerate gate tests).
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const out = arg("out");
const mode = process.env.FAKE_RUNNER_MODE ?? "pass";
const creds = JSON.parse(readFileSync(process.env.CONNECT_CREDENTIALS_FILE, "utf8"));
writeFileSync(join(out, "argv.json"), JSON.stringify({ argv, credential_targets: Object.keys(creds), pid: process.pid }));
const profile = JSON.parse(readFileSync(process.env.FAKE_PROFILE, "utf8"));
const gate = arg("gate"), reps = Number(arg("reps")), pairs = arg("pairs").split(","), also = arg("also") ? arg("also").split(",") : [];
const ids = [...new Set([...profile.tests.filter((t) => gate === "all" || t.gate === gate).map((t) => t.id), ...also])];
const secretOf = () => Object.values(Object.values(creds)[0] ?? {})[0] ?? "";
const rows = [];
for (const pair of pairs) for (let rep = 1; rep <= reps; rep++) for (const id of ids)
  rows.push({ test_id: id, status: id === "PC-DRILL-1" ? "not_applicable" : "pass", scenario: pair, repetition: rep, requirement_ids: ["R-X-1"], ...(id === "PC-DRILL-1" ? { reason: "CAPABILITY_ABSENT" } : {}) });
const write = (r) => writeFileSync(join(out, "results.jsonl"), r.map((x) => JSON.stringify(x)).join("\n") + (r.length ? "\n" : ""));

switch (mode) {
  case "pass": write(rows); break;
  case "fail": rows[1].status = "fail"; rows[1].detail = "expected 403"; write(rows); process.exit(1);
  case "empty": write([]); break;
  case "only-na": write(rows.map((r) => ({ ...r, status: "not_applicable" }))); break;
  case "malformed": writeFileSync(join(out, "results.jsonl"), "{not json\n"); break;
  case "missing": break;
  case "partial": write(rows.slice(1)); break;
  case "unknown": write([...rows, { ...rows[0], test_id: "NEVER-REQUESTED" }]); break;
  case "duplicate": write([...rows, rows[0]]); break;
  // runner-supplied text carrying the synthetic secret in the very fields a coverage failure is about (closure02 F1)
  case "unexpected-secret": write([...rows, { ...rows[0], test_id: `X-${secretOf()}`, scenario: `${secretOf()}-${"s".repeat(400)}` }]); break;
  case "duplicate-secret": write([...rows, { ...rows[0], detail: `dup ${secretOf()}` }]); break;
  case "leak": rows[0].detail = "x".repeat(495) + secretOf() + ` token ilpo_abcdefghijklmnop and Bearer abcdefghijkl and eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl`; write(rows); break;
  case "leak-slow": { const original = secretOf(); setTimeout(() => { rows[0].detail = `late ${original}`; write(rows); process.exit(0); }, 1500); break; }
  case "short-secret": rows[0].detail = `pin=${creds["ref-a"]?.pin}`; write(rows); break;
  case "orphan": { // leaves a same-group descendant running after the leader exits
    const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    writeFileSync(join(out, "descendant.pid"), String(c.pid));
    c.unref(); write(rows); process.exit(0);
  }
  case "orphan-ignore-term": { // same-group descendant that ignores SIGTERM; the leader exits at once
    const c = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
    writeFileSync(join(out, "descendant.pid"), String(c.pid));
    c.unref(); setTimeout(() => { write(rows); process.exit(0); }, 200); break;
  }
  case "sleep": setInterval(() => {}, 1000); break; // runs until killed
  case "sleep-ignore-term": process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); break;
  default: process.exit(3);
}
