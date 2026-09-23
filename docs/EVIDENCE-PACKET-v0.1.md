# Project Connect Evidence Packet v0.1

Status: discussion draft

The evidence packet is a portable, sanitized, independently verifiable record
of one Project Connect test run. It supports, but does not by itself guarantee,
the conformance and interoperability findings defined in the corresponding
acceptance profile.

## Design requirements

The packet must be:

- **self-identifying:** exact protocol profile, test suite, implementations,
  builds, deployments, and test-run ID;
- **tamper-evident:** every file is hashed in a canonical manifest and the root
  manifest is signed;
- **independently verifiable:** verification needs only packet bytes, published
  keys, and documented algorithms, not databases or administrator access;
- **privacy-preserving:** use synthetic participants and exclude reusable
  secrets, email addresses, OTP codes, session cookies, bearer tokens, private
  keys, and unnecessary infrastructure details;
- **inspectable:** preserve sanitized requests, responses, protocol objects,
  stable error codes, timestamps, and test assertions;
- **reproducible:** include verifier and test-suite versions plus commands or
  machine-readable instructions sufficient to repeat verification; and
- **honest about limits:** record skipped tests, deviations, warnings,
  environmental assumptions, and the exact scope of any passing verdict.

## Packet layout

```text
project-connect-run-<run-id>/
  README.md
  manifest.json
  manifest.sig
  profile/
    acceptance-profile.json
    schemas/
  implementations/
    node-a.json
    node-b.json
    runner.json
  discovery/
    node-a.json
    node-b.json
  conformance/
    node-a-results.json
    node-b-results.json
  interoperability/
    scenario.json
    assertions.json
    timeline.jsonl
  transcripts/
    sanitized-http.jsonl
    redaction-report.json
  objects/
    event-directory/
    identity-claims/
    authorization-grants/
    revocations/
    actions/
    receipts/
  negative-tests/
    results.json
  exports/
    node-a-event/
    node-b-event/
  verification/
    report.json
    report.md
  attestations/
    node-a.json
    node-b.json
    runner.json
```

Equivalent archive layouts are conforming if their manifest declares every
role and every required artifact can be located deterministically.

## Root manifest

`manifest.json` must contain at least:

- packet and acceptance-profile versions;
- globally unique run ID and start/end timestamps;
- A, B, and V identifiers, URLs, implementation/build versions, and public-key
  fingerprints;
- test-suite and verifier names, versions, and source identifiers;
- declared protocol versions and test profile;
- verdicts for each node and the pair;
- deviations, skipped tests, warnings, and review status;
- canonicalization, hash, and signature algorithms;
- every packet file's path, media type, size, SHA-256 digest, and evidence role;
- the packet root digest; and
- references to the three attestations.

The manifest itself must use a documented canonical encoding before signing.
The eventual machine-readable schema will fix the precise algorithm and object
shape rather than leaving implementers to infer them from this prose.

## Evidence roles

### Implementation identity

Node records identify the exact software and deployment under test. A result
must never silently apply to `latest`, an unrecorded working tree, or a later
build.

### Discovery and peering

Capture the discovery documents as observed by Runner V, their signatures or
transport evidence, key fingerprints, the peer-state transitions, and the
directory entries as published and as consumed.

### Identity evidence

Use synthetic identities. Preserve the signed claim and validation result when
that can be done without exposing private data. Record issuer, audience,
subject, agent, purpose, event, times, claim identifier, signature algorithm,
key identifier, and revocation status.

### Authorization evidence

Preserve the signed authorization grant separately from the identity claim. At
minimum it records:

- issuer and signing-key identifier;
- human subject and agent subject when applicable;
- home node and authoritative event host;
- event and role or permitted actions;
- mandate or delegation context where applicable;
- constraints and explicit exclusions;
- issuance, not-before, expiration, and unique grant identifier;
- parent grant when authority is delegated;
- credential-binding fingerprint, never the credential itself; and
- status or revocation reference.

The packet must show signature validation and the authorization decision used
for both the accepted action and every rejected negative test.

### Transaction transcripts

Preserve sanitized request and response method, URL path, selected headers,
body, status, stable problem code, timestamp, correlation ID, and body hash.
Remove cookies, bearer credentials, OTPs, API keys, private host details, and
unnecessary personal data. `redaction-report.json` states what classes were
removed and confirms that the retained fingerprints are non-reusable.

### Receipts and exports

Receipts connect accepted actions to identity, authorization, origin, event
state, and result. Final event exports contain the same action and provenance.
The verifier must detect a missing action, altered content, broken receipt
chain, unknown signer, or mismatched authorization reference.

### Negative evidence

A protocol is not proven merely because its happy path works. Preserve the
inputs, expected errors, observed errors, and no-side-effect checks for every
required negative case in the acceptance profile.

### Attestations

Each node operator signs a statement naming:

- the node and exact build tested;
- the run ID and packet root digest;
- the operator's role in the test;
- whether prohibited shared state or private hooks were used; and
- disclosed deviations or qualifications.

Runner V separately signs the test and verification verdict. Attestations make
the actors accountable for the claimed test conditions; they do not replace
the underlying machine-verifiable evidence.

## Public and sealed material

The normal packet should be safe to publish. If operational investigation needs
sensitive material, place it in a separately encrypted annex with its own
manifest and access policy. A passing public verdict must not depend on access
to that annex.

## Verification output

The offline verifier returns a non-zero exit status on failure and emits both
machine-readable JSON and concise Markdown. Its report must distinguish:

- packet integrity;
- Node A conformance;
- Node B conformance;
- A-to-B interoperability;
- B-to-A interoperability;
- authorization enforcement;
- revocation and failure isolation;
- export and provenance verification;
- deviations and skipped tests; and
- final qualified verdict.

The verifier must never turn an incomplete packet into a passing result merely
because the missing evidence was not evaluated.
