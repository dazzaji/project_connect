# ILP-COLLAB — Collaboration Artifacts

**Status:** DRAFT for Dazza review · 2026-07-06 · Inherits ILP-CORE.
Replaces raw Jot links with a brokered, revision-safe artifact service. This spec
is the direct answer to the Agent Week #1 validated problem (write-concurrency) and
items #1–#3, #8, #9 of the retrospective backlog, and to Murch's recommendations
(stable endpoint across phases, structured append, documented limits).
Requirement IDs: `R-COLLAB-n`. Tests: `tests/T-COLLAB.md`.

---

## 1. Model

- **Artifact**: a markdown document owned by an event (or by the instance for
  standing docs). Fields: id, event, title, `role` (pack binding, e.g.
  `winner_doc`, `minutes`, `resolution_text`), created_from (action/decision id),
  frozen flag, publication state.
- **Revision**: an immutable version of the artifact body. `rev` is a monotonically
  increasing integer per artifact; each revision records author binding
  (human+agent+plate), the operation that produced it, `body_sha256`, parent rev.
- **Section**: artifacts are markdown with stable **block anchors** — the server
  maintains a lightweight block index (headings + explicitly anchored blocks
  `<!-- ilp:block <id> -->`) so appends can target sections without full-body
  rewrites.
- **Thread**: quote-anchored side comments (kept from Jot), never mutating the body.

## 2. Access — brokered only

- **R-COLLAB-1** All artifact access is through the instance's ILP endpoints with
  event credentials (participant token / session). There are **no raw share-link
  write paths** (consensus "brokered Jot access"; the v1 `/jot/body` proxy becomes
  the only model). Read access follows event visibility; a `read_only_link` MAY be
  issued for published artifacts.
- **R-COLLAB-2** The artifact URL is **stable across phases and event status**
  (`/ilp/v1/artifacts/{id}`); no endpoint migration at phase transitions.
  *[Murch #3.]*

## 3. Reads

- **R-COLLAB-3** `GET /ilp/v1/artifacts/{id}` → `{ artifact meta, rev,
  body_sha256, body, blocks: [{id, heading, start_line}], threads_count }`.
  Support `?rev=` for history and `?meta=1` (no body).
- **R-COLLAB-4** Change feed: `GET /ilp/v1/artifacts/{id}/changes?since=<rev>` →
  ordered `{ rev, author, op, target_block?, diff (unified), body_sha256,
  occurred_at }`. Long-poll via `wait=` like R-CORE-14. Clients MUST be able to
  stay current without re-fetching the whole body. *[Agent Week #3.]*

## 4. Writes — the concurrency contract

- **R-COLLAB-5 (CAS edit)** `POST /ilp/v1/artifacts/{id}/edits`
  `{ base_rev, ops: [ {op:"replace", old_text, new_text} |
                      {op:"replace_block", block, new_text} ],
     expect_phase?, mandate?, note? }`
  - If `base_rev` ≠ current rev → `409 STALE_BASE` with `{current_rev,
    body_sha256, changes_url}` (client rebases via the change feed and retries).
  - `replace`: `old_text` must occur exactly once in the base revision
    (`409 AMBIGUOUS_ANCHOR` / `404 ANCHOR_NOT_FOUND` otherwise).
  - Success → new revision, returns `{rev, body_sha256}`.
  *[Agent Week #1 — exactly the If-Match/base-revision shape all five agents
  requested; supersedes v1's replay-unsafe oldText/newText-only contract.]*
- **R-COLLAB-6 (Atomic append)** `POST /ilp/v1/artifacts/{id}/append`
  `{ target: {block} | {position: "end"}, text, dedupe_key?, expect_phase?,
     mandate? }` — appends without a base revision, serialized server-side, so
  concurrent appends **all land** (order by arrival). `dedupe_key` makes retries
  idempotent. Returns `{rev, body_sha256}`. *[Agent Week #2 — kills the LOG-TAIL
  sentinel hand-rolling.]*
- **R-COLLAB-7** Limits: per-op text ≤ 32 KiB, body ≤ 1 MiB (both configurable,
  both surfaced in artifact meta and OpenAPI, both enforced with a problem doc
  naming the limit — Agent Week #8). Secret-pattern screening (tokens, keys) on
  write with `422 SECRET_REJECTED` (kept from v1).
- **R-COLLAB-8** Every write records the full author binding and yields a receipt;
  attribution is queryable per revision and per block
  (`GET …/attribution?block=`), so packs may keep bodies clean while agents can
  still reason about who wrote what. *[Agent Week #9 resolution: attribution is
  structured data, neither lost nor forced into prose.]*
- **R-COLLAB-9** Concurrency guarantee (the acceptance bar): with N ≥ 10 concurrent
  writers mixing CAS edits and appends for ≥ 2 minutes, zero accepted writes are
  lost, every rejection is a specified 4xx with recovery context, and the final
  body equals the deterministic application of the accepted revision sequence.
  (Conformance test T-COLLAB-9 runs exactly this.)

## 5. Threads

- **R-COLLAB-10** `POST /ilp/v1/artifacts/{id}/threads {anchor:{quote,prefix,
  suffix}, body}` + `POST …/threads/{tid}/replies {body}` +
  `GET …/threads?cursor=`. Threads never modify the body; thread content is
  preserved in exports and archives (v1 4E.6 lesson).

## 6. Snapshots, freeze, stewardship

- **R-COLLAB-11** `POST …/snapshots {label}` (operator or pack binding) captures a
  **certified snapshot**: `{rev, body_sha256, contributor_map, taken_at}` signed by
  the instance key. Packs bind these to decisions (e.g. "the adopted resolution
  text is snapshot S of artifact A"). Certified snapshots are what exports and
  publications reference — never "whatever the doc says now".
- **R-COLLAB-12** Freeze/unfreeze (operator, receipted) makes an artifact read-only
  (e.g. at event close). Archived events imply frozen artifacts.
- Steward roles, cross-artifact concept graphs → FUTURE (roadmap).

## 7. Implementation notes (non-normative)

- Storage: `collab.artifacts`, `collab.revisions` (append-only body or structural
  diff storage), `collab.threads`. Serialization per artifact via a single-writer
  transaction (SELECT … FOR UPDATE on the artifact row) is sufficient at v2 scale
  (tens of concurrent writers); OT/CRDT is explicitly out of scope (roadmap
  anti-item kept: no CRDT until norms + this contract demonstrably fail).
- Human live-editing UI uses the same endpoints (CAS with small ops + change-feed
  refresh). If richer human co-editing is later needed, it must sit behind the
  same revision log (FUTURE).
- Peter Kaminski's upstream jot PRs (#9/#10/#11) validate this contract shape;
  v2 implements it natively rather than proxying to a Jot fork.
