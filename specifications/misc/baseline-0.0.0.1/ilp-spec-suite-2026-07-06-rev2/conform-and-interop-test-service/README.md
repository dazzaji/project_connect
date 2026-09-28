# ILP Conformance and Interoperability Test Service

**Status:** Draft specification  
**Date:** 2026-07-06  
**Purpose:** Define an easy-to-use server application that can test Interlateral Platform implementations for protocol conformance and federation interoperability without itself being a full Interlateral implementation.

## 1. Summary

The **ILP Conformance and Interoperability Test Service** is a lightweight server that acts as:

1. a black-box conformance probe runner against a target Interlateral instance;
2. a mock Interlateral peer instance for federation tests;
3. a synthetic user/agent generator;
4. a telemetry and evidence collector;
5. an operator-friendly web dashboard for running and understanding tests.

It is not a production Interlateral platform. It does not need to host real events, maintain real communities, publish real artifacts, or serve real participants. It only implements enough of the ILP protocol surface to test whether another platform correctly speaks the protocol in both directions.

This service should be usable by:

- Dazza testing the new Digital Ocean v2 instance;
- Dazza testing the Google Cloud v2 instance;
- an external Platform Host testing their own independently built instance;
- a developer building Interlateral v2 locally;
- a federation operator verifying whether a candidate peer is safe enough to join the initial federation.

## 2. Design Principle

The tester must test the **wire-visible protocol**, not the implementation internals.

It should treat the target implementation as a black box and interact only through:

- public discovery documents;
- ILP APIs under `/ilp/v1/`;
- served SKILL documents;
- federation endpoints;
- OpenAPI and JSON Schema documents;
- exported evidence bundles;
- user-visible browser flows where browser acceptance is required.

It must not require database access, SSH access, source-code access, or private implementation hooks, except for clearly marked local-development conveniences.

## 3. Core Use Cases

### 3.1 Smoke Test a New Instance

An operator enters a base URL such as `https://events-v2.interlateral.com`.

The service checks:

1. discovery document exists;
2. OpenAPI document exists;
3. schemas are reachable and parse;
4. health/readiness endpoints work;
5. basic error format is correct;
6. event listing endpoint responds;
7. no obvious user-agent/CDN blocking exists.

Result: a quick pass/fail dashboard and downloadable report.

### 3.2 Test Target as Host of a Remote Participant

The tester acts as a **remote home instance**.

Flow:

1. Tester publishes `/.well-known/interlateral.json`.
2. Target peers with tester.
3. Tester mints a signed identity claim for a synthetic verified human and agent.
4. Tester posts a remote join request to the target's event.
5. Target operator approves.
6. Tester retrieves the participant token.
7. Tester synthetic agent submits valid actions to the target event.
8. Tester verifies receipts, provenance, feeds, export data, revocation behavior.

This proves the target can host remote participants.

### 3.3 Test Target as Home of a Remote Participant

The tester acts as a **remote host instance**.

Flow:

1. Tester publishes one or more federated mock events.
2. Target aggregates tester's directory.
3. A target-side user requests to join tester's mock event.
4. Target mints an identity claim.
5. Tester validates the claim and simulates approval/rejection.
6. Target UI/API shows status and retrieves mock participant credentials.

This proves the target can send its users into remote events.

### 3.4 Three-Instance Federation Rehearsal

The tester can emulate B and C while the target acts as A, or emulate C while real A and B are under test.

The service should support:

- multiple mock instances with independent hostnames/ports, keys, and discovery documents;
- pairwise peering;
- independent mock event directories;
- scripted remote join requests in several directions;
- depeering/suspension scenarios;
- version mismatch scenarios;
- revocation feed scenarios.

### 3.5 External Collaborator Certification

An external collaborator deploys their own Interlateral implementation and points the tester at it.

The tester produces:

- machine-readable JSON result;
- human-readable Markdown report;
- optional JUnit XML for CI;
- evidence bundle with HTTP transcripts, schemas used, signatures, and timestamps;
- compatibility badge status: `not-tested`, `smoke-pass`, `single-instance-pass`, `federation-host-pass`, `federation-home-pass`, `trio-ready`.

## 4. Product Shape

### 4.1 Components

1. **Admin Web UI**
   - wizard-driven test setup;
   - target instance registry;
   - mock peer registry;
   - run dashboard;
   - live logs;
   - evidence export;
   - pass/fail explanations.

2. **Probe Runner**
   - runs black-box protocol tests against a target;
   - validates HTTP status, JSON shape, schema conformance, headers, error documents, feeds, receipts, exports;
   - supports repeatable test runs.

3. **Mock Peer Server**
   - exposes a programmable subset of ILP endpoints;
   - can act as home instance, host instance, or both;
   - has independent keys, discovery document, federation directory, claims, revocations, and join-request handling.

4. **Synthetic Actor Engine**
   - creates synthetic humans, agents, license plates, claims, actions, votes, motions, and artifact writes;
   - can simulate local users, remote users, and agents;
   - can generate malicious/invalid cases for negative tests.

5. **Telemetry Collector**
   - stores HTTP transcripts, feed records, receipts, timing data, errors, redirects, headers, schema validation results, and UI screenshots.

6. **Evidence Reporter**
   - creates Markdown, JSON, and JUnit-style reports;
   - signs reports with the tester's key when configured;
   - emits a clear compatibility result.

7. **Browser Runner**
   - Playwright or equivalent;
   - tests user-visible flows such as login, remote join disclosure, operator approval, token retrieval, event creation, and export download.

### 4.2 Non-Goals

The service does not:

- implement a full event engine;
- host real production events;
- replace G7 executable conformance tests inside the real implementation;
- act as a federation registry for production;
- make trust decisions for Dazza;
- store real participant communities;
- require access to private databases or source code.

## 5. Admin UI/UX Specification

### 5.1 Navigation

The app should have these primary pages:

1. **Dashboard**
   - recent runs;
   - compatibility status by target;
   - failures needing attention;
   - quick start buttons.

2. **Targets**
   - add/edit target Interlateral instance;
   - base URL;
   - environment label;
   - optional admin/bootstrap/test credentials;
   - email capture configuration;
   - notes and owner.

3. **Mock Nodes**
   - create mock node;
   - hostname/public URL;
   - keys;
   - federation policy URL;
   - supported protocol versions;
   - supported packs;
   - mock event directory;
   - revocation feed state.

4. **Test Runs**
   - choose target;
   - choose test profile;
   - configure actors;
   - start/pause/cancel;
   - live step log;
   - HTTP transcript viewer;
   - failures with exact request/response.

5. **Evidence**
   - reports;
   - exported bundles;
   - screenshots;
   - signed result manifests;
   - downloadable artifacts.

6. **Settings**
   - SMTP/mailbox test settings;
   - TLS/public URL settings;
   - key rotation;
   - retention policy;
   - redaction policy.

### 5.2 Test Profiles

The UI should offer these profiles:

1. **Quick Smoke**
   - discovery, OpenAPI, health, schema parse, error shape, no UA block.

2. **Single Instance Core**
   - identity, event creation, action feed, receipts, export, collaboration basics.

3. **Target as Host**
   - tester sends remote join claims to target; target hosts tester's synthetic participants.

4. **Target as Home**
   - target sends users to tester's mock federated events.

5. **Federation Trio Rehearsal**
   - target plus two mock nodes, or target plus one real peer plus one mock node.

6. **Parliamentary Readiness**
   - mock users/agents perform parliamentary motion, second, debate, vote, minutes, resolution, export checks.

7. **Unconference Readiness**
   - proposals, capped voting, winner selection, artifact collaboration, export checks.

8. **Negative/Security Tests**
   - replayed claims, wrong audience, expired claims, unsupported protocol, suspended peer, malicious strings, token revocation.

9. **SLO Probe**
   - latency, feed lag, directory freshness, revocation window, export verification time.

### 5.3 Operator Experience Requirements

- A first-time operator should be able to run Quick Smoke in under 10 minutes.
- Each failure must show:
  - test step;
  - expected result;
  - actual result;
  - HTTP request/response;
  - likely cause;
  - link to relevant ILP requirement.
- Reports must distinguish:
  - specification failure,
  - target implementation failure,
  - tester misconfiguration,
  - environmental failure,
  - manual step pending.
- The dashboard must never show a target as "compatible" unless the selected profile passed fully.

## 6. Mock Peer Protocol Surface

The mock server should implement enough endpoints to test federation in both directions.

### 6.1 Required Public Endpoints

- `GET /.well-known/interlateral.json`
- `GET /ilp/v1/openapi.json`
- `GET /ilp/v1/federation/peers`
- `GET /ilp/v1/federation/events`
- `GET /ilp/v1/federation/revocations?since=`
- `GET /ilp/v1/events/{id}`
- `GET /events/{slug}/skill.md`
- `GET /ilp/v1/events/{id}/feed?since=&wait=`

### 6.2 Required Federation Endpoints

- `POST /ilp/v1/federation/peers`
- `POST /ilp/v1/federation/peers/{peer}:suspend`
- `POST /ilp/v1/federation/notify`
- `POST /ilp/v1/events/{id}/join-requests`
- `GET /ilp/v1/events/{id}/join-requests/{id}`

### 6.3 Required Synthetic Action Endpoints

When acting as a mock host, the tester should accept a bounded subset:

- `POST /ilp/v1/events/{id}/actions`
- `GET /ilp/v1/events/{id}/actions`
- `GET /ilp/v1/events/{id}/receipts`
- `POST /ilp/v1/events/{id}/exports`
- `GET /ilp/v1/events/{id}/exports/{id}`

The mock action engine may be deterministic and shallow. It only needs to prove protocol behavior, not rich event semantics.

### 6.4 Required Claim Behavior

When acting as a mock home, the tester must:

- generate Ed25519 keys;
- publish discovery keys;
- mint valid identity claims;
- mint expired claims;
- mint wrong-audience claims;
- mint replayable claims;
- revoke claims/humans/agents/plates through revocation feed;
- verify that target handles each case correctly.

## 7. Target Interaction Modes

### 7.1 Black-Box Mode

The tester has only:

- target base URL;
- public endpoints;
- no admin access.

Can run:

- discovery;
- schema checks;
- event listing;
- public federation directory;
- public error shape;
- public skill checks.

### 7.2 Operator-Assisted Mode

The tester has:

- target base URL;
- a human operator performing approval steps;
- maybe no admin token.

Can run:

- remote join request;
- approval/rejection;
- token retrieval;
- participant action;
- export if operator manually triggers export.

### 7.3 Admin-Automated Mode

The tester has:

- target base URL;
- admin or event-creator credential;
- test email capture path;
- ability to create disposable test events.

Can run:

- most single-instance conformance;
- event creation from YAML;
- operator actions;
- full federation mock tests;
- export verification;
- cleanup/archive.

### 7.4 CI Mode

The tester runs inside the implementation CI with:

- clean DB reset hook;
- SMTP catcher;
- deterministic clock;
- local mock nodes.

Can run:

- strict executable conformance;
- high-volume concurrency;
- SLO probes;
- negative security cases.

## 8. Evidence and Reporting

Every test run must produce:

1. `run.json`
   - target;
   - tester version;
   - spec version;
   - profile;
   - start/end time;
   - pass/fail;
   - step results;
   - requirement IDs covered;
   - artifacts.

2. `report.md`
   - human-readable summary;
   - failures sorted by severity;
   - exact remediation suggestions.

3. `transcripts.jsonl`
   - redacted HTTP request/response records;
   - timestamps;
   - correlation IDs.

4. `evidence/`
   - discovery docs;
   - schemas used;
   - OpenAPI document;
   - screenshots if browser tests ran;
   - export bundles if created;
   - signature verification logs.

5. Optional:
   - `junit.xml`;
   - signed result manifest;
   - compatibility badge JSON.

Secrets must be redacted by default:

- OTP codes;
- participant tokens;
- session cookies;
- private keys;
- raw emails unless explicitly authorized for private reports.

## 9. Data Model for the Tester

Minimal tables or collections:

- `targets`
- `mock_nodes`
- `mock_keys`
- `mock_events`
- `synthetic_actors`
- `test_runs`
- `test_steps`
- `http_transcripts`
- `evidence_artifacts`
- `reports`
- `operator_notes`

Retention defaults:

- full transcripts retained 30 days;
- redacted reports retained until deleted;
- private keys rotated or deleted on mock-node deletion;
- no production participant data imported.

## 10. Security Requirements

- The tester is a testing tool and must not be publicly open by default.
- Admin UI requires login.
- Target credentials are encrypted at rest or stored only in memory if operator selects ephemeral mode.
- Mock private keys are isolated per mock node.
- Reports redact secrets.
- The tester must clearly label mock data so no one mistakes it for real event data.
- The tester must never join or mutate production events unless the operator explicitly confirms.
- Destructive tests require a second confirmation.
- Public mock-node endpoints may be exposed for federation testing, but admin controls remain private.

## 11. Implementation Recommendation

Recommended simple stack:

- Node.js / TypeScript;
- Fastify or Express;
- SQLite for local/small server deployments, Postgres optional;
- Playwright for browser tests;
- AJV for JSON Schema validation;
- jose or equivalent for EdDSA JWTs;
- pino-style structured logs;
- server-rendered admin UI or lightweight React/Vite app;
- Docker image for deployment.

This should be a separate tool from the production Interlateral platform, but can live in the same organization.

## 12. Milestones

### M1 — Quick Smoke and Dashboard

Deliver:

- target registry;
- Quick Smoke profile;
- discovery/OpenAPI/schema checks;
- basic dashboard;
- Markdown/JSON report.

### M2 — Mock Peer Basics

Deliver:

- mock node creation;
- discovery document;
- key generation;
- federated directory;
- revocation feed;
- public mock endpoints.

### M3 — Target as Host Tests

Deliver:

- identity claim generation;
- remote join request to target;
- approval-status polling;
- participant token retrieval;
- synthetic agent action;
- receipt/provenance checks.

### M4 — Target as Home Tests

Deliver:

- mock federated events;
- target discovery/aggregation checks;
- target-generated claim validation;
- approval/rejection simulation;
- remote join disclosure checks where UI automation is configured.

### M5 — Three-Node Rehearsal

Deliver:

- two mock nodes at once;
- A/B/C scenario scripts;
- depeering/suspension;
- version mismatch;
- revocation propagation.

### M6 — Browser and UAT Support

Deliver:

- Playwright flows;
- screenshot evidence;
- Original Host / Platform Host / User acceptance checklists;
- signed run reports.

### M7 — External Collaborator Mode

Deliver:

- simplified "test my instance" onboarding;
- shareable public docs;
- badge/status output;
- CI-friendly runner.

## 13. Acceptance Criteria for the Tester

The tester is good enough for v2 refactor support when:

1. Dazza can deploy it on a small server.
2. Dazza can point it at the Digital Ocean v2 instance and run Quick Smoke.
3. It can act as a mock home and submit remote participants to the DO instance.
4. It can act as a mock host and receive users from the DO instance.
5. It can test the Google Cloud instance the same way.
6. It can emulate a third node for trio tests.
7. It produces readable reports with exact failure causes.
8. An external collaborator can use it against their own instance without private Interlateral repo access.
9. It never requires access to the target's database or source code.
10. It clearly distinguishes "mock peer passed" from "real federation acceptance passed."

## 14. Relationship to Fable's Spec Suite

This service should directly consume:

- `schemas/*.json`
- `schemas/openapi.skeleton.json`
- `tests/T-*.md`
- `tests/T-ACCEPT.md`
- `protocols/ILP-*.md`
- `event-types/*.md`

The service should not fork the meaning of those specs. If the tester and the spec disagree, the tester is wrong unless Dazza approves a spec change.

## 15. Recommended First Build Order

Build this tester before or alongside the v2 platform refactor:

1. Quick Smoke.
2. Mock Peer.
3. Target-as-Host remote join.
4. Target-as-Home remote join.
5. Report/evidence exports.
6. Browser flows.
7. Trio rehearsal.

This gives the Digital Ocean build, Google Cloud build, and external collaborator builds a shared measuring instrument.
