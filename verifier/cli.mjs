#!/usr/bin/env node
// pc-verify — offline evidence-packet verifier.
//   node verifier/cli.mjs <packet-dir> --trust <trust.json> [--out <report-dir>]
// Exit 0 only when every check passes. Writes report.json and report.md to --out (never into the packet).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toMarkdown, verifyPacket } from "./verify.mjs";

const argv = process.argv.slice(2);
const packet = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--trust" && argv[argv.indexOf(a) - 1] !== "--out");
const opt = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
if (!packet || !opt("trust")) {
  console.error("usage: pc-verify <packet-dir> --trust <trust.json> [--out <report-dir>]");
  process.exit(2);
}
const trust = JSON.parse(readFileSync(opt("trust"), "utf8"));
let report;
try {
  report = verifyPacket(resolve(packet), trust);
} catch (e) {
  report = { ok: false, content_root: null, checks: [{ id: "verifier", ok: false, detail: e.message }] };
}
const out = opt("out");
if (out) {
  if (resolve(out).startsWith(resolve(packet))) {
    console.error("pc-verify: the report must be written outside the packet");
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(out, "report.md"), toMarkdown(report, packet));
}
for (const c of report.checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.id}: ${c.detail}`);
console.log(report.ok ? "PASS" : "FAIL");
process.exit(report.ok ? 0 : 1);
