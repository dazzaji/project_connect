// SG-4: exports (PC-EXP-1), packet assembly, and verification including negative packets (PC-VER-1).
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalBytes } from "../lib/jcs.mjs";
import { generateKey, sha256Hex, signJws, TYP, verifyDetached, verifyJws } from "../lib/jws.mjs";
import { validate } from "../lib/schemas.mjs";
import { assemblePacket } from "../packet/assemble.mjs";
import { thumbprint, verifyPacket } from "../verifier/verify.mjs";
import { check, expectOk, http } from "./lib.mjs";
import { createHash } from "node:crypto";

const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Close E1 on the host and export it with the scoped operator credential. */
export async function exportHostEvent(ctx) {
  await ctx.host.close(ctx.events.E1);
  const r = await http("POST", `${ctx.host.base}/ilp/v1/events/${ctx.events.E1.id}/exports`, { bearer: ctx.creds.operator.E1, body: {} });
  expectOk(r, [200, 201], "export");
  return { name: `${ctx.scenario.id.toLowerCase()}-r${ctx.rep}-${ctx.host.name}`, manifest: r.json.manifest, files: r.json.files };
}

/** PC-EXP-1 for one exported bundle. */
export async function checkExport(ctx, bundle) {
  const m = bundle.manifest;
  const v = validate("export-manifest", m);
  check(v.ok, `export manifest schema: ${v.errors.join("; ")}`);
  const d = (await http("GET", `${ctx.host.base}/.well-known/interlateral.json`)).json;
  check(m.kid === d.federation.active_kid, `export signed by ${m.kid}, not the active kid`);
  verifyDetached(m, d.keys.find((k) => k.kid === m.kid));
  for (const f of m.files) check(sha(Buffer.from(bundle.files[f.path], "utf8")) === f.sha256, `export file ${f.path} hash`);
  for (const need of ["grants.jsonl", "revocations.jsonl", "claims.jsonl", "receipts.jsonl"]) check(need in bundle.files, `export lacks ${need}`);
  check(!bundle.files["claims.jsonl"].includes("@"), "claims.jsonl carries an email-like value");
  for (const line of bundle.files["grants.jsonl"].split("\n").filter(Boolean)) {
    const g = JSON.parse(line);
    verifyJws(g.jws, (kid) => d.keys.find((k) => k.kid === kid) ?? null, { typ: TYP.grant });
  }
  check(bundle.files["grants.jsonl"].includes(ctx.grantPayload.jti), "export grants.jsonl lacks the golden-thread grant");
  return { files: m.files.length, kid: m.kid };
}

// ---------------- negative packets: each must fail, for the stated reason ----------------
function variant(packetDir, mutate) {
  const dir = mkdtempSync(join(tmpdir(), "pc-neg-"));
  cpSync(packetDir, dir, { recursive: true });
  mutate(dir);
  return dir;
}
const J = (dir, p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const W = (dir, p, obj) => writeFileSync(join(dir, p), typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) + "\n");
/** attacker-style re-hash of content.json and envelope (without the ability to re-sign attestations) */
function rehash(dir) {
  const content = J(dir, "content.json");
  for (const f of content.files) {
    if (!existsSync(join(dir, f.path))) continue;
    const b = readFileSync(join(dir, f.path));
    f.sha256 = sha(b);
    f.bytes = b.length;
  }
  const text = JSON.stringify(content, null, 2) + "\n";
  W(dir, "content.json", text);
  const env = J(dir, "envelope.json");
  env.content_manifest.sha256 = sha(Buffer.from(text));
  env.content_root = sha256Hex(canonicalBytes(content));
  W(dir, "envelope.json", env);
}

export function negativeCases(packetDir, trust) {
  const firstExport = J(packetDir, "content.json").files.find((f) => f.path.startsWith("exports/") && f.path.endsWith("/receipts.jsonl")).path.split("/").slice(0, 2).join("/");
  return [
    { id: "NEG-1 deleted required file", expect: "files", dir: variant(packetDir, (d) => rmSync(join(d, "subjects", J(d, "content.json").subjects[0].label, "discovery.json"))) },
    { id: "NEG-2 removed result (re-hashed)", expect: "attestations", dir: variant(packetDir, (d) => { const lines = readFileSync(join(d, "results/results.jsonl"), "utf8").split("\n").filter(Boolean); W(d, "results/results.jsonl", lines.slice(1).join("\n") + "\n"); rehash(d); }) },
    { id: "NEG-3 removed grant link", expect: "files", dir: variant(packetDir, (d) => { const p = `${firstExport}/receipts.jsonl`; const rs = readFileSync(join(d, p), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); const i = rs.findIndex((r) => r.authorization_grant && r.source_class === "agent_token_api"); delete rs[i].authorization_grant; W(d, p, rs.map((r) => JSON.stringify(r)).join("\n") + "\n"); }) },
    { id: "NEG-3b removed grant link (re-hashed)", expect: "exports", dir: variant(packetDir, (d) => { const p = `${firstExport}/grants.jsonl`; W(d, p, ""); const m = J(d, `${firstExport}/manifest.json`); const f = m.files.find((x) => x.path === "grants.jsonl"); f.sha256 = sha(Buffer.from("")); f.bytes = 0; W(d, `${firstExport}/manifest.json`, m); rehash(d); }) },
    { id: "NEG-4 altered signed byte", expect: "attestations", dir: variant(packetDir, (d) => { const env = J(d, "envelope.json"); const a = env.attestations[0]; const jws = readFileSync(join(d, a.path), "utf8").trim().split("."); const sig = Buffer.from(jws[2], "base64url"); sig[5] ^= 1; W(d, a.path, `${jws[0]}.${jws[1]}.${sig.toString("base64url")}\n`); a.sha256 = sha(readFileSync(join(d, a.path))); W(d, "envelope.json", env); }) },
    { id: "NEG-5 changed signer", expect: "attestations", dir: variant(packetDir, (d) => { const env = J(d, "envelope.json"); const [a, b] = env.attestations; W(d, a.path, readFileSync(join(d, b.path), "utf8")); a.sha256 = sha(readFileSync(join(d, a.path))); W(d, "envelope.json", env); }) },
    { id: "NEG-6 changed profile", expect: "profile", dir: variant(packetDir, (d) => { const p = J(d, "profile/pc-0.1-s1.json"); p.parameters.revocation_bound_s = 600; W(d, "profile/pc-0.1-s1.json", p); const c = J(d, "content.json"); c.profile.sha256 = sha256Hex(canonicalBytes(p)); W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d); }) },
    { id: "NEG-7 changed build", expect: "subjects", dir: variant(packetDir, (d) => { const c = J(d, "content.json"); c.subjects[0].software.build = "git:000000000000"; W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d); }) },
    { id: "NEG-8 path traversal entry", expect: "files", dir: variant(packetDir, (d) => { const c = J(d, "content.json"); c.files.push({ path: "../outside.json", sha256: "0".repeat(64), bytes: 0 }); W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d); }) },
    { id: "NEG-9 duplicate entry", expect: "files", dir: variant(packetDir, (d) => { const c = J(d, "content.json"); c.files.push({ ...c.files[0] }); W(d, "content.json", JSON.stringify(c, null, 2) + "\n"); rehash(d); }) },
    { id: "NEG-10 substituted self-signed key set", expect: "subjects", dir: variant(packetDir, (d) => {
      // an attacker replaces a subject's keys with their own and re-signs its attestation: only the out-of-band pin stops this
      const c = J(d, "content.json");
      const s = c.subjects[0];
      const k = generateKey(s.keys[0].kid);
      const disc = J(d, `subjects/${s.label}/discovery.json`);
      disc.keys = [k.publicJwk];
      W(d, `subjects/${s.label}/discovery.json`, disc);
      s.keys = [k.publicJwk];
      s.discovery_sha256 = sha256Hex(canonicalBytes(disc));
      W(d, "content.json", JSON.stringify(c, null, 2) + "\n");
      rehash(d);
      const env = J(d, "envelope.json");
      const a = env.attestations.find((x) => x.signer === s.label);
      W(d, a.path, signJws({ iss: s.base_url, jti: "forged", iat: Math.floor(Date.now() / 1000), role: "node", content_root: env.content_root, profile: c.profile.id, build: s.software.build }, k.privateJwk, TYP.attestation) + "\n");
      a.sha256 = sha(readFileSync(join(d, a.path)));
      W(d, "envelope.json", env);
    }) },
  ].map((c) => {
    const report = verifyPacket(c.dir, trust);
    const failedChecks = report.checks.filter((x) => !x.ok).map((x) => x.id);
    rmSync(c.dir, { recursive: true, force: true });
    return { id: c.id, rejected: !report.ok, expected_check: c.expect, failed_checks: failedChecks, right_reason: failedChecks.includes(c.expect) };
  });
}

export { assemblePacket, thumbprint, verifyPacket };
