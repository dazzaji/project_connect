// Generates vectors/*.json — normative-once-released test vectors (R-CORE-37) for ILP 0.0.2.
// Deterministic: Ed25519 is deterministic and the test keys derive from fixed, published seeds.
import { createPrivateKey } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../lib/jcs.mjs";
import { createPrivateKey as cpk, sign as edSign } from "node:crypto";
import { b64u, publicJwkOf, sha256B64u, signDetached, signJws, TYP } from "../lib/jws.mjs";
import { GENESIS_HASH, receiptHash } from "../lib/receipt.mjs";

const OUT = process.env.ILP_GEN_OUT ? join(process.env.ILP_GEN_OUT, "vectors") : join(dirname(fileURLToPath(import.meta.url)), "..", "vectors");

/** Test-only key from a published 32-byte seed. NEVER use these keys outside vectors. */
function seededKey(kid, seedByte) {
  const seed = Buffer.alloc(32, seedByte);
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const jwk = createPrivateKey({ key: der, format: "der", type: "pkcs8" }).export({ format: "jwk" });
  return { ...jwk, kid };
}

const HOME = seededKey("vec-home-1", 0x01);
const HOST = seededKey("vec-host-1", 0x02);
const OTHER = seededKey("vec-other-1", 0x03);
const keys = {
  "https://home.example": [publicJwkOf(HOME)],
  "https://host.example": [publicJwkOf(HOST)],
  "https://other.example": [publicJwkOf(OTHER)],
};

const T0 = 1790500000;
const token = "ilpt_VECTORONLY-0000000000000000000000000000";
const claim = {
  iss: "https://home.example",
  sub: "ilp:home.example:human:0192a1b3-5c6d-7e8f-9a0b-1c2d3e4f5a6b",
  aud: "https://host.example",
  iat: T0,
  exp: T0 + 3600,
  jti: "claim-0192f0c2-0000-7000-8000-000000000001",
  display_name: "Vector Human",
  verified: true,
  verified_method: "email_otp",
  agent: { id: "ilp:home.example:agent:0192a1b3-aaaa-7bbb-8ccc-1d2e3f4a5b6c", display_name: "Vector Agent", license_plate: "IL-7Q3K2M9P" },
  purpose: "event_join",
  event: "ilp:host.example:event:0192e7d1-1111-7222-8333-944455566677",
  consent_accepted: null,
};
const grant = {
  iss: "https://host.example",
  aud: "https://host.example",
  jti: "ilp:host.example:grant:0192f0c2-7e1a-7b4e-9a55-3c1f0e2d4b61",
  sub: claim.sub,
  agent: { id: claim.agent.id, license_plate: claim.agent.license_plate },
  event: claim.event,
  home: "home.example",
  role: "participant",
  authorization_details: [{ type: "ilp.pack_action", pack: "unconference@1.1", actions: ["unconference.proposal"] }],
  exclusions: ["unconference.vote"],
  mandates_allowed: ["human_directed", "human_approved"],
  iat: T0,
  nbf: T0,
  exp: T0 + 600,
  credential_binding: { alg: "S256", value: sha256B64u(Buffer.from(token, "utf8")) },
  status: { uri: "https://host.example/ilp/v1/grants/0192f0c2-7e1a-7b4e-9a55-3c1f0e2d4b61/status" },
  parent_grant: null,
};
const revocation = {
  iss: "https://host.example",
  jti: "ilp:host.example:revocation:0192f0c2-9999-7000-8000-000000000001",
  iat: T0 + 100,
  kind: "grant",
  subject: grant.jti,
  revoked_at: "2026-09-27T12:01:40Z",
  reason: "operator",
  seq: 1,
};
const attestation = {
  iss: "https://host.example",
  jti: "attestation-vec-1",
  iat: T0 + 200,
  role: "node",
  content_root: "a".repeat(64),
  profile: "pc-0.1-s1",
  build: "git:0000000",
};

const good = {
  claim: signJws(claim, HOME, TYP.claim),
  grant: signJws(grant, HOST, TYP.grant),
  revocation: signJws(revocation, HOST, TYP.revocation),
  attestation: signJws(attestation, HOST, TYP.attestation),
};

// --- mutators producing bad JWS from good ones (each constructible from public data) ---
const parts = (j) => j.split(".");
// Alter one payload byte while keeping the payload valid JSON, so the failure is the signature, not parsing.
const alterPayloadByte = (j, from, to) => {
  const [h, p, s] = parts(j);
  const text = b64u.decode(p).toString("utf8");
  if (from.length !== to.length || !text.includes(from)) throw new Error("bad alteration");
  return `${h}.${b64u.encode(Buffer.from(text.replace(from, to), "utf8"))}.${s}`;
};
const alterSigByte = (j) => {
  const [h, p, s] = parts(j);
  const sig = b64u.decode(s);
  sig[0] ^= 0x01;
  return `${h}.${p}.${b64u.encode(sig)}`;
};
const withHeader = (j, header) => {
  const [, p, s] = parts(j);
  return `${b64u.encode(Buffer.from(JSON.stringify(header)))}.${p}.${s}`;
};

// Sign raw JSON text (not JCS) so out-of-profile values can be carried in a correctly signed JWS.
function signRaw(headerObj, payloadText, jwk) {
  const input = `${b64u.encode(Buffer.from(JSON.stringify(headerObj)))}.${b64u.encode(Buffer.from(payloadText, "utf8"))}`;
  const k = cpk({ key: { kty: "OKP", crv: "Ed25519", d: jwk.d, x: jwk.x }, format: "jwk" });
  return `${input}.${b64u.encode(edSign(null, Buffer.from(input, "ascii"), k))}`;
}
// Sign raw payload BYTES (for encoding-level negatives).
function signRawBytes(headerObj, payloadBytes, jwk) {
  const input = `${b64u.encode(Buffer.from(JSON.stringify(headerObj)))}.${b64u.encode(payloadBytes)}`;
  const k = cpk({ key: { kty: "OKP", crv: "Ed25519", d: jwk.d, x: jwk.x }, format: "jwk" });
  return `${input}.${b64u.encode(edSign(null, Buffer.from(input, "ascii"), k))}`;
}
const grantText = JSON.stringify(grant);
const hdr = { alg: "EdDSA", kid: HOST.kid, typ: TYP.grant };

const jws = {
  keys,
  cases: [
    ...Object.entries(good).map(([kind, v]) => ({ id: `JWS-GOOD-${kind}`, kind, typ: TYP[kind], jws: v, expect: "valid" })),
    { id: "JWS-BAD-1", kind: "claim", typ: TYP.claim, jws: alterPayloadByte(good.claim, "Vector Human", "Vector Humam"), expect: "SIGNATURE_INVALID", note: "one payload byte altered" },
    { id: "JWS-BAD-2", kind: "grant", typ: TYP.grant, jws: alterPayloadByte(good.grant, "\"participant\"", "\"participanu\""), expect: "SIGNATURE_INVALID", note: "one payload byte altered" },
    { id: "JWS-BAD-3", kind: "grant", typ: TYP.grant, jws: alterSigByte(good.grant), expect: "SIGNATURE_INVALID", note: "one signature byte altered" },
    { id: "JWS-BAD-4", kind: "claim", typ: TYP.claim, jws: withHeader(good.claim, { alg: "none", kid: HOME.kid, typ: TYP.claim }), expect: "SIGNATURE_INVALID", note: "alg none" },
    { id: "JWS-BAD-5", kind: "claim", typ: TYP.claim, jws: withHeader(good.claim, { alg: "HS256", kid: HOME.kid, typ: TYP.claim }), expect: "SIGNATURE_INVALID", note: "alg not EdDSA" },
    { id: "JWS-BAD-6", kind: "claim", typ: TYP.claim, jws: signJws(claim, { ...HOME, kid: "vec-home-unpublished" }, TYP.claim), expect: "UNKNOWN_SIGNER", note: "kid not published by the issuer" },
    { id: "JWS-BAD-7", kind: "grant", typ: TYP.grant, jws: signJws(grant, OTHER, TYP.grant), expect: "UNKNOWN_SIGNER", note: "signed by another host's key; kid does not resolve under iss" },
    { id: "JWS-BAD-8", kind: "claim", typ: TYP.claim, jws: signJws(claim, HOME, TYP.grant), expect: "VALIDATION_FAILED", note: "typ mismatch (a grant typ on a claim)" },
    { id: "JWS-BAD-9", kind: "claim", typ: TYP.claim, jws: good.claim.split(".").slice(0, 2).join("."), expect: "VALIDATION_FAILED", note: "two-part compact" },
    { id: "JWS-BAD-10", kind: "claim", typ: TYP.claim, jws: withHeader(good.claim, { alg: "EdDSA", typ: TYP.claim }), expect: "UNKNOWN_SIGNER", note: "no kid" },
    { id: "JWS-BAD-11", kind: "grant", typ: TYP.grant, jws: signRaw({ ...hdr, crit: ["x_unimplemented"], x_unimplemented: true }, grantText, HOST), expect: "SIGNATURE_INVALID", note: "correctly signed, unsupported critical extension (RFC 7515 §4.1.11)" },
    { id: "JWS-BAD-12", kind: "grant", typ: TYP.grant, jws: signRaw(hdr, grantText.replace('"iat":', '"x_probe":1.5,"iat":'), HOST), expect: "VALIDATION_FAILED", note: "correctly signed, non-integer number (R-CORE-35)" },
    { id: "JWS-BAD-13", kind: "grant", typ: TYP.grant, jws: signRaw(hdr, grantText.replace('"iat":', '"x_probe":9007199254740993,"iat":'), HOST), expect: "VALIDATION_FAILED", note: "correctly signed, integer beyond ±(2^53−1)" },
    { id: "JWS-BAD-14", kind: "grant", typ: TYP.grant, jws: signRaw(hdr, grantText.replace('"iat":', '"x_probe":1e400,"iat":'), HOST), expect: "VALIDATION_FAILED", note: "correctly signed, infinity" },
    { id: "JWS-BAD-16", kind: "grant", typ: TYP.grant, jws: signRaw(hdr, grantText.replace('"role":"participant"', '"role":"participant","role":"admin"'), HOST), expect: "VALIDATION_FAILED", note: "correctly signed, duplicate member name (role twice)" },
    { id: "JWS-BAD-17", kind: "claim", typ: TYP.claim, jws: signRawBytes({ alg: "EdDSA", kid: HOME.kid, typ: TYP.claim }, Buffer.concat([Buffer.from(JSON.stringify(claim).split("Vector Human")[0] + "Vector "), Buffer.from([0xff]), Buffer.from("Human" + JSON.stringify(claim).split("Vector Human")[1])]), HOME), expect: "VALIDATION_FAILED", note: "correctly signed payload containing the invalid UTF-8 byte 0xFF" },
    { id: "JWS-BAD-18", kind: "claim", typ: TYP.claim, jws: (() => { const [h, p, s] = good.claim.split("."); return `${h}.${p}A.${s}`; })(), expect: "VALIDATION_FAILED", note: "payload segment with an impossible base64url length" },
    { id: "JWS-BAD-19", kind: "grant", typ: TYP.grant, jws: signRaw(hdr, grantText.replace(/"iat":(\d+)/, '"iat":$1.0000000001'), HOST), expect: "VALIDATION_FAILED", note: "correctly signed, fractional lexeme that rounds to an integer" },
    { id: "JWS-BAD-20", kind: "grant", typ: TYP.grant, jws: signRaw(hdr, grantText.replace('"iat":', '"x_probe":1e-400,"iat":'), HOST), expect: "VALIDATION_FAILED", note: "correctly signed, underflowing lexeme (would parse to 0)" },
    { id: "JWS-GOOD-integral-lexeme", kind: "grant", typ: TYP.grant, jws: signRaw(hdr, grantText.replace('"iat":', '"x_probe":1.0e3,"iat":'), HOST), expect: "valid", note: "1.0e3 is mathematically the integer 1000: accepted" },
    { id: "JWS-BAD-15", kind: "grant", typ: TYP.grant, jws: signRaw(hdr, grantText.replace('"role":"participant"', '"role":"\\ud800"'), HOST), expect: "VALIDATION_FAILED", note: "correctly signed, lone surrogate" },
  ],
  resolve: "Resolve `kid` only among keys published by the payload's `iss` (keys[iss]).",
};

const jcs = {
  cases: [
    { id: "JCS-1", input: '{"b":2,"a":1}', expect: '{"a":1,"b":2}' },
    { id: "JCS-2", input: '{"€":1,"\\r":2,"1":3,"é":4}', expect: '{"\\r":2,"1":3,"é":4,"€":1}', note: "UTF-16 code-unit order" },
    { id: "JCS-3", input: '{"a":[3,{"z":null,"y":true}],"s":"\\u00e9\\n"}', expect: '{"a":[3,{"y":true,"z":null}],"s":"é\\n"}' },
    { id: "JCS-4", input: '{"n":-0}', expect: '{"n":0}' },
    { id: "JCS-5", input: '{"n":9007199254740991}', expect: '{"n":9007199254740991}' },
    { id: "JCS-6", input: '{"s":"é"}', expect: '{"s":"é"}', note: "precomposed; never normalized" },
    { id: "JCS-7", input: '{"s":"e\u0301"}', expect: '{"s":"e\u0301"}', note: "decomposed (U+0065 U+0301) stays decomposed; never NFC-normalized" },
    { id: "JCS-8", input: '{"s":"\\u0000\\u001f\\b\\t\\n\\f\\r\\"\\\\/\\u2028\\u2029\\ud83d\\ude00"}', expect: '{"s":"\\u0000\\u001f\\b\\t\\n\\f\\r\\"\\\\/\u2028\u2029\ud83d\ude00"}', note: "RFC 8785 escapes: controls escaped (short forms where defined), '/', U+2028, U+2029, and non-BMP emitted literally" },
    { id: "JCS-BAD-1", input: '{"n":1.5}', expect: "reject", note: "non-integer" },
    { id: "JCS-BAD-2", input: '{"n":1e400}', expect: "reject", note: "infinity" },
    { id: "JCS-BAD-3", input: '{"n":9007199254740993}', expect: "reject", note: "beyond ±(2^53−1)" },
    { id: "JCS-BAD-4", input: '{"s":"\\ud800"}', expect: "reject", note: "lone surrogate" },
    { id: "JCS-BAD-5", input: '{"n":1.0e0}', expect: '{"n":1}', note: "1.0e0 parses to the integer 1; accepted" },
  ],
};

// --- receipts ---
function chain() {
  const base = "ilp:host.example";
  const ev = claim.event;
  const out = [];
  let prev = GENESIS_HASH;
  const add = (r) => {
    const full = { ...r, event: ev, prev_receipt_hash: prev };
    full.hash = receiptHash(full);
    prev = full.hash;
    out.push(full);
  };
  add({ id: `${base}:receipt:00000000-0000-7000-8000-000000000001`, action_kind: "engine.event_created", subject_human: "ilp:host.example:human:00000000-0000-7000-8000-0000000000aa", subject_agent: null, license_plate: null, mandate: "human_directed", source_class: "engine", resource: ev, occurred_at: "2026-09-27T12:00:00.000Z" });
  add({ id: `${base}:receipt:00000000-0000-7000-8000-000000000002`, action_kind: "federation.grant_issued", subject_human: claim.sub, subject_agent: claim.agent.id, license_plate: "IL-7Q3K2M9P", mandate: "human_directed", source_class: "engine", authorization_grant: grant.jti, resource: grant.jti, occurred_at: "2026-09-27T12:00:05.000Z" });
  add({ id: `${base}:receipt:00000000-0000-7000-8000-000000000003`, action_kind: "unconference.proposal", subject_human: claim.sub, subject_agent: claim.agent.id, license_plate: "IL-7Q3K2M9P", mandate: "human_directed", source_class: "agent_token_api", authorization_grant: grant.jti, resource: `${base}:action:00000000-0000-7000-8000-00000000a001`, occurred_at: "2026-09-27T12:00:09.000Z" });
  add({ id: `${base}:receipt:00000000-0000-7000-8000-000000000004`, action_kind: "engine.legacy", subject_human: "ilp:host.example:human:00000000-0000-7000-8000-0000000000aa", subject_agent: null, license_plate: null, mandate: "human_directed", resource: ev, occurred_at: "2026-09-27T12:00:10.000Z" });
  return out;
}
const good_chain = chain();
const clone = (x) => JSON.parse(JSON.stringify(x));
const badChains = [];
{
  const c = clone(good_chain);
  c[2].resource_global_id = c[2].resource;
  delete c[2].resource;
  badChains.push({ id: "RCPT-BAD-1", chain: c, expect: "reject", note: "wire member resource_global_id instead of resource (K-21)" });
}
{
  const c = clone(good_chain);
  c[1].prev_receipt_hash = "f".repeat(64);
  badChains.push({ id: "RCPT-BAD-2", chain: c, expect: "reject", note: "broken link" });
}
{
  const c = clone(good_chain);
  c[2].mandate = "standing_instruction";
  badChains.push({ id: "RCPT-BAD-3", chain: c, expect: "reject", note: "hashed member altered" });
}
{
  const c = clone(good_chain);
  c[3].source_class = null;
  badChains.push({ id: "RCPT-BAD-4", chain: c, expect: "schema_reject", note: "the hash body treats null as absent, so the chain still verifies; the strict receipt schema rejects null (R-CORE-39(a))" });
}
{
  const c = clone(good_chain);
  delete c[2].authorization_grant;
  badChains.push({ id: "RCPT-BAD-5", chain: c, expect: "reject", note: "authorization_grant stripped from a hashed receipt" });
}

{
  const c = clone(good_chain).slice(0, 2);
  c[1].event = "ilp:host.example:event:00000000-0000-7000-8000-000000000099";
  c[1].hash = receiptHash(c[1]);
  badChains.push({ id: "RCPT-BAD-6", chain: c, expect: "reject", note: "links and hashes recompute, but the chain spans two events" });
}

{
  const c = clone(good_chain).slice(0, 1);
  c[0].x_note = "extension members are outside the hash body";
  badChains.push({ id: "RCPT-BAD-7", chain: c, expect: "schema_reject", note: "an x_ member on a receipt is not covered by the hash, so receipts are closed (R-CORE-39(c) exception)" });
}

const receipts = {
  genesis: GENESIS_HASH,
  hash_body_rule: "R-CORE-40: subject_agent and license_plate present (null when absent); source_class and authorization_grant omitted when absent",
  good: { id: "RCPT-GOOD-1", chain: good_chain, head: good_chain.at(-1).hash },
  bad: badChains,
};

// --- detached signature (export manifest) ---
const manifest = signDetached(
  {
    format: "ilp-export/1",
    event: claim.event,
    created_at: "2026-09-27T13:00:00Z",
    created_by: "ilp:host.example:human:00000000-0000-7000-8000-0000000000aa",
    instance: { host: "host.example", kid: HOST.kid },
    files: [{ path: "receipts.jsonl", sha256: "b".repeat(64), bytes: 1234 }],
    receipts_head_hash: good_chain.at(-1).hash,
    consent_versions: [],
  },
  HOST,
);
const detached = {
  keys,
  good: { id: "DET-GOOD-1", object: manifest, signer: "https://host.example" },
  bad: [
    { id: "DET-BAD-1", object: { ...manifest, receipts_head_hash: "c".repeat(64) }, signer: "https://host.example", expect: "SIGNATURE_INVALID", note: "member altered after signing" },
    { id: "DET-BAD-2", object: { ...manifest, kid: OTHER.kid }, signer: "https://host.example", expect: "UNKNOWN_SIGNER", note: "kid not published by signer" },
  ],
};

const context = {
  $comment: "Vector context: synthetic values only. The token below is a published test value, never a live credential.",
  participant_token: token,
  credential_binding_rule: "value = base64url(SHA-256(UTF-8 token bytes)), unpadded",
  expected_binding: grant.credential_binding.value,
  now_for_validity: T0 + 60,
  claim_payload: claim,
  grant_payload: grant,
  seeds: { "vec-home-1": "0x01 × 32", "vec-host-1": "0x02 × 32", "vec-other-1": "0x03 × 32" },
};

mkdirSync(OUT, { recursive: true });
const write = (name, obj) => writeFileSync(join(OUT, name), JSON.stringify(obj, null, 2) + "\n");
write("jcs.json", jcs);
write("jws.json", jws);
write("receipts.json", receipts);
write("detached.json", detached);
write("context.json", context);
console.log("vectors written:", ["jcs", "jws", "receipts", "detached", "context"].join(", "), "| canonical check:", canonicalize({ ok: true }));
