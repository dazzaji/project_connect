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
  const branchValidators = new Map();
  const validateBranch = (b, candidate) => {
    if (!branchValidators.has(b)) branchValidators.set(b, ajv.compile({ ...b, $defs: v.schema.$defs }));
    return branchValidators.get(b)(candidate);
  };
  return validate(name, prune(v.schema, v.schema, doc, validateBranch));
}

/** Lenient receive that also RETURNS the pruned document, so a consumer re-emits only schema members. */
export function receiveLenient(name, doc) {
  load();
  const v = byName.get(name);
  if (!v) throw new Error(`unknown schema ${name}`);
  const branchValidators = new Map();
  const validateBranch = (b, candidate) => {
    if (!branchValidators.has(b)) branchValidators.set(b, ajv.compile({ ...b, $defs: v.schema.$defs }));
    return branchValidators.get(b)(candidate);
  };
  const pruned = prune(v.schema, v.schema, doc, validateBranch);
  return { ...validate(name, pruned), value: pruned };
}

function resolve(root, s) {
  if (s?.$ref?.startsWith("#/")) return s.$ref.slice(2).split("/").reduce((o, k) => o[k], root);
  return s;
}

// own data property only; never through the prototype chain (a member named __proto__ or toString is data)
const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

function prune(root, schema, value, validateBranch) {
  const s = resolve(root, schema);
  if (!s || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return s.items ? value.map((x) => prune(root, s.items, x, validateBranch)) : value;
  const branches = s.oneOf ?? s.anyOf;
  if (branches) {
    // choose the branch whose pruned candidate validates; otherwise keep the value for the strict error
    for (const b of branches.map((x) => resolve(root, x))) {
      if (!(b.type === "object" || b.properties)) continue;
      const candidate = prune(root, b, value, validateBranch);
      if (validateBranch(b, candidate)) return candidate;
    }
    return value;
  }
  if (!s.properties) return value;
  const out = {};
  for (const [k, x] of Object.entries(value)) {
    if (Object.hasOwn(s.properties, k)) put(out, k, prune(root, s.properties[k], x, validateBranch));
    else if (s.additionalProperties !== false || (s.patternProperties && Object.keys(s.patternProperties).some((re) => new RegExp(re).test(k)))) put(out, k, x);
  }
  return out;
}
