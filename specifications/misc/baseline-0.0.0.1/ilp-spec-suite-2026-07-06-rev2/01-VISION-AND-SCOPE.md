# 01 — Vision and Scope

**Spec suite:** Interlateral Platform v2 — Federated, Modular, Governable
**Status:** DRAFT for Dazza review · 2026-07-06
**Audience:** a fresh builder agent (Fable 5) executing a clean-room rebuild, and Dazza as owner.
**Normative language:** RFC-2119 (MUST / SHOULD / MAY). Requirements carry stable IDs
(`R-<AREA>-<n>`) and are traced to conformance tests (`T-<AREA>-<n>`) in `tests/`.

---

## 1. What Interlateral is

Interlateral is a **live event operating system for structured human + AI-agent
collaboration**. It runs bounded, facilitated events — unconferences, parliamentary
sessions, deliberations — in which verified humans and their agents propose, debate,
vote, co-author, and decide together, and it produces a **trustworthy, inspectable,
exportable record** of everything that happened.

Three sentences that must survive every refactor:

1. **Events are the engine; the evidence is the value; the corpus is the moat.**
   A live event that leaves no trustworthy record has produced nothing.
2. **The platform stores truth; procedure packs decide how the truth is used;
   proof surfaces bind the two.**
3. **Every consequential action traces to an agent (license plate), its owning human
   (verification status), and the organizational/mandate context — or the identity
   model is incomplete.**

## 2. Why a rebuild, and why now

The v1 stack (`services/quest-board/server.js`, 15,823 lines as surveyed
2026-07-06, plus a separate legacy pilot server) proved the product across Agent
Week 2026 (five live events, zero
catastrophic failures) but is a hand-grown monolith: event-type logic is welded to core
flow, the collaboration layer (Jot) races under concurrent writes, event creation is
manual and footgun-prone, and nothing about the system is federable. The archive-mining
consensus (`docs/2026_07_01_CarryForwardItems/consensus-final-carry-forward.md`)
committed the project to a **protocol-first, federated** future.

v2 is therefore specified as **protocols first, implementation second**: the deliverable
of this spec suite is a set of wire-visible contracts (the ILP protocol suite) plus
conformance tests. Any implementation that passes the conformance suite is a valid
Interlateral instance — including implementations on different clouds, by different
teams, federating with each other.

## 3. Durable principles (carried forward, normative)

These are inherited from `roadmap/ARCHITECTURE.md` Layer 1 and remain binding on v2.

- **P1 — The Evidence Packet is the product.** Complete, self-verifying event records
  with attribution and integrity checks.
- **P2 — The platform/event boundary.** Platform stores truth (identity, events,
  rounds, actions, votes, persistence). Event-side logic (procedure packs) decides
  semantics (round meaning, advancement policy, tally rules). Violating this boundary
  in either direction forces rewrites.
- **P3 — Human + agent engagement is the differentiator.** Steering, co-authoring,
  judging, supervising, commissioning; autonomous and human-in-the-loop modes.
- **P4 — Identity is first-class and queryable.** Three principals (Human,
  Organization, Agent), agent license plates, membership-based authorization — never
  free-text authorization.
- **P5 — Structural success ≠ semantic success.** The platform must support sampling
  and scoring content quality (SIV), not just schema validity.
- **P6 — Supported-surface truth.** A requirement is proven on the surface a
  participant/operator/observer actually experiences, not just in the database.
- **P7 — Events are operating systems, not scripts.** Budget for operator tooling,
  proof, and replay — not just the state machine.
- **P8 — Prove in isolation, then integrate.** New event types are built and proven as
  standalone procedure packs against the engine contract before going live.

v2 adds two:

- **P9 — Protocol before platform.** Every capability is specified as a wire-visible
  protocol contract before it is implemented. Internal module boundaries follow the
  protocol boundaries. If a behavior matters, it is observable at an API and covered by
  a conformance test.
- **P10 — Federation preserves authority and provenance.** An event has exactly one
  authoritative home instance. Remote participation, observation, and export never
  launder provenance: every federated record carries its origin instance, and receipts
  survive crossing instance boundaries.

## 4. Product scope of this build (the "PRESENT" path)

The builder MUST deliver, and the conformance suite covers:

1. **Identity & access (ILP-ID).** Email + 8-digit OTP-code login (codes, never magic
   links — hard-won production lesson), human/org/agent principals, agent license
   plates, human verification with provenance, groups/memberships (organizations and
   event cohorts), sessions, audit events, authorization receipts.
2. **Event engine & procedure packs (ILP-EVENT).** Events defined by a declarative
   **Event Definition** (YAML), interpreted by a generic engine exposing rounds,
   phases, transition gates, actions, roles, decisions. Event lifecycle:
   draft → open → active(phases/rounds) → closed → archived. One canonical
   **event-state endpoint** (the "Event Home" JSON) per event.
3. **Two procedure packs:**
   - **Unconference** — registration/approval, topic proposals, capped voting, winner
     selection, breakout collaboration rooms, synthesis, publication.
   - **Parliamentary** — agenda, recognition queue, motions/seconds/amendments, debate
     windows, points of order, quorum, threshold votes, rulings, minutes, resolutions.
4. **Collaboration artifacts (ILP-COLLAB).** Revision-safe shared documents replacing
   raw Jot semantics: compare-and-set writes on a base revision, atomic append,
   change feed (cursor), snapshots, brokered access (no raw edit links as the security
   boundary). This closes the #1 validated Agent Week pain: write-concurrency.
5. **Consent & publication.** Identity-required and publication-consent are per-event,
   settable in the Event Definition YAML, and **default ON** (the v1 admin-only split
   is explicitly designated a footgun, not a security rule).
6. **Federation v1 (ILP-FED).** Instance identity (signed discovery document), event
   directory, and the cross-instance participant journey: a verified member of
   instance A can discover an **open** event on instance B, request to join, be
   approved by B's event operators, and participate — with A-origin identity claims
   and B-issued event-scoped credentials. Acceptance runs across **three
   instances spanning at least two cloud providers** (R-FED-18).
7. **Agent interface (ILP-AGENT surface of ILP-EVENT).** Per-event served
   SKILL/instructions document, agent registration + approval, polling cursors (SSE
   optional but the cursor contract is mandatory), receipts on consequential actions.
8. **Web UI (PWA-first).** Participant journey (register → verify → login → propose →
   vote → collaborate → consent), operator console (approvals, phase control,
   room health), public event page + archive view.
9. **Export v1.** A signed event export bundle (manifest + participants + registry +
   proposals + votes + decisions + artifact snapshots + receipts) — the Evidence
   Packet seed, not its full future form.
10. **Operations baseline.** Multi-instance deployability on commodity cloud
    (container + Postgres), config via environment, migrations, backup/restore
    proof, TLS, health/readiness endpoints, structured logs, reliability SLOs
    (R-OPS-9).

## 5. Explicitly OUT of this build (routed to FUTURE)

Everything else in the carry-forward consensus is preserved in `06-ROADMAP.md` under
FUTURE with its consensus tier, including: additional procedure packs (debate,
buildathon, charrette, arbitration, kanban governance), authority cards / agentgateway
policy enforcement, social login + enterprise SSO (email OTP is the v2 baseline),
reputation and people-graph, cross-artifact concept graphs, marketplaces, Event
Intelligence/OTEL analytics, The Show / media tooling, thin desktop bridge, browser
agent runner, full Evidence Packet productization, InterMesh live-mesh integration,
and federation beyond v1 (revocation propagation networks, trust scoring, remote
instance health policy).

The rule: **the v2 architecture must leave room for these (extension points are
specified), but the builder must not build them now.**

## 6. Design commitments the builder MUST NOT re-litigate

These encode production lessons; deviating requires Dazza's explicit sign-off:

- **C1.** Login verification uses **8-digit OTP codes**, never magic links (scanner
  prefetch invalidates links; both new-user and returning-user email templates must
  render the code).
- **C2.** Identity-required and publication-consent are **YAML-settable and default
  ON**; no capability split that forces an admin round-trip to enable them.
- **C3.** Collaboration writes are **revision-checked**; blind full-body overwrite
  endpoints are prohibited.
- **C4.** Event-type semantics live in **procedure packs**, not in engine code; adding
  an event type must not modify engine code (P2/P8).
- **C5.** Authorization derives from **membership/role records**, never profile text
  (P4); license plates are never reassigned.
- **C6.** All participant-supplied content (proposals, artifacts, chat, event
  descriptions) is **untrusted input** — for the UI (XSS), for agents (prompt
  injection labeling), and for operators (moderation surface).
- **C7.** An event's **home instance is the single source of truth**; federation
  transfers claims and receipts, never raw authority.
- **C8.** Every consequential action produces a **dual-subject receipt** (human
  principal + agent) with mandate type.
- **C9.** The platform is **cloud-agnostic**: container + Postgres + SMTP/email API;
  no provider-proprietary control-plane dependency (Supabase-specific auth, DO/GCP
  specifics) in core logic.
- **C10.** Event data is exportable at any time; export never requires database access.

## 7. Success criteria for the rebuild

Summary — the full purpose/goals/objectives and measurable success metrics live
in `01A-PURPOSE-GOALS-SUCCESS.md`:

1. The conformance suite (`tests/`) passes against the new implementation through
   Gate G7 (`--matrix --strict` green).
2. Three instances spanning at least two cloud providers federate: the
   cross-instance join scenarios (`tests/T-FED`, incl. three-node) pass
   end-to-end, with the federation security review signed (R-SEC-21).
3. A complete unconference and a complete parliamentary session each run end-to-end
   via API + UI, producing a verifiable export bundle.
4. A concurrency test with 10 simultaneous writers on one artifact loses zero
   writes, and the R-OPS-9 reliability SLOs are met.
5. An operator can create and run an event from YAML without editing code or SSH.
6. The Host/User acceptance tests (`tests/T-ACCEPT.md`, Gate G8) pass — Dazza as
   Original Host, two other Platform Hosts, a participant who didn't build the
   system, and two agent frameworks all sign off.
