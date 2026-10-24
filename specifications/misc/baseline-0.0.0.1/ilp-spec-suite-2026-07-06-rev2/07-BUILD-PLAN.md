# 07 — Build Plan for the Builder Agent

**Status:** DRAFT for Dazza review · 2026-07-06
Ordered milestones for a fresh Fable 5 building v2 from this spec suite. Each
milestone ends at a conformance **gate** (tests/00-CONFORMANCE-PLAN §5). Do not
start a milestone before the previous gate is green — the gates exist to prevent
the v1 failure mode (integration debugging at event time).

## How to use this spec suite (read order)

1. `01-VISION-AND-SCOPE.md` — especially §6 design commitments (C1–C10).
2. `02-ARCHITECTURE.md` → `protocols/ILP-CORE.md`.
3. The protocol for the milestone you're on; its T-file in parallel.
4. `03-DATA-MODEL.md` when you touch storage; `04-SECURITY` before any auth code.
5. Treat T-files as executable acceptance criteria; extend `tests/harness/cases/`
   as you go (the harness skeleton defines the pattern).

Rules of engagement: prefer boring technology (02-ARCH §7); when the spec is
silent, choose the simplest option that keeps every `R-` requirement testable and
note the choice in a `DECISIONS.md` you maintain in the new repo; when the spec
seems wrong, flag it to Dazza rather than silently deviating (C-commitments need
sign-off to change).

## Milestones

**M0 — Skeleton + ops baseline** (part of G1)
New repo (outside iCloud paths). Modular-monolith scaffold, config/env loader,
migrations runner, healthz/readyz, structured logging, OpenAPI generation
wiring, problem-document + cursor + idempotency middleware, CI running the
harness. Exit: T-CORE-2/5/13, T-OPS-1.

**M1 — Identity core** (Gate G1)
`identity` module: humans, OTP login (mail adapter + smtp-catcher for tests),
sessions+CSRF, agents+plates, verification, groups/memberships, consents, audit,
admin bootstrap. Exit: **G1** (T-CORE 1–12 where applicable + T-ID all).

**M2 — Event engine + pack runtime** (Gate G2)
`events` module: events, YAML definition pipeline (validate/create/snapshot),
lifecycle, rounds/phases/gates/grace, action pipeline (validation stack, caps
per-human, idempotency), decisions (top_n, threshold, count), feed + long-poll,
receipts chain, registrations/approval/tokens, operator endpoints, SKILL
generation, discovery doc, exports (bundle + signing + offline verifier).
Pack contract + `unconference@1.0` minus artifacts. Exit: **G2** (T-EVENT all
except artifact-dependent, T-CORE feed/receipts).

**M3 — Collaboration** (Gate G3)
`collab` module: artifacts, revisions, CAS edits, atomic append, change feed,
threads, snapshots, freeze, attribution, limits+secret screening. Wire
unconference artifact bindings (atomic winner-doc creation). Exit: **G3**
(T-COLLAB all — the 10-writer drill is the bar — plus T-EVENT-10).

**M4 — Unconference E2E + UI** (Gate G4)
PWA participant journey + operator console (05-UI). Full unconference flow on
real UI + API. Exit: **G4** (T-UNCONF all, T-UI-1/2/4/5).

**M5 — Parliamentary pack** (Gate G5)
`parliamentary@1.0`: session state machine, motion lifecycle, queue, ballots,
quorum snapshots, rulings/appeals, minutes generation, resolutions, pack UI
blocks. Exit: **G5** (T-PARL all, T-UI-3).

**M6 — Federation** (Gate G6)
`federation` module: instance keys, peering, directory + aggregation, claims
mint/verify, join requests + shadow principals, revocation feeds + polling,
version negotiation, notify. Deploy the **three-instance acceptance federation
(A, B, C) spanning at least two cloud providers** (R-FED-18). Exit: **G6** =
T-FED all (incl. the three-node suites) + T-OPS-4 **+ the federation security
review sign-off (R-SEC-21)** committed with the run logs.

**M7 — Hardening** (Gate G7)
Auth-matrix sweep, injection corpus, rate limits, CSP enforcement, secrets scan,
backup/restore drill, restart resilience, SLO measurement (T-OPS-5), a11y pass,
`--matrix --strict` green (100% executable coverage minus verify-tagged items).
Exit: **G7** = the automated suite passes end to end; produce a signed export
from one real dry-run event of each pack and archive it as acceptance evidence.

**M8 — Host/User acceptance** (Gate G8)
Run `tests/T-ACCEPT.md` on the three-instance federation: UAT-OH (Dazza), UAT-PH
(operators of B and C), UAT-PU (a participant who didn't build the system),
UAT-AG (two agent frameworks driven only by served skills), UAT-GOV (governance
readiness). Exit: **G8** = the signed acceptance checklist
(`acceptance/G8-<date>.md`) with every UAT line pass.

## Estimated shape (non-binding)

M0–M1 and M2 are the bulk of the risk; M3 is small but must not be rushed (the
drill is unforgiving); M4–M5 are mostly product surface; M6 is new ground —
build it against three local instances first, clouds last. If timeboxing, the
minimum demonstrable increments are: G1 (login+plates demo), G4 (a real
unconference), G5 (a real parliamentary session), G6 (the cross-cloud join demo),
G8 (humans sign off).

## Known risks (watch these; they sank or bent v1)

1. **Engine/pack boundary erosion** — the moment pack semantics leak into engine
   code, the parliamentary pack stops being proof of modularity. Guard: R-ARCH-7
   review at every milestone.
2. **Concurrency under-testing** — a late T-COLLAB-5 failure is expensive. Run
   the drill continuously from M3 onward, not once at the gate.
3. **Federation trust bugs** — claim validation and revocation are
   security-critical paths with small surface but high blast radius; the
   R-SEC-21 review is not a formality.
4. **Timer/grace semantics** — phase deadlines + grace windows have edge cases
   (pause on point-of-order, restart mid-window). Build the test-mode clock hook
   early (harness `clockHook`).
5. **Email deliverability** — OTP is the only login; a mis-configured provider
   bricks login. Keep the smtp-catcher path first-class and document SPF/DKIM
   setup in the ops guide.
6. **Scope creep from FUTURE** — the roadmap holds 60+ tempting items; the spec
   deliberately excludes them. The builder adds none without a Dazza GO.

## Cutover and rollback (v1 → v2)

1. v2 runs on **new domains** alongside v1; v1 (`events.interlateral.com`) stays
   untouched during the whole build — no shared DB, secrets, or infrastructure.
2. Dry-run events on v2 (M7/M8 acceptance evidence) precede any real event.
3. The first real v2 event is a small curated room with v1 held as fallback.
4. v1 is archived read-only only on Dazza's explicit GO — never
   auto-decommissioned. v1 data migration, if wanted, is a separate ETL project
   (06-ROADMAP §B5); nothing in v2 blocks on it.
5. Rollback at any point = keep using v1; v2 instances are disposable until G8.

## Repo and branch layout (recommended)

New repo (e.g. `interlateral_platform`) outside any iCloud-synced path:
`src/<module>/`, `packs/`, `schemas/` (copied from this spec, kept in sync),
`migrations/`, `web/`, `tests/conformance/` (this suite's harness, fleshed out),
`acceptance/`, `ops/` (install guide, env reference, backup/restore runbook),
`DECISIONS.md`. Trunk-based, milestone tags `M0`…`M8`; each gate's run logs
committed under `acceptance/`.

## Handoff artifacts expected from the builder

1. The running three-instance deployment + env docs (install guide good enough
   to pass UAT-PH-1).
2. Green conformance run logs (single + trio) and the T-OPS-5 SLO report,
   checked into the new repo.
3. `DECISIONS.md` of spec-silent choices.
4. A deviations report: any `R-` requirement not met verbatim and why —
   including the checked-off `[verify: review]` items from the Coverage
   Supplement.
5. The R-SEC-21 federation security review checklist, signed.
6. The G8 acceptance checklist, signed.
