# 02 — Architecture

**Status:** DRAFT for Dazza review · 2026-07-06
**Depends on:** `01-VISION-AND-SCOPE.md`. Protocol details live in `protocols/`.

---

## 1. Protocol-first layering

v2 is organized as a **protocol suite** (ILP — Interlateral Protocol) with an
implementation behind it. The protocols are the product surface; the implementation is
replaceable. Anything two modules need from each other crosses a specified API.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Surfaces:   Web PWA   ·   Agent clients (SKILL+HTTP)   ·  Operator │
│              console   ·   Remote instances (federation)            │
├─────────────────────────────────────────────────────────────────────┤
│  ILP protocol suite (wire contracts, versioned, conformance-tested) │
│   ILP-CORE   conventions: ids, auth, errors, cursors, receipts      │
│   ILP-ID     identity: principals, OTP login, verification, plates  │
│   ILP-EVENT  event engine: events, rounds, gates, actions, decisions│
│   ILP-COLLAB collaboration artifacts: revisions, append, feed       │
│   ILP-FED    federation: discovery, directory, remote join, claims  │
├─────────────────────────────────────────────────────────────────────┤
│  Modules (independently replaceable; may deploy as one process)     │
│   identity  ·  event-engine  ·  procedure-pack runtime  ·  collab   │
│   federation gateway  ·  notifier  ·  exporter  ·  web frontend     │
├─────────────────────────────────────────────────────────────────────┤
│  Substrate: PostgreSQL · object storage (exports) · SMTP/email API  │
└─────────────────────────────────────────────────────────────────────┘
```

- **R-ARCH-1** Every capability listed in scope MUST be exposed through a versioned
  ILP endpoint; no behavior may exist only as an internal function or UI affordance
  (Principle P9, P6).
- **R-ARCH-2** Modules MUST communicate only via the ILP contracts (or module-local
  DB schemas they own). A module MUST be replaceable without changes to other modules.
- **R-ARCH-3** A **modular monolith is a conformant deployment**: one process hosting
  all modules is fine and is the recommended v2 starting shape. The requirement is
  boundary discipline, not microservices.
- **R-ARCH-4** Each module OWNS its tables (separate Postgres schemas:
  `identity.*`, `events.*`, `collab.*`, `federation.*`). Cross-module reads go through
  the module's API or read-only views it explicitly publishes — never raw foreign
  writes into another module's schema.

## 2. Modules

| Module | Owns | Implements | Notes |
|---|---|---|---|
| **identity** | humans, orgs, agents, license plates, groups/memberships, verifications, sessions, audit, receipts registry | ILP-ID | The only module that mints credentials. |
| **event-engine** | events, rounds/phases, gates, actions, decisions, registrations, consent records | ILP-EVENT | Generic: contains **zero event-type semantics** (P2). |
| **procedure-pack runtime** | pack registry, pack validation, per-pack action vocabulary + tally + gate logic | pack contract (in ILP-EVENT) | Packs are declarative YAML + a small deterministic logic layer per pack. v2 ships `unconference` and `parliamentary`. |
| **collab** | artifacts (documents), revisions, appends, change feed, snapshots, access grants | ILP-COLLAB | Replaces raw Jot links. |
| **federation gateway** | peer registry, instance keys, identity claims, remote join requests, revocation cache | ILP-FED | The only module that talks to other instances. |
| **notifier** | outbound email (OTP, approvals, phase changes) | (internal contract) | Email-provider adapter (SMTP/API); OTP templates render the **code**. |
| **exporter** | export bundles + manifests + signatures | export format (in ILP-EVENT §export) | Reads via other modules' APIs — proving C10. |
| **web frontend** | PWA: participant, operator, public pages | consumes ILP only | No privileged backdoor; the UI uses the same APIs agents use. |

- **R-ARCH-5** The web frontend MUST consume only ILP endpoints (dogfooding is the
  conformance proof).
- **R-ARCH-6** The exporter MUST be able to produce a complete event bundle using only
  ILP APIs plus its own signing key (no direct DB dependency).
- **R-ARCH-7** Procedure packs MUST be installable/registerable without engine code
  changes (C4). The two shipped packs use the same public pack contract a third-party
  pack would use.

## 3. The event engine / procedure pack split (the heart of P2)

The engine knows: an event exists, has participants with roles, moves through
**phases** grouped in **rounds**, accepts **actions** (typed JSON documents) that are
validated against the active phase + actor role, evaluates **transition gates**, and
records **decisions** and **receipts**. The engine does NOT know what a "proposal",
"vote", "motion", or "second" means.

A **procedure pack** supplies, declaratively:

1. **Action vocabulary** — action types with JSON Schemas
   (`unconference.proposal`, `parliamentary.motion`, …).
2. **Role matrix** — roles and which actions each role may perform in each phase.
3. **Phase graph** — named phases, allowed orderings, and **transition gates**
   (operator-manual, timer, quorum/count conditions, or decision-result conditions).
4. **Decision procedures** — tallies over actions (e.g. "top N entries by vote count",
   "motion passes at ≥ 2/3 of votes cast with quorum q") — expressed in a small closed
   expression language, not arbitrary code.
5. **Artifact bindings** — when to create collab artifacts (e.g. one per winning topic;
   one minutes document per session).
6. **Surface templates** — SKILL text blocks, UI labels (e.g. phase `complete`
   displays as "DISCUSSING"), and prompts.

- **R-ARCH-8** Pack definitions MUST be validated at registration (schema + graph
  reachability + gate references); an invalid pack MUST be rejected before it can be
  used by any event (fail-fast, no runtime surprises).
- **R-ARCH-9** Decision procedures MUST be deterministic and replayable: given the
  recorded actions, re-running the tally MUST reproduce the recorded decision (P1,
  replay requirement).
- **R-ARCH-10** Engine-level invariants that packs CANNOT override: identity binding
  of actions, receipt generation, consent enforcement, phase-gated action validation,
  append-only action log.

An **Event Definition** (YAML) instantiates a pack for a concrete event: pack id +
parameters (timings, caps, winner counts, quorum sizes, visibility, identity/consent
settings). See `protocols/ILP-EVENT.md`.

## 4. Identity and trust boundaries

Full model in `protocols/ILP-ID.md`; summary of boundaries:

- **Humans** authenticate via email + 8-digit OTP → opaque session (C1).
- **Agents** hold event-scoped bearer tokens issued at registration approval; every
  agent action binds `(agent license plate, owning human, event)`. Tokens are
  short-lived relative to the event and revocable.
- **Operators** are humans whose authority comes from memberships
  (`role: operator/owner` on the event cohort or instance staff group) — not from a
  shared passphrase. Admin UI sessions are human sessions + role checks + CSRF.
- **Instances** authenticate to each other with instance keys (ILP-FED); remote
  participants act under host-issued credentials annotated with home-instance origin.

## 5. Federation topology (v1)

- Explicit **peering**: instance operators exchange/approve peers (allow-list). Open
  federation is FUTURE.
- An event lives on exactly one **home instance** (P10). Remote members **come to the
  event** — v1 federates *identity and discovery*, not event state. There is no
  cross-instance state replication in v1 (that is FUTURE: mirrored observation,
  push directories).
- The three federated flows: **discover** (federated event directory), **join**
  (home-signed identity claim → host approval → host credential), **prove**
  (exports/receipts carry origin-qualified global ids verifiable against instance
  keys).

Rationale: this delivers "a verified member of any federated instance can see, be
approved to join, and participate in an open event on any other instance" with minimal
new distributed-systems surface — the participant's traffic during the event goes
directly to the host instance, exactly like a local participant.

## 6. Deployment model

- **R-OPS-1** An instance MUST run from: one container image (or compose set) +
  PostgreSQL + an email provider credential + object storage or volume for exports.
  No provider-specific control-plane dependency (C9).
- **R-OPS-2** All configuration via environment variables, documented in
  `.env.example`; secrets never logged.
- **R-OPS-3** Schema migrations are ordered, idempotent-safe, and run by a single
  migration command on boot or by explicit invocation.
- **R-OPS-4** `GET /healthz` (liveness: process up) and `GET /readyz` (readiness: DB +
  migrations current) MUST exist and be unauthenticated.
- **R-OPS-5** TLS termination MAY be delegated to a fronting proxy (Caddy or a cloud
  LB); the app MUST honor `X-Forwarded-*` only from configured trusted proxies.
- **R-OPS-6** Backup/restore: a documented, tested procedure MUST exist for DB +
  artifact volume; the conformance suite includes a restore-proof test (T-OPS).
- **R-OPS-7** Structured JSON logs with request ids; identity secrets, OTP codes,
  tokens, session cookies MUST never appear in logs.
- **R-OPS-8** The reference deployment for acceptance is **three instances
  spanning at least two different clouds** (e.g. DigitalOcean + one other
  provider; see R-FED-18) federated via ILP-FED, each with its own domain, keys,
  and Postgres. Nothing in the code may assume a shared network, database, or
  secret store between instances.
- **R-OPS-9** Reliability SLOs at reference load (100 concurrent participants,
  one live event per instance): p95 read latency ≤ 300 ms; p95 write ≤ 800 ms;
  long-poll delivery of a new feed record ≤ 2 s after commit (p95); federated
  directory freshness ≤ 10 min; revocation-poll window ≤ 10 min; a live event
  survives process restart with ≤ 30 s interruption and zero data loss; restore
  from backup ≤ 30 min; export verification of a typical event ≤ 60 s. Measured
  by T-OPS-5 plus timing assertions embedded in the suites; v2 makes no
  multi-node availability promise (single-node deployments are conformant).

## 7. Technology guidance (non-normative, recommended defaults)

The protocols are language-agnostic. For the reference implementation:

- **Runtime:** Node.js LTS + TypeScript. Single web process (modular monolith) with
  clear module directories (`src/identity/`, `src/events/`, `src/packs/`,
  `src/collab/`, `src/federation/`, `src/notify/`, `src/export/`, `src/web/`).
- **HTTP:** Fastify or Express with centralized schema validation (JSON Schema /
  zod) — every route declares its input schema (fixes v1's ad-hoc validation).
- **DB:** PostgreSQL ≥ 15, one schema per module, `node-pg-migrate` or equivalent
  plain-SQL migrations (keep migrations readable SQL, as v1 did).
- **Auth/crypto:** Ed25519 instance keys (libsodium/`crypto.sign`), opaque random
  session tokens (hashed at rest), argon2/bcrypt for any password-equivalent, JWT
  (EdDSA) only for federation claims — never for local sessions.
- **Email:** provider adapter interface with Resend + generic SMTP implementations.
- **Frontend:** server-rendered pages + light progressive enhancement, or a small
  SPA — builder's choice, but PWA installable, and every UI action must map to a
  public ILP call (R-ARCH-5).
- **Tests:** the conformance suite in `tests/` runs against a base URL — keep it
  black-box. Unit tests are the builder's own affair; conformance is the contract.

## 8. What deliberately does NOT exist in v2

To prevent scope creep during the build:

- No microservice mesh, no message broker, no Kubernetes requirement.
- No websockets requirement — cursor polling contracts are mandatory; SSE is an
  optional optimization behind the same cursor semantics (streams/SSE is FUTURE).
- No plugin marketplace, no dynamic code loading for packs (declarative YAML +
  built-in pack logic modules only).
- No cross-instance realtime replication; federation v1 is identity + discovery +
  join + provenance.
- No Supabase-Auth/GoTrue dependency: identity is in-app (Postgres + email adapter),
  preserving C9. (Supabase-hosted Postgres remains a fine database choice.)
