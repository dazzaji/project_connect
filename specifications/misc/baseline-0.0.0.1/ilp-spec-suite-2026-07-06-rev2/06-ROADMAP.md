# 06 — Updated Roadmap: PRESENT build path vs FUTURE

**Status:** DRAFT for Dazza review · 2026-07-06
This routes **every known roadmap and carry-forward item** into either the
**PRESENT** build path (delivered by this spec suite — pointer to where it's
specified) or **FUTURE** (preserved with its consensus tier). Sources:
`roadmap/` (F1–F12, H1–H5, decisions, ID-series), the Agent Week retrospective
backlog, `consensus-final-carry-forward.md` (items and routing matrix), and the
Murch reflection. Status vocabulary follows `roadmap/STATUS_TAXONOMY.md`
(`planned | needs_scope | paused | speculative`). Business/legal/related-repo
items stay routed OUTSIDE the technical roadmap per the consensus four-home model
and are listed at the end only as pointers.

---

## A. PRESENT — on the v2 build path (this spec)

| Item (source) | Where specified |
|---|---|
| Rebuild core platform, modular + protocol-first (F4 modularize server.js; consensus obs. 1) | `02-ARCHITECTURE`, `protocols/*` |
| Identity: email OTP login, plates, verification, memberships, receipts (F11 parity; ID-1A) | `ILP-ID` |
| Identity/consent **default ON + YAML-settable** (Dazza's #1 footgun fix) | R-EV-11, C2 |
| De-manualized atomic event creation from YAML (Sprint 8 lineage) | R-EV-12 |
| Event engine primitives: Round, Phase, TransitionGate, Action, Decision, RoleMatrix, Receipt, Export (consensus A.1 subset) | `ILP-EVENT` §1–3 |
| Event Home / canonical event-state object (consensus A.3, promote-soon) | R-EV-3 |
| Unconference event type (parity + upgrades) | `event-types/unconference-pack.md` |
| **Parliamentary event type** (F5a event-type expression: agenda, motions, seconds, amendments, debate windows, points of order, quorum, thresholds, rulings, appeals, minutes, resolutions) | `event-types/parliamentary-pack.md` |
| Voting governance mechanics from Sprint 9B: per-human cross-token caps, durable voter identity, self-vote ban (unconference), change-vote (parliamentary) | R-EV-17, R-UNCONF-2, T-PARL-8 |
| Jot write-concurrency fix — CAS base-revision, atomic append, change feed (Agent Week #1–#3; the validated #1 priority) | `ILP-COLLAB` §4 |
| Brokered artifact access + certified snapshots (consensus A.11, promote-soon) | R-COLLAB-1, R-COLLAB-11 |
| Phase countdown, grace window, `expect_phase` (Agent Week #4) | R-EV-7, R-CORE-17 |
| Native change feeds / cursors / long-poll — no blind polling (Agent Week #5; consensus E.29/30) | R-CORE-13/14 |
| Accurate capability metadata (votes-remaining etc.) (Agent Week #6) | R-EV-3 `my.*` |
| Machine-readable OpenAPI + UTF-8 wire fidelity (Agent Week #7) | R-CORE-1/3 |
| Documented size limits (Agent Week #8) | R-CORE-4, R-COLLAB-7 |
| Structured attribution (Agent Week #9 / Murch #2 resolution) | R-COLLAB-8 |
| Stable artifact endpoint across phases (Murch #3) | R-COLLAB-2 |
| Token lifecycle in-band + named auth errors (Murch #4) | R-ID-13, R-CORE-11 |
| Documented gotchas + no UA blocking (Murch #5, Cloudflare 1010) | R-EV-24, R-SEC-15 |
| Prompt-injection/untrusted-content baseline (consensus item 6/19; no naive classifier per Murch #6) | `04-SECURITY` §3, R-SEC-7 |
| Publication consent + CC-BY flow, export consent filtering | R-ID-14, R-EV-21/22 |
| Export bundle v1 / Evidence Packet seed (consensus F.35/36 promote-soon) | R-EV-25/26 |
| Operator console + human-legible live-ops view (F2; consensus F.40 promote-soon) | `05-UI` §3 |
| PWA-first onboarding & control plane (consensus E.31 promote-soon) | `05-UI` §1–2 |
| Cloud exposure hardening incl. enforced CSP (F1 completion) | `04-SECURITY` §2–3 |
| Per-operator identity — shared admin passphrase eliminated | R-CORE-19, R-ID-4 |
| **Federation v1: discovery, directory, cross-instance join of open events, provenance, revocation checks** (Independence Day Phase 1, protocol-first per consensus G.27/28 gating) | `ILP-FED` |
| Roles/deputization seed — event operator/owner via memberships (ID-3 core) | R-ID-3 |
| Two-cloud deployability + ops baseline (backup/restore proof — 4A lineage) | `02-ARCH` §6, T-OPS |
| Conformance test suite + traceability | `tests/` |

## B. FUTURE — preserved, not in this build

Grouped by consensus home/tier. "(F#/H#/item#)" = source id.

### B1. Event architecture & procedure packs
| Item | Tier | Notes |
|---|---|---|
| Full Composable Event Engine primitives: HandoffPacket, Checkpoint, Branch, BroadcastState (item 1) | F | engine v2 ships the subset it needs; these are the extension points |
| Procedure pack registry for third-party/signed packs (item 2) | F | v2 packs are built-in via the same contract |
| Debate event type revival, ranked/weighted/approval voting (F5) | F | next pack after v2 ships; decision-procedure registry extension |
| Kanban/governance board protocol (item 29b) | F | |
| Buildathon, charrette, arbitration, innovation-tournament, debate-topic-generator packs (items 6–8; H3) | F/H | |
| Civic deliberation pack, Court of Agentic Opinion (items 9–10) | H | strategy/research home |
| Parliamentary depth: committees, motion taxonomy, secret ballots, enforced speech timers, multi-amendment depth (pack §8) | F | explicit v1 simplifications |

### B2. Federation beyond v1
| Item | Tier | Notes |
|---|---|---|
| Open federation (beyond allowlist), instance health policy, trust tiers for remote participants (item 28) | F | |
| Signed portable Open Event Packs + export/import; adapter boundary for external hosts (item 27) | F | directory entries → signed packs |
| Cross-instance observation/mirroring, push directories | F | |
| **Human Council / United Federation Session** — synchronized multi-node parliamentary events, federation-level tally + certification (Independence Day north star) | F | parliamentary pack + ILP-FED are its building blocks |
| Revocation propagation networks beyond peer polling | F | |

### B3. Identity, authority & safety
| Item | Tier |
|---|---|
| Social login (ID-1B), branded-email polish beyond OTP baseline (ID-2 remainder) | F |
| Admin MFA (ID-4), account page extras (ID-5), identity ops UI (ID-6), SKILL identity-awareness extras (ID-7) | F |
| Organizations management UI (ID-8), enterprise SSO/white-label (ID-9), agent OAuth/MCP identity (ID-10) | F |
| Authority cards / mandate records UI (item 16); short-lived scoped-down agent token refinements (17) | F |
| Agentgateway/policy engine + dynamic revocation (18); kill-switch automation, trust scoring, sanitizer, anomaly ML (22a) | F |
| Participation tiers (20); mandate/warrant/warden vocabulary productization (21); handoff/decision-brief standard (22) | F |
| Reputation registry / performance intelligence (F3, item 24) | F |
| Deny-by-default governance matrix (H1) | H |

### B4. Collaboration & artifacts
| Item | Tier |
|---|---|
| Jot steward roles (12); cross-artifact concept graph (13); publishable-output pipeline beyond export v1 (14); legal workflow pattern library (15) | F |
| Real-time co-editing (CRDT/OT) — only if CAS+append demonstrably fails (roadmap anti-item preserved) | F |
| Live rooms / voice / Ably-style presence (F10 parked); InterMesh hardening + platform lifecycle integration (F8, F9) | F |
| Event data contract v0.2 + archive API (38); OTEL as product substrate (39); Event Intelligence (37) | F |

### B5. Onboarding, clients & UI
| Item | Tier |
|---|---|
| Connect-your-agent wizard (33); notifications center + email digests (30 beyond feed long-poll); Agent-Ops SDK formalization from clients/ (28) | F — first candidates after v2 ships |
| Hot-swap skin architecture (34a); thin desktop bridge (32); browser agent runner (34); native desktop app | F/H |
| Public profiles, people-first graph (23); knowledge commons (25); marketplaces (26/27) | F/H |
| Platform agents (concierge/test-participant archetypes) rebuilt on v2 (Sprint 13 lineage) | F |
| v1 data import/ETL into v2 (if wanted) | F — decide at cutover |

### B6. Ops & platform
| Item | Tier |
|---|---|
| Load testing at scale (Peter's dyad test → formalized perf suite beyond T-COLLAB-5) | F |
| Multi-region/HA, object-storage export offload, observability dashboards | F |
| Stripe/agent-provisioned infra (H5); commercial hardening (H2) | H |

## C. Superseded / retired by v2 (recorded so nothing haunts us)

v1 quest-board monolith and its dual global/slug routes; shared
`FACILITATOR_PASSPHRASE`; Supabase-Auth (GoTrue) dependency; magic-link login
(already banned); raw Jot share-link editing + Jot proxy fork question (native
ILP-COLLAB replaces — the fork-vs-upstream decision dissolves); admin
PATCH-consent dance; Ably dependency for rooms; quest/offer board (FUTURE if
wanted); default-event aliasing. GCP-fallback posture is unchanged by this spec.

## D. Non-technical homes (pointers only, per consensus routing)

Strategy/business (The Show, sponsor package, Event Intelligence GTM, LinkedIn
strategy, research arm) → `docs/strategy/…` (to be created per consensus
unresolved item 1). Legal/corporate (IP/PIIA, SAFE, data room) → `docs/legal/…`.
Related repos (mesh methodology, InterMesh backlog) → `roadmap/RELATED-REPOS.md`
(consensus should-fix 3). These are unchanged by this spec.
