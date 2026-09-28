// Strict JSON parser for signed and hashed objects: RFC 8259 grammar, and member names must be unique
// (a JCS object has one value per name; duplicate names would let two verifiers read different values).
export class JsonError extends Error {}

// R-CORE-35: a number in a signed or hashed object must be mathematically an integer within ±(2^53−1).
// Decide that from the LEXEME, before any lossy conversion (so 1e-400 or 1800000000.0000000001 cannot
// round into an integer). Integral forms such as 1.0e0 or 1e3 are accepted as integers.
const MAX = 9007199254740991n;
function exactInteger(m, fail) {
  const [, sign, int, frac = "", expStr = "0"] = m;
  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 400) fail("number outside the integer profile");
  let digits = int + frac;
  let scale = exp - frac.length; // value = digits × 10^scale
  if (scale < 0) {
    const drop = digits.slice(scale);
    if (/[^0]/.test(drop)) fail("non-integer number");
    digits = digits.slice(0, scale) || "0";
  } else digits += "0".repeat(scale);
  const v = BigInt(digits);
  if (v > MAX) fail("integer outside ±(2^53−1)");
  return Number(sign ? -v : v);
}

export function parseStrict(text) {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const fail = (m) => {
    throw new JsonError(`${m} at offset ${i}`);
  };
  function value() {
    ws();
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "t" && text.startsWith("true", i)) return (i += 4), true;
    if (c === "f" && text.startsWith("false", i)) return (i += 5), false;
    if (c === "n" && text.startsWith("null", i)) return (i += 4), null;
    if (c === "-" || (c >= "0" && c <= "9")) return number();
    return fail("unexpected token");
  }
  function object() {
    i++;
    const out = {};
    const seen = new Set();
    ws();
    if (text[i] === "}") return i++, out;
    for (;;) {
      ws();
      if (text[i] !== '"') fail("expected member name");
      const k = string();
      if (seen.has(k)) fail(`duplicate member name ${JSON.stringify(k)}`);
      seen.add(k);
      ws();
      if (text[i++] !== ":") fail("expected ':'");
      Object.defineProperty(out, k, { value: value(), enumerable: true, writable: true, configurable: true });
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") return i++, out;
      fail("expected ',' or '}'");
    }
  }
  function array() {
    i++;
    const out = [];
    ws();
    if (text[i] === "]") return i++, out;
    for (;;) {
      out.push(value());
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") return i++, out;
      fail("expected ',' or ']'");
    }
  }
  function string() {
    const m = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(text.slice(i));
    if (!m) fail("invalid string");
    i += m[0].length;
    return JSON.parse(m[0]);
  }
  function number() {
    const m = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?/.exec(text.slice(i));
    if (!m) fail("invalid number");
    i += m[0].length;
    return exactInteger(m, fail);
  }
  const v = value();
  ws();
  if (i !== text.length) fail("trailing characters");
  return v;
}
