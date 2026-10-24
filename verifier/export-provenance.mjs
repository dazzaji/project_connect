// Opt-in semantic verification of the Beta B5 export provenance companions (`ilp-action-provenance/1`, and
// `ilp-revision-provenance/1` rows), per the frozen producer contract (docs/export-provenance.md in Beta source47; the row
// schema is vendored byte-for-byte in ./contracts/). Nothing here is checked unless a caller asks for it: legacy exports
// without the companion stay legacy and are never reported as B5-complete. No result ever states human approval.
// fix68 (review61): absent or unlisted evidence never becomes an empty successful join; strict JSON (duplicate members,
// non-integer numbers rejected) before validation; exact typed revision keys; standalone applies the manifest/receipt
// schemas, the signed lengths and the grant bindings the packet verifier already enforces.
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseStrict } from "../lib/json.mjs";
import { receiptHash, verifyReceiptChain } from "../lib/receipt.mjs";
import { TYP, verifyDetached, verifyJws } from "../lib/jws.mjs";
import { validate } from "../lib/schemas.mjs";

export const PROVENANCE_MODE = "ilp-action-provenance/1";
export const ACTION_PROVENANCE_FILE = "action-provenance.jsonl";
export const REVISION_PROVENANCE_FILE = "revision-provenance.jsonl";
export const CONTRACT_SCHEMA_SHA256 = "b33075887e04bff626439df3750f1880487a4bfa40aaf312f242c1aff00925cd";
// the semantic joins read these; each must be covered by the signed export manifest (present-but-empty is fine, absent is not)
const REQUIRED_INPUTS = ["actions.jsonl", "receipts.jsonl", "grants.jsonl"];
const SKEW_S = 300;

const schemaText = readFileSync(new URL("./contracts/ilp-action-provenance-1.schema.json", import.meta.url), "utf8");
const ajv = new Ajv({ strict: false, allErrors: true });
const schema = JSON.parse(schemaText);
const validAction = ajv.compile(schema);
const validRevision = ajv.compile({ ...schema.$defs.revisionRow, $id: undefined });
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
function jsonl(text, what) {
  need(typeof text === "string", `${what} is missing`);
  return text.split("\n").filter((l) => l.length).map((l, i) => {
    try { return parseStrict(l); } catch (e) { throw new Error(`${what} line ${i + 1} is not strict JSON (${e.message})`); }
  });
}
const uniqueBy = (rows, key, what) => {
  const m = new Map();
  for (const r of rows) { const k = key(r); need(!m.has(k), `${what}: duplicate ${k}`); m.set(k, r); }
  return m;
};
/** an exact, typed (artifact, rev) key: artifact a string and rev a safe integer on BOTH sides, never coerced */
const revKey = (r, what) => {
  need(typeof r.artifact === "string" && Number.isSafeInteger(r.rev), `${what}: artifact/rev must be a string and an integer`);
  return JSON.stringify([r.artifact, r.rev]);
};

/**
 * Semantic checks of one export's companions. `manifest` must already be signature-, hash- and length-verified by the caller
 * (the packet verifier's exports guard, or verifyExportBundle below); `files` maps manifest paths to their exact text;
 * `presentPaths` lists every file the export actually carries (none may be outside the manifest); `keyFor` resolves the
 * exporting instance's operator-trusted signing keys. Throws on the first violation; returns a summary.
 */
export function verifyExportProvenance({ manifest, files, keyFor, presentPaths = Object.keys(files) }) {
  const listed = new Set(manifest.files.map((f) => f.path));
  need(listed.has(ACTION_PROVENANCE_FILE), `legacy export: no manifest-covered ${ACTION_PROVENANCE_FILE} (B5 provenance not established)`);
  // F1: no export-local file outside the signed manifest; every semantic input covered and present
  for (const p of presentPaths) need(listed.has(p) || p === "manifest.json", `export file ${p} is not covered by the export manifest`);
  for (const p of REQUIRED_INPUTS) need(listed.has(p) && typeof files[p] === "string", `required evidence ${p} is absent or not covered by the export manifest`);
  const actions = jsonl(files["actions.jsonl"], "actions.jsonl");
  const receipts = jsonl(files["receipts.jsonl"], "receipts.jsonl");
  const grants = jsonl(files["grants.jsonl"], "grants.jsonl");
  const rows = jsonl(files[ACTION_PROVENANCE_FILE], ACTION_PROVENANCE_FILE);

  // 1. every row is exactly the frozen contract (version, members, null/non-null grant pairing)
  for (const [i, r] of rows.entries()) need(validAction(r), `${ACTION_PROVENANCE_FILE} row ${i + 1} violates ${PROVENANCE_MODE}: ${ajv.errorsText(validAction.errors)}`);
  // 2. bijection with exported actions: no duplicate, orphan or missing row
  const byAction = uniqueBy(rows, (r) => r.action, "action provenance");
  const actionById = uniqueBy(actions, (a) => a.id, "actions.jsonl");
  for (const r of rows) need(actionById.has(r.action), `orphan provenance row for ${r.action}`);
  for (const a of actions) need(byAction.has(a.id), `missing provenance row for ${a.id}`);
  // 3. receipt join: exact id and original hash, resource/kind/mandate/human/agent agree; one receipt per action
  const receiptById = uniqueBy(receipts, (r) => r.id, "receipts.jsonl");
  uniqueBy(rows, (r) => r.receipt, "action provenance receipt (ambiguous receipt linkage)");
  const grantRows = new Map();
  for (const g of grants) { const list = grantRows.get(g.jti) ?? []; list.push(g); grantRows.set(g.jti, list); }
  const declared = { caller: 0, default: 0, unknown: 0 };
  let grantsVerified = 0;
  for (const r of rows) {
    const a = actionById.get(r.action);
    const rc = receiptById.get(r.receipt);
    need(rc, `${r.action}: receipt ${r.receipt} is not in receipts.jsonl`);
    need(rc.hash === r.receipt_hash && receiptHash(rc) === rc.hash, `${r.action}: receipt hash disagrees with the receipt`);
    need(rc.resource === a.id, `${r.action}: receipt ${rc.id} is for another resource`);
    need(rc.action_kind === a.kind, `${r.action}: receipt kind ${rc.action_kind} differs from action kind ${a.kind}`);
    need(rc.mandate === a.mandate, `${r.action}: receipt mandate differs from the action's`);
    need(rc.subject_human === a.actor_human_ref && (rc.subject_agent ?? null) === (a.actor_agent_ref ?? null), `${r.action}: receipt subject differs from the action's`);
    // 4. grant: the receipt's own grant (absent = null) equals the companion; non-null selects exactly one verified grant
    need((rc.authorization_grant ?? null) === r.authorization_grant, `${r.action}: authorization_grant disagrees with the receipt`);
    if (r.authorization_grant === null) need(r.grant_jws_sha256 === null, `${r.action}: grant digest without a grant`);
    else {
      const list = grantRows.get(r.authorization_grant) ?? [];
      need(list.length === 1, `${r.action}: grant ${r.authorization_grant} selects ${list.length} grants.jsonl entries`);
      need(sha(list[0].jws) === r.grant_jws_sha256, `${r.action}: grant JWS digest disagrees`);
      let payload;
      try { ({ payload } = verifyJws(list[0].jws, keyFor, { typ: TYP.grant })); } catch (e) { throw new Error(`${r.action}: grant does not verify (${e.message})`); }
      need(payload.jti === r.authorization_grant, `${r.action}: verified grant payload jti differs`);
      grantsVerified++;
    }
    declared[r.mandate_source ?? "unknown"]++;
  }
  // 5. revision companion: exact typed (artifact, rev) bijection; artifacts never silently drop their revisions
  const artifactsListed = listed.has("artifacts.json") ? parseStrict(files["artifacts.json"] ?? "null") : null;
  const hasArtifacts = Array.isArray(artifactsListed) ? artifactsListed.length > 0 : !!(artifactsListed?.items?.length);
  if (hasArtifacts) need(listed.has("revisions.jsonl"), "artifacts exist but revisions.jsonl is not covered by the export manifest");
  let revRows = [];
  if (listed.has(REVISION_PROVENANCE_FILE) || listed.has("revisions.jsonl")) {
    need(listed.has("revisions.jsonl"), `${REVISION_PROVENANCE_FILE} present but revisions.jsonl is not covered by the export manifest`);
    const revisions = jsonl(files["revisions.jsonl"], "revisions.jsonl");
    if (revisions.length || listed.has(REVISION_PROVENANCE_FILE)) {
      need(listed.has(REVISION_PROVENANCE_FILE), `revisions exist but no manifest-covered ${REVISION_PROVENANCE_FILE}`);
      revRows = jsonl(files[REVISION_PROVENANCE_FILE], REVISION_PROVENANCE_FILE);
      for (const [i, r] of revRows.entries()) need(validRevision(r), `${REVISION_PROVENANCE_FILE} row ${i + 1} violates ilp-revision-provenance/1: ${ajv.errorsText(validRevision.errors)}`);
      const byKey = uniqueBy(revRows, (r) => revKey(r, "revision provenance"), "revision provenance");
      const revKeys = uniqueBy(revisions, (r) => revKey(r, "revisions.jsonl"), "revisions.jsonl");
      for (const k of byKey.keys()) need(revKeys.has(k), `orphan revision provenance row ${k}`);
      for (const k of revKeys.keys()) need(byKey.has(k), `missing revision provenance row ${k}`);
    }
  }
  return {
    checked: true, version: PROVENANCE_MODE, actions: rows.length, receipts_joined: rows.length, grants_verified: grantsVerified, revisions: revRows.length,
    mandate_source_declared: declared,
    // caller/default/null labels and valid signatures are recorded provenance only (contract: never independent approval)
    human_approval: "not_established",
  };
}

/**
 * Standalone: verify a returned export bundle {manifest, files} against operator configuration — `trustedKeys` (the exporting
 * instance's signing keys) and `issuer` (its base URL) — exactly as the packet verifier does for an export (manifest schema,
 * signature, signed hash AND length of every listed file, receipt schema and chain, every grant's signature/issuer/audience and
 * receipt bindings), then its companions. Missing operator inputs refuse; nothing is silently skipped.
 */
export function verifyExportBundle(bundle, trustedKeys, { issuer } = {}) {
  need(typeof issuer === "string" && /^https?:\/\//.test(issuer), "standalone verification needs the operator-trusted issuer base URL");
  const { manifest, files } = bundle;
  need(validate("export-manifest", manifest).ok, `export manifest schema: ${validate("export-manifest", manifest).errors.slice(0, 3).join("; ")}`);
  const key = trustedKeys.find((k) => k.kid === manifest.kid);
  need(key, `manifest kid ${manifest.kid} is not an operator-trusted key`);
  try { verifyDetached(manifest, key); } catch (e) { throw new Error(`manifest signature (${e.message})`); }
  for (const f of manifest.files) {
    need(typeof files[f.path] === "string", `listed file ${f.path} missing`);
    need(Number.isSafeInteger(f.bytes), `listed file ${f.path} has no signed length`);
    need(sha(files[f.path]) === f.sha256 && Buffer.byteLength(files[f.path], "utf8") === f.bytes, `listed file ${f.path} hash/length`);
  }
  const keyFor = (kid) => trustedKeys.find((k) => k.kid === kid) ?? null;
  const receipts = jsonl(files["receipts.jsonl"], "receipts.jsonl");
  for (const r of receipts) need(validate("receipt", r).ok, `receipt schema ${r.id}`);
  const chain = verifyReceiptChain(receipts, { event: manifest.event });
  need(chain.ok && chain.head === manifest.receipts_head_hash, `receipt chain ${JSON.stringify(chain.errors.slice(0, 2))}`);
  // grant prerequisites (same rules as the packet verifier's exports guard)
  const grants = new Map();
  for (const g of jsonl(files["grants.jsonl"], "grants.jsonl")) {
    let payload;
    try { ({ payload } = verifyJws(g.jws, keyFor, { typ: TYP.grant })); } catch (e) { throw new Error(`grant ${g.jti} does not verify (${e.message})`); }
    need(payload.jti === g.jti && payload.iss === issuer && payload.aud === issuer, `grant ${g.jti} issuer/audience`);
    grants.set(g.jti, payload);
  }
  for (const r of receipts.filter((x) => x.authorization_grant && x.source_class === "agent_token_api")) {
    const g = grants.get(r.authorization_grant);
    need(g, `receipt ${r.id} links a grant absent from grants.jsonl`);
    need(g.sub === r.subject_human && (g.agent?.id ?? null) === r.subject_agent, `receipt ${r.id} subject differs from its grant`);
    const t = Math.floor(Date.parse(r.occurred_at) / 1000);
    need(t >= g.nbf - SKEW_S && t <= g.exp + SKEW_S, `receipt ${r.id} falls outside its grant's validity at the historical action time`);
    need(g.event === manifest.event, "grant event");
  }
  return verifyExportProvenance({ manifest, files, keyFor });
}
