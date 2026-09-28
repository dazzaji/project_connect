// Receipt hash body and chain verification (R-CORE-40).
import { canonicalBytes } from "./jcs.mjs";
import { sha256Hex } from "./jws.mjs";

export const GENESIS_HASH = "0".repeat(64);

/** Build the hash body: historical null-when-absent members, omitted-when-absent members after 0.0.1. */
export function receiptHashBody(r) {
  const body = {
    id: r.id,
    event: r.event,
    action_kind: r.action_kind,
    subject_human: r.subject_human,
    subject_agent: r.subject_agent ?? null,
    license_plate: r.license_plate ?? null,
    mandate: r.mandate,
    resource: r.resource,
    occurred_at: r.occurred_at,
    prev_receipt_hash: r.prev_receipt_hash,
  };
  if (r.source_class != null) body.source_class = r.source_class;
  if (r.authorization_grant != null) body.authorization_grant = r.authorization_grant;
  return body;
}

export const receiptHash = (r) => sha256Hex(canonicalBytes(receiptHashBody(r)));

/**
 * Verify an ordered receipt chain. Returns { ok, head, errors[] }.
 * Each error is { index, id, reason }.
 */
export function verifyReceiptChain(receipts) {
  const errors = [];
  let prev = GENESIS_HASH;
  receipts.forEach((r, index) => {
    if ("resource_global_id" in r) errors.push({ index, id: r.id, reason: "wire member resource_global_id (must be resource)" });
    if (r.prev_receipt_hash !== prev) errors.push({ index, id: r.id, reason: "prev_receipt_hash does not link" });
    let h;
    try {
      h = receiptHash(r);
    } catch (e) {
      errors.push({ index, id: r.id, reason: `hash body not canonicalizable: ${e.message}` });
      return;
    }
    if (h !== r.hash) errors.push({ index, id: r.id, reason: "hash does not recompute" });
    prev = r.hash;
  });
  return { ok: errors.length === 0, head: prev, errors };
}
