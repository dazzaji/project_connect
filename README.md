# Project Connect

Project Connect is the interoperability and conformance-testing project for the
first Interlateral Protocol-enabled implementations. Eventually, once this is stable and production-ready, the name should become something like "Interlateral Connect" and can have a simple certification mark for systems that conform to the protocol and are confirmed to be interoperable (ie they have permission to use an "Interlateral Connect" logo, can be listed in a directory of certified systems, and can be connected to the federation so their events and users and activities are part of the network). 

The initial purpose of this repo is to prove that independently operated platforms can use a
shared protocol to discover events, establish governed trust, admit remote
participants, preserve human and agent identity provenance, issue and verify
signed authorization, exchange receipts, and produce verifiable event records
without sharing a database or surrendering local control.

## Initial implementations

The first integration targets are:

- the production Interlateral Platform at `events.interlateral.com`, connected
  through a bounded protocol adapter; and
- the protocol-first Interlateral Platform beta/reference implementation at
  `open-events.interlateral.com`.

Project Connect is intended to test the protocol from the outside. Conformance
must be demonstrated through public protocol surfaces and observable behavior,
not through shared implementation internals.

## Initial scope

1. Instance discovery and protocol-version negotiation.
2. Explicit, allowlisted peer establishment.
3. Federated event directory publication and aggregation.
4. Audience-bound, short-lived remote identity claims.
5. Cryptographically signed authorization grants, distinct from identity
   claims, that state who granted what authority to which human or agent, for
   which event and actions, under what limits, and until when.
6. Host-controlled remote registration and approval.
7. Host-issued, event-scoped participant credentials bound to the signed grant,
   participant identity, agent identity when present, and home node.
8. Human, agent, authorization, and origin provenance in actions, receipts, and
   exports.
9. Signed authorization revocation, peer suspension, expiry, replay, and
   peer-failure behavior.
10. Black-box conformance tests and reproducible evidence.

Identity and authorization are separate protocol concerns. An identity claim
answers **who the principal is**. A signed authorization grant answers **whether
that principal may perform a particular action, who granted that authority, and
under which scope, mandate, constraints, and expiration**. A conforming
implementation must not infer authority merely from a valid identity claim.

## First success milestone

Two independently deployed implementations pass a shared conformance profile:

- an event created on one instance appears on the other;
- a verified participant from the second instance requests access;
- the event host approves the request and issues a signed, event-scoped
  authorization grant plus credentials bound to that grant;
- the remote participant completes an action permitted by the grant;
- an out-of-scope action is rejected;
- expired, replayed, tampered, or revoked authorization is rejected;
- authorization signatures and revocation evidence can be verified without
  trusting either implementation's private database; and
- the resulting receipt and export preserve the participant's home-instance
  identity, agent, authorization-grant, issuer, and action provenance and verify
  without database access.

The detailed first test and its proof requirements are discussion drafts:

- [Acceptance Profile v0.1](docs/ACCEPTANCE-PROFILE-v0.1.md)
- [Evidence Packet v0.1](docs/EVIDENCE-PACKET-v0.1.md)
- [Node Certification Evidence Pack v0.1](docs/NODE-CERTIFICATION-EVIDENCE-PACK-v0.1.md)

The result deliberately separates per-implementation conformance from pairwise
interoperability. The first passing run should yield two implementation results
and one result for the exact tested implementation pair.

## Project posture

- Each event has one authoritative home instance.
- Identity evidence from a peer does not confer authority on the host.
- Authorization is explicit, signed, scoped, time-bounded, independently
  verifiable, and revocable; possession of identity or credentials alone is not
  proof of authority.
- Each host retains admission, moderation, data, and publication control.
- Federation is explicit and governed; it is not an automatic open mesh.
- Participant content and remote protocol input are untrusted data.
- Protocol claims are supported by executable conformance tests.

## Status

Project initialization. The protocol profile, adapter boundaries, test harness,
and two-node demonstration plan will be developed in this repository.

## License

Apache License 2.0. See [LICENSE](LICENSE).
