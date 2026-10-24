# External Collaborator Guide — Building an Interlateral v2 Instance

**Status:** DRAFT · 2026-07-06 · For Platform Hosts and developers outside the core
team who want to build, deploy, and federate their own Interlateral instance.

## The five rules

1. **Start with [`00-README.md`](00-README.md).** It maps the whole spec suite.
2. **Build against the ILP protocols** (`protocols/`, `schemas/`) — never against the
   old v1 platform's routes or behavior. If you've seen `events.interlateral.com`
   v1 internals, treat them as history, not reference.
3. **Run the Conformance and Interop Test Service** against your instance
   (`conform-and-interop-test-service/`, repo: `ilp-tester`) early and often. Quick
   Smoke first; then the single-instance profile; then federation profiles.
4. **Do not claim federation compatibility until the required tests pass** — a signed
   `trio-ready` tester result is the bar for requesting peering with the Original
   Host. A mock-peer pass is not a real-federation acceptance.
5. **Ask before changing wire-protocol behavior.** The ILP contracts are versioned
   and shared; propose changes to Dazza (Original Host) rather than shipping
   divergent semantics. Implementation internals are entirely yours (any language,
   any stack — conformance is black-box).

## What you're building, in one paragraph

An Interlateral **instance** is one deployment (your domain, your keys, your
Postgres) of a protocol-first platform for structured human + AI-agent events. It
must expose: identity (email-OTP humans, agents with license plates, verification),
the event engine (YAML-defined events running procedure packs — `unconference@1.0`
and `parliamentary@1.0`), revision-safe collaboration artifacts, receipts and signed
exports, and federation v1 (discovery document, peering, federated event directory,
claim-based cross-instance join). Your instance stays sovereign: you approve
participants, you own your events' truth, federation only moves identity claims and
provenance — never authority.

## Reading order for implementers

1. `00-README.md` → `01-VISION-AND-SCOPE.md` (commitments C1–C10 are non-negotiable)
2. `GLOSSARY.md` (vocabulary), `01A-PURPOSE-GOALS-SUCCESS.md` (what "working" means)
3. `02-ARCHITECTURE.md`, then `protocols/ILP-CORE.md` → `ILP-ID` → `ILP-EVENT` →
   `ILP-COLLAB` → `ILP-FED`
4. `schemas/` (normative shapes) + `event-types/` (the two packs)
5. `tests/00-CONFORMANCE-PLAN.md` and the `T-*.md` suites — these are your
   acceptance criteria; `tests/harness/` is runnable
6. `07-BUILD-PLAN.md` for a proven milestone order (adapt freely — the gates matter,
   the order less so)

## Federating with the Original Host

Peering is mutual and allow-listed (ILP-FED). When your instance passes the tester's
federation profiles, contact the Original Host operator (Dazza) via the Project Connect issue tracker
(https://github.com/dazzaji/project_connect/issues) with: your instance's discovery URL, your signed tester
results, and your federation policy URL. Expect the same in return — verify us too.

## Support

Open questions about spec meaning: file them against the spec suite (or via the
Original Host). Ambiguity discovered while implementing is a spec bug we want to
hear about — that's what protocol-first means.
