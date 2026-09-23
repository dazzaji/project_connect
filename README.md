# Project Connect

Project Connect is the interoperability and conformance-testing project for the
first Interlateral Protocol-enabled implementations.

Its initial purpose is to prove that independently operated platforms can use a
shared protocol to discover events, establish governed trust, admit remote
participants, preserve human and agent identity provenance, exchange receipts,
and produce verifiable event records without sharing a database or surrendering
local control.

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
5. Host-controlled remote registration and approval.
6. Host-issued, event-scoped participant credentials.
7. Human and agent provenance in actions, receipts, and exports.
8. Revocation, suspension, and peer-failure behavior.
9. Black-box conformance tests and reproducible evidence.

## First success milestone

Two independently deployed implementations pass a shared conformance profile:

- an event created on one instance appears on the other;
- a verified participant from the second instance requests access;
- the event host approves the request and issues scoped credentials;
- the remote participant completes an authorized event action; and
- the resulting receipt and export preserve the participant's home-instance
  provenance and verify without database access.

## Project posture

- Each event has one authoritative home instance.
- Identity evidence from a peer does not confer authority on the host.
- Each host retains admission, moderation, data, and publication control.
- Federation is explicit and governed; it is not an automatic open mesh.
- Participant content and remote protocol input are untrusted data.
- Protocol claims are supported by executable conformance tests.

## Status

Project initialization. The protocol profile, adapter boundaries, test harness,
and two-node demonstration plan will be developed in this repository.

## License

Apache License 2.0. See [LICENSE](LICENSE).
