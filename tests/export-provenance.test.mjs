// B5 export provenance companions (unit51): opt-in semantic verification against the frozen producer contract.
// An own signed fixture (Ed25519 manifest, signed grant, hash-chained receipts) with RE-SIGNED semantic negatives: integrity
// passes, so only the semantic checks can reject. Plus the producer47 real bundle (secret-scanned) as a positive control.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateKey, signDetached, signJws, TYP } from "../lib/jws.mjs";
import { GENESIS_HASH, receiptHash } from "../lib/receipt.mjs";
import { CONTRACT_SCHEMA_SHA256, verifyExportBundle } from "../verifier/export-provenance.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const KEY = generateKey("fx-key-1");
const H = "fx.localhost", BASE = `http://${H}:1`, g = (t, id) => `ilp:${H}:${t}:${id}`;
const EV = g("event", "e1"), H1 = g("human", "h1"), R1 = `ilp:home.localhost:human:r1`, G1 = g("grant", "g1"), ART = g("artifact", "a1");

/** A fully valid signed export; `mutate(model)` edits the parsed model before serialization and (re-)signing. */
function bundle(mutate = () => {}, { key = KEY, resign = true } = {}) {
  const grantPayload = { jti: G1, iss: BASE, aud: BASE, sub: R1, agent: null, event: EV, nbf: 1, exp: 4102444800 };
  const grantJws = signJws(grantPayload, KEY.privateJwk, TYP.grant);
  const m = {
    actions: [
      { id: g("action", "a1"), kind: "unconference.proposal", mandate: "human_directed", actor_human_ref: H1, actor_agent_ref: null },
      { id: g("action", "a2"), kind: "unconference.proposal", mandate: "human_approved", actor_human_ref: R1, actor_agent_ref: null },
    ],
    receipts: [
      { id: g("receipt", "r0"), event: EV, action_kind: "engine.event_created", subject_human: H1, subject_agent: null, license_plate: null, mandate: "human_directed", resource: EV, occurred_at: "2026-10-23T00:00:00Z", source_class: "engine" },
      { id: g("receipt", "r1"), event: EV, action_kind: "federation.grant_issued", subject_human: R1, subject_agent: null, license_plate: null, mandate: "human_directed", resource: G1, occurred_at: "2026-10-23T00:00:01Z", source_class: "engine", authorization_grant: G1 },
      { id: g("receipt", "r2"), event: EV, action_kind: "unconference.proposal", subject_human: H1, subject_agent: null, license_plate: null, mandate: "human_directed", resource: g("action", "a1"), occurred_at: "2026-10-23T00:00:02Z", source_class: "browser_ui" },
      { id: g("receipt", "r3"), event: EV, action_kind: "unconference.proposal", subject_human: R1, subject_agent: null, license_plate: null, mandate: "human_approved", resource: g("action", "a2"), occurred_at: "2026-10-23T00:00:03Z", source_class: "agent_token_api", authorization_grant: G1 },
    ],
    grants: [{ jti: G1, jws: grantJws }],
    revisions: [{ artifact: ART, rev: 0, op: "init" }, { artifact: ART, rev: 1, op: "edit" }],
    prov: null, revprov: [{ format: "ilp-revision-provenance/1", artifact: ART, rev: 0, mandate_source: null }, { format: "ilp-revision-provenance/1", artifact: ART, rev: 1, mandate_source: "caller" }],
    omitFiles: [], files: null, unlisted: [], raw: null, manifestEdit: null, grantPayload,
  };
  let prev = GENESIS_HASH;
  for (const r of m.receipts) { r.prev_receipt_hash = prev; r.hash = receiptHash(r); prev = r.hash; }
  m.prov = [
    { format: "ilp-action-provenance/1", action: g("action", "a1"), intent: null, mandate_source: "default", receipt: g("receipt", "r2"), receipt_hash: m.receipts[2].hash, authorization_grant: null, grant_jws_sha256: null },
    { format: "ilp-action-provenance/1", action: g("action", "a2"), intent: "ship it", mandate_source: "caller", receipt: g("receipt", "r3"), receipt_hash: m.receipts[3].hash, authorization_grant: G1, grant_jws_sha256: sha(grantJws) },
  ];
  mutate(m);
  const J = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  const files = { "actions.jsonl": J(m.actions), "receipts.jsonl": J(m.receipts), "grants.jsonl": J(m.grants), "revisions.jsonl": J(m.revisions), "action-provenance.jsonl": J(m.prov), "revision-provenance.jsonl": J(m.revprov) };
  for (const f of m.omitFiles) delete files[f];
  if (m.raw) m.raw(files); // exact pre-signing text edits (strict-JSON cases)
  const manifest = { format: "ilp-export/1", event: EV, created_at: "2026-10-23T00:01:00Z", created_by: H1, instance: { host: H, kid: key.privateJwk.kid }, files: Object.entries(files).filter(([path]) => !m.unlisted.includes(path)).map(([path, text]) => ({ path, sha256: sha(text), bytes: Buffer.byteLength(text) })), receipts_head_hash: m.receipts.at(-1).hash, consent_versions: [], remote_origins: ["home.localhost"], kid: key.privateJwk.kid };
  if (m.manifestEdit) m.manifestEdit(manifest);
  const signed = resign ? signDetached(manifest, key.privateJwk) : manifest;
  return { manifest: signed, files: m.files ? m.files(files) : files };
}
const trusted = [KEY.publicJwk];
const ISSUER = { issuer: BASE };
const rejects = (b, re, what) => assert.throws(() => verifyExportBundle(b, trusted, ISSUER), re, what);

test("contract: the vendored row schema is the frozen producer47 schema", () => {
  assert.equal(sha(readFileSync(join(ROOT, "verifier/contracts/ilp-action-provenance-1.schema.json"), "utf8")), CONTRACT_SCHEMA_SHA256);
  assert.equal(CONTRACT_SCHEMA_SHA256, "b33075887e04bff626439df3750f1880487a4bfa40aaf312f242c1aff00925cd");
});

test("positive: own signed fixture verifies; recorded caller/default labels never become human approval", () => {
  const r = verifyExportBundle(bundle(), trusted, ISSUER);
  assert.deepEqual([r.checked, r.actions, r.grants_verified, r.revisions], [true, 2, 1, 2]);
  assert.deepEqual(r.mandate_source_declared, { caller: 1, default: 1, unknown: 0 });
  assert.equal(r.human_approval, "not_established", "caller + human_approved is a declared label, not approval");
});

test("positive: the real producer47 bundle verifies semantically", () => {
  const b = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/b5-real-bundle.json"), "utf8"));
  const keys = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/b5-real-public-keys.json"), "utf8"));
  const iss = { issuer: "http://b5host.localhost:4300" };
  const r = verifyExportBundle(b, keys, iss);
  assert.deepEqual([r.actions, r.grants_verified, r.revisions, r.human_approval], [5, 1, 3, "not_established"]);
  // companion deleted or tampered with the ORIGINAL manifest: integrity rejects
  assert.throws(() => verifyExportBundle({ ...b, files: { ...b.files, "action-provenance.jsonl": undefined } }, keys, iss), /listed file action-provenance.jsonl missing/);
  assert.throws(() => verifyExportBundle({ ...b, files: { ...b.files, "action-provenance.jsonl": b.files["action-provenance.jsonl"].replace("default", "caller") } }, keys, iss), /hash\/length/);
  assert.throws(() => verifyExportBundle(b, keys), /issuer base URL/, "standalone refuses without the operator-trusted issuer");
  assert.throws(() => verifyExportBundle(b, keys, { issuer: "http://other.localhost:1" }), /issuer\/audience/, "wrong operator issuer");
});

test("re-signed semantic negatives: action bijection, receipt joins and grant evidence", () => {
  const A1 = 0, A2 = 1;
  rejects(bundle((m) => m.prov.push({ ...m.prov[A1] })), /duplicate/, "duplicate row");
  rejects(bundle((m) => m.prov.splice(A1, 1)), /missing provenance row/, "omitted row");
  rejects(bundle((m) => m.prov.push({ ...m.prov[A1], action: g("action", "ghost"), receipt: g("receipt", "r0"), receipt_hash: m.receipts[0].hash })), /orphan provenance row/, "orphan row");
  rejects(bundle((m) => { m.prov[A1].receipt = m.receipts[0].id; m.prov[A1].receipt_hash = m.receipts[0].hash; }), /another resource/, "alternate receipt (valid id and hash, wrong resource)");
  rejects(bundle((m) => { m.prov[A1].receipt = m.receipts[3].id; m.prov[A1].receipt_hash = m.receipts[3].hash; }), /ambiguous receipt linkage|another resource/, "receipt already joined to another action");
  rejects(bundle((m) => { m.prov[A1].receipt_hash = "f".repeat(64); }), /receipt hash disagrees/, "wrong receipt hash");
  rejects(bundle((m) => { m.prov[A1].receipt = g("receipt", "nope"); }), /not in receipts.jsonl/, "unknown receipt");
  rejects(bundle((m) => { m.actions[A2].actor_human_ref = H1; }), /subject differs/, "receipt subject differs from action");
  rejects(bundle((m) => { m.actions[A1].kind = "unconference.vote"; }), /kind/, "receipt kind differs from action");
  rejects(bundle((m) => { m.actions[A1].mandate = "human_approved"; }), /mandate differs/, "receipt mandate differs from action");
  rejects(bundle((m) => { m.prov[A2].authorization_grant = g("grant", "other"); }), /disagrees with the receipt/, "wrong grant JTI");
  rejects(bundle((m) => { m.prov[A1].authorization_grant = G1; m.prov[A1].grant_jws_sha256 = m.prov[A2].grant_jws_sha256; }), /disagrees with the receipt/, "grant claimed for a grant-less receipt");
  rejects(bundle((m) => { m.prov[A2].grant_jws_sha256 = "0".repeat(64); }), /JWS digest disagrees/, "wrong JWS digest");
  rejects(bundle((m) => m.grants.push({ ...m.grants[0] })), /selects 2 grants/, "duplicate grant evidence");
  rejects(bundle((m) => { m.grants = []; }), /selects 0 grants|links a grant absent from grants.jsonl/, "missing grant evidence (now also caught by the standalone grant prerequisites)");
  rejects(bundle((m) => { const forged = signJws({ jti: G1, iss: BASE, aud: BASE, sub: R1 }, generateKey("fx-key-1").privateJwk, TYP.grant); m.grants[0].jws = forged; m.prov[A2].grant_jws_sha256 = sha(forged); }), /does not verify/, "grant signed by an untrusted key with a matching digest");
  rejects(bundle((m) => { const other = signJws({ jti: g("grant", "x"), iss: BASE, aud: BASE, sub: R1 }, KEY.privateJwk, TYP.grant); m.grants[0].jws = other; m.prov[A2].grant_jws_sha256 = sha(other); }), /payload jti differs|issuer\/audience/, "verified grant whose payload jti differs (standalone prerequisite: payload jti must equal the listed jti)");
});

test("re-signed semantic negatives: contract version/members, null pairing, approval claims, revisions, legacy", () => {
  rejects(bundle((m) => { m.prov[0].grant_jws_sha256 = "a".repeat(64); }), /violates ilp-action-provenance\/1/, "null grant with a digest");
  rejects(bundle((m) => { m.prov[1].grant_jws_sha256 = null; }), /violates/, "grant without a digest");
  rejects(bundle((m) => { m.prov[0].format = "ilp-action-provenance/2"; }), /violates/, "unsupported version");
  rejects(bundle((m) => { m.prov[1].human_approval = true; }), /violates/, "an extra approval claim is not a member of the contract");
  rejects(bundle((m) => { m.prov[0].mandate_source = "approved"; }), /violates/, "unknown mandate_source value");
  rejects(bundle((m) => m.revprov.push({ ...m.revprov[0] })), /duplicate/, "duplicate revision row");
  rejects(bundle((m) => m.revprov.pop()), /missing revision provenance row/, "missing revision row");
  rejects(bundle((m) => m.revprov.push({ format: "ilp-revision-provenance/1", artifact: ART, rev: 9, mandate_source: null })), /orphan revision provenance row/, "orphan revision row");
  rejects(bundle((m) => { m.revprov[0].receipt = "ilp:x:receipt:inferred"; }), /violates ilp-revision-provenance/, "no inferred revision→receipt member");
  rejects(bundle((m) => m.omitFiles.push("revision-provenance.jsonl")), /no manifest-covered revision-provenance.jsonl/, "revisions without their companion");
  rejects(bundle((m) => m.omitFiles.push("action-provenance.jsonl")), /legacy export/, "legacy export without the companion is not B5-complete");
  rejects(bundle(() => {}, { key: generateKey("fx-key-1") }), /manifest signature/, "manifest signed by an untrusted key");
  rejects(bundle((m) => { m.files = (f) => ({ ...f, "action-provenance.jsonl": f["action-provenance.jsonl"].replace("ship it", "ship it!") }); }), /hash\/length/, "companion modified under the original signed manifest");
});

test("fix68 (review61): absent/unlisted evidence, strict JSON, typed revision keys, standalone schemas/lengths/grant bindings", () => {
  // F1 — absent or unlisted evidence never becomes an empty successful join
  rejects(bundle((m) => { m.omitFiles.push("actions.jsonl"); m.prov = []; }), /required evidence actions.jsonl is absent/, "missing actions with an empty companion");
  rejects(bundle((m) => { m.unlisted.push("actions.jsonl"); m.prov = []; }), /actions.jsonl is not covered by the export manifest/, "unlisted actions with an empty companion");
  rejects(bundle((m) => { m.unlisted.push("actions.jsonl"); }), /actions.jsonl is not covered/, "populated companion joined against an unlisted source");
  rejects(bundle((m) => { m.unlisted.push("revisions.jsonl"); m.omitFiles.push("revision-provenance.jsonl"); }), /revisions.jsonl is not covered by the export manifest/, "unlisted revisions without companion");
  rejects(bundle((m) => m.omitFiles.push("receipts.jsonl")), /listed file|required evidence receipts.jsonl|receipts.jsonl is missing/, "missing receipts");
  // F2 — strict JSON before validation; exact typed revision keys
  rejects(bundle((m) => { m.raw = (f) => { f["action-provenance.jsonl"] = f["action-provenance.jsonl"].replace('"intent":null', '"intent":"DO NOT ACT","intent":null'); }; }), /not strict JSON \(duplicate member name "intent"/, "duplicate intent member");
  rejects(bundle((m) => { m.raw = (f) => { f["revision-provenance.jsonl"] = f["revision-provenance.jsonl"].replace('"rev":1,', '"rev":1.00000000000000001,'); }; }), /not strict JSON \(non-integer number/, "fractional revision rounded to an integer");
  rejects(bundle((m) => { m.revisions[1].rev = "1"; }), /revisions.jsonl: artifact\/rev must be a string and an integer/, "string source revision paired with number");
  // F4 — standalone schemas and signed lengths
  rejects(bundle((m) => { m.manifestEdit = (x) => { x.format = "wrong/99"; }; }), /export manifest schema/, "unknown manifest format");
  rejects(bundle((m) => { m.manifestEdit = (x) => { delete x.files.find((f) => f.path === "action-provenance.jsonl").bytes; }; }), /export manifest schema|no signed length/, "missing companion byte length");
  rejects(bundle((m) => { m.manifestEdit = (x) => { x.files.find((f) => f.path === "action-provenance.jsonl").bytes += 1; }; }), /hash\/length/, "wrong companion byte length");
  rejects(bundle((m) => { m.actions[0].mandate = "not-a-mandate"; m.receipts[2].mandate = "not-a-mandate"; let prev = m.receipts[1].hash; for (const r of m.receipts.slice(2)) { r.prev_receipt_hash = prev; r.hash = receiptHash(r); prev = r.hash; } m.prov[0].receipt_hash = m.receipts[2].hash; m.prov[1].receipt_hash = m.receipts[3].hash; }), /receipt schema/, "invalid receipt mandate with recomputed hashes");
  // F5 — standalone grant bindings (same rules as the packet verifier)
  const regrant = (edit) => (m) => { const p = { ...m.grantPayload, ...edit }; const jws = signJws(p, KEY.privateJwk, TYP.grant); m.grants[0].jws = jws; m.prov[1].grant_jws_sha256 = sha(jws); };
  rejects(bundle(regrant({ sub: H1 })), /subject differs from its grant/, "grant subject mismatch");
  rejects(bundle(regrant({ event: g("event", "other") })), /grant event/, "grant event mismatch");
  rejects(bundle(regrant({ iss: "http://evil.localhost:1" })), /issuer\/audience/, "grant issuer mismatch");
  rejects(bundle(regrant({ exp: 1700000000, nbf: 1 })), /outside its grant's validity/, "grant expired before the action");
});
