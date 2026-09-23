# Project Connect Acceptance Profile v0.1

Status: discussion draft

This profile defines the first test that must pass before Project Connect may
claim both protocol conformance and implementation interoperability.

## Claims kept separate

Project Connect produces two distinct findings:

1. **Implementation conformance:** one implementation satisfies the normative
   requirements in the named Interlateral Protocol profile when tested as a
   black box.
2. **Pairwise interoperability:** two identified implementations successfully
   exchange and enforce the protocol objects required by this profile.

Passing one finding does not imply the other. A pairwise result names both
implementation builds and is not automatically transferable to later builds or
to a third implementation.

## Test subjects

- **Node A:** the production Interlateral Platform Alpha implementation through
  its bounded Project Connect adapter.
- **Node B:** an independently deployed Interlateral Platform Beta or later
  protocol-enabled implementation.
- **Runner V:** an independent black-box test runner and offline verifier.

Each node has a different hostname, signing key, database, administrator, and
deployment. The test must not use shared database access or private
implementation hooks.

## Required gates

### G0 - Reproducible identity

- Record the protocol profile version, public base URL, implementation name and
  version, build or commit identifier, deployment identifier, and test-run ID.
- Capture each node's discovery document, supported protocol versions, public
  verification keys, endpoint inventory, and advertised capabilities.
- Validate every captured object against the profile's schemas.

### G1 - Independent conformance

Runner V executes the same normative black-box test suite separately against A
and B. Required endpoint, schema, error, signature, time, idempotency, cursor,
authorization, receipt, revocation, and export tests must pass.

### G2 - Governed peering and discovery

- A and B establish an explicit, mutually approved peer relationship.
- B publishes a federated event; A obtains it through the protocol and displays
  the same global event identifier, home node, pack, version, status, policy,
  and update time.
- A publishes a second event and B discovers it, proving both directions.
- A private or non-federated control event does not cross either boundary.

### G3 - Remote identity and signed authorization

- A issues an audience-bound, short-lived identity claim for a synthetic human
  and, when present, that human's synthetic agent.
- B verifies the claim but does not treat identity as authority.
- B's event operator independently approves the remote participant.
- B issues a signed authorization grant that identifies the issuer, subject,
  human, agent when present, home node, event, permitted actions or role,
  constraints, issuance time, expiration, unique identifier, and revocation
  mechanism.
- The participant credential is bound to that grant; raw credential secrets are
  never included in the evidence packet.

### G4 - Authorized participation and receipts

- The remote participant performs an action allowed by the grant.
- B accepts it exactly once and returns a signed or hash-bound receipt.
- The receipt preserves the human, agent, home-node, event, authorization-grant,
  issuer, action, time, and result provenance.
- A duplicate idempotency key does not create a second action.
- The action appears consistently in B's event feed and final export.

### G5 - Enforcement and negative cases

Each case must fail with the expected stable problem code and must not create an
event action:

- valid identity with no authorization;
- an action outside the grant's scope;
- wrong audience or wrong event;
- expired grant;
- replayed single-use claim;
- tampered claim, grant, action, or receipt;
- revoked participant, agent, grant, or peer;
- unknown signer or unsupported protocol version.

The packet records the rejection but never records a reusable credential.

### G6 - Revocation and failure isolation

- Revoking the signed grant prevents the next attempted action within the
  profile's stated propagation bound.
- Suspending the peer prevents new cross-node admissions and applies the stated
  policy to existing remote participants.
- Taking either peer offline does not prevent the other node's local events or
  local participants from operating.

### G7 - Bidirectional proof

Repeat G3 through G6 with B as the participant's home and A as the event host.
This distinguishes genuine interoperability from a one-way import adapter.

### G8 - Offline evidence verification

- Close both test events and produce their export bundles.
- Runner V verifies schemas, content hashes, signatures, receipt chains,
  authorization links, revocations, event decisions, and origin provenance
  without database or administrator access.
- Runner V verifies the Project Connect evidence-packet manifest and all files.
- Re-running the verifier on unchanged bytes produces the same verdict.

## Passing verdict

The run passes only when:

- A and B each pass the required conformance suite;
- every required interoperability gate G2-G8 passes in both directions;
- all required negative tests fail in the expected way;
- no unresolved critical or high-severity deviation remains;
- the evidence packet is complete, internally hash-consistent, and verifies
  offline; and
- A, B, and Runner V sign attestations identifying the exact packet root hash.

The resulting claims are:

- `ILP-CONFORMANCE-v0.1` for the tested build of A;
- `ILP-CONFORMANCE-v0.1` for the tested build of B; and
- `ILP-INTEROP-PAIR-v0.1` for that exact A/B build pair.

These labels are provisional Project Connect test-result names, not third-party
certifications or warranties.

## Stop conditions

Stop the run and issue no passing verdict if:

- an implementation's identity cannot be tied to a stable build;
- required verification keys or schemas are unavailable;
- a raw secret appears in packet output;
- identity is accepted as authorization;
- an out-of-scope, expired, tampered, or revoked grant authorizes an action;
- a required negative test unexpectedly succeeds;
- the verifier needs private database access; or
- packet hashes, signatures, or node attestations do not verify.
