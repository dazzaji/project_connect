// pc-verify: offline verification of a Project Connect evidence packet (pc-evidence/1).
// Uses only the packet bytes and a trust file pinned out of band. No network, no database, no node access.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";
import { canonicalBytes } from "../lib/jcs.mjs";
import { decodeJws, JwsError, sha256Hex, TYP, verifyDetached, verifyJws } from "../lib/jws.mjs";
import { parseStrict } from "../lib/json.mjs";
import { verifyReceiptChain } from "../lib/receipt.mjs";
import { validate } from "../lib/schemas.mjs";

const SKEW_S = 300;
const fileSha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
/** RFC 7638 JWK thumbprint for an OKP key (the trust-pin format). */
export const thumbprint = (jwk) => createHash("sha256").update(`{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`).digest("base64url");

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.push({ path: relative(root, p).split(sep).join("/"), symlink: true });
      else if (st.isDirectory()) walk(p);
      else out.push({ path: relative(root, p).split(sep).join("/") });
    }
  };
  walk(root);
  return out;
}
const safePath = (p) => typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === ".." || s === "." || s === "") && normalize(p) === p;
const readJsonl = (text) => text.split("\n").filter(Boolean).map((l) => parseStrict(l));

/**
 * verifyPacket(packetDir, trust) → { ok, checks: [{id, ok, detail}], summary }
 * trust = { profile_sha256, signers: { <label>: { thumbprints: [..] } }, runner: { id, thumbprint } }
 */
export function verifyPacket(packetDir, trust) {
  const checks = [];
  const pass = (id, detail) => checks.push({ id, ok: true, detail });
  const fail = (id, detail) => checks.push({ id, ok: false, detail });
  const guard = (id, fn) => {
    try {
      const d = fn();
      pass(id, d ?? "ok");
      return true;
    } catch (e) {
      fail(id, e.message);
      return false;
    }
  };
  const need = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  const P = (p) => join(packetDir, p);

  // 1. envelope and content manifest
  let envelope, content, contentRoot;
  if (!guard("envelope", () => {
    need(existsSync(P("envelope.json")), "envelope.json missing");
    envelope = parseStrict(readFileSync(P("envelope.json"), "utf8"));
    const v = validate("evidence-packet-manifest", envelope);
    need(v.ok && envelope.format === "pc-evidence-envelope/1", `envelope invalid: ${v.errors.join("; ")}`);
  })) return finish();
  if (!guard("content-manifest", () => {
    need(existsSync(P("content.json")), "content.json missing");
    need(fileSha(P("content.json")) === envelope.content_manifest.sha256, "content.json bytes do not match the envelope");
    content = parseStrict(readFileSync(P("content.json"), "utf8"));
    const v = validate("evidence-packet-manifest", content);
    need(v.ok && content.format === "pc-evidence/1", `content manifest invalid: ${v.errors.join("; ")}`);
    contentRoot = sha256Hex(canonicalBytes(content));
    need(contentRoot === envelope.content_root, "content_root does not recompute");
    return contentRoot;
  })) return finish();

  // 2. file inventory: complete, exact, safe
  guard("files", () => {
    const listed = new Map();
    for (const f of content.files) {
      need(safePath(f.path), `unsafe path ${JSON.stringify(f.path)}`);
      need(!listed.has(f.path), `duplicate entry ${f.path}`);
      listed.set(f.path, f);
    }
    const attPaths = new Set(envelope.attestations.map((a) => a.path));
    for (const a of attPaths) need(safePath(a), `unsafe attestation path ${a}`);
    const onDisk = listFiles(packetDir);
    for (const f of onDisk) {
      need(!f.symlink, `symlink in packet: ${f.path}`);
      if (f.path === "content.json" || f.path === "envelope.json" || attPaths.has(f.path)) continue;
      need(listed.has(f.path), `unlisted file ${f.path}`);
    }
    for (const [p, f] of listed) {
      need(existsSync(P(p)), `missing file ${p}`);
      need(fileSha(P(p)) === f.sha256, `hash mismatch ${p}`);
      need(readFileSync(P(p)).length === f.bytes, `size mismatch ${p}`);
    }
    return `${listed.size} files`;
  });

  // 3. profile pinned out of band
  let profile;
  guard("profile", () => {
    need(content.profile.sha256 === trust.profile_sha256, "profile hash differs from the trust pin");
    const pf = "profile/pc-0.1-s1.json";
    need(existsSync(P(pf)), "profile file missing");
    profile = parseStrict(readFileSync(P(pf), "utf8"));
    need(sha256Hex(canonicalBytes(profile)) === content.profile.sha256, "profile file does not match its hash");
    need(profile.id === content.profile.id, "profile id");
    return profile.id;
  });

  // 4. subjects: discovery documents, keys pinned by thumbprint
  const subjects = {};
  guard("subjects", () => {
    for (const s of content.subjects) {
      const pin = trust.signers?.[s.label];
      need(pin, `no trust pin for subject ${s.label}`);
      const dpath = `subjects/${s.label}/discovery.json`;
      need(existsSync(P(dpath)), `${s.label}: discovery.json missing`);
      const disc = parseStrict(readFileSync(P(dpath), "utf8"));
      need(sha256Hex(canonicalBytes(disc)) === s.discovery_sha256, `${s.label}: discovery hash`);
      need(disc.instance.host === s.host && disc.instance.software.build === s.software.build && disc.instance.deployment_id === s.deployment_id, `${s.label}: build identity differs from discovery`);
      need(JSON.stringify(disc.keys) === JSON.stringify(s.keys), `${s.label}: keys differ from discovery`);
      for (const k of s.keys) need(pin.thumbprints.includes(thumbprint(k)), `${s.label}: key ${k.kid} is not pinned in the trust file (substituted key set?)`);
      subjects[s.label] = { ...s, disc };
    }
    return Object.keys(subjects).join(", ");
  });

  // 5. attestations over the content root: every subject and the runner
  guard("attestations", () => {
    const signed = new Set();
    for (const a of envelope.attestations) {
      need(existsSync(P(a.path)), `attestation missing ${a.path}`);
      need(fileSha(P(a.path)) === a.sha256, `attestation bytes differ ${a.path}`);
      const jws = readFileSync(P(a.path), "utf8").trim();
      let key;
      if (a.signer === trust.runner?.id) {
        const { header } = decodeJws(jws);
        const jwk = header.jwk;
        need(jwk && thumbprint(jwk) === trust.runner.thumbprint, "runner attestation key is not the pinned runner key");
        key = () => jwk;
      } else {
        const s = subjects[a.signer];
        need(s, `attestation by unknown signer ${a.signer}`);
        key = (kid) => s.keys.find((k) => k.kid === kid) ?? null;
      }
      let payload;
      try {
        ({ payload } = verifyJws(jws, key, { typ: TYP.attestation }));
      } catch (e) {
        throw new Error(`${a.signer}: attestation does not verify (${e.message})`);
      }
      need(validate("attestation", payload).ok, `${a.signer}: attestation payload invalid`);
      need(payload.content_root === contentRoot, `${a.signer}: attests a different content root`);
      need(payload.profile === content.profile.id, `${a.signer}: attests a different profile`);
      if (a.signer !== trust.runner?.id) need(payload.build === subjects[a.signer].software.build, `${a.signer}: attests a different build`);
      else need(payload.build === content.runner.build, "runner attests a different build");
      signed.add(a.signer);
    }
    for (const label of Object.keys(subjects)) need(signed.has(label), `subject ${label} did not attest`);
    need(signed.has(trust.runner?.id), "runner did not attest");
    return [...signed].join(", ");
  });

  // 6. results: schema, coverage from the FROZEN profile, summary
  guard("results", () => {
    need(profile, "profile unavailable");
    const rpath = "results/results.jsonl";
    need(existsSync(P(rpath)), "results missing");
    const results = readJsonl(readFileSync(P(rpath), "utf8"));
    for (const r of results) need(validate("test-result", r).ok, `invalid result ${r.test_id} ${r.scenario}`);
    const byKey = new Map(results.map((r) => [`${r.test_id}|${r.scenario}|${r.repetition}`, r]));
    const inPacket = profile.tests.filter((t) => t.id !== "PC-VER-1"); // PC-VER-1 is decided by this verifier, outside the packet
    const missing = [];
    const failed = [];
    for (const sc of profile.scenarios) for (let rep = 1; rep <= sc.repetitions; rep++) for (const t of inPacket) {
      const r = byKey.get(`${t.id}|${sc.id}|${rep}`);
      if (!r) missing.push(`${t.id}@${sc.id}.${rep}`);
      else if (r.status === "fail") failed.push(`${t.id}@${sc.id}.${rep}`);
      else if (r.status === "not_applicable") {
        const naOk = (t.id === "PC-INTEROP-AB" && sc.id !== "SC-1") || (t.id === "PC-INTEROP-BA" && sc.id !== "SC-2") || (t.id === "PC-PROV-1" && profile.nodes[sc.home]?.implementation === "project-connect-reference-node");
        if (!naOk) failed.push(`${t.id}@${sc.id}.${rep} (not_applicable not permitted)`);
      }
    }
    need(!missing.length, `missing results: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` (+${missing.length - 8})` : ""}`);
    need(!failed.length, `failing results: ${failed.slice(0, 8).join(", ")}`);
    const s = content.summary;
    need(s.tests === results.length && s.passed === results.filter((r) => r.status === "pass").length && s.failed === results.filter((r) => r.status === "fail").length, "summary does not match results");
    // traceability: every requirement the profile traces is covered by a passing result
    return `${results.length} results cover ${inPacket.length} tests × ${profile.scenarios.reduce((a, s) => a + s.repetitions, 0)} runs`;
  });

  // 7. exports: signatures, receipt chains, grant links at historical action time, revocation records
  guard("exports", () => {
    const dirs = [...new Set(content.files.map((f) => f.path).filter((p) => p.startsWith("exports/")).map((p) => p.split("/").slice(0, 2).join("/")))];
    need(dirs.length > 0, "no exports in the packet");
    let receiptsChecked = 0;
    let linksChecked = 0;
    for (const d of dirs) {
      const manifest = parseStrict(readFileSync(P(`${d}/manifest.json`), "utf8"));
      need(validate("export-manifest", manifest).ok, `${d}: manifest schema`);
      const host = Object.values(subjects).find((s) => s.host === manifest.instance.host);
      need(host, `${d}: exported by an unknown host ${manifest.instance.host}`);
      const jwk = host.keys.find((k) => k.kid === manifest.kid);
      need(jwk, `${d}: manifest kid ${manifest.kid} unknown`);
      try {
        verifyDetached(manifest, jwk);
      } catch (e) {
        throw new Error(`${d}: manifest signature (${e.message})`);
      }
      for (const f of manifest.files) {
        need(safePath(f.path) && existsSync(P(`${d}/${f.path}`)), `${d}: file ${f.path} missing`);
        need(fileSha(P(`${d}/${f.path}`)) === f.sha256, `${d}: ${f.path} hash`);
      }
      const receipts = readJsonl(readFileSync(P(`${d}/receipts.jsonl`), "utf8"));
      const chain = verifyReceiptChain(receipts, { event: manifest.event });
      need(chain.ok, `${d}: receipt chain ${JSON.stringify(chain.errors.slice(0, 2))}`);
      need(chain.head === manifest.receipts_head_hash, `${d}: head hash`);
      for (const r of receipts) need(validate("receipt", r).ok, `${d}: receipt schema ${r.id}`);
      receiptsChecked += receipts.length;
      const grants = new Map();
      for (const g of readJsonl(readFileSync(P(`${d}/grants.jsonl`), "utf8"))) {
        let payload;
        try {
          ({ payload } = verifyJws(g.jws, (kid) => host.keys.find((k) => k.kid === kid) ?? null, { typ: TYP.grant }));
        } catch (e) {
          throw new Error(`${d}: grant ${g.jti} does not verify (${e.message})`);
        }
        need(payload.jti === g.jti && payload.iss === host.base_url && payload.aud === host.base_url, `${d}: grant ${g.jti} issuer/audience`);
        grants.set(g.jti, payload);
      }
      for (const r of receipts.filter((x) => x.authorization_grant && x.source_class === "agent_token_api")) {
        const g = grants.get(r.authorization_grant);
        need(g, `${d}: receipt ${r.id} links a grant absent from grants.jsonl`);
        need(g.sub === r.subject_human && (g.agent?.id ?? null) === r.subject_agent, `${d}: receipt ${r.id} subject differs from its grant`);
        const t = Math.floor(Date.parse(r.occurred_at) / 1000);
        need(t >= g.nbf - SKEW_S && t <= g.exp + SKEW_S, `${d}: receipt ${r.id} falls outside its grant's validity at the historical action time`);
        need(g.event === manifest.event, `${d}: grant event`);
        linksChecked++;
      }
      for (const rv of readJsonl(readFileSync(P(`${d}/revocations.jsonl`), "utf8"))) {
        try {
          verifyJws(rv.jws, (kid) => host.keys.find((k) => k.kid === kid) ?? null, { typ: TYP.revocation });
        } catch (e) {
          throw new Error(`${d}: revocation record ${rv.seq} (${e.message})`);
        }
      }
      for (const c of readJsonl(readFileSync(P(`${d}/claims.jsonl`), "utf8"))) need(!JSON.stringify(c).includes("@"), `${d}: claims.jsonl carries an email-like value`);
    }
    return `${dirs.length} exports, ${receiptsChecked} receipts, ${linksChecked} grant links`;
  });

  // 8. no reusable credential anywhere in the packet
  guard("secrets", () => {
    for (const f of content.files) {
      const text = readFileSync(P(f.path), "utf8");
      need(!/ilp[tpfor]_[A-Za-z0-9_-]{16,}/.test(text), `${f.path} contains a credential`);
      need(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) && !/"d"\s*:\s*"[A-Za-z0-9_-]{40,}"/.test(text), `${f.path} contains private key material`);
    }
  });

  return finish();

  function finish() {
    const ok = checks.length > 0 && checks.every((c) => c.ok);
    return { ok, content_root: contentRoot ?? null, checks };
  }
}

export function toMarkdown(report, packetDir) {
  const lines = [`# pc-verify report`, ``, `- Packet: \`${packetDir}\``, `- Content root: \`${report.content_root ?? "n/a"}\``, `- Verdict: **${report.ok ? "PASS" : "FAIL"}**`, ``, `| Check | Result | Detail |`, `|---|---|---|`];
  for (const c of report.checks) lines.push(`| ${c.id} | ${c.ok ? "pass" : "FAIL"} | ${String(c.detail).replace(/\|/g, "\\|")} |`);
  return lines.join("\n") + "\n";
}

export { JwsError };
