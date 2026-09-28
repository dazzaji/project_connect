// Loads the ILP schemas and validates documents (Ajv, JSON Schema 2020-12).
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "specifications", "schemas");

let ajv;
const byName = new Map();

function load() {
  if (ajv) return;
  ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  for (const f of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json"))) {
    const s = JSON.parse(readFileSync(join(SCHEMA_DIR, f), "utf8"));
    byName.set(f.replace(/\.schema\.json$/, ""), ajv.compile(s));
  }
}

export function schemaNames() {
  load();
  return [...byName.keys()];
}

/** Validate `doc` against schema `name`. Returns { ok, errors: string[] }. */
export function validate(name, doc) {
  load();
  const v = byName.get(name);
  if (!v) throw new Error(`unknown schema ${name}`);
  const ok = v(doc);
  return { ok: !!ok, errors: ok ? [] : v.errors.map((e) => `${e.instancePath || "/"} ${e.message}`) };
}

/** Lenient receive (R-CORE-39(b)): unknown members of peer input are ignored at every level the schema
 *  closes, then what remains is validated strictly. Signatures are always checked over the received bytes
 *  before this is applied, so pruning never affects verification. */
export function validateLenient(name, doc) {
  load();
  const v = byName.get(name);
  if (!v) throw new Error(`unknown schema ${name}`);
  return validate(name, prune(v.schema, v.schema, doc));
}

function resolve(root, s) {
  if (s?.$ref?.startsWith("#/")) return s.$ref.slice(2).split("/").reduce((o, k) => o[k], root);
  return s;
}

function prune(root, schema, value) {
  const s = resolve(root, schema);
  if (!s || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return s.items ? value.map((x) => prune(root, s.items, x)) : value;
  const branches = s.oneOf ?? s.anyOf;
  if (branches) {
    const obj = branches.map((b) => resolve(root, b)).find((b) => b.type === "object" || b.properties);
    return obj ? prune(root, obj, value) : value;
  }
  if (!s.properties) return value;
  const out = {};
  for (const [k, x] of Object.entries(value)) {
    if (k in s.properties) out[k] = prune(root, s.properties[k], x);
    else if (s.additionalProperties !== false || (s.patternProperties && Object.keys(s.patternProperties).some((re) => new RegExp(re).test(k)))) out[k] = x;
  }
  return out;
}
