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

/** Lenient receive (R-CORE-39(b)): unknown top-level members of peer input are ignored, then the
 *  remaining members are validated strictly. Used by consumers of federation payloads and signed objects. */
export function validateLenient(name, doc) {
  load();
  const v = byName.get(name);
  const props = v.schema.properties ? new Set(Object.keys(v.schema.properties)) : null;
  if (!props || typeof doc !== "object" || doc === null) return validate(name, doc);
  const known = Object.fromEntries(Object.entries(doc).filter(([k]) => props.has(k) || k.startsWith("x_")));
  return validate(name, known);
}
