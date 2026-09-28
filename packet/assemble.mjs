// Assembles a pc-evidence/1 packet from a finished run (sprint SG-1 evidence-packet contract, CDX-09):
//   content.json  — content manifest (profile, spec version, subjects, runner, files, summary)
//   content root  — SHA-256 of JCS(content.json)
//   attestations/ — ilp-attestation+jwt by every subject node and by the runner, over the content root
//   envelope.json — content-manifest hash, content root, attestation hashes
// The verifier report is produced OUTSIDE the packet. Trust inputs (key thumbprints, profile hash) are
// written to a separate trust file that is pinned out of band.
import { createHash, createPrivateKey, randomUUID, sign as edSign } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { canonicalBytes } from "../lib/jcs.mjs";
import { generateKey, sha256Hex, TYP } from "../lib/jws.mjs";
import { thumbprint } from "../verifier/verify.mjs";

const fileSha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const write = (root, rel, content) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};
function walk(root) {
  const out = [];
  const rec = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) rec(p);
      else out.push(relative(root, p).split(sep).join("/"));
    }
  };
  rec(root);
  return out.sort();
}

/**
 * assemblePacket({ dir, runId, profile, profileRaw, results, subjects: [{label, base_url, discovery, revocations}],
 *                  exports: [{name, manifest, files}], runnerBuild, attest: async (label, contentRoot) => jws })
 * Returns { dir, contentRoot, trust }.
 */
export async function assemblePacket({ dir, runId, profile, profileRaw, results, subjects, exports, runnerBuild, attest }) {
  mkdirSync(dir, { recursive: true });
  write(dir, "profile/pc-0.1-s1.json", profileRaw);
  write(dir, "results/results.jsonl", results.map((r) => JSON.stringify(r)).join("\n") + "\n");
  for (const s of subjects) {
    write(dir, `subjects/${s.label}/discovery.json`, JSON.stringify(s.discovery, null, 2) + "\n");
    write(dir, `subjects/${s.label}/revocations.json`, JSON.stringify(s.revocations, null, 2) + "\n");
  }
  for (const e of exports) {
    write(dir, `exports/${e.name}/manifest.json`, JSON.stringify(e.manifest, null, 2) + "\n");
    for (const [path, body] of Object.entries(e.files)) write(dir, `exports/${e.name}/${path}`, body);
  }
  const files = walk(dir).map((p) => ({ path: p, sha256: fileSha(join(dir, p)), bytes: statSync(join(dir, p)).size }));
  const content = {
    format: "pc-evidence/1",
    run_id: runId,
    profile: { id: profile.id, sha256: sha256Hex(canonicalBytes(profile)) },
    spec_version: profile.spec_version,
    subjects: subjects.map((s) => ({
      label: s.label, host: s.discovery.instance.host, base_url: s.base_url, software: s.discovery.instance.software,
      deployment_id: s.discovery.instance.deployment_id, discovery_sha256: sha256Hex(canonicalBytes(s.discovery)), keys: s.discovery.keys,
    })),
    runner: { id: "runner:project-connect", build: runnerBuild },
    files,
    summary: {
      tests: results.length,
      passed: results.filter((r) => r.status === "pass").length,
      failed: results.filter((r) => r.status === "fail").length,
      not_applicable: results.filter((r) => r.status === "not_applicable").length,
    },
  };
  const contentText = JSON.stringify(content, null, 2) + "\n";
  write(dir, "content.json", contentText);
  const contentRoot = sha256Hex(canonicalBytes(content));

  // attestations: each subject node signs with its own key; the runner signs with a per-run key whose thumbprint is pinned
  const attestations = [];
  for (const s of subjects) {
    const jws = await attest(s.label, contentRoot);
    write(dir, `attestations/${s.label}.jws`, jws + "\n");
    attestations.push({ path: `attestations/${s.label}.jws`, sha256: fileSha(join(dir, `attestations/${s.label}.jws`)), signer: s.label });
  }
  const runnerKey = generateKey(`runner-${randomUUID().slice(0, 8)}`);
  const runnerJws = signJwsWithJwk({ iss: content.runner.id, jti: `attestation-${randomUUID()}`, iat: Math.floor(Date.now() / 1000), role: "runner", content_root: contentRoot, profile: profile.id, build: runnerBuild }, runnerKey);
  write(dir, "attestations/runner.jws", runnerJws + "\n");
  attestations.push({ path: "attestations/runner.jws", sha256: fileSha(join(dir, "attestations/runner.jws")), signer: content.runner.id });

  const envelope = { format: "pc-evidence-envelope/1", content_manifest: { path: "content.json", sha256: createHash("sha256").update(contentText).digest("hex") }, content_root: contentRoot, attestations };
  write(dir, "envelope.json", JSON.stringify(envelope, null, 2) + "\n");

  const trust = {
    $comment: "Trust inputs pinned OUT OF BAND (never read from the packet): key thumbprints per subject and for the runner, and the profile hash.",
    profile_sha256: content.profile.sha256,
    signers: Object.fromEntries(subjects.map((s) => [s.label, { thumbprints: s.discovery.keys.map(thumbprint) }])),
    runner: { id: content.runner.id, thumbprint: thumbprint(runnerKey.publicJwk) },
  };
  return { dir, contentRoot, trust };
}

// The runner's per-run key travels in the protected header (jwk); its thumbprint is pinned in the trust file.
function signJwsWithJwk(payload, key) {
  const header = { alg: "EdDSA", kid: key.privateJwk.kid, typ: TYP.attestation, jwk: key.publicJwk };
  const input = `${Buffer.from(canonicalBytes(header)).toString("base64url")}.${Buffer.from(canonicalBytes(payload)).toString("base64url")}`;
  const k = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: key.privateJwk.d, x: key.privateJwk.x }, format: "jwk" });
  return `${input}.${edSign(null, Buffer.from(input, "ascii"), k).toString("base64url")}`;
}
