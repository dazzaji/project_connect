# T-UNCONF — Unconference Pack E2E

env: single (rerun as smoke on both duo instances). This suite is also the v1
parity check.

---

**T-UNCONF-1 — Full lifecycle E2E** · traces: R-UNCONF-1..9 (integrative)
Script: create event from the canonical sample YAML (winners=2, cap=2,
identity+consent ON) → open → 3 humans register+verify, each registers an agent,
all approved → live → round 1 proposing: a1 submits 2 proposals, a2 submits 1,
a3 submits 1 → advance to voting (operator, count-gate satisfied) → votes: a2→p1,
a3→p1, a1→p3, a2→p3, a3→p3 (within caps) → advance to complete → EXPECT decision:
winners = [p3 (3 votes), p1 (2 votes)]; two winner artifacts created atomically
with scaffold content → working: T-COLLAB smoke on both docs → synthesis:
snapshots taken → close round → close event → export → offline-verify.
Every step also asserts: feed records, receipts, Event Home consistency.

**T-UNCONF-2 — Proposal rules** · traces: R-UNCONF-1
3rd proposal over `max_proposals_per_participant=2` → 409 cap code; duplicate
(author,title) → idempotent; proposal immutable (no edit endpoint).

**T-UNCONF-3 — No self-vote (per human)** · traces: R-UNCONF-2
h1's second agent a1b votes for a1's proposal → 409 `SELF_VOTE_FORBIDDEN`
(same owning human). With `no_self_vote:false` event → allowed.

**T-UNCONF-4 — Tally visibility** · traces: R-UNCONF-2 (counts_visible)
During voting with default `counts_visible: complete`: action list/Event Home hide
per-proposal counts from participants (operator sees them); after complete,
public.

**T-UNCONF-5 — Tie determinism** · traces: R-UNCONF-3
Construct exact tie at the winner boundary → winner set uses created_at_asc
tie-break; decision replay (T-EVENT-9 method) reproduces it. *(Christopher's Agent
Week tie loss becomes deterministic + auditable.)*

**T-UNCONF-6 — Winner-doc creation atomicity under failure** · traces: R-UNCONF-6
(CI-only fault injection if available; else review) Kill artifact creation mid-
transition → transition rolls back: phase still `voting`, no partial artifacts,
operator sees retriable error. [verify: fault-injection or review]

**T-UNCONF-7 — Locked params** · traces: R-UNCONF-4, R-EV-13
After voting starts: PATCH winners/cap → 409 `PARAMS_LOCKED`; next round may set
new params where pack allows.

**T-UNCONF-8 — Multi-round** · traces: R-UNCONF-5
rounds=2 event: round 1 completes; round 2 starts fresh proposing; round 1 winner
artifacts persist and remain writable until event close per template rules.

**T-UNCONF-9 — Room template surfaces** · traces: R-UNCONF-7, R-UNCONF-9
skill.md for a `deliberation_room_v1` event contains that template's norms block;
unknown template in YAML → validation error (T-EVENT-1 family).

**T-UNCONF-10 — Parity checklist** · traces: unconference-pack §7
Assert presence: register→approve→propose→vote→winners→docs→archive journey;
winner scaffold sections; "DISCUSSING" label in Event Home surface hints; absence:
unscoped default-event routes, raw Jot URLs.
