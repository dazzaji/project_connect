# T-EVENT — Event Engine

env: single.

---

**T-EVENT-1 — YAML validate + create, atomically** · traces: R-EV-10..12, C2
(a) POST definition:validate with a YAML containing 3 distinct errors (bad slug,
unknown key, missing required param) → 400 listing ALL three at once.
(b) Valid unconference YAML **omitting** `policy` block → create succeeds;
Event Home shows `identity_required=true` AND `publication_consent_required=true`
(defaults ON — the C2 test).
(c) Create is one call: event exists in `draft` with skill.md already served;
definition snapshot immutable (GET returns byte-identical YAML + sha256).
(d) Duplicate slug → 409 `SLUG_CONFLICT`.
(e) YAML with a privileged-looking key (`admin_token: x`) → 400 unknown-key.

**T-EVENT-2 — Lifecycle state machine** · traces: R-EV-1
draft→open→live→closed→archived each via operator call, each receipted + feed
record. Illegal jumps (draft→live, closed→open, archived→anything) → 409.
Archived event: all GETs work read-only; every mutation → 409/403.

**T-EVENT-3 — Visibility** · traces: R-EV-2
`private` event absent from public list; non-member GET → 404/403; member ok.
`public` listed locally, absent from `/federation/events`. `federated` present in
both.

**T-EVENT-4 — Event Home accuracy** · traces: R-EV-3
During `voting` with cap 3 and 1 vote cast by h1: Event Home with k1 shows
`my.votes_remaining==2`, `allowed_actions` correct for phase/role; with no
credential no `my` block; `phase_deadline` present iff timer gate armed; `seq`
equals feed head.

**T-EVENT-5 — Registration + approval flow** · traces: R-EV-14, R-EV-15
Register (identity-required): without session → 401; with session + owned agent →
`pending`; approval by operator → feed record within one long-poll cycle; token
issued and retrievable only via the human's session; reject + revoke paths emit
receipts; re-register after revoke → 409 or new-pending per spec choice
(documented; assert consistency).

**T-EVENT-6 — Action validation stack** · traces: R-EV-16
Matrix: wrong phase → 409 `PHASE_MISMATCH` (+current phase); wrong role → 403;
bad schema → 400 with pointer; over cap → 409 `VOTE_CAP_EXCEEDED` {cap,
votes_remaining:0}; missing consent → 409 `CONSENT_REQUIRED`; valid → 201 +
feed + receipt.

**T-EVENT-7 — expect_phase + grace window** · traces: R-CORE-17, R-EV-7
Arm `proposing→voting` transition; submit a proposal with
`expect_phase:"proposing"` 5s AFTER the flip (inside 30s grace) → accepted;
same 40s after (outside grace) → 409 `PHASE_MISMATCH`. A vote with
`expect_phase:"voting"` during proposing → 409 immediately.

**T-EVENT-8 — Cap enforcement across tokens (per human)** · traces: R-EV-17
h1 registers two agents (two tokens) in a cap-3 voting event; cast 2 votes on
token A, 1 on token B → 4th vote on either token → `VOTE_CAP_EXCEEDED`.
Concurrency: fire 6 parallel votes with 1 remaining → exactly 1 accepted (K-not-N).

**T-EVENT-9 — Decision replayability** · traces: R-EV-8, R-ARCH-9
After winners decided: fetch decision object + all considered actions; harness
recomputes `top_n` independently → identical result + `inputs_hash`.

**T-EVENT-10 — Gate atomicity** · traces: R-EV-6, R-UNCONF-6
Fire voting→complete while a vote is in flight repeatedly (20 rounds of race
loop): in every run, either the vote is in the decision inputs or it was rejected
`PHASE_MISMATCH` — never accepted-but-ignored. Winner artifacts exist iff the
transition committed; no partial artifact sets.

**T-EVENT-11 — Operator surface parity** · traces: R-EV-19, R-EV-20, R-ARCH-5
Every operator mutation used by the UI exists as documented ILP endpoint (crawl
openapi vs UI actions list); operator/summary returns pending count, phase, gate
readiness, action rate.

**T-EVENT-12 — SKILL serving** · traces: R-EV-23, R-EV-24
GET `/events/{slug}/skill.md` → contains: exact event API base, feed+long-poll
instructions, expect_phase guidance, caps, collab contract section, consent
posture, untrusted-content rule; per-event `surfaces.skill_markdown` appended.
GET `/.well-known/agent.json` lists entry points. Fetch with
`User-Agent: python-urllib/3.11` → 200 (no UA blocking).

**T-EVENT-13 — Export bundle verifiability** · traces: R-EV-25, R-EV-26, C10
Close event; create export; download. Offline verifier (harness, no DB):
manifest signature valid against discovery keys; every file sha256 matches;
receipts chain verifies; decisions replay from actions.jsonl; registrations
respect consent filtering; global ids intact.

**T-EVENT-14 — No default-event aliasing** · traces: R-EV-1(note)
No `/api/rounds/current`-style unscoped mutation route exists (openapi + probe →
404): all event operations are event-addressed.
