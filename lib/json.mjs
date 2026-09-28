// Strict JSON parser for signed and hashed objects: RFC 8259 grammar, and member names must be unique
// (a JCS object has one value per name; duplicate names would let two verifiers read different values).
export class JsonError extends Error {}

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
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if (!m) fail("invalid number");
    i += m[0].length;
    return Number(m[0]);
  }
  const v = value();
  ws();
  if (i !== text.length) fail("trailing characters");
  return v;
}
