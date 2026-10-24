# Procedure Pack: `parliamentary@1.0`

**Status:** DRAFT for Dazza review · 2026-07-06 · Implements the ILP-EVENT pack
contract. This is the initial parliamentary event type (roadmap F5a made concrete;
protocol objects per the carry-forward consensus item 29: agenda, recognition
queue, motions, seconds, amendments, debate windows, points of order, votes,
quorum, thresholds, minutes, rulings, appeals, resolutions). It is deliberately a
**simplified Robert's-Rules-inspired procedure**, complete enough for real
governance sessions and for the future Human Council, small enough to build and
test now. Requirement IDs: `R-PARL-n`. Tests: `tests/T-PARL.md`.

---

## 1. Roles

| Role | Granted by | May |
|---|---|---|
| `chair` | cohort membership metadata (exactly one active) | recognize speakers, open/close debate, call votes, rule on points of order, adjourn |
| `clerk` | membership metadata (0–n; may be a platform agent) | manage agenda drafts, record minutes annotations |
| `member` | approved registration | move, second, debate, amend, vote, raise points of order, appeal |
| `observer` | approved registration (observer) | read only |

- **R-PARL-1** The chair is set at event creation (YAML `params.chair`) or by
  operator action before `live`; chair actions are receipted like all others.
  The chair MAY also be a member (params flag `chair_votes`: default
  `tie_break_only`).

## 2. Objects and action vocabulary

All are engine Actions with pack schemas; the session state machine interprets them.

| Kind | Payload (summary) | Notes |
|---|---|---|
| `parliamentary.agenda_item` | `{title, description, order}` | clerk/chair, during `assembly` phase; forms the agenda |
| `parliamentary.motion` | `{text ≤10000, agenda_item, kind: main}` | member; one active main motion per agenda item |
| `parliamentary.second` | `{}` → target: motion | member ≠ mover |
| `parliamentary.speech_request` | `{}` → target: motion | member; forms the **recognition queue** (FIFO, one outstanding request per member) |
| `parliamentary.recognize` | `{}` → target: speech_request | chair; grants the floor |
| `parliamentary.speech` | `{text ≤5000}` → target: motion | the recognized member (or open-floor mode) |
| `parliamentary.amendment` | `{text, replaces?}` → target: motion | member, during debate; treated as subsidiary motion (needs second, debated, voted before the main motion) — **one level deep** (no amendments to amendments in v1) |
| `parliamentary.point_of_order` | `{text ≤2000}` | member, any time in session; pauses the flow until ruled |
| `parliamentary.ruling` | `{disposition: well_taken|not_well_taken, text}` → target: point_of_order | chair |
| `parliamentary.appeal` | `{}` → target: ruling | member + requires a second; puts "shall the ruling stand?" to a majority vote |
| `parliamentary.call_vote` | `{}` → target: motion | chair; closes debate, opens the ballot |
| `parliamentary.vote` | `{choice: aye|no|abstain}` → target: motion | member; **changeable until ballot closes** (last ballot counts — recorded, not secret) |
| `parliamentary.withdraw_motion` | `{}` → target: motion | mover, before vote called |
| `parliamentary.adjourn` | `{}` | chair (or motion+second+majority via params) |

- **R-PARL-2** The **recognition queue** is queryable
  (`GET …/actions?kind=parliamentary.speech_request&state=open`) and shown in the
  Event Home pack block (`current_motion`, `floor`, `queue`, `debate_deadline`).
- **R-PARL-3** Points of order **pause** the active debate/ballot clock; the pause
  and resume are feed-visible.

## 3. Session state machine (phase graph)

Phases within each round ("sitting"):

```
assembly ──(operator/chair: quorum_check gate)──▶ session
session: per agenda item, motion lifecycle loop (see below)
session ──(adjourn)──▶ minutes
minutes ──(chair certifies minutes snapshot)──▶ closed(round)
```

Motion lifecycle (within `session`, engine-enforced as action validity states,
not separate engine phases):

```
moved ──second within params.second_timeout──▶ debating
      └─(no second)──▶ dead
debating ──(amendment moved+seconded)──▶ debating(amendment sub-ballot first)
debating ──(chair call_vote | timer params.debate_minutes)──▶ balloting
balloting ──(timer params.ballot_minutes | chair closes)──▶ decided
decided: threshold(parliamentary.vote, rule=params.threshold, quorum=params.quorum)
         → adopted | rejected  (Decision object, replayable)
```

- **R-PARL-4 (Quorum)** Quorum = `params.quorum` expressed as count or fraction of
  **approved members checked in** during `assembly` (check-in =
  `parliamentary.checkin` action; the eligible-voter set is **snapshotted** at
  `session` start — the eligibility snapshot the F5a notes require). A ballot whose
  participating-eligible count < quorum yields `QUORUM_NOT_MET`: the motion
  remains undecided and may be re-balloted; nothing silently passes.
- **R-PARL-5 (Thresholds)** `params.threshold`: `majority` (>50% of ayes+noes) or
  `two_thirds` (≥2/3 of ayes+noes); abstentions counted for quorum, excluded from
  the ratio. Per-motion-kind overrides: appeals = majority; procedural motions
  configurable. Ties fail (except `chair_votes: tie_break_only` where the chair's
  ballot is then accepted).
- **R-PARL-6 (Amendments)** An adopted amendment rewrites the pending main-motion
  text (recorded as a new revision of the motion's **resolution artifact**, see
  §4); a rejected amendment leaves it unchanged; then debate on the main motion
  resumes. One amendment pending at a time.
- **R-PARL-7 (Appeals)** An appeal (seconded) suspends the ruling and puts
  "shall the ruling of the chair stand?" to an immediate majority ballot; the
  decision is recorded against the ruling and the flow resumes accordingly.
- **R-PARL-8 (Votes are receipted per ILP-CORE)** — every ballot choice is a
  dual-subject receipted action (human + agent if agent-cast). Recorded (roll-call)
  voting only in v1; secret ballots are FUTURE.

## 4. Artifact bindings

- **R-PARL-9 Minutes.** One `role: minutes` artifact per round, **auto-generated**
  by the pack from the action/decision log (agenda, motions with movers/seconders,
  debate summaries as listed speeches, rulings, ballots with tallies, outcomes) and
  annotatable by the clerk via ILP-COLLAB appends. Closing requires a chair-
  certified snapshot (R-COLLAB-11).
- **R-PARL-10 Resolutions.** Each adopted main motion produces a `role: resolution`
  artifact containing the final adopted text (post-amendments), the Decision id,
  tally, quorum evidence, and receipt references — the exportable, verifiable
  "final resolution" object.

## 5. Parameters (YAML `params`)

| Param | Type / default |
|---|---|
| `chair` | plate or human global id, **required** |
| `chair_votes` | `never | tie_break_only | always`, `tie_break_only` |
| `quorum` | int or fraction (e.g. `0.5`), **required** |
| `threshold` | `majority | two_thirds`, `majority` |
| `second_required` | bool, true |
| `second_timeout_minutes` | int, 10 |
| `debate_minutes` | int, 20 (per motion; chair may close early) |
| `speech_seconds` | int, 180 (advisory in v1; enforced display timer) |
| `ballot_minutes` | int, 10 |
| `max_open_motions` | fixed 1 (v1) |
| `agenda_locked_at_session` | bool, true |

## 6. Surface templates

- **R-PARL-11** The generated SKILL teaches agents the procedure: check in during
  assembly; how to move/second; join the recognition queue and wait for
  `recognize` (via feed long-poll, not polling); debate norms (speak only with the
  floor in `floor_mode: recognized`); amend; vote with `expect_phase`; raise
  points of order sparingly; where minutes and resolutions live. The Event Home
  pack block always shows: current agenda item, current motion text (current
  revision), floor holder, queue position, debate/ballot deadlines, quorum status.
- **R-PARL-12** UI: agenda sidebar, motion card with live state, queue widget,
  ballot widget with countdown, minutes view. All via public ILP data (R-ARCH-5).

## 7. Federation note and Human Council readiness

A `federated` parliamentary event admits remote members via ILP-FED exactly like
local ones (host-approved, host-tallied). Multi-node synchronized sessions with
federation-level tallies (the Human Council / United Federation Session) are
explicitly FUTURE — this pack is their building block. **Human Council readiness
criteria** (tested as `UAT-GOV` in `tests/T-ACCEPT.md`): eligibility snapshots
including remote members with provenance; every ballot dual-subject receipted
and replayable; certified, signed minutes and resolutions; exports containing
everything a future federation-level tally service needs, consumable offline
without database access, with each subject's origin verifiable against its home
instance's published keys.

## 8. v1 simplifications (explicit, so nobody "fixes" them accidentally)

Single active main motion; one amendment level; no committees/referral; no
privileged/incidental motion taxonomy beyond point-of-order+adjourn; recorded
votes only; advisory speech timer. Each is a FUTURE roadmap line, not a bug.


## v1.1 — Ballotable amendments (usability sprint UG-4; Q-1 Option B)

`parliamentary@1.1` (registered alongside 1.0 — events pin their version):
`second` / `speech` / `call_vote` / `vote` / `close_ballot` target
`["parliamentary.motion", "parliamentary.amendment"]`, so an amendment follows
the same declarative lifecycle as a motion: moved → seconded (debating) →
ballot called by the chair (balloting) → voted (changeable until close) →
adopted/rejected. The `ballot_result` resolution binding carries
`when: { target_kind: parliamentary.motion }` — amendments never mint their
own resolution; instead the motion's resolution template renders
`{{adopted_children}}` (the adopted amendment texts) in an
`## Adopted amendments` block.

**v1.1 limits (documented, enforced by declaration):** one degree only —
`parliamentary.amendment` still targets ONLY `parliamentary.motion`, so
amending an amendment is refused server-side with prose naming the allowed
target kinds, renders no UI control (capabilities declare motion-only
targets), and is stated in the served SKILL. Amendment ballots may run while
the main motion stays `debating`; the chair sequences by convention.
