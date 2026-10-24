// RFC 8785 (JCS) canonical JSON under the ILP canonicalization profile (R-CORE-35):
// values are objects, arrays, strings, booleans, null, and integers within ±(2^53 − 1).
// Non-integer numbers, NaN, and infinities are rejected. Strings are never normalized.

export class CanonicalizationError extends Error {
  constructor(message, path) {
    super(`${message} at ${path}`);
    this.name = "CanonicalizationError";
    this.path = path;
  }
}

// RFC 8785 §3.2.3: sort member names by their UTF-16 code units.
function compareUtf16(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

// RFC 8785 §3.2.2.2: escape only '"', '\\', and U+0000..U+001F (with the short forms \b \t \n \f \r);
// every other code point, including '/', U+2028, and U+2029, is emitted literally. Not host JSON.stringify.
const SHORT = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r" };
function quote(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c < 0x20) out += SHORT[c] ?? "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

function serialize(value, path) {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      if (!value.isWellFormed()) throw new CanonicalizationError("string contains a lone surrogate", path);
      return quote(value);
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError("non-finite number", path);
      if (!Number.isInteger(value)) throw new CanonicalizationError("non-integer number", path);
      if (!Number.isSafeInteger(value)) throw new CanonicalizationError("integer outside ±(2^53−1)", path);
      return Object.is(value, -0) ? "0" : String(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v, i) => serialize(v, `${path}[${i}]`)).join(",") + "]";
      }
      const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort(compareUtf16);
      for (const k of keys) if (!k.isWellFormed()) throw new CanonicalizationError("member name contains a lone surrogate", path);
      return "{" + keys.map((k) => quote(k) + ":" + serialize(value[k], `${path}.${k}`)).join(",") + "}";
    }
    default:
      throw new CanonicalizationError(`unsupported type ${typeof value}`, path);
  }
}

/** Canonical JSON string of `value` (throws CanonicalizationError on out-of-profile values). */
export function canonicalize(value) {
  return serialize(value, "$");
}

/** Canonical UTF-8 bytes of `value`. */
export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), "utf8");
}
