# Node Certification Evidence Pack v0.1

Status: discussion draft

## 1. Purpose

This specification defines the evidence a candidate Interlateral node must
produce and provide when requesting certification and listing as a participant
in an Interlateral federation.

The pack supports a decision; it does not make the decision automatically. A
candidate's self-produced files are assertions until the federation verifies
their signatures, repeats required tests, conducts a fresh live challenge, and
issues a separate signed decision record.

Certification is limited to the exact node, implementation build, protocol
profile, capabilities, and time period named in that decision. It is not a
general warranty of software quality, security, legality, availability, or
future compatibility.

## 2. Roles

- **Candidate Node (N):** the independently operated implementation requesting
  certification and listing.
- **Approved Peer (P):** an already accepted implementation that completes the
  required two-way interoperability test with N.
- **Verifier (V):** the federation test runner or appointed independent reviewer
  that validates the pack and repeats the required tests.
- **Certification Authority (F):** the federation role that signs the admission
  decision and controls the authoritative node listing. Initially this may be
  performed by the federation organizer; the role should later be governed by
  the federation's common agreement.

No role may treat a valid identity claim as proof of authorization. Signed
authorization, scope enforcement, expiration, and revocation are independently
tested.

## 3. Required certification findings

A candidate may be certified only when the evidence supports all three:

1. **Conformance:** N satisfies the required Interlateral Protocol profile as a
   black-box implementation.
2. **Interoperability:** N and P complete the required two-way protocol flow,
   with each serving as participant home and event host.
3. **Operational trust readiness:** N can protect keys and credentials, respond
   to revocation and incidents, preserve privacy and provenance, and maintain
   accurate public discovery and operator information.

## 4. Submission package

The candidate submits one deterministic archive with this logical layout:

```text
node-certification-<node-id>-<submission-id>/
  README.md
  manifest.json
  manifest.sig
  candidate/
    node.json
    operator.json
    implementation.json
    capabilities.json
  protocol/
    discovery.json
    schemas.json
    public-keys.json
  conformance/
    profile.json
    results.json
    report.md
  interoperability/
    peer.json
    scenario.json
    results.json
    sanitized-http.jsonl
    timeline.jsonl
  authorization/
    identity-claim.json
    authorization-grant.json
    accepted-action.json
    accepted-receipt.json
    out-of-scope-rejection.json
    revocation.json
    post-revocation-rejection.json
  exports/
    event-export/
    offline-verification.json
  operations/
    federation-policy.md
    security-and-key-management.md
    incident-and-revocation.md
    privacy-and-retention.md
    continuity.md
  attestations/
    candidate.json
    peer.json
  redaction-report.json
```

Equivalent layouts are acceptable only when the manifest maps every required
evidence role to exactly one file or declared collection.

## 5. Manifest and integrity

`manifest.json` must identify:

- evidence-pack specification version;
- unique submission and test-run identifiers;
- node identifier, canonical URL, operator, and contact URL;
- exact implementation version, source revision or immutable build identifier,
  deployment identifier, and build time;
- protocol profile and versions claimed;
- supported procedure packs and optional capabilities;
- approved peer and exact peer build used in the interoperability test;
- conformance and interoperability test-suite versions;
- every file's path, evidence role, media type, byte length, and SHA-256 digest;
- redactions, omitted evidence, deviations, warnings, and failed or skipped
  tests; and
- canonicalization, signature algorithm, signing-key identifier, and submission
  root digest.

The candidate signs the canonical manifest with the same node identity, or a
documented operator key bound to that identity, that the federation can resolve
independently. Changing any packet byte invalidates the manifest.

## 6. Candidate and operator evidence

The candidate must provide:

- stable node identifier and canonical HTTPS base URL;
- operator name, jurisdiction when applicable, public policy URL, incident
  contact URL, and authority to operate the node;
- implementation name, version, source or build provenance, and deployment
  identity;
- live discovery document and public verification keys;
- supported protocol and procedure-pack versions;
- declared data, identity, authorization, federation, export, and revocation
  capabilities; and
- all material limitations or extensions that could affect peers.

Personal home addresses, unnecessary personal identifiers, passwords, and
private contact details must not be included.

## 7. Conformance evidence

The candidate supplies the complete result of the named conformance profile,
including machine-readable assertions and concise human-readable findings.

Evidence must cover required endpoints, schemas, version negotiation, stable
errors, signatures, canonicalization, time checks, idempotency, replay defense,
cursors or feeds, identity, signed authorization, receipts, revocation, export,
and offline verification.

Raw pass counts without the underlying assertions, test-suite identity, and
observable request/response evidence are insufficient.

## 8. Two-way interoperability evidence

N and P must complete the current Project Connect acceptance profile in both
directions:

1. establish explicitly approved peering;
2. discover one another's federated events while excluding private controls;
3. exchange a short-lived, audience-bound identity claim;
4. make an independent host admission decision;
5. issue a signed, event-scoped authorization grant distinct from identity;
6. accept an action that the grant permits and produce a verifiable receipt;
7. reject an action outside the grant's scope;
8. reject tampered, expired, replayed, wrong-audience, and revoked material;
9. enforce revocation within the profile's bound;
10. preserve operation of local events during peer failure; and
11. produce an event export whose identity, authorization, action, receipt, and
    origin provenance verifies offline.

The approved peer signs its attestation over the shared run and packet root.
The peer attestation does not replace independent federation verification.

## 9. Signed authorization evidence

The pack must preserve a non-secret example authorization grant containing:

- issuer and verification-key identifier;
- human subject and agent subject when applicable;
- home node and authoritative event host;
- event, role, and permitted actions;
- mandate or delegation context where applicable;
- material constraints and explicit exclusions;
- issuance, not-before, expiration, and unique grant identifier;
- parent grant when authority is delegated;
- non-reusable credential-binding fingerprint; and
- status or revocation reference.

The packet must connect this grant to the accepted action and receipt, and must
show the authorization decision used for an out-of-scope rejection and a
post-revocation rejection.

## 10. Operational trust evidence

The candidate supplies short, accurate statements covering:

- signing-key generation, storage, rotation, compromise, and retirement;
- credential handling and secret-free logging;
- revocation publication and response expectations;
- incident reporting, operator availability, and peer suspension contacts;
- privacy, consent, retention, deletion, and export boundaries;
- backup, restore, continuity, and orderly shutdown or withdrawal; and
- how discovery metadata and federation policy changes are published.

These statements are commitments made for federation admission. Materially
false, stale, or breached commitments may support suspension or removal.

## 11. Privacy and prohibited contents

Use synthetic participants wherever possible. The public pack must not contain:

- passwords, OTP codes, bearer tokens, API keys, session cookies, or private
  signing keys;
- reusable participant credentials;
- personal email addresses or unnecessary personal data;
- database dumps or unrestricted infrastructure access details; or
- confidential peer data unrelated to the test.

Requests and responses must retain the fields necessary to verify protocol
behavior while replacing secrets with non-reusable fingerprints. The redaction
report identifies every redaction class and the screening tools used.

A separately encrypted annex may support incident investigation, but a passing
public certification decision must not depend on access to that annex.

## 12. Federation verification procedure

V must not accept the submission solely on the candidate's report. V performs:

1. archive, schema, manifest, hash, and signature validation;
2. live resolution of N's discovery document and keys;
3. comparison of the live node with the exact submitted build and capabilities;
4. independent replay of offline receipt and export verification;
5. a fresh, unpredictable nonce challenge signed by N;
6. a fresh conformance run against N's public protocol surface;
7. a fresh two-way interoperability run with P or another approved peer;
8. required negative authorization, tamper, replay, expiry, and revocation
   tests; and
9. secret/privacy screening of the candidate's public packet.

V emits its own signed verification report. Candidate-produced evidence and
verifier-produced evidence remain distinguishable in the final record.

## 13. Decision and listing record

F issues a signed decision with one status:

- `certified`;
- `certified_with_conditions`;
- `deferred`;
- `denied`;
- `suspended`;
- `withdrawn`; or
- `expired`.

A certification decision identifies the node, operator, canonical URL, exact
implementation build, protocol profile and versions, supported capabilities,
submission root digest, verifier report digest, decision time, expiration time,
conditions, and appeal or reconsideration path.

The public federation listing must expose at least:

- node identifier, name, canonical URL, and operator;
- certification status and scope;
- protocol and pack versions;
- certification and expiration dates;
- federation-policy and incident-contact URLs;
- evidence-pack root digest and decision-record URL; and
- current signing-key fingerprints or discovery-document URL.

## 14. Passing criteria

Certification requires:

- a complete, valid, secret-free candidate pack;
- conformance to every required item in the named profile;
- successful two-way interoperability with an approved peer;
- correct signed-authorization enforcement and revocation;
- successful independent live challenge and verifier rerun;
- no unresolved critical or high-severity security, privacy, integrity, or
  provenance finding;
- signed candidate, peer, and verifier attestations; and
- a signed decision by F.

Missing evidence, a self-generated report without independent replay, or a
successful happy path without required rejection tests cannot produce a passing
decision.

## 15. Renewal, change, suspension, and withdrawal

Certification expires on the date in the decision. Earlier retesting is
required after a material protocol-version change, signing-key compromise,
canonical-host change, implementation replacement, authorization-model change,
or other change that could invalidate the evidence.

The federation may suspend a listing while investigating key compromise,
incorrect authorization, materially false evidence, failure to honor
revocation, or a serious policy breach. Suspension and reinstatement must be
signed, timestamped, reasoned, and linked from the listing.

An operator may withdraw voluntarily. Withdrawal stops new federation trust but
does not erase historical receipts, evidence, or the fact and timing of the
former certification.
