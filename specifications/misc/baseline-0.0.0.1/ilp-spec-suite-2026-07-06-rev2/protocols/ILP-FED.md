# ILP-FED — Federation v1

**Status:** DRAFT for Dazza review · 2026-07-06 · Inherits ILP-CORE, ILP-ID, ILP-EVENT.
Implements the Independence Day model (`roadmap/0_Independence_Day.md`): each node
runs its own instance; events are described portably; a member of node A can **see**
and **request to join** an open event on node B; **node B stays source-of-truth**
for admission, records, and outputs. This is "Phase 1+" of that plan: registry
discovery + cross-node join + provenance, specified as protocol from day one.
Requirement IDs: `R-FED-n`. Tests: `tests/T-FED.md`.

---

## 1. Scope of v1 (and non-goals)

In scope: instance identity, explicit peering, federated event directory,
cross-instance member join + participation, identity claims + revocation checks,
provenance-preserving receipts/exports.

Out of scope (FUTURE, see roadmap): open (non-allowlisted) federation, cross-
instance state mirroring/observation caches, synchronized multi-node sessions and
federation-level tallies (Human Council), federated Kanban, trust scoring,
automated instance health policies.

- **R-FED-1** Nothing in federation v1 replicates event state across instances.
  Remote participants interact **directly with the host instance's** ILP-EVENT API
  using host-issued credentials. (This keeps v1 small and testable while matching
  the ActivityPub-style "host owns the event" model.)

## 2. Instance identity and peering

- **R-FED-2** An instance is identified by its canonical host + Ed25519 keys in its
  discovery document (R-CORE-20). Instance-to-instance calls are signed with HTTP
  message signatures (RFC 9421, `keyid = <host>#<kid>`); receivers verify against
  the sender's live discovery document (cache ≤ 1h).
- **R-FED-3** Peering is mutual and explicit (allowlist):
  `POST /ilp/v1/federation/peers {host}` (admin) → fetch + pin the peer's discovery
  doc → peer does the same. Peer states: `proposed → active → suspended → removed`
  (each change audited + receipted). Only `active` peers' claims and directory
  listings are honored.
- **R-FED-4** `GET /ilp/v1/federation/peers` (public) lists active peers — the
  federation is transparent.

## 3. Federated event directory

- **R-FED-5** `GET /ilp/v1/federation/events` (public) lists this instance's
  `visibility: federated` events as **directory entries**:
  `{ global_id, slug, title, description, pack {id, version}, status, starts_at,
  policy {identity_required, remote_participants}, home: {host, api},
  updated_at }` — enough to render a listing and start a join, nothing more
  (state stays home).
- **R-FED-6** An instance SHOULD aggregate its active peers' directories (poll ≥
  every 10 min, per-peer failure-isolated) and present a unified "Federated events"
  listing in its UI, each entry labeled with its home instance. Signed entries are
  not required in v1 (the fetch is TLS + the listing is the home's own API);
  signed portable Event Packs are FUTURE.

## 4. Cross-instance join (the core flow)

Actors: member **M** (verified human on home **A**, optionally with agent),
host **B** running a federated event **E** with `remote_participants: allowed`.

1. **Discover.** M sees E in A's federated directory (or directly on B).
2. **Initiate.** M (session on A):
   `POST /ilp/v1/claims { purpose: "event_join", event: <E global id>,
   agent?: <M's agent id> }` → A mints an Identity Claim JWT (R-ID-17/18):
   subject M, audience B, ≤ 24h, single-use, embedding display name, `verified` +
   method, and optionally the agent + plate.
3. **Request.** M's client (A's UI does this for them):
   `POST https://B/ilp/v1/events/{E}/join-requests { claim: <jwt> }`.
4. **Validate (B).** B verifies: A is an `active` peer; JWT signature against A's
   discovery keys; `aud`=B, `exp` ok, `jti` unseen; checks A's revocations endpoint
   for the claim/subject. B creates a **shadow principal** for M
   (`origin: ilp:A:human:…`, marked `remote`, with A's verification attestation) —
   or reuses the existing shadow if M joined before — and a `pending` registration
   on E. → `202 { join_request_id, status: "pending" }`.
5. **Approve.** B's event operator sees the request (flagged remote, with home
   instance + verification provenance) and approves/rejects via the normal
   ILP-EVENT moderation API. Approval activates membership and issues a normal
   **participant token** bound to the shadow principal (+agent).
6. **Deliver.** M retrieves status/token:
   `GET https://B/ilp/v1/events/{E}/join-requests/{id}` authenticated by a
   `retrieval_key` returned at step 3 (single-audience secret; also surfaced
   through A's UI via the claim `jti`). B additionally notifies A
   (`POST https://A/ilp/v1/federation/notify` signed, best-effort) so A's UI can
   alert M. *[Polling by M remains the guaranteed path; the notify is UX sugar.]*
7. **Participate.** M (and their agent) uses B's ILP-EVENT API with the token,
   exactly like a local participant. Consent: B's event consent text is accepted
   at step 3 (checkbox recorded in the join request) or first action (R-EV-21).

- **R-FED-7** Steps 3–6 constitute the normative join protocol; every state change
  emits feed records + receipts on B, and the claim mint is audited on A.
- **R-FED-8** B MUST treat A's attestation as **identity evidence, not authority**:
  admission is B's operator decision (or `registration_approval: auto` if B chose
  it). B MAY apply different defaults to remote participants (v1: same flow,
  flagged origin; trust tiers are FUTURE).
- **R-FED-9** Receipts and exports on B record M with the A-origin global id and
  the claim reference — provenance survives (P10). A never receives copies of E's
  records in v1; M can of course share their own outputs.

## 5. Revocation

- **R-FED-10** `GET /ilp/v1/federation/revocations?since=<cursor>` (peer-signed
  request) returns revocation records:
  `{ kind: claim|human|agent|plate, global_id or jti, revoked_at, reason? }`.
  Hosts MUST check the specific subject at join time (step 4) and SHOULD poll
  peers' revocation feeds (≥ every 10 min) for shadow principals with **active**
  tokens; on a hit, tokens are revoked and the operator is alerted.
- **R-FED-11** Local revocation always works regardless of federation state: B can
  eject any remote participant instantly (R-EV-19); A revoking M's claim/identity
  does not depend on B's cooperation to take effect at the next check, and B's
  suspension of the peering suspends all its shadow-principal tokens.

## 6. Failure and trust boundaries

- **R-FED-12** A peer being down MUST NOT affect local events or already-approved
  local participation; it only pauses new joins/claims from that peer (fail
  closed for admission, fail open for nothing).
- **R-FED-13** All federation inputs (directory entries, claims, notify payloads)
  are untrusted input: schema-validated, size-limited, never rendered as HTML
  without escaping, never interpreted as instructions (C6).
- **R-FED-14** Clock skew tolerance ±5 min on claim validation; all claim
  validation failures return specific codes (`NOT_A_PEER`, `CLAIM_EXPIRED`,
  `CLAIM_REPLAYED`, `CLAIM_AUDIENCE_MISMATCH`, `SUBJECT_REVOKED`).

## 7. Version negotiation and compatibility

- **R-FED-15** Compatibility is negotiated from discovery documents, never
  assumed:
  - The discovery doc lists all supported protocol versions
    (`protocols: ["ilp/1", …]`) and packs with versions (+ optional
    `compatible_versions`). Peering requires ≥ 1 common `ilp/` version; without
    one, peering fails with `PROTOCOL_UNSUPPORTED`.
  - Directory entries carry `pack {id, version}`. Pack versions follow
    major.minor: same-major = interoperable (a remote participant only ever
    talks to the **host's** API and skill, so pack version is informational for
    the participant; it gates nothing at join time). UIs SHOULD surface
    pack/version and any unknown-pack status on remote events rather than
    hiding the event.
  - An instance advertising a protocol version MUST keep serving it for a
    deprecation window ≥ 6 months after it first advertises a successor.
  - Unknown fields in federation payloads from a newer minor version MUST be
    ignored, never fatal (forward compatibility); unknown *required* semantics
    only arrive with a new major version path.

## 8. Peering governance and trust management

- **R-FED-16** Peering is a governed act, not a config flag:
  - Only an instance admin (`instance_staff:admin`) may propose, approve,
    suspend, or remove a peer; every change is audited and receipted.
  - An instance SHOULD publish a human-readable federation policy
    (`instance.federation_policy_url` in discovery): what it expects of peers
    (identity/verification hygiene, revocation responsiveness, content/consent
    norms, contact for incidents). Approving a peer records which policy
    version was in force.
  - Key rotation follows R-CORE-21; peers refresh discovery docs ≤ 1h, so
    rotation needs no coordination. Loss/compromise of a peer's key ⇒ suspend
    the peer (one admin action): all its shadow-principal tokens suspend, new
    claims are rejected, and the operator UI shows the blast radius. Reinstate
    only after the peer publishes new keys and the admins re-approve.
  - Suspension/removal policy for **existing** remote participants is explicit
    and visible: `suspend` = their tokens pause (resumable); `remove` = tokens
    revoked, memberships revoked, records retained with provenance.

## 9. Data shared across instances (privacy boundary)

- **R-FED-17** What crosses the wire is closed-set and user-visible:

| Moment | Shared with the other instance | Never shared |
|---|---|---|
| Directory listing | event metadata per R-FED-5 | participant data |
| Join request (claim) | display name, `verified` + method, agent display name + plate, home host, consent acceptance ref | **email**, session data, other events, org memberships (unless FUTURE org-claims), IP |
| Participation | whatever the participant does on the host (actions/artifacts, under host consent) | home-instance records |
| Revocation feed | kind + global id/jti + time + optional reason | underlying cause detail |

  Before a user sends a join request, their home UI MUST display: the host
  instance's name/host, its operator contact, its consent text, and the exact
  claim fields that will be shared (UAT-PU-5). The claim schema
  (`schemas/identity-claim.schema.json`) is the normative closed set.

## 10. Endpoint summary

| Method+Path | Auth | Purpose |
|---|---|---|
| GET `/.well-known/interlateral.json` | public | discovery doc (R-CORE-20) |
| GET `/ilp/v1/federation/peers` | public | active peers |
| POST `/ilp/v1/federation/peers` / `:suspend` / `:remove` | admin | peering management |
| GET `/ilp/v1/federation/events` | public | federated directory (own events) |
| GET `/ilp/v1/federation/events:aggregated` | public | unified peer directory (cached) |
| POST `/ilp/v1/events/{id}/join-requests` | claim | remote join request |
| GET `/ilp/v1/events/{id}/join-requests/{jrid}` | retrieval key | status + token delivery |
| GET `/ilp/v1/federation/revocations?since=` | peer signature | revocation feed |
| POST `/ilp/v1/federation/notify` | peer signature | best-effort join-status notify |

## 11. The three-instance acceptance federation (normative)

- **R-FED-18** The acceptance deployment is **three independent instances**:
  **A** (Original Host), **B** and **C** (other Platform Hosts) — each with its
  own domain, keys, and Postgres, spanning **at least two different cloud
  providers** (the third instance may share a provider with one of the others;
  it must not share infrastructure). Nothing in the code may assume any shared
  resource between instances (extends R-OPS-8).

Core scenario (full scripts in `tests/T-FED.md`):

1. A↔B, A↔C, B↔C peer (mutual admin approval); public peer lists show all.
2. B creates a `federated` parliamentary event; C creates a `federated`
   unconference; each also creates one `public` and one `private` event.
   A's aggregated directory shows exactly the two federated events.
3. Human M registers on A (OTP), is verified by A's admin, registers agent
   `IL-…`. Symmetric fixtures on B and C.
4. Cross joins in ≥ 4 directions (A→B, A→C, B→A, C→B): each host's operator
   sees the remote pending request with origin + verification attestation and
   approves/rejects independently.
5. Participants from A, B, and C all act in B's parliamentary event; every
   action is receipted with its home-origin global id.
6. A revokes M's agent plate; within one revocation poll B and C kill M's
   tokens; M's next action fails `AUTH_REVOKED`.
7. A suspends B: new B-origin joins to A are rejected; A's local events and
   already-running C participation continue; the existing-participant policy
   (R-FED-16) is observably enforced.
8. B and C close their events and produce exports; an offline verifier
   validates signatures, hashes, receipt chains, decision replay, and
   remote-subject origins against A's/B's/C's published discovery keys.
9. Version negotiation: a fixture peer advertising no common `ilp/` version is
   rejected `PROTOCOL_UNSUPPORTED`; an unknown pack version on a directory
   entry is surfaced, not hidden (R-FED-15).
