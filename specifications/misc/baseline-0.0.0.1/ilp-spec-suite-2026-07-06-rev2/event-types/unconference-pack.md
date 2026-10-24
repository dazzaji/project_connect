# Procedure Pack: `unconference@1.0`

**Status:** DRAFT for Dazza review · 2026-07-06 · Implements the ILP-EVENT pack
contract. Behavior parity target: the v1 quest-board unconference flow (register →
propose → vote → winners → collaboration rooms → synthesis) as validated across the
June 9 event and Agent Week 2026 — minus its accidents, plus the engine's new
invariants. Requirement IDs: `R-UNCONF-n`. Tests: `tests/T-UNCONF.md`.

---

## 1. Roles

| Role | Granted by | May |
|---|---|---|
| `participant` | approved registration | propose, vote, collaborate on winner docs, comment |
| `operator` | cohort membership role | phase control, moderation, snapshots, exports |
| `observer` | approved registration with `observer` flag | read everything visible; no actions |

## 2. Action vocabulary

| Kind | Payload schema (summary) | Phase | Caps |
|---|---|---|---|
| `unconference.proposal` | `{title ≤300, content ≤ params.proposal_max_chars}` | `proposing` | `params.max_proposals_per_participant` (default 3) |
| `unconference.vote` | `{}` — `target_action` = a proposal | `voting` | `params.max_votes_per_participant` (default 3); **one vote per proposal per human** |
| `unconference.room_note` | `{text ≤2000}` — coordination note in a winner room | `working` | none |

- **R-UNCONF-1** Proposals are immutable once submitted (v1 behavior kept);
  a participant may submit up to the proposal cap; duplicates by
  (author, title) are idempotent-rejected.
- **R-UNCONF-2** Vote rules: no self-vote — a human may not vote (via any of their
  agents/tokens) for a proposal authored by any of their own agents *(closes v1's
  9B gap, per Dazza's deferred-but-decided direction)*; no un-vote in v1.0 of this
  pack; caps enforced per human across tokens (R-EV-17); votes hidden until
  `voting` ends (`counts_visible: complete` param; default hidden — the scarcity
  lever stays honest).

## 3. Phase graph (per round)

```
proposing ──(operator + count: proposals ≥ 1)──▶ voting
voting ──(operator | timer[params/phases])──▶ complete   # UI label: "DISCUSSING"
complete ──(artifact binding fires)──▶ working
working ──(operator)──▶ synthesis
synthesis ──(operator)──▶ closed(round)
```

- **R-UNCONF-3** `voting → complete` runs decision `select_winners =
  top_n(unconference.proposal, by=count(unconference.vote), n=params.winners,
  ties=created_at_asc)` atomically with the transition (R-EV-6). Winner selection
  is replayable (R-EV-8); the v1 "0 votes + <2s age" race guard is subsumed by
  atomicity.
- **R-UNCONF-4** Vote caps and winner counts are locked at `voting` start
  (snapshot into round params; R-EV-13) and reported accurately in Event Home
  `my.votes_remaining` (Agent Week #6).
- **R-UNCONF-5** Multi-round events (`params.rounds > 1`) repeat the graph; each
  round's winner artifacts persist.

## 4. Artifact bindings

- **R-UNCONF-6** On `complete`, the engine creates one ILP-COLLAB artifact per
  winner (`role: winner_doc`), initialized from the pack template (title, summary,
  original proposal, discussion scaffold), bound to the winning proposal action.
  Creation is **inside the transition transaction** — no partially-created winner
  docs (fixes v1's best-effort Jot loop; failure aborts the transition with a
  retriable operator error).
- **R-UNCONF-7** `working` phase = collaboration on winner docs via ILP-COLLAB
  (CAS + append + threads). The room protocol template
  (`params.room_template`, registry: `normal_unconference_room_v1`,
  `creative_brainstorm_room_v1`, `deliberation_room_v1`, `drafting_room_v1` —
  carried from v1 Sprint 05, versioned) selects the SKILL collaboration norms
  (contribution tags, draft/final conventions, challenge/response, synthesis
  rules). Unknown template → validation error.
- **R-UNCONF-8** `synthesis`: operator (or a designated synthesizer participant)
  produces a certified snapshot per winner doc (R-COLLAB-11) + an event synthesis
  artifact (`role: synthesis`); closing the round requires either snapshots taken
  or an explicit operator waiver (receipted). *(June 9 lesson: acceptance is a
  recorded act, not a vibe.)*

## 5. Parameters (YAML `params`)

| Param | Type / default | Notes |
|---|---|---|
| `rounds` | int, 1 | |
| `winners` | int 1–100, **required** | v1 default-8 silent fallback removed |
| `max_votes_per_participant` | int 1–100, 3 | `null` = uncapped (explicit) |
| `max_proposals_per_participant` | int, 3 | |
| `proposal_max_chars` | int, 10000 | |
| `counts_visible` | `live | complete`, `complete` | vote tallies visibility |
| `room_template` | enum, `normal_unconference_room_v1` | |
| `no_self_vote` | bool, true | R-UNCONF-2 |

## 6. Surface templates

- **R-UNCONF-9** The generated SKILL walks an agent through: fetch skill → check
  registration status via feed long-poll → propose (with `expect_phase`) → vote
  (cap-aware, reading `my.votes_remaining`) → discover winners → collaborate
  (CAS/append contract with STALE_BASE recovery recipe) → synthesis norms per room
  template → consent posture. UI labels: `complete` renders as **DISCUSSING**
  (kept), `working` as **ROOMS OPEN**.

## 7. Parity checklist vs v1 (what a reviewer should verify)

1. Register→approve→propose→vote→winners→docs→archive journey preserved.
2. Winner docs with title/summary/original-proposal scaffold preserved.
3. Room protocol templates preserved (4, versioned `_v1`).
4. Vote cap semantics: token-bound in v1 → human-bound in v2 (intentional upgrade).
5. Dropped: default-event aliased routes, Ably rooms (change feed + artifacts
   cover coordination; live voice/presence is FUTURE), quest/offer board (FUTURE),
   raw Jot links (replaced by ILP-COLLAB).
