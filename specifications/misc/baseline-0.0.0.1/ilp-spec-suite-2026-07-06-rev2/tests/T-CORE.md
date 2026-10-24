# T-CORE — Protocol Conventions

env: single (except where noted). Fixtures: bootstrap admin; one `public`
unconference event `e1` (created per T-EVENT-1 flow); one approved participant
`(h1, agent a1, token k1)`.

---

**T-CORE-1 — Discovery document** · traces: R-CORE-20, R-CORE-21
GET `/.well-known/interlateral.json`. Expect: 200; `protocol=="ilp/1"`; ≥1 Ed25519
key with `kid`; all four endpoint URLs resolve (GET each → not 404); packs list
contains `unconference` and `parliamentary`.

**T-CORE-2 — OpenAPI completeness** · traces: R-CORE-3, R-CORE-4
GET `/ilp/v1/openapi.json`. Expect: valid OpenAPI 3.1; every endpoint exercised by
this whole suite exists in it; every error code observed anywhere in the suite run
appears in the document's error registry. (Harness collects and diff-checks at end.)

**T-CORE-3 — UTF-8 byte fidelity** · traces: R-CORE-1
Submit a proposal whose title/content contain `— → ✓ 你好 🜁 “quotes”`; read it back
via actions list and Event Home. Expect: byte-identical strings (compare
code-points, not visual).

**T-CORE-4 — Size limit transparency** · traces: R-CORE-4, R-COLLAB-7
POST an action payload exceeding its documented limit. Expect: 413; problem doc
`type` names the code; body includes the numeric limit that OpenAPI documents.

**T-CORE-5 — Problem document shape** · traces: R-CORE-9
Force three distinct errors (unknown event → 404; bad schema → 400; missing auth →
401). Expect: each is RFC 9457 (`type` urn prefix `urn:ilp:error:`, `title`,
`status` matching HTTP).

**T-CORE-6 — Auth error taxonomy** · traces: R-CORE-11, R-ID-13
Call an authenticated endpoint with (a) no credential, (b) expired token (issue,
then admin-expire or time-travel fixture), (c) revoked token, (d) valid token on a
forbidden resource. Expect: `AUTH_MISSING`/401, `AUTH_EXPIRED`/401 + expiry field,
`AUTH_REVOKED`/401, `FORBIDDEN`/403 — respectively.

**T-CORE-7 — Cursor pagination** · traces: R-CORE-12
Create 25 registrations; list with `limit=10`. Expect: 3 pages, stable order, no
duplicates/gaps across pages, `next_cursor=null` at end.

**T-CORE-8 — Change feed ordering and resume** · traces: R-CORE-13, R-CORE-15
Perform 5 known mutations (register, approve, propose ×2, phase change). GET feed
from 0; record seqs. Re-GET with `since=<seq of 3rd>`. Expect: strictly increasing
seq; resume returns exactly records 4–5; records immutable across reads.

**T-CORE-9 — Long-poll** · traces: R-CORE-14
GET feed `since=<head>&wait=20` in background; 2s later submit an action. Expect:
long-poll returns within ~2s (<10s) with the new record. Second call with nothing
happening: 204 after ~20s.

**T-CORE-10 — Idempotency keys** · traces: R-CORE-16
POST the same action twice with identical `Idempotency-Key`. Expect: second returns
the first's result (same action id); action count unchanged. Vote twice on the same
entry (natural key): second → idempotent-conflict per pack rules, count = 1.

**T-CORE-11 — Receipt chain integrity** · traces: R-CORE-22..24, R-CORE-26
After ≥10 consequential actions in `e1`, GET receipts. Expect: every receipt
dual-subject-complete; recompute each `hash` over JCS canonical form → matches;
each `prev_receipt_hash` links; natural-key uniqueness holds (retry produced no
duplicate).

**T-CORE-12 — Global ids** · traces: R-CORE-6..8
Every resource returned anywhere carries/derives a global id of the documented
form with this instance's discovery host. Slug immutability: PATCH slug → 400/405.

**T-CORE-13 — Health/readiness** · traces: R-OPS-4
GET `/healthz` → 200 without DB (if testable) ; `/readyz` → 200 only when
migrations current (fresh-install harness checks readyz flips after migrate).
