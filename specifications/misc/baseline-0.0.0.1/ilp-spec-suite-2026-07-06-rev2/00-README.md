# Interlateral Platform v2 — Federated · Modular · Governable
## Clean-Room Rebuild Specification & Conformance Suite

**Date:** 2026-07-06 · **Status:** DRAFT rev 2 for Dazza review
(rev 2 incorporates the Codex Desktop review — see
`codex_helper/claude-fable-info/claude-fable-response.md` for the item-by-item
disposition)
**Prepared by:** Claude (Fable 5), from a full survey of the v1 platform
(`services/quest-board/`, `identity.js`, migrations, clients, roadmap/) and the
protocol-first/federated direction in
`docs/2026_07_01_CarryForwardItems/consensus-final-carry-forward.md` and
`roadmap/0_Independence_Day.md`.

**Normative vs non-normative:** everything in this directory is normative for
the build EXCEPT `_working-notes/` (exploration digests) and `codex_helper/`
(review correspondence). `schemas/` is normative for object shape; prose
protocols for behavior; `GLOSSARY.md` for vocabulary.

## What this is

A **necessary-and-sufficient** specification + test suite for a fresh builder
agent (Fable 5) to build Interlateral v2 from scratch: cleaner, more reliable,
and more usable than v1, **protocol-first** (every capability is a wire-visible,
conformance-tested contract) and **federated** (two+ instances on different
clouds; verified members of any instance can discover, be approved to join, and
participate in open events on any other). It ships **two event types**:
the existing **unconference** (behavior-parity, minus the accidents) and a new
**parliamentary** procedure pack. Everything else on the roadmap is preserved in
FUTURE — deliberately not specified for build yet.

An implementation is "done" when the conformance suite passes: single-instance
gates G1–G5, the three-instance/two-cloud federation gate G6 (with security
review sign-off), hardening gate G7 (`--matrix --strict` green), and the
host/user acceptance gate G8 (`tests/T-ACCEPT.md`).

## Reading map

| File | What |
|---|---|
| [01-VISION-AND-SCOPE.md](01-VISION-AND-SCOPE.md) | What Interlateral is, principles P1–P10, scope in/out, **design commitments C1–C10** (don't re-litigate), success criteria |
| [01A-PURPOSE-GOALS-SUCCESS.md](01A-PURPOSE-GOALS-SUCCESS.md) | Management-facing purpose/goals/objectives + measurable success metrics and SLO targets |
| [GLOSSARY.md](GLOSSARY.md) | Canonical definitions ("open event", host vs home instance, shadow principal, …) |
| [02-ARCHITECTURE.md](02-ARCHITECTURE.md) | Protocol-first layering, modules, engine/pack split, deployment (3 instances / ≥2 clouds), SLOs, tech guidance |
| [03-DATA-MODEL.md](03-DATA-MODEL.md) | Recommended Postgres layout per module |
| [04-SECURITY-AND-SAFETY.md](04-SECURITY-AND-SAFETY.md) | Threat model, untrusted-content rules, authz matrix, federation security |
| [05-UI-SPEC.md](05-UI-SPEC.md) | PWA participant journey + operator console + pack UI blocks |
| [protocols/ILP-CORE.md](protocols/ILP-CORE.md) | Conventions: ids, errors, cursors, **change feeds/long-poll**, idempotency, discovery doc, **receipts** |
| [protocols/ILP-ID.md](protocols/ILP-ID.md) | OTP login, plates, verification, memberships, consents, portable identity claims |
| [protocols/ILP-EVENT.md](protocols/ILP-EVENT.md) | Event engine, procedure-pack contract, **Event Definition YAML v1**, Event Home object, actions/gates/decisions, SKILL serving, exports |
| [protocols/ILP-COLLAB.md](protocols/ILP-COLLAB.md) | Revision-safe artifacts: CAS edits, atomic append, change feed, snapshots (the Agent Week #1 fix) |
| [protocols/ILP-FED.md](protocols/ILP-FED.md) | Federation v1: peering, directory, cross-instance join, revocation, provenance, version negotiation, trust governance, privacy boundary |
| [schemas/](schemas/README.md) | **Machine-readable JSON Schemas** for every wire object + OpenAPI 3.1 skeleton (normative for shape, R-CORE-28) |
| [event-types/unconference-pack.md](event-types/unconference-pack.md) | `unconference@1.0` (v1 parity + upgrades) |
| [event-types/parliamentary-pack.md](event-types/parliamentary-pack.md) | `parliamentary@1.0` (agenda, motions, seconds, amendments, debate, points of order, quorum, rulings, appeals, minutes, resolutions) |
| [tests/00-CONFORMANCE-PLAN.md](tests/00-CONFORMANCE-PLAN.md) | Test philosophy, environments, traceability, gates G1–G7 |
| [tests/T-*.md](tests/) | Concrete test cases traced to requirements (CORE, ID, EVENT, COLLAB, UNCONF, PARL, FED incl. three-node, SEC-OPS-UI) |
| [tests/T-ACCEPT.md](tests/T-ACCEPT.md) | **Host/User acceptance tests** (Gate G8): Original Host (Dazza), Platform Hosts, Users, Agents, governance readiness |
| [tests/harness/](tests/harness/) | Runnable black-box harness skeleton. `--matrix` = spec-level traceability (passes now, 100%); `--matrix --strict` = executable coverage (the builder's G7 gate) |
| [06-ROADMAP.md](06-ROADMAP.md) | **Updated roadmap**: every item routed PRESENT (this build) vs FUTURE (preserved) |
| [07-BUILD-PLAN.md](07-BUILD-PLAN.md) | Milestones M0–M7 with test gates; handoff artifacts |
| `_working-notes/` | Non-normative exploration digests (may be deleted) |

## The five headline decisions embodied here

1. **Protocol before platform (P9).** The ILP suite is the product surface; the
   reference implementation is a modular monolith behind it. The UI uses the same
   APIs agents use — no privileged side-channels.
2. **The engine/pack split makes event types cheap (P2→C4).** The engine knows
   rounds, phases, gates, actions, decisions, receipts; packs declare semantics.
   Parliamentary is the proof that a second pack needs zero engine changes.
3. **Concurrency-safe collaboration is core, not a Jot patch.** Base-revision CAS
   + atomic append + change feeds, natively — resolving Agent Week's unanimous #1
   finding and the fork-vs-upstream question.
4. **Federation v1 = identity + discovery + join + provenance**, host owns the
   event (Independence Day model). No state replication yet — small, testable,
   proven on a three-instance federation, and the building block for the Human
   Council later (readiness criteria in `tests/T-ACCEPT.md` §UAT-GOV).
5. **The footguns are fixed by construction:** identity/consent default ON in
   YAML; one atomic create; no shared admin passphrase; OTP codes never magic
   links; no UA blocking; documented limits; accurate capability metadata.

## Open questions for Dazza (need answers, none block review)

1. **v1 data migration:** import v1 events/identities into v2, or start clean and
   keep v1 archived read-only? (Spec assumes clean start; ETL is FUTURE.)
2. **Acceptance federation hosting:** the acceptance target is now THREE
   instances (A/B/C) spanning ≥ 2 clouds (per Codex review). Which second cloud
   (Hetzner/Fly/GCP/…), and who operates B and C for the UAT-PH acceptance —
   you with another hat, or two real external hosts?
3. **Instance naming/domains** for v2 (replace `events.` or run parallel during
   transition?).
4. **Parliamentary defaults:** quorum default (spec requires explicit), chair
   tie-break default (`tie_break_only`) — confirm the politics match your intent.
5. **Consent text:** keep CC-BY-4.0 v1 text verbatim or revise at v2 launch?
