# Roadmap

The specification is a working draft (`0.0.2`) and the conformance profiles are
candidates. Every result this repository produces is a **candidate result only.
Nothing here is certified.** A job status of `succeeded`, a verifier `PASS`, and
a discovery field value are not certification.

## Usable now

Each of these has a tested walkthrough in the [README Quickstart](README.md#quickstart).

1. **Reference node and discovery.** Start `reference-node/main.mjs` on
   loopback and read `/.well-known/interlateral.json`.
2. **Standalone conformance job service and runner.** Register nodes you
   control, submit a job, and get a report with per-test rows, counts, and a
   `qualification` (`partial` unless every profile test was selected). Loopback
   only, one job at a time, targets on the same machine.
3. **Evidence packet export and offline verification.** Copy a job's
   `pc-evidence/1` packet out, verify it with `verifier/cli.mjs` against pinned
   trust roots, and see a copy with one flipped bit rejected.

## Not yet usable

- **Formal acceptance gates:** frozen-profile conformance and the formal
  acceptance of the two-way test in section 1 below.
- **Certification:** certification awards, a certification mark, a directory
  of certified systems, and federation admission. The certification record in
  [docs/core-service-profile.md](docs/core-service-profile.md) is a proposal.
- **Multi-party interoperability:** interoperability results between
  independently operated implementations, including the two-way test below and
  the three-way test under Possible Future Work.
- **Whole-profile results on reference nodes:** the outage and key drill tests
  run only through a harness control API, so a job on two reference nodes stays
  `partial`.
- **A hosted or continuous conformance service,** targets on other machines, and
  the job service on Linux (untested) or Windows (unsupported).
- **Everything under Possible Future Work and Prospective Additional Work.**

## 1. Two-Way Conformance and Interoperability Test

**Status: not yet usable. Preparatory implementations and test tooling delivered as drafts; formal acceptance remains open as of 2026-10-23.**

The current work has produced draft protocol, platform and federation-service
implementations, together with conformance, interoperability and evidence tooling.
Local rehearsals support that build-out, but the remaining formal acceptance and
cross-platform interoperability checks are unfinished. This is not a completed
two-way conformance result or certification.

Conduct a two-way test that:

- tests each of two Interlateral Platform implementations for conformance to the Interlateral Protocol; and
- tests interoperability between those two implementations according to the protocol.

# Possible Future Work

Not yet usable.

- Three-way interoperability testing in which one participating implementation is a continuous test service offered by the federation.

# Prospective Additional Work

Not yet usable. These are proposals for implementation quality and later qualification, not new
acceptance requirements or blockers for the current exploratory `pc-0.1-s1`
sprint. Existing in-scope protocol requirements remain mandatory. Any broader
protocol or conformance-profile requirements need a separately reviewed scope
and version; internal design choices are not federation admission rules by
default.

## 1. Explicit Architecture Contracts

- **What and why:** Document module responsibilities, data ownership, allowed
  dependencies, and stable interfaces so federation can evolve without coupling
  every feature to engine internals. Preserve the modular-monolith option; this
  does not require microservices or a particular implementation architecture.
- **Initial approach:** Describe the as-built design, record consequential
  design decisions, and replace undocumented cross-module access with deliberate
  interfaces where useful.
- **How to test:** Review actual dependencies against the documented boundaries;
  use automated boundary checks and interface tests for the chosen design.

## 2. Extensibility Beyond the Tested Event Type

- **What and why:** Demonstrate that federation and authorization support other
  procedure packs, rather than merely the action vocabulary used by the first
  unconference test. This enables different activities without special-case
  federation code.
- **Initial approach:** Derive capabilities and grants from explicit pack and
  event policies. Add another pack without changing generic federation or engine
  semantics, retaining versioned pack definitions.
- **How to test:** Exercise a second pack with different actions and roles across
  nodes; verify permitted actions, rejected actions, receipts, and exports.

## 3. Concurrency and Integrity Qualification

- **What and why:** Extend assurance beyond sequential examples to simultaneous
  approval, revocation, retries, and participant actions. Define precisely when
  an action becomes authorized and committed, so races cannot produce duplicate
  effects or evidence inconsistent with the resulting state.
- **Initial approach:** Document transaction boundaries and ordering guarantees;
  use appropriate locks, constraints, idempotency, and shared policy evaluation.
  Do not silently strengthen or change the protocol's revocation semantics.
- **How to test:** Use controlled concurrent requests and injected failures at
  transaction boundaries. Check action counts, grant status, feed ordering,
  receipt chains, and exports against the declared guarantees. A discovered
  violation of a current required invariant is a current defect, not deferred
  merely because this broader qualification is prospective.

## 4. Recovery and Bounded Federation Resource Use

- **What and why:** Ensure restarts, slow peers, malformed responses, and prolonged
  outages do not lose revocation progress or exhaust local resources. Extend the
  current slice's outage-isolation checks to sustained operation.
- **Initial approach:** Persist synchronization progress; bound polling
  concurrency, response sizes, and timeouts; use controlled retries and safe
  peer-fetch policies. Keep loopback test allowances distinct from deployed
  network policy.
- **How to test:** Restart nodes mid-sync; simulate slow or unavailable peers,
  malformed feeds, and repeated retries. Verify recovery, declared freshness
  behavior, bounded resource use, and continued local-event operation.

## 5. Safe Upgrades and Operational Readiness

- **What and why:** Preserve existing events, credentials, and verifiable evidence
  across upgrades, recovery, and key rotation. A fresh installation passing tests
  does not establish that an existing deployment can be upgraded safely.
- **Initial approach:** Check readiness against the required migration set;
  document supported upgrade and recovery paths; retain the public keys needed
  for historical verification; establish backup and restore procedures.
- **How to test:** Upgrade a populated earlier version, repeat migration commands,
  interrupt an upgrade, restore a backup, and rotate signing keys. Confirm data
  integrity and verification of historical and newly generated evidence.

## 6. Separate Engineering-Quality Acceptance

- **What and why:** Assess maintainability, policy duplication, coupling, and
  test-specific shortcuts separately from protocol conformance. A valid local
  interoperability result must not be presented as production-readiness proof.
- **Initial approach:** Introduce a scoped design review and engineering checklist
  for a later implementation-readiness milestone. Give material design risks a
  documented disposition rather than treating them automatically as style nits.
  Select applicable operational and performance targets for deployment
  qualification instead of adding them implicitly to this exploratory sprint.
- **How to test:** Review the integrated implementation, test ordinary lifecycle
  paths without privileged test hooks, and measure agreed latency, resource, and
  recovery targets under a declared workload. Report engineering qualification
  separately from protocol-profile and interoperability verdicts.
