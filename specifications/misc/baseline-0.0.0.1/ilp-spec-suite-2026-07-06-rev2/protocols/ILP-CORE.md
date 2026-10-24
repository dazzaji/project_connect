# ILP-CORE — Protocol Conventions

**Protocol version:** `ilp/1` · **Status:** DRAFT for Dazza review · 2026-07-06
All other ILP specs (`ILP-ID`, `ILP-EVENT`, `ILP-COLLAB`, `ILP-FED`) inherit these
conventions. Requirement IDs: `R-CORE-n`. Tests: `tests/T-CORE.md`.

---

## 1. Transport, encoding, versioning

- **R-CORE-1** All ILP endpoints are HTTPS + JSON (`application/json; charset=utf-8`).
  Servers MUST preserve UTF-8 content byte-exactly end-to-end (no transcoding,
  no "smart" character normalization). *[Agent Week finding #7: em-dashes and arrows
  were silently corrupted in v1.]*
- **R-CORE-2** All protocol endpoints live under `/ilp/v1/`. Version bumps are new
  path prefixes; `/ilp/v1/` semantics never change incompatibly after release.
- **R-CORE-3** The server MUST publish a machine-readable **OpenAPI 3.1 document** at
  `GET /ilp/v1/openapi.json` describing every ILP endpoint, schema, and error code.
  The conformance harness validates responses against it.
- **R-CORE-4** Every request/response body limit MUST be documented in the OpenAPI
  spec and enforced with `413` + a problem document stating the limit.
  *[Agent Week #8: undocumented 8 KB cap caused silent failures.]*
- **R-CORE-5** Human-facing HTML pages are NOT part of ILP; they consume it
  (R-ARCH-5). `GET /healthz`, `GET /readyz` per R-OPS-4.

## 2. Identifiers

- **R-CORE-6** Local resource ids are UUIDv7 (time-ordered). Slugs
  (`[a-z0-9][a-z0-9-]{1,78}[a-z0-9]`) are permanent once created (no renames;
  create-new + redirect if needed).
- **R-CORE-7** Every resource has a **global id** of the form
  `ilp:<instance-host>:<type>:<local-id>`, e.g.
  `ilp:events.interlateral.com:event:0197...`. Global ids appear in receipts,
  exports, and all federation payloads. `<instance-host>` is the instance's canonical
  hostname from its discovery document (§7).
- **R-CORE-8** Types (closed set for v1): `instance`, `human`, `org`, `agent`,
  `plate`, `group`, `membership`, `event`, `round`, `phase`, `action`, `decision`,
  `artifact`, `receipt`, `export`, `claim`.

## 3. Errors

- **R-CORE-9** Errors are RFC 9457 problem documents:
  `{ "type": "urn:ilp:error:<CODE>", "title", "status", "detail", "instance",
  ...extensions }`. `<CODE>` is a stable SCREAMING_SNAKE token (e.g. `STALE_BASE`,
  `PHASE_MISMATCH`, `VOTE_CAP_EXCEEDED`, `CONSENT_REQUIRED`, `QUORUM_NOT_MET`,
  `NOT_A_PEER`, `CLAIM_EXPIRED`). The full registry lives in the OpenAPI doc; codes
  are append-only.
- **R-CORE-10** Error responses for state conflicts MUST carry enough context to
  recover without another round-trip (e.g. `STALE_BASE` includes the current
  revision id; `VOTE_CAP_EXCEEDED` includes `cap` and `votes_remaining`;
  `PHASE_MISMATCH` includes the current phase and its `phase_changed_at`).
- **R-CORE-11** Authentication/authorization failures distinguish, by code:
  `AUTH_MISSING` (no credential), `AUTH_EXPIRED` (credential known but expired —
  include expiry), `AUTH_REVOKED`, `FORBIDDEN` (valid credential, insufficient
  authority). *[Murch: v1's split-brain 401s took real diagnosis.]*

## 4. Collections, cursors, change feeds

- **R-CORE-12** List endpoints paginate with opaque cursors:
  `?cursor=<opaque>&limit=<n≤200>` → `{ "items": [...], "next_cursor": null | "…" }`.
- **R-CORE-13** Every event-scoped mutable domain (actions, registrations, phases,
  artifact changes) is observable through a **change feed**:
  `GET /ilp/v1/events/{event}/feed?since=<seq>` → ordered records
  `{ seq, occurred_at, kind, resource_global_id, summary, data }`, where `seq` is a
  per-event monotonically increasing integer. Clients resume from their last `seq`.
  *[Kills v1 blind polling; Agent Week #3/#5, consensus item 29/30.]*
- **R-CORE-14** The feed endpoint MUST support **long-poll**
  (`?wait=<seconds≤60>`: hold until a record newer than `since` exists or timeout →
  `204`). SSE MAY be offered at the same URL via `Accept: text/event-stream` with
  identical record framing; the long-poll contract is the conformance target.
- **R-CORE-15** Feed records are append-only and immutable; a compacted feed MUST
  still preserve every record required to replay decisions (P1).

## 5. Idempotency and concurrency

- **R-CORE-16** All non-idempotent POST endpoints accept an `Idempotency-Key` header
  (or documented natural key); retrying with the same key returns the original
  result, not a duplicate. Natural-key examples: one vote per (voter, entry); one
  registration per (event, agent name).
- **R-CORE-17** State-dependent mutations accept **preconditions** and fail closed:
  - revision-checked writes: `If-Match: <revision>` (ILP-COLLAB) → `409 STALE_BASE`;
  - phase-checked actions: `expect_phase` field → `409 PHASE_MISMATCH`.
  *[Agent Week #1 and #4 — both outcome-changing bugs in v1.]*

## 6. Authentication credential types

Defined in detail in ILP-ID / ILP-FED; the core vocabulary:

| Credential | Form | Who | Scope |
|---|---|---|---|
| **Human session** | opaque cookie (`il_session`) + CSRF double-submit for browser mutations | humans in the PWA | instance-wide, role-checked per resource |
| **Participant token** | `Authorization: Bearer ilpt_<random>` | an agent (or human tooling) acting in one event | one event, one (human, agent) binding |
| **Operator authority** | human session + `operator`/`owner` membership on the event | operators | per event |
| **Instance signature** | HTTP message signature (Ed25519, key in discovery doc) | peer instances | per request |
| **Identity claim** | EdDSA JWT minted by home instance | remote participant during join | one join request |

- **R-CORE-18** Tokens and session ids are opaque random ≥ 128-bit values, stored
  only as salted hashes. Secrets never appear in logs, URLs, or exports.
- **R-CORE-19** There is no shared facilitator passphrase anywhere in v2 (fixes v1's
  global `FACILITATOR_PASSPHRASE`); operator authority is always a human identity +
  membership role.

## 7. Instance discovery document

- **R-CORE-20** Every instance serves
  `GET /.well-known/interlateral.json`:

```json
{
  "protocol": "ilp/1",
  "protocols": ["ilp/1"],
  "instance": {
    "host": "events.interlateral.com",
    "name": "Interlateral (Dazza)",
    "operator_contact": "mailto:operator@example.org",
    "software": { "name": "interlateral", "version": "2.0.0" }
  },
  "keys": [
    { "kid": "2026-07-a", "kty": "OKP", "crv": "Ed25519", "x": "<base64url>",
      "use": "sig", "not_after": "2027-07-01T00:00:00Z" }
  ],
  "endpoints": {
    "api": "https://events.interlateral.com/ilp/v1",
    "federation": "https://events.interlateral.com/ilp/v1/federation",
    "directory": "https://events.interlateral.com/ilp/v1/federation/events",
    "revocations": "https://events.interlateral.com/ilp/v1/federation/revocations"
  },
  "packs": [ { "id": "unconference", "version": "1.0" },
             { "id": "parliamentary", "version": "1.0" } ],
  "federation": { "mode": "allowlist", "join_requests": true }
}
```

- **R-CORE-21** Key rotation: multiple keys may be listed; signatures reference
  `kid`; retired keys remain listed (with `not_after`) for as long as any receipt or
  export signed by them is within its verification-support window (≥ 2 years).

## 8. Receipts (engine-level, universal)

Receipts are ILP-CORE objects because every module emits them.

- **R-CORE-22** Every **consequential action** (registration approval, proposal,
  vote, motion, second, ruling, artifact edit, decision certification, consent
  acceptance, verification change, join approval, export creation) produces a
  **receipt**:

```json
{
  "id": "ilp:<host>:receipt:<uuid>",
  "event": "ilp:<host>:event:<uuid>",
  "action_kind": "unconference.vote",
  "subject_human": "ilp:<home-host>:human:<uuid>",
  "subject_agent": "ilp:<home-host>:agent:<uuid> | null",
  "license_plate": "IL-XXXXXXXX | null",
  "mandate": "human_directed | human_approved | standing_instruction | agent_draft_unaccepted",
  "resource": "ilp:<host>:action:<uuid>",
  "occurred_at": "<RFC3339>",
  "prev_receipt_hash": "<sha256 of previous receipt in this event, hex>",
  "hash": "<sha256 of canonical JSON of all fields above, hex>"
}
```

- **R-CORE-23** Receipts are **dual-subject** (human principal + agent when an agent
  acted), append-only, hash-chained per event, and idempotent on a natural key
  (`event`, `action_kind`, `resource`). *(Carries forward v1's
  `identity.authorization_receipts`, generalized beyond proposal/vote.)*
- **R-CORE-24** `GET /ilp/v1/events/{event}/receipts?cursor=` lists receipts
  (visibility follows event visibility); the chain MUST verify: each `hash`
  recomputes, each `prev_receipt_hash` matches.
- **R-CORE-25** For remote participants, `subject_human`/`subject_agent` keep their
  **home-instance** global ids (P10 — provenance survives federation).

## 9. Canonical JSON and signing

- **R-CORE-26** Where hashing/signing of JSON is required (receipts, export
  manifests, identity claims), the input is **RFC 8785 (JCS) canonical JSON**.
  Signatures are Ed25519; JWTs use `alg: EdDSA`.

## 10. Time

- **R-CORE-27** All timestamps are RFC 3339 UTC, server-assigned. Ordering
  guarantees come from `seq` (feeds) and receipt chains — never from timestamps.

## 11. Normative schemas

- **R-CORE-28** Every wire-visible ILP object MUST validate against its JSON
  Schema in `schemas/` (event definition, pack, Event Home, action, receipt,
  artifact records, feed record, problem document, discovery document, identity
  claim, export manifest). The served OpenAPI document (R-CORE-3) MUST embed or
  reference schemas equivalent to these. Prose specs govern behavior; `schemas/`
  governs shape; a conflict between them is a spec bug to flag, not a choice.
