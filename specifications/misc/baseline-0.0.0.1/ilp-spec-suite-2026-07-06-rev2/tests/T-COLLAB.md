# T-COLLAB — Collaboration Artifacts

env: single. Fixture: winner artifact `d1` in a `working`-phase unconference,
participants h1/a1(k1), h2/a2(k2), h3/a3(k3).

---

**T-COLLAB-1 — Read + meta** · traces: R-COLLAB-3
GET artifact → body, rev, body_sha256 (verify sha256 matches body), blocks index
includes headings; `?meta=1` omits body; `?rev=1` returns the initial revision.

**T-COLLAB-2 — CAS happy path + STALE_BASE** · traces: R-COLLAB-5, R-CORE-17
k1 edits at base_rev=N → 201 rev N+1. k2 edits with base_rev=N → 409 `STALE_BASE`
with `{current_rev: N+1, changes_url}`; k2 fetches changes since N, rebases,
retries at N+1 → 201. *(The exact Agent Week #1 recovery loop.)*

**T-COLLAB-3 — Anchor safety** · traces: R-COLLAB-5
`old_text` not present → 404 `ANCHOR_NOT_FOUND`; present twice →
409 `AMBIGUOUS_ANCHOR`; `replace_block` with unknown block → 404.

**T-COLLAB-4 — Atomic append, no base needed** · traces: R-COLLAB-6
k1 and k2 append to the same section with no revision knowledge, sequentially →
both land, order by arrival. Retried append with same `dedupe_key` → idempotent
(one occurrence).

**T-COLLAB-5 — THE CONCURRENCY DRILL** · traces: R-COLLAB-9, Vision §7.4
10 concurrent writers (harness workers) for 2 minutes: each loops {30% CAS edit of
its own block (rebase-on-STALE_BASE up to 3 tries), 60% append with dedupe_key,
10% thread comment}. Expect at end: zero accepted-write loss (every 2xx response's
content findable in final body or revision log); final body = deterministic replay
of revision log; every non-2xx is a specified code with recovery context; no 5xx;
revision numbers dense (no gaps).

**T-COLLAB-6 — Change feed for artifacts** · traces: R-COLLAB-4
`changes?since=<rev>` returns per-revision diffs (apply diffs from rev k to head →
body_sha256 matches); long-poll `wait=` returns on next write.

**T-COLLAB-7 — Limits + secret screening** · traces: R-COLLAB-7, R-SEC-6
Op text over limit → 413 naming limit; body-growth beyond max → 413; write
containing `ilpt_<40 hex>`-style token or PEM header → 422 `SECRET_REJECTED`.

**T-COLLAB-8 — Attribution queryability** · traces: R-COLLAB-8, Agent Week #9
After drill: `attribution?block=<b>` names last author binding per block;
each revision lists human+agent+plate; receipts exist for every revision.

**T-COLLAB-9 — Threads never mutate body** · traces: R-COLLAB-10
Post thread + reply → body_sha256 unchanged; threads listed; threads present in
export.

**T-COLLAB-10 — Snapshots + freeze** · traces: R-COLLAB-11, R-COLLAB-12
Operator snapshot → {rev, sha256, contributor_map, signature} verifies against
instance key; freeze → all writes 409 `ARTIFACT_FROZEN`, reads fine; unfreeze
restores; archived event ⇒ frozen.

**T-COLLAB-11 — Stable URL across phases** · traces: R-COLLAB-2
Record artifact URL during `working`; advance phases to event `archived`; URL
still serves (read-only). No alternate endpoint required at any point.

**T-COLLAB-12 — Brokered-only access** · traces: R-COLLAB-1
Attempt unauthenticated write → 401; no raw share/edit URL exists in any API
response for unpublished artifacts (scan responses for non-ILP write URLs).
