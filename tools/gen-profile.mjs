// Generates profile/pc-0.1-s1.json — the CANDIDATE slice-1 profile (frozen and hashed at SG-1).
import { mkdirSync, writeFileSync } from "node:fs";
import { validate } from "../lib/schemas.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalBytes } from "../lib/jcs.mjs";
import { sha256Hex } from "../lib/jws.mjs";

const OUT = process.env.ILP_GEN_OUT ? join(process.env.ILP_GEN_OUT, "profile") : join(dirname(fileURLToPath(import.meta.url)), "..", "profile");

// role: which scenario node the test exercises — "host", "home", "both", or "pair".
const T = (id, gate, role, severity, title, traces, expect, extra = {}) => ({ id, gate, role, severity, title, traces, expect, since: "0.0.2", verification: "black-box", ...extra });

const tests = [
  // Discovery and build identity (G0)
  T("PC-DISC-1", "SG-2", "both", "blocker", "Discovery document is served at /.well-known/interlateral.json and validates against the strict discovery schema", ["R-CORE-20", "R-CORE-28", "R-CORE-39"], "200; schema discovery v2 valid"),
  T("PC-DISC-2", "SG-2", "both", "blocker", "Build identity is present and stable: instance.software.build and instance.deployment_id are non-empty, equal across fetches, and equal to the values bound into the evidence packet. (That the build changes when code changes is verify: review, R-OPS-11.)", ["R-CORE-30"], "two fetches equal; non-empty build and deployment_id"),
  T("PC-DISC-3", "SG-2", "both", "major", "spec_versions declares the profile's specification version; protocols includes ilp/1; instance.host has no scheme, port, or path", ["R-CORE-31", "R-CORE-7a", "R-FED-15"], "spec_versions ∋ 0.0.2"),
  T("PC-DISC-4", "SG-2", "both", "blocker", "Keys: every key is an Ed25519 OKP JWK; federation.active_kid names a listed key; every signed object observed in the run carries the active kid; revocation_bound_s ≤ profile bound; the declared remote_session_policy is pause with after_s ≤ parameters.remote_session_policy.after_s_max", ["R-CORE-21", "R-CORE-34", "R-FED-20", "R-FED-21", "R-FED-21a"], "active kid used by claims, grants, revocations"),
  T("PC-DISC-5", "SG-3", "both", "major", "Key custody ops drill: started in production mode with its key file absent, the node refuses to start; started in declared development mode with a key file present, the node does not replace it", ["R-CORE-34"], "refusal; key unchanged", { verification: "ops-drill" }),
  // Core conventions
  T("PC-CORE-1", "SG-3", "both", "major", "Problem documents: type = urn:ilp:error:<CODE>, title = <CODE>, status = HTTP status, served as application/problem+json", ["R-CORE-9", "R-CORE-9a", "R-CORE-11"], "every negative response in the run conforms"),
  T("PC-CORE-2", "SG-3", "host", "major", "Lenient receive: a claim carrying an unknown x_ member (signed) is accepted; a claim carrying a non-x_ unknown member is accepted and the member ignored", ["R-CORE-39", "R-FED-15"], "202 pending for both"),
  T("PC-CORE-3", "SG-3", "host", "blocker", "JWS discipline: a claim with alg none, or alg other than EdDSA, is rejected with SIGNATURE_INVALID; a claim whose kid does not resolve is rejected with UNKNOWN_SIGNER", ["R-CORE-36", "R-FED-14"], "SIGNATURE_INVALID; UNKNOWN_SIGNER"),
  T("PC-CORE-4", "SG-3", "host", "blocker", "Error precedence: an out-of-scope action attempted in a phase that forbids it reports GRANT_SCOPE_VIOLATION, not PHASE_MISMATCH", ["R-CORE-29", "R-AUTHZ-7"], "GRANT_SCOPE_VIOLATION"),
  T("PC-CORE-5", "SG-3", "host", "blocker", "Receipt wire form: served receipts use member `resource` (never resource_global_id), validate against the receipt schema, and the chain recomputes from sixty-four zeros", ["R-CORE-24", "R-CORE-40", "R-CORE-35"], "chain verifies with the reference library"),
  // Peering (G2)
  T("PC-PEER-1", "SG-2", "pair", "blocker", "Explicit mutual peering: each admin (or peering credential) adds the other; both peer lists show the other as active with common_spec_versions non-empty", ["R-FED-3", "R-FED-4", "R-FED-15", "R-FED-16"], "active both ways"),
  T("PC-PEER-2", "SG-3", "host", "blocker", "A join request whose claim is issued by a non-peer is rejected with NOT_A_PEER, with no shadow principal created", ["R-FED-3", "R-FED-14"], "NOT_A_PEER"),
  T("PC-PEER-3", "SG-3", "pair", "major", "Peering state changes (suspend, reinstate) are visible on the public peer list (a suspended peer is listed as suspended) and are published as signed revocation records of kind peer; the reinstatement record carries reinstated: true", ["R-FED-3", "R-FED-3a", "R-FED-4", "R-FED-10a", "R-FED-16"], "state + records"),
  // Directory (G2)
  T("PC-DIR-1", "SG-3", "host", "major", "The host lists its federated event; every entry validates against directory-entry and carries the event's global ID, pack, status, policy, and home", ["R-FED-5", "R-FED-19"], "entry present and valid"),
  T("PC-DIR-2", "SG-3", "host", "blocker", "A private control event and a non-federated control event never appear in the directory, locally or aggregated", ["R-FED-19", "R-FED-17"], "absent"),
  T("PC-DIR-3", "SG-3", "home", "major", "The home aggregates its active peer's directory: the host's event appears with the same global ID and is labeled with its home host", ["R-FED-6"], "aggregated entry equal on identifying members"),
  T("PC-DIR-4", "SG-3", "host", "minor", "updated_at is monotonic per entry, and a closed event is reported with status closed", ["R-FED-19"], "monotonic; closed reported"),
  // Identity claims (G3)
  T("PC-IDC-1", "SG-2", "home", "blocker", "The home mints an ilp-claim+jwt: typ, EdDSA, active kid; payload valid against identity-claim; sub = the on_behalf_of synthetic human; aud = host; exp − iat ≤ 86400; no email or out-of-schema member; a claim request whose aud is not an active peer is refused with NOT_A_PEER", ["R-ID-17", "R-ID-18", "R-FED-7a", "R-CORE-36", "R-CORE-38"], "valid claim; NOT_A_PEER for a non-peer aud"),
  T("PC-IDC-2", "SG-2", "host", "blocker", "The host accepts a valid claim (202 pending, retrieval key) and creates a remote shadow principal keyed by the home global ID; identity alone confers nothing: an action authenticated only by the claim returns AUTHZ_REQUIRED", ["R-FED-7", "R-FED-8", "R-AUTHZ-1", "R-AUTHZ-16", "R-ID-18"], "202; AUTHZ_REQUIRED; no side effects"),
  T("PC-IDC-3", "SG-2", "host", "blocker", "Claim validation: a replayed claim is rejected with CLAIM_REPLAYED; a claim for another audience with CLAIM_AUDIENCE_MISMATCH; an expired claim with CLAIM_EXPIRED; a tampered claim with SIGNATURE_INVALID", ["R-FED-14", "R-ID-18", "R-CORE-38"], "each code"),
  // Grants (G3)
  T("PC-GRANT-1", "SG-2", "host", "blocker", "After approval, the authenticated join retrieval delivers the participant token and an ilp-grant+jwt: typ, EdDSA, active kid; payload valid; iss = aud = host; sub = home global ID; agent bound; authorization_details names unconference@1.1 unconference.proposal; exp − iat ≤ test-grant TTL; credential_binding = S256(token)", ["R-AUTHZ-2", "R-AUTHZ-3", "R-AUTHZ-4", "R-AUTHZ-5", "R-AUTHZ-6"], "valid grant bound to the delivered token"),
  T("PC-GRANT-2", "SG-2", "host", "major", "Grant status is public and secret-free (active), and the bearer can re-fetch the same grant at /ilp/v1/auth/grant", ["R-AUTHZ-9"], "active; same JWS"),
  T("PC-GRANT-3", "SG-3", "host", "blocker", "A grant used after exp (plus skew) is rejected with GRANT_EXPIRED and status reports expired", ["R-AUTHZ-5", "R-CORE-38"], "GRANT_EXPIRED"),
  // Receipts (G4)
  T("PC-RCPT-1", "SG-2", "host", "blocker", "The permitted act's receipt carries authorization_grant = grant jti, subject_human = home global ID, subject_agent = home agent global ID, license_plate, mandate, source_class agent_token_api; the hash recomputes and links", ["R-CORE-22c", "R-CORE-25", "R-AUTHZ-10", "R-CORE-40", "R-FED-9"], "receipt as specified"),
  T("PC-RCPT-2", "SG-3", "host", "major", "Idempotency: a retry with the same Idempotency-Key returns the original result and creates no second action, feed record, or receipt", ["R-CORE-16"], "one action"),
  T("PC-RCPT-3", "SG-3", "host", "major", "Join approval and grant issuance each produce a receipt and feed records on the host", ["R-CORE-22", "R-AUTHZ-2", "R-FED-7"], "receipts present"),
  // Enforcement (G4, G5)
  T("PC-ENF-1", "SG-2", "host", "blocker", "The permitted action (unconference.proposal) by the remote agent is accepted exactly once, under the grant", ["R-AUTHZ-7", "R-FED-1"], "201; one action"),
  T("PC-ENF-2", "SG-2", "host", "blocker", "The out-of-scope action (unconference.vote) is rejected with GRANT_SCOPE_VIOLATION and produces no action, feed record, receipt, or tally change", ["R-AUTHZ-8", "R-AUTHZ-11"], "GRANT_SCOPE_VIOLATION; no side effects"),
  T("PC-ENF-3", "SG-3", "host", "blocker", "A token and grant issued for event E1 used against event E2 on the same host is rejected with GRANT_EVENT_MISMATCH, with no side effects", ["R-AUTHZ-7", "R-AUTHZ-17", "R-CORE-29", "R-AUTHZ-11"], "GRANT_EVENT_MISMATCH"),
  T("PC-ENF-4", "SG-3", "host", "blocker", "A presented grant issued by another host is rejected with GRANT_AUDIENCE_MISMATCH, with no side effects", ["R-AUTHZ-4", "R-AUTHZ-15"], "GRANT_AUDIENCE_MISMATCH"),
  T("PC-ENF-5", "SG-3", "host", "blocker", "A presented grant with an altered payload byte is rejected with SIGNATURE_INVALID, with no side effects", ["R-CORE-36", "R-AUTHZ-15"], "SIGNATURE_INVALID"),
  T("PC-ENF-6", "SG-3", "host", "blocker", "A presented grant bound to another participant's token is rejected with GRANT_BINDING_MISMATCH, with no side effects", ["R-AUTHZ-6", "R-AUTHZ-15"], "GRANT_BINDING_MISMATCH"),
  T("PC-ENF-7", "SG-3", "host", "blocker", "An expired grant authorizes nothing: the act is rejected with GRANT_EXPIRED and no side effects", ["R-AUTHZ-5", "R-AUTHZ-11"], "GRANT_EXPIRED"),
  T("PC-ENF-8", "SG-3", "host", "blocker", "A grant revoked by the host operator is rejected on next use with GRANT_REVOKED (or AUTH_REVOKED when the token is revoked with it), its status is revoked, and a signed revocation record of kind grant is published", ["R-AUTHZ-12", "R-FED-10", "R-AUTHZ-9"], "revoked on next use; record"),
  T("PC-ENF-9", "SG-3", "host", "major", "On the E-mandate event, the delivered grant carries mandates_allowed = [human_directed, human_approved] (asserted first); an act declaring standing_instruction is rejected with GRANT_SCOPE_VIOLATION + code_detail MANDATE_NOT_ALLOWED and no side effects", ["R-AUTHZ-13"], "MANDATE_NOT_ALLOWED"),
  T("PC-ENF-10", "SG-3", "host", "blocker", "A grant is not a bearer credential: Authorization: Bearer <grant JWS> is rejected with AUTH_INVALID, and ILP-Grant with no Authorization is rejected with AUTH_MISSING, both with no side effects", ["R-AUTHZ-6", "R-AUTHZ-11"], "AUTH_INVALID; AUTH_MISSING"),
  T("PC-ENF-11", "SG-3", "host", "blocker", "Narrowing only: (a) on the E-excl event, whose grant lists unconference.vote in both authorization_details and exclusions, a vote is rejected with GRANT_SCOPE_VIOLATION; (b) a grant-permitted proposal beyond the engine's per-participant cap is rejected (VOTE_CAP_EXCEEDED or CONFLICT); both with no side effects", ["R-AUTHZ-8", "R-AUTHZ-11"], "rejected; no side effects"),
  // Revocation and isolation (G6)
  T("PC-REV-1", "SG-3", "both", "blocker", "The revocation feed serves signed ilp-revocation+jwt records, valid against revocation-record, with strictly increasing seq and the {items, next_cursor, latest_seq} envelope", ["R-FED-10", "R-CORE-36"], "records verify"),
  T("PC-REV-2", "SG-3", "pair", "blocker", "The home revokes the participant's agent; within revocation_bound_s the host rejects the next act (AUTH_REVOKED or GRANT_REVOKED) and a new join by that subject is rejected with SUBJECT_REVOKED", ["R-FED-10", "R-FED-11", "R-ID-19", "R-FED-20"], "rejected within bound"),
  T("PC-REV-3", "SG-3", "host", "blocker", "The host suspends the home peer: the remote participant's next act and a new join are rejected with PEER_SUSPENDED and the grant status reads suspended; after reinstatement the ORIGINAL token and grant act again (status active) — suspension is resumable", ["R-FED-11", "R-FED-16", "R-AUTHZ-9"], "PEER_SUSPENDED then original credentials resume"),
  T("PC-REV-4", "SG-3", "host", "blocker", "Fail closed: when the home's revocation feed cannot be refreshed for 2 × bound, a new join from that peer is rejected with REVOCATION_STATE_UNKNOWN (503, retry_after), and an already-admitted remote participant is handled per the declared remote_session_policy (pause → REVOCATION_STATE_UNKNOWN); after the home returns and a refresh succeeds, that participant acts again", ["R-FED-21"], "REVOCATION_STATE_UNKNOWN; declared policy; recovery"),
  T("PC-REV-5", "SG-3", "host", "blocker", "Outage isolation: while the home is unreachable, the host's local event accepts a local participant's act", ["R-FED-12", "R-FED-21"], "local act accepted"),
  // Provisioning credential boundary (R-CONF-6)
  T("PC-PROV-1", "SG-3", "home", "blocker", "The ilpp_ provisioning credential cannot mint a claim for, or revoke, a non-synthetic principal (FORBIDDEN), and cannot add peers, moderate joins, revoke grants, or act in an event (rejected: FORBIDDEN or AUTH_INVALID); no state changes", ["R-CONF-6"], "rejected; no state change"),
  // Interoperability (G7)
  T("PC-INTEROP-AB", "SG-3", "pair", "blocker", "Golden thread with Beta-A as home and Beta-B as host passes end to end (PEER-1, IDC-1..3, GRANT-1..2, ENF-1..2, RCPT-1)", ["R-CONF-2"], "all pass in SC-1"),
  T("PC-INTEROP-BA", "SG-3", "pair", "blocker", "Golden thread with Beta-B as home and Beta-A as host passes end to end", ["R-CONF-2"], "all pass in SC-2"),
  // Export and verification (G8)
  T("PC-EXP-1", "SG-4", "host", "major", "The host's ilp-export/1 bundle validates, is signed by the active kid, and additively includes grants.jsonl, revocations.jsonl, and claims.jsonl (consent-filtered, no email)", ["R-EV-25", "R-FED-9", "R-CORE-36"], "bundle verifies"),
  T("PC-VER-1", "SG-4", "pair", "blocker", "pc-verify accepts the complete packet offline with network denied, and rejects each negative packet for the stated reason", ["R-CORE-37", "R-CONF-1"], "exit 0; negatives non-zero"),
];

const profile = {
  id: "pc-0.1-s1",
  status: "candidate",
  spec_version: "0.0.2",
  title: "Project Connect slice 1 — governed remote participation (candidate)",
  claim_label: "exploratory",
  parameters: {
    revocation_bound_s: 60,
    fail_closed_after_s: 120,
    clock_skew_s: 300,
    claim_ttl_max_s: 86400,
    test_grant_ttl_max_s: 600,
    short_grant_ttl_s: 20,
    remote_session_policy: { on_stale_revocation_state: "pause", after_s_max: 120, $comment: "certification requires the pause policy within 2 × bound (R-FED-21a); asserted by PC-DISC-4" },
    pack: "unconference@1.1",
    permitted_action: "unconference.proposal",
    out_of_scope_probe: "unconference.vote",
    mandates_allowed_probe: { allowed: ["human_directed", "human_approved"], rejected: "standing_instruction" },
  },
  exclusions: [
    { what: "R-CORE-34(a) key storage outside the database", why: "not observable black-box", verification: "review" },
    { what: "R-OPS-11 build identity changes with deployed code", why: "requires a controlled rebuild", verification: "review" },
    { what: "transport/TLS", why: "D10: HTTP on loopback; transport not proven" },
    { what: "RFC 9421 request signing", why: "OI-3" },
    { what: "local login (§6.2)", why: "Identity-Home profile" },
    { what: "collaboration artifacts (§9)", why: "out of slice" },
    { what: "parliamentary and meeting packs", why: "out of slice" },
    { what: "three-node trio topology", why: "pc-*-trio" },
  ],
  scenarios: [
    { id: "SC-1", home: "beta-one", host: "beta-two", repetitions: 2, fresh_events: true },
    { id: "SC-2", home: "beta-two", host: "beta-one", repetitions: 2, fresh_events: true },
    { id: "SC-3", home: "pc-ref", host: "beta-one", repetitions: 2, fresh_events: true },
    { id: "SC-4", home: "beta-one", host: "pc-ref", repetitions: 2, fresh_events: true },
  ],
  nodes: {
    "beta-one": { base_url: "http://beta-one.localhost:4101", implementation: "interlateral-platform-beta" },
    "beta-two": { base_url: "http://beta-two.localhost:4102", implementation: "interlateral-platform-beta" },
    "pc-ref": { base_url: "http://pc-ref.localhost:4193", implementation: "project-connect-reference-node", $comment: "not 4190: that port is on the Fetch standard blocked-ports list (sieve)" },
  },
  actors: {
    $comment: "Actor and credential table (CDX-06). Credentials are provisioned at startup by each node's admin, outside the black-box run, and never appear in evidence.",
    synthetic_human: "Homed on the scenario's home node. On Beta: created through the SCR-1 synthetic-principal provisioning credential. On pc-ref: created through the runner's own node.",
    claim_minting: "POST /ilp/v1/claims on the home node, authenticated by the SCR-1 provisioning credential with on_behalf_of = the synthetic human.",
    operator_credential: "ilpo_ scoped conformance-operator credential: one test event on the host; approve/reject joins, revoke grants and tokens; revocable, audited.",
    peering_credential: "ilpf_ peering-scoped credential: add, suspend, reinstate, remove peers.",
    provisioning_credential: "ilpp_ SCR-1 credential: create principals marked synthetic, mint claims for them, revoke them. Never usable on non-synthetic principals.",
    events: "Created per scenario and repetition by the host's admin at startup: E1 (federated, live, remote allowed), E2 (same policy), E-short (grant_ttl_s = short_grant_ttl_s), E-mandate (mandates_allowed = [human_directed, human_approved]), E-excl (grant actions [proposal, vote], exclusions [vote]), E-private (private control), E-local (non-federated control with a local participant). Federation policy is set through federation_policy before the run.",
    non_synthetic_principal: "The host admin's own human global ID, given to the runner so PC-PROV-1 can attempt forbidden operations on it.",
    negative_claim_signer: "pc-aux — a second runner-owned reference node, peered with every node under test. The runner signs negative claims (NF-4, NF-6) with pc-aux's own key; no key of any node under test is ever used (R-CONF-1).",
    outage_control: "PC-REV-4 and PC-REV-5 stop and restart the home node through the local harness (declared ops drill; the host under test is never touched).",
  },
  interfaces: {
    discovery: "GET /.well-known/interlateral.json",
    peers_list: "GET /ilp/v1/federation/peers",
    peers_add: "POST /ilp/v1/federation/peers {base_url} [peering credential] (R-FED-3: base_url = scheme://host[:port])",
    federation_policy: "POST /ilp/v1/events/{event}/federation-policy {grant_ttl_s, mandates_allowed, grant_actions, grant_exclusions} [admin, setup only]",
    peers_state: "POST /ilp/v1/federation/peers/{host}/(suspend|reinstate|remove) [peering credential]",
    directory: "GET /ilp/v1/federation/events[?scope=aggregated]",
    claims: "POST /ilp/v1/claims {purpose, event, aud, agent, on_behalf_of, consent_accepted} [provisioning credential]",
    join: "POST /ilp/v1/events/{event}/join-requests {claim, consent_accepted?}",
    join_status: "GET /ilp/v1/events/{event}/join-requests/{id} [Bearer retrieval_key]",
    join_moderation: "GET /ilp/v1/events/{event}/join-requests; POST …/{id}/(approve|reject) [operator credential]",
    actions: "POST /ilp/v1/events/{event}/actions {kind, payload, mandate} [Bearer ilpt_; optional ILP-Grant header (SCR-2); Idempotency-Key]",
    grant_status: "GET /ilp/v1/grants/{id}/status",
    grant_refetch: "GET /ilp/v1/auth/grant [Bearer ilpt_]",
    grant_revoke: "POST /ilp/v1/grants/{id}/revoke [operator credential]",
    revocations: "GET /ilp/v1/federation/revocations?since=<seq> (public in 0.0.2; each record is signed)",
    synthetic: "POST /ilp/v1/admin/synthetic/humans {display_name, agent_display_name}; POST /ilp/v1/admin/synthetic/(humans|agents)/{id}/revoke [provisioning credential]",
    observables: "GET /ilp/v1/events/{event}/feed?since=; GET /ilp/v1/events/{event}/receipts",
    export: "POST /ilp/v1/events/{event}/exports; GET …/exports/{id} [operator credential]",
  },
  no_side_effect_observables: ["action count (feed records of kind action)", "feed latest_seq", "receipt head hash", "tallies", "artifact revision"],
  negative_fixtures: [
    { id: "NF-1", test: "PC-IDC-2", build: "an action with Authorization: Bearer <valid claim JWS>", expect: "AUTHZ_REQUIRED", step: 1 },
    { id: "NF-2", test: "PC-IDC-3", build: "submit the same claim twice", expect: "CLAIM_REPLAYED" },
    { id: "NF-3", test: "PC-IDC-3", build: "claim minted legitimately with aud = another host", expect: "CLAIM_AUDIENCE_MISMATCH" },
    { id: "NF-4", test: "PC-IDC-3", build: "claim signed by the runner-owned pc-aux node with exp in the past beyond skew", expect: "CLAIM_EXPIRED" },
    { id: "NF-5", test: "PC-IDC-3", build: "valid claim with one payload byte altered", expect: "SIGNATURE_INVALID" },
    { id: "NF-6", test: "PC-CORE-3", build: "reference-node claim with header alg none / alg HS256; claim with unpublished kid", expect: "SIGNATURE_INVALID; UNKNOWN_SIGNER" },
    { id: "NF-7", test: "PC-PEER-2", build: "claim from a node that is not a peer of the host", expect: "NOT_A_PEER" },
    { id: "NF-8", test: "PC-ENF-2", build: "unconference.vote under a proposal-only grant", expect: "GRANT_SCOPE_VIOLATION", step: 6 },
    { id: "NF-9", test: "PC-ENF-3", build: "E1 token + grant against E2", expect: "GRANT_EVENT_MISMATCH", step: 5 },
    { id: "NF-10", test: "PC-ENF-4", build: "ILP-Grant: a grant legitimately issued by another host", expect: "GRANT_AUDIENCE_MISMATCH", step: "4a" },
    { id: "NF-11", test: "PC-ENF-5", build: "ILP-Grant: own grant with one payload byte altered", expect: "SIGNATURE_INVALID", step: "4a" },
    { id: "NF-12", test: "PC-ENF-6", build: "ILP-Grant: a second participant's legitimate grant with the first participant's token", expect: "GRANT_BINDING_MISMATCH", step: 4 },
    { id: "NF-13", test: "PC-ENF-7", build: "act after a short-TTL grant has expired (wait short_grant_ttl_s + skew)", expect: "GRANT_EXPIRED", step: 4 },
    { id: "NF-14", test: "PC-ENF-8", build: "operator revokes the grant, then act", expect: "GRANT_REVOKED | AUTH_REVOKED" },
    { id: "NF-15", test: "PC-ENF-9", build: "act declaring standing_instruction under mandates_allowed = [human_directed, human_approved]", expect: "GRANT_SCOPE_VIOLATION + MANDATE_NOT_ALLOWED", step: 6 },
    { id: "NF-16", test: "PC-CORE-4", build: "out-of-scope vote while the event phase forbids voting", expect: "GRANT_SCOPE_VIOLATION", step: 6 },
    { id: "NF-17", test: "PC-ENF-10", build: "Authorization: Bearer <the participant's own grant JWS>", expect: "AUTH_INVALID", step: 1 },
    { id: "NF-18", test: "PC-ENF-10", build: "ILP-Grant: <own grant>, no Authorization header", expect: "AUTH_MISSING", step: 1 },
    { id: "NF-19", test: "PC-ENF-11", build: "vote on E-excl (listed in authorization_details and exclusions)", expect: "GRANT_SCOPE_VIOLATION", step: 6 },
    { id: "NF-20", test: "PC-ENF-11", build: "proposal number cap+1 under a proposal grant", expect: "VOTE_CAP_EXCEEDED | CONFLICT", step: 10 },
    { id: "NF-21", test: "PC-PROV-1", build: "ilpp_ used to mint a claim on behalf of the admin human; to approve a join; to add a peer", expect: "FORBIDDEN" },
    { id: "NF-22", test: "PC-REV-4", build: "admitted remote participant acts after the home has been unreachable for longer than the declared remote_session_policy.after_s (≤ 2 × bound; the pause policy is required by parameters.remote_session_policy)", expect: "REVOCATION_STATE_UNKNOWN", step: 4 },
  ],
  evidence_packet: {
    content_manifest: "content.json — format pc-evidence/1: profile id + sha256, spec version, subjects (build, deployment, discovery hash, keys), runner, files[], summary",
    content_root: "SHA-256 of JCS(content.json)",
    attestations: "ilp-attestation+jwt per node and per runner over content_root",
    envelope: "envelope.json — format pc-evidence-envelope/1: content manifest hash, content_root, attestation hashes",
    trust_inputs: "pinned out of band: node and runner key fingerprints, profile hash",
    verifier_report: "produced outside the packet",
  },
  tests,
};

// every test must be able to produce a schema-valid result carrying its declared traces
for (const t of tests) {
  const r = validate("test-result", { test_id: t.id, scenario: "SC-1", repetition: 1, status: "pass", traces: t.traces, started_at: "2026-09-27T00:00:00Z", elapsed_ms: 0, observations: {} });
  if (!r.ok) throw new Error(`${t.id}: a result with its declared traces is schema-invalid: ${r.errors.join("; ")}`);
}
mkdirSync(OUT, { recursive: true });
const json = JSON.stringify(profile, null, 2) + "\n";
writeFileSync(join(OUT, "pc-0.1-s1.json"), json);
const hash = sha256Hex(canonicalBytes(profile));
writeFileSync(join(OUT, "pc-0.1-s1.sha256"), `${hash}  pc-0.1-s1.json (JCS)\n`);
console.log(`profile pc-0.1-s1: ${tests.length} tests, JCS sha256 ${hash}`);
