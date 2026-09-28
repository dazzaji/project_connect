# T-FED — Federation (three instances, at least two clouds)

env: duo/trio. The acceptance federation is **A (Original Host), B, C** —
independent deployments, domains, DBs, keys, spanning ≥ 2 cloud providers
(R-FED-18, R-OPS-8). T-FED-1..10 run pairwise on A/B (CI may use two isolated
hosts); T-FED-11..15 require all three. Fixtures built via protocol on each side.

---

**T-FED-1 — Peering** · traces: R-FED-2..4
A admin proposes peer B; B reciprocates → both list each other `active`
(public peers endpoint). Signed request from A to B's revocations endpoint
verifies; tampered signature → 401; non-peer host C calling peer-only endpoints →
403 `NOT_A_PEER`.

**T-FED-2 — Directory + aggregation** · traces: R-FED-5, R-FED-6
B creates `federated` parliamentary event eB; A's aggregated directory shows eB
labeled home=B within one poll interval; B's `private`+`public` events absent.
Take B down (or block) → A's aggregation skips B gracefully, local listing
unaffected (R-FED-12 part).

**T-FED-3 — Cross-instance join, full flow** · traces: R-FED-7..9, R-ID-17..19
M registers on A (OTP), A-admin verifies, M registers agent (plate). M mints claim
for eB; POST join-request to B → 202 pending; B operator queue shows request
flagged remote with origin A + verified attestation + plate. Approve → M retrieves
token via retrieval key (and A-notify observed if delivered). M's agent
participates on eB: check-in, motion, second, ballot — actions accepted exactly as
a local member's; every receipt carries `ilp:A:human:…` subject (P10 assertion).

**T-FED-4 — Claim security** · traces: R-FED-14, R-ID-18
Replay the same claim JWT → 409 `CLAIM_REPLAYED`. Expired claim → `CLAIM_EXPIRED`.
Claim audience=C presented to B → `CLAIM_AUDIENCE_MISMATCH`. Claim signed by
non-peer → `NOT_A_PEER`. Claim from suspended peer → rejected.

**T-FED-5 — Host authority** · traces: R-FED-8, C7
B operator rejects a second remote join (M2) → M2 gets rejected status; nothing A
does can force admission (no A-side endpoint exists that mutates B state — probe).
B ejects M mid-event → token dead (`AUTH_REVOKED`), membership revoked, receipted.

**T-FED-6 — Home revocation propagates** · traces: R-FED-10, R-FED-11
Re-approve M. A revokes M's agent plate → A's revocation feed lists it → within
one poll cycle B kills M's token; M's next action → `AUTH_REVOKED`; B operator
alerted (feed/summary). Direct join-time check: new claim for revoked subject →
`SUBJECT_REVOKED`.

**T-FED-7 — Peer outage isolation** · traces: R-FED-12
Suspend/block A entirely: eB continues for local members; existing remote token
policy per spec (keeps working until revocation-poll fails long enough per
documented policy — assert documented behavior); new joins fail closed with clear
error.

**T-FED-8 — Federated export provenance** · traces: R-FED-9, R-EV-25
Close eB; export; offline verifier checks: M's actions/receipts carry A-origin
global ids; the manifest verifies against B's keys; M's identity attestation
(claim reference) is included so a third party can verify the A-signature chain
against A's published discovery keys.

**T-FED-9 — Consent across instances** · traces: R-EV-21, R-FED §4
eB requires publication consent: M's join records acceptance of B's consent text
(version+sha256 from B); M's first action passes; export consent-filtering treats
M like locals.

**T-FED-10 — Smoke symmetry**
Run T-UNCONF-1 on A and T-PARL-2 on B unchanged (env-parametrized) — both pass on
their respective clouds.

**T-FED-11 — Three-node peering + directory** · traces: R-FED-18, R-FED-3..6
A↔B, A↔C, B↔C all peer; each public peer list shows the other two. B hosts a
federated parliamentary event, C a federated unconference; each also creates one
public and one private event. A's aggregated directory shows exactly the two
federated events, each labeled with home instance + pack@version. Block C → A's
aggregation degrades gracefully (B's entry remains); A's local listing unaffected.

**T-FED-12 — Multi-direction cross joins** · traces: R-FED-18, R-FED-7, R-FED-8
Verified users join across ≥ 4 directions: A→B, A→C, B→A, C→B. Each host
operator sees origin + attestation and decides independently; one request is
rejected to prove independence; approved users receive host-issued tokens; each
host's roster labels remote origin correctly.

**T-FED-13 — Federated parliamentary with A/B/C participants** · traces:
R-FED-18, R-FED-9, R-PARL-4, R-EV-25
On B's parliamentary event with members from A, B, and C: quorum snapshot lists
all three with provenance; motion → second → debate → ballot → adopted; minutes
+ resolution certified. Export from B verifies offline including A-origin and
C-origin subjects against A's and C's published keys. C's federated unconference
runs the mirror test: remote proposals/votes respect per-human caps; artifact
writes stay safe under mixed local/remote concurrent writers (T-COLLAB-5 method,
5 local + 5 remote workers).

**T-FED-14 — Version negotiation** · traces: R-FED-15
(a) Fixture "peer" serving a discovery doc with `protocols: ["ilp/0"]` →
peering attempt fails `PROTOCOL_UNSUPPORTED`. (b) Directory entry with pack
`parliamentary@9.9` → still listed; UI/API surface compatibility status; join
still possible (participant uses host API). (c) Federation payload with an
unknown extra field (newer-minor simulation) → ignored, not fatal.

**T-FED-15 — Depeering policy on existing participants** · traces: R-FED-16,
R-FED-11
With active remote participants from B on A: A **suspends** B → their tokens
pause with `AUTH_REVOKED`-family error naming the suspension; A reinstates B →
tokens resume (suspend is resumable). A **removes** B → tokens and memberships
revoked permanently; records/receipts retained with provenance; operator UI
showed the blast radius before confirming.
