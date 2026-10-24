# 01A — Purpose, Goals, Objectives, and Success Metrics

**Status:** DRAFT for Dazza review · 2026-07-06 (rev 2)
Management-facing statement of why this rebuild exists and how success is
measured. Companion to `01-VISION-AND-SCOPE.md` (product/principles view).
Adapted from the Codex Desktop review of 2026-07-06 (§3–4), integrated and
aligned with this suite's requirement/test IDs.

---

## 1. Purpose

Transform Interlateral from a successful but hand-grown, single-host event
application into a **protocol-first, modular, federated, governable platform for
structured human + AI-agent collaboration** — one that multiple independent
hosts can run on their own infrastructure while interoperating through shared
protocols for identity, event discovery, remote join, collaboration artifacts,
receipts, exports, and (eventually) federated governance.

## 2. Goals

1. **Protocol-first clarity** — Interlateral is a set of stable, versioned
   protocol contracts (ILP) before it is an implementation.
2. **Modular implementation** — identity, event engine, procedure packs,
   collaboration, federation, UI, export, and operations are separable modules.
3. **Clean rebuild path** — a fresh builder agent or team can implement v2 from
   the specs and conformance tests alone.
4. **Federation v1** — two or more independently hosted instances; verified
   members of any instance can discover, request, and (once approved)
   participate in open events on any other.
5. **Procedure-pack extensibility** — new event types without engine rewrites;
   unconference and parliamentary ship first.
6. **Reliable collaboration** — revision-safe artifacts, atomic appends, change
   feeds, certified snapshots; no lost writes.
7. **Human/agent accountability** — every consequential action traces to a
   human principal, optional agent + license plate, mandate, and event authority.
8. **Host autonomy with interop** — each host controls its own events,
   admission, records, and outputs while federating.
9. **Governability** — the parliamentary pack + provenance + certified results
   are the foundation for future Human Council / United Federation Sessions.
10. **Evidence as product** — complete, verifiable event records and exports.

## 3. Objectives (the refactor is successful when…)

| # | Objective | Proven by |
|---|---|---|
| O1 | A new implementation is built from spec without reference to v1's route structure | G1–G7 pass; builder deviations report |
| O2 | A host creates and runs an **unconference** from YAML without code edits | T-UNCONF-1, UAT-OH-5 |
| O3 | A host creates and runs a **parliamentary** event from YAML without code edits | T-PARL suite, UAT-OH-6 |
| O4 | A user registers, verifies, registers an agent, and participates with full attribution | T-ID, T-EVENT-5/6, UAT-PU |
| O5 | A remote user discovers, requests, is approved for, and participates in an open event on another instance | T-FED-3, UAT-PU-5 |
| O6 | **Three or more instances** (spanning ≥ 2 clouds) peer, list each other's federated events, process cross-node joins, and preserve provenance | T-FED-11..13, UAT-PH |
| O7 | Shared artifacts survive concurrent writes with zero lost accepted writes | T-COLLAB-5 |
| O8 | Every consequential action produces a verifiable receipt | T-CORE-11 |
| O9 | Event exports verify offline, including remote-participant provenance | T-EVENT-13, T-FED-8 |
| O10 | Dazza (Original Host) and at least two other Platform Hosts complete their acceptance tests | `tests/T-ACCEPT.md`, Gate G8 |

## 4. Success metrics

### 4.1 Specification completeness
- 100% of normative `R-*` requirements traced to a test, review gate, or ops
  drill — **met now**: `harness/run.mjs --matrix` passes at spec level (168/168
  at rev 2; re-run after any spec change).
- 100% of wire-visible objects have JSON Schemas (`schemas/`, R-CORE-28).
- 100% of carry-forward items routed PRESENT / FUTURE / outside-technical /
  retired (`06-ROADMAP.md`).
- All core terms defined once (`GLOSSARY.md`).

### 4.2 Build & deployment
- Fresh install from image + env + migrations on a new cloud host, using docs
  only (T-OPS-1; UAT-PH-1): target ≤ 60 minutes operator time.
- First admin bootstrap without shared passphrases (T-OPS-1, R-ID-4).
- Backup/restore drill passes (T-OPS-2): restore ≤ 30 minutes.
- Second and third instances deploy independently (T-OPS-4).

### 4.3 Protocol
- 100% ILP endpoints conform to the served OpenAPI (T-CORE-2, `--strict` at G7).
- UTF-8 round-trips byte-exactly (T-CORE-3); all errors are stable problem
  codes (T-CORE-5/6); idempotency on all non-idempotent POSTs (T-CORE-10);
  feeds resume + long-poll (T-CORE-8/9); receipts hash-chain verifies
  (T-CORE-11); exports verify offline (T-EVENT-13).

### 4.4 Collaboration (SLO-grade, measured by T-COLLAB-5 and T-OPS-5)
- 10 concurrent writers × 2 min → **zero lost accepted writes**.
- Stale writes fail with recovery context; appends land exactly once.
- Change feed keeps agents current without full-body polling.
- Long-poll delivery of a new feed record ≤ 2 s after commit (p95).

### 4.5 Federation
- 3 instances peer; each lists the others' federated events (freshness ≤ 10 min).
- Cross-node joins work in both directions (A→B, A→C, B→A, C→B minimum).
- Host reject/revoke enforced immediately; home revocation honored within one
  documented poll window (≤ 10 min).
- Peer outage never breaks local events; depeering blocks new joins.
- Exports preserve home-instance provenance verifiable against home keys.

### 4.6 User & host experience (Gate G8)
- New user: register → verify → agent → instructions with no operator help
  except required approvals (UAT-PU).
- Before a remote join, the user sees which host controls the event and exactly
  what data will be shared (R-FED-17, UAT-PU-5).
- Agents run entirely from the served skill (UAT-AG).
- Original Host operates events end-to-end without SSH (UAT-OH).
- Annual all-users governance **readiness** demonstrable (UAT-GOV): eligibility
  snapshots, receipted ballots, certified results, provenance-preserving
  exports a future federation-level tally could consume without DB access.

### 4.7 Reliability SLOs (R-OPS-9)
- p95 read latency ≤ 300 ms, p95 write ≤ 800 ms at reference load (100
  concurrent participants, one live event per instance).
- Live event survives a process restart with ≤ 30 s interruption and no data
  loss (T-OPS-3).
- No availability "nines" promise in v2 (single-node deployments are
  conformant); resilience is restart-safety + backup/restore, per 02-ARCH.
