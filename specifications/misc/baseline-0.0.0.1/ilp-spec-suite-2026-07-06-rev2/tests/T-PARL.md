# T-PARL — Parliamentary Pack E2E

env: single (rerun as smoke on duo host B). Fixture: parliamentary event
(quorum=3, threshold=majority, chair=hC, clerk agent aK, members h1..h4 approved
with agents).

---

**T-PARL-1 — Convening + quorum gate** · traces: R-PARL-4
Only h1, h2 check in → operator fires assembly→session gate → 409
`QUORUM_NOT_MET` {present:2, required:3}. h3 checks in → transition succeeds;
eligibility snapshot recorded (fetchable; contains exactly hC?,h1,h2,h3 per
check-ins).

**T-PARL-2 — Motion → second → debate → vote → adopted (full happy path)**
· traces: R-PARL-2, R-PARL-5, R-PARL-8, R-PARL-10
h1 moves M1 ("Adopt the roadmap"); h2 seconds; h3 speech_request → queue position
visible; chair recognizes h3; h3 speaks; chair call_vote → balloting with
deadline; votes: h1 aye, h2 aye, h3 no → decided `adopted` (2/3 majority of
ayes+noes, quorum met from snapshot); Decision object replayable; `resolution`
artifact exists with final text + tally + receipt refs; all ballots dual-subject
receipted.

**T-PARL-3 — No second → dead** · traces: motion lifecycle
h4 moves M2; `second_timeout_minutes` elapses (fixture timer) → M2 state `dead`;
no ballot possible on it (409).

**T-PARL-4 — Amendment flow (one level)** · traces: R-PARL-6
During M3 debate: h2 moves amendment A1 (text replace), h3 seconds → A1 sub-ballot
first (chair call_vote) → adopted → M3's pending text revision updated in its
resolution artifact (revision log shows amendment op) → debate resumes → M3 final
ballot on amended text. Amendment-to-amendment attempt → 409 (v1 depth limit).

**T-PARL-5 — Recognition queue discipline** · traces: R-PARL-2
Speech by a member without the floor (floor_mode recognized) → 403; queue is FIFO;
one outstanding request per member (2nd request → 409); recognize clears the head.

**T-PARL-6 — Point of order + ruling + appeal** · traces: R-PARL-3, R-PARL-7
During balloting h4 raises point_of_order → ballot clock pauses (deadline shifts,
feed shows pause); chair rules `not_well_taken`; h4 appeals + h2 seconds →
immediate majority ballot "shall the ruling stand": ayes 2, noes 1 → ruling
stands; flow resumes; all steps receipted; minutes reflect the sequence.

**T-PARL-7 — Threshold + tie + chair vote** · traces: R-PARL-5, R-PARL-1
Motion with votes 2 aye / 2 no → fails (tie). With `chair_votes: tie_break_only`:
chair's ballot before tie → 409 (not allowed); at tie, chair casts aye → adopted.
`two_thirds` event: 2 aye / 1 no → 66.7% ≥ 2/3 boundary case asserted per spec
definition (≥); abstentions counted for quorum only.

**T-PARL-8 — Vote change until close** · traces: vocabulary (changeable ballots)
h1 votes aye then changes to no before close → final tally uses no; both ballots
receipted; decision inputs list the effective ballot set.

**T-PARL-9 — Quorum failure at ballot** · traces: R-PARL-4
Ballot where only 2 of snapshot participate and quorum=3 → decision
`QUORUM_NOT_MET`; motion remains undecided; re-ballot after another member votes
succeeds.

**T-PARL-10 — Withdraw + adjourn + minutes certification** · traces: R-PARL-9
Mover withdraws a pre-vote motion → state withdrawn, no ballot; chair adjourns →
minutes phase: minutes artifact auto-contains agenda, motions (incl. dead,
withdrawn), rulings, appeal, ballots with tallies; clerk appends an annotation
(ILP-COLLAB append); chair certifies → snapshot signed; round closes; export
verifies (T-EVENT-13 method) including minutes + resolutions.

**T-PARL-11 — Role enforcement** · traces: R-PARL-1, R-ID-3
Member fires chair-only action (recognize, call_vote, ruling) → 403; observer
fires anything → 403; clerk can annotate minutes but cannot rule.

**T-PARL-12 — Event Home pack block** · traces: R-PARL-11
During debate: pack block shows current agenda item, motion text revision, floor
holder, queue, deadlines, quorum status — all consistent with the action log.
