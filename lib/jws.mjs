// JWS Compact with EdDSA over Ed25519 (R-CORE-36(a)) and detached Ed25519 over JCS (R-CORE-36(b)).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { CanonicalizationError, canonicalBytes, canonicalize } from "./jcs.mjs";
import { JsonError, parseStrict } from "./json.mjs";

export const TYP = Object.freeze({
  claim: "ilp-claim+jwt",
  grant: "ilp-grant+jwt",
  revocation: "ilp-revocation+jwt",
  attestation: "ilp-attestation+jwt",
});

export class JwsError extends Error {
  /** @param {"SIGNATURE_INVALID"|"UNKNOWN_SIGNER"|"VALIDATION_FAILED"} code */
  constructor(code, message) {
    super(message);
    this.name = "JwsError";
    this.code = code;
  }
}

export const b64u = {
  encode: (buf) => Buffer.from(buf).toString("base64url"),
  decode: (s) => {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new JwsError("VALIDATION_FAILED", "not base64url");
    return Buffer.from(s, "base64url");
  },
};

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const sha256B64u = (bytes) => createHash("sha256").update(bytes).digest("base64url");

/** Generate an Ed25519 key pair. Returns { kid, privateJwk, publicJwk }. */
export function generateKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateJwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  return { kid, privateJwk: { ...privateJwk, kid }, publicJwk: { kid, kty: "OKP", crv: "Ed25519", x: pub.x, use: "sig" } };
}

export const publicJwkOf = (privateJwk) => ({ kid: privateJwk.kid, kty: "OKP", crv: "Ed25519", x: privateJwk.x, use: "sig" });

function privateKeyObject(jwk) {
  return createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: jwk.d, x: jwk.x }, format: "jwk" });
}

function publicKeyObject(jwk) {
  if (jwk?.kty !== "OKP" || jwk?.crv !== "Ed25519" || typeof jwk?.x !== "string") {
    throw new JwsError("UNKNOWN_SIGNER", "key is not an Ed25519 OKP JWK");
  }
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
}

/** Sign `payload` (JCS-encoded) as JWS Compact with header {alg:EdDSA, kid, typ}. */
export function signJws(payload, privateJwk, typ) {
  if (!privateJwk?.kid) throw new Error("signing key has no kid");
  const header = { alg: "EdDSA", kid: privateJwk.kid, ...(typ ? { typ } : {}) };
  const signingInput = `${b64u.encode(canonicalBytes(header))}.${b64u.encode(canonicalBytes(payload))}`;
  const sig = sign(null, Buffer.from(signingInput, "ascii"), privateKeyObject(privateJwk));
  return `${signingInput}.${b64u.encode(sig)}`;
}

/** Decode without verifying. Throws VALIDATION_FAILED on malformed input. */
export function decodeJws(jws) {
  if (typeof jws !== "string") throw new JwsError("VALIDATION_FAILED", "JWS must be a string");
  const parts = jws.split(".");
  if (parts.length !== 3) throw new JwsError("VALIDATION_FAILED", "JWS compact must have three parts");
  let header, payload;
  try {
    header = parseStrict(b64u.decode(parts[0]).toString("utf8"));
    payload = parseStrict(b64u.decode(parts[1]).toString("utf8"));
  } catch (e) {
    if (e instanceof JwsError) throw e;
    // duplicate member names are rejected: one value per name (RFC 8785 / R-CORE-26)
    throw new JwsError("VALIDATION_FAILED", e instanceof JsonError ? `JWS JSON rejected: ${e.message}` : "JWS header or payload is not JSON");
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) throw new JwsError("VALIDATION_FAILED", "JWS header is not an object");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new JwsError("VALIDATION_FAILED", "JWS payload is not an object");
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] };
}

/**
 * Verify a JWS Compact over the received bytes (never re-canonicalized).
 * `resolveKey(kid, header, payload)` returns a public JWK or null.
 * Returns { header, payload }. Throws JwsError with SIGNATURE_INVALID / UNKNOWN_SIGNER / VALIDATION_FAILED.
 */
export function verifyJws(jws, resolveKey, { typ } = {}) {
  const { header, payload, signingInput, signature } = decodeJws(jws);
  if (header.alg !== "EdDSA") throw new JwsError("SIGNATURE_INVALID", `alg ${JSON.stringify(header.alg)} is not EdDSA`);
  // RFC 7515 §4.1.11: no critical extensions are understood, so any `crit` makes the JWS invalid
  if ("crit" in header) throw new JwsError("SIGNATURE_INVALID", "unsupported critical header extension");
  if (typeof header.kid !== "string" || !header.kid) throw new JwsError("UNKNOWN_SIGNER", "JWS header has no kid");
  if (typ && header.typ !== typ) throw new JwsError("VALIDATION_FAILED", `typ ${JSON.stringify(header.typ)} is not ${typ}`);
  const jwk = resolveKey(header.kid, header, payload);
  if (!jwk) throw new JwsError("UNKNOWN_SIGNER", `kid ${header.kid} does not resolve`);
  const ok = verify(null, Buffer.from(signingInput, "ascii"), publicKeyObject(jwk), b64u.decode(signature));
  if (!ok) throw new JwsError("SIGNATURE_INVALID", "signature does not verify");
  // R-CORE-35: verifiers reject signed values outside the canonicalization profile (the signature
  // was checked over the received bytes; this checks the decoded value domain)
  try {
    canonicalize(header);
    canonicalize(payload);
  } catch (e) {
    if (e instanceof CanonicalizationError) throw new JwsError("VALIDATION_FAILED", `signed value outside the canonicalization profile: ${e.message}`);
    throw e;
  }
  return { header, payload };
}

/** Detached Ed25519 over JCS(object without `signature`) — R-CORE-36(b). */
export function signDetached(object, privateJwk) {
  const { signature: _omit, ...rest } = object;
  const body = { ...rest, kid: rest.kid ?? privateJwk.kid };
  const sig = sign(null, canonicalBytes(body), privateKeyObject(privateJwk));
  return { ...body, signature: b64u.encode(sig) };
}

export function verifyDetached(object, publicJwk) {
  const { signature, ...rest } = object;
  if (typeof signature !== "string") throw new JwsError("SIGNATURE_INVALID", "missing signature");
  const ok = verify(null, canonicalBytes(rest), publicKeyObject(publicJwk), b64u.decode(signature));
  if (!ok) throw new JwsError("SIGNATURE_INVALID", "detached signature does not verify");
  return true;
}

export { canonicalize };
