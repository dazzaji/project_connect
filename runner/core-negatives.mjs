// Negative evidence packets for the draft core-service profile (pc-core-service-0.1): each must be rejected by the offline
// verifier for the stated reason. The historical NEG-1..10 are mirrored for this profile's packet layout (runner/sg4.mjs keeps
// the historical set unchanged); C-* cover pinned-pair coverage, applicability and trust roots.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalBytes } from "../lib/jcs.mjs";
import { generateKey, sha256Hex, signJws, TYP } from "../lib/jws.mjs";
import { CORE_PROFILE_PATH, JOB_MANIFEST_PATH } from "../verifier/core-service.mjs";
import { verifyPacket } from "../verifier/verify.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const J = (dir, p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const W = (dir, p, obj) => writeFileSync(join(dir, p), typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) + "\n");
function variant(packetDir, mutate) {
  const dir = mkdtempSync(join(tmpdir(), "pc-cneg-"));
  cpSync(packetDir, dir, { recursive: true });
  mutate(dir);
  return dir;
}
/** attacker-style re-hash of content.json and envelope (cannot re-sign the attestations) */
function rehash(dir) {
  const content = J(dir, "content.json");
  for (const f of content.files) {
    try { const b = readFileSync(join(dir, f.path)); f.sha256 = sha(b); f.bytes = b.length; } catch {}
  }
  const rows = readFileSync(join(dir, "results/results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  content.summary = { tests: rows.length, passed: rows.filter((r) => r.status === "pass").length, failed: rows.filter((r) => r.status === "fail").length, not_applicable: rows.filter((r) => r.status === "not_applicable").length };
  const text = JSON.stringify(content, null, 2) + "\n";
  W(dir, "content.json", text);
  const env = J(dir, "envelope.json");
  env.content_manifest.sha256 = sha(Buffer.from(text));
  env.content_root = sha256Hex(canonicalBytes(content));
  W(dir, "envelope.json", env);
}
const rowsOf = (d) => readFileSync(join(d, "results/results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const writeRows = (d, rows) => W(d, "results/results.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

export function coreNegativeCases(packetDir, trust) {
  const c0 = J(packetDir, "content.json");
  const firstExport = c0.files.find((f) => f.path.startsWith("exports/") && f.path.endsWith("/receipts.jsonl")).path.split("/").slice(0, 2).join("/");
  const m0 = J(packetDir, JOB_MANIFEST_PATH);
  const p0 = m0.pairs[0];
  const label0 = `${p0.home}:${p0.host}`;
  const naFree = rowsOf(packetDir).find((r) => r.status === "pass" && !["PC-DISC-5", "PC-REV-4", "PC-REV-5", "PC-PROV-1", "PC-INTEROP-AB", "PC-INTEROP-BA"].includes(r.test_id));
  const cases = [
    // mirrors of the historical set
    { id: "NEG-1 deleted required file", expect: "files", dir: variant(packetDir, (d) => rmSync(join(d, "subjects", c0.subjects[0].label, "discovery.json"))) },
    { id: "NEG-2 removed result (re-hashed)", expect: "attestations", dir: variant(packetDir, (d) => { writeRows(d, rowsOf(d).slice(1)); rehash(d); }) },
    { id: "NEG-3b removed grant link (re-hashed)", expect: "exports", dir: variant(packetDir, (d) => { const p = `${firstExport}/grants.jsonl`; W(d, p, ""); const m = J(d, `${firstExport}/manifest.json`); const f = m.files.find((x) => x.path === "grants.jsonl"); f.sha256 = sha(Buffer.from("")); f.bytes = 0; W(d, `${firstExport}/manifest.json`, m); rehash(d); }) },
    { id: "NEG-4 altered signed byte", expect: "attestations", dir: variant(packetDir, (d) => { const env = J(d, "envelope.json"); const a = env.attestations[0]; const jws = readFileSync(join(d, a.path), "utf8").trim().split("."); const sig = Buffer.from(jws[2], "base64url"); sig[5] ^= 1; W(d, a.path, `${jws[0]}.${jws[1]}.${sig.toString("base64url")}\n`); a.sha256 = sha(readFileSync(join(d, a.path))); W(d, "envelope.json", env); }) },
    { id: "NEG-6 changed profile", expect: "profile", dir: variant(packetDir, (d) => { const p = J(d, CORE_PROFILE_PATH); p.parameters.revocation_bound_s = 600; W(d, CORE_PROFILE_PATH, p); const c = J(d, "content.json"); c.profile.sha256 = sha256Hex(canonicalBytes(p)); W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d); }) },
    { id: "NEG-7 changed build", expect: "subjects", dir: variant(packetDir, (d) => { const c = J(d, "content.json"); c.subjects[0].software.build = "git:000000000000"; W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d); }) },
    // the content-manifest schema forbids ".." segments, so the earliest correct rejection is content-manifest (the historical
    // NEG-8 expects "files" and is recorded as rejected-for-another-reason; its verdict is kept unchanged in runner/sg4.mjs)
    { id: "NEG-8 path traversal entry", expect: "content-manifest", dir: variant(packetDir, (d) => { const c = J(d, "content.json"); c.files.push({ path: "../outside.json", sha256: "0".repeat(64), bytes: 0 }); W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d); }) },
    { id: "NEG-8b absolute path entry (schema-valid, unsafe)", expect: "files", dir: variant(packetDir, (d) => { const c = J(d, "content.json"); c.files.push({ path: "/tmp/outside.json", sha256: "0".repeat(64), bytes: 0 }); W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d); }) },
    { id: "NEG-9 duplicate entry", expect: "files", dir: variant(packetDir, (d) => { const c = J(d, "content.json"); c.files.push({ ...c.files[0] }); W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d); }) },
    { id: "NEG-10 substituted self-signed key set", expect: "subjects", dir: variant(packetDir, (d) => {
      const c = J(d, "content.json"); const s = c.subjects[0]; const k = generateKey(s.keys[0].kid);
      const disc = J(d, `subjects/${s.label}/discovery.json`); disc.keys = [k.publicJwk]; W(d, `subjects/${s.label}/discovery.json`, disc);
      s.keys = [k.publicJwk]; s.discovery_sha256 = sha256Hex(canonicalBytes(disc)); W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d);
      const env = J(d, "envelope.json"); const a = env.attestations.find((x) => x.signer === s.label);
      W(d, a.path, signJws({ iss: s.base_url, jti: "forged", iat: Math.floor(Date.now() / 1000), role: "node", content_root: env.content_root, profile: c.profile.id, build: s.software.build }, k.privateJwk, TYP.attestation) + "\n");
      a.sha256 = sha(readFileSync(join(d, a.path))); W(d, "envelope.json", env);
    }) },
    // core-service coverage, applicability and trust
    { id: "C-1 omitted pinned pair (re-hashed)", expect: "results", dir: variant(packetDir, (d) => { writeRows(d, rowsOf(d).filter((r) => r.scenario !== label0)); rehash(d); }) },
    { id: "C-2 extra unpinned pair (re-hashed)", expect: "results", dir: variant(packetDir, (d) => { const rows = rowsOf(d); writeRows(d, [...rows, ...rows.filter((r) => r.scenario === label0).map((r) => ({ ...r, scenario: `${p0.host}:${p0.home}x` }))]); rehash(d); }) },
    { id: "C-3 substituted pair in the job manifest (re-hashed)", expect: "job-manifest", dir: variant(packetDir, (d) => { const m = J(d, JOB_MANIFEST_PATH); m.pairs[0] = { home: p0.host, host: p0.home }; W(d, JOB_MANIFEST_PATH, m); rehash(d); }) },
    { id: "C-4 duplicate result row (re-hashed)", expect: "results", dir: variant(packetDir, (d) => { const rows = rowsOf(d); writeRows(d, [...rows, rows[0]]); rehash(d); }) },
    { id: "C-5 unexpected test id (re-hashed)", expect: "results", dir: variant(packetDir, (d) => { const rows = rowsOf(d); writeRows(d, [...rows, { ...rows[0], test_id: "PC-CORE-99" }]); rehash(d); }) },
    { id: "C-6 unexpected repetition (re-hashed)", expect: "results", dir: variant(packetDir, (d) => { const rows = rowsOf(d); writeRows(d, [...rows, { ...rows[0], repetition: m0.repetitions + 1 }]); rehash(d); }) },
    { id: "C-7 not_applicable without a profile rule (re-hashed)", expect: "results", dir: variant(packetDir, (d) => { writeRows(d, rowsOf(d).map((r) => (r === null || r.test_id !== naFree.test_id || r.scenario !== naFree.scenario || r.repetition !== naFree.repetition ? r : { ...r, status: "not_applicable" }))); rehash(d); }) },
    { id: "C-8 all rows not_applicable (re-hashed)", expect: "results", dir: variant(packetDir, (d) => { writeRows(d, rowsOf(d).map((r) => ({ ...r, status: "not_applicable" }))); rehash(d); }) },
  ];
  const trusts = [
    { id: "T-1 untrusted root: operator pin is another key", expect: "subjects", trust: { ...trust, signers: { ...trust.signers, [c0.subjects[0].label]: { thumbprints: ["A".repeat(43)] } } } },
    { id: "T-2 job manifest pin absent from the trust file", expect: "job-manifest", trust: { ...trust, job_manifest_sha256: undefined } },
    { id: "T-3 job manifest pin is another job's", expect: "job-manifest", trust: { ...trust, job_manifest_sha256: "0".repeat(64) } },
    { id: "T-4 core mode not selected (historical trust): no silent fallback", expect: "profile", trust: { ...trust, profile_mode: undefined } },
  ];
  const out = cases.map((c) => {
    const report = verifyPacket(c.dir, trust);
    const failed = report.checks.filter((x) => !x.ok).map((x) => x.id);
    rmSync(c.dir, { recursive: true, force: true });
    return { id: c.id, rejected: !report.ok, expected_check: c.expect, failed_checks: failed, right_reason: failed.includes(c.expect) };
  });
  for (const t of trusts) {
    const report = verifyPacket(packetDir, t.trust);
    const failed = report.checks.filter((x) => !x.ok).map((x) => x.id);
    out.push({ id: t.id, rejected: !report.ok, expected_check: t.expect, failed_checks: failed, right_reason: failed.includes(t.expect) });
  }
  return out;
}
