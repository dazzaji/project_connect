# Conformance Test Plan

**Status:** DRAFT for Dazza review · 2026-07-06

## 1. Philosophy

The tests are **black-box, protocol-level** conformance tests: they run against any
implementation via its base URL(s), using only ILP endpoints — the same way agents
and the UI use the platform. Passing this suite is the definition of "a working
Interlateral v2 instance" (Vision §7). The builder writes their own unit tests;
those are not specified here.

Necessity/sufficiency stance:
- Every normative requirement (`R-*`) maps to at least one test (`T-*`) or is
  marked `[verify: review]` (few — e.g. logging hygiene) or `[verify: ops-drill]`
  (backup/restore).
- No test asserts implementation detail beyond the protocol (framework, schema
  names, service topology are free).

## 2. Test environments

| Env | What | Used by |
|---|---|---|
| `single` | one instance, fresh DB, email captured by a test mailbox (harness runs a trivial SMTP catcher or reads a provider sandbox) | T-CORE, T-ID, T-EVENT, T-COLLAB, T-UNCONF, T-PARL, T-SEC |
| `duo` | two instances (CI: two isolated hosts), independent DBs/keys | T-FED-1..10, plus re-run of T-UNCONF/T-PARL smoke on each |
| `trio` | **three instances spanning ≥ 2 cloud providers** (acceptance, R-FED-18) | T-FED-11..15, T-OPS-4, T-ACCEPT (Gate G8) |

Harness config (`tests/harness/config.json`):
`{ "A": {"base": "...", "adminBootstrapToken": "..."},
   "B": {...}, "C": {...}, "mail": {"mode": "smtp-catcher|api", ...} }`
The only non-protocol affordances the harness needs: (1) a way to read OTP emails,
(2) the admin bootstrap credential created at install, (3) a clean-DB reset hook
for CI (documented, disabled in production builds).

## 3. Traceability matrix (summary)

| Requirement family | Test file | Coverage notes |
|---|---|---|
| R-CORE-1..28 | `T-CORE.md` | conventions, discovery, feeds, receipts chain, schemas |
| R-ID-1..19 | `T-ID.md` | OTP, sessions, plates, verification, claims |
| R-EV-1..26, R-ARCH-5..10 | `T-EVENT.md` | lifecycle, YAML, actions, gates, decisions, exports |
| R-COLLAB-1..12 | `T-COLLAB.md` | CAS, append, feed, snapshots, **concurrency drill** |
| R-FED-1..18 | `T-FED.md` | peering, directory, join, revocation, provenance, 3-node, versioning |
| R-UNCONF-1..9 | `T-UNCONF.md` | full unconference E2E + parity checks |
| R-PARL-1..12 | `T-PARL.md` | full parliamentary session E2E |
| R-SEC-1..21, R-UI-1..9, R-OPS-1..9 | `T-SEC-OPS-UI.md` | auth matrix, injection, privacy, ops drills + SLOs, browser acceptance |
| UAT-* (host/user/agent/governance) | `T-ACCEPT.md` | Gate G8 human acceptance |

Traceability is checked at two levels by `harness/run.mjs --matrix`:

1. **Spec-level coverage (passes NOW, kept green):** every `R-` id defined in the
   suite appears on a `traces:` line somewhere in `tests/*.md` — in a T-case, in
   `T-ACCEPT.md`, or in the Coverage Supplement (§6) for requirements verified by
   review or ops drill rather than a runtime probe. `--matrix` exits non-zero on
   any gap.
2. **Executable coverage (the builder's gate):** every `R-` id appears in a
   `traces: [...]` literal inside `harness/cases/*.test.mjs`. Reported always;
   enforced with `--matrix --strict`, which is part of Gate G7. The shipped
   harness is a skeleton — executable coverage starts near zero by design and
   must reach 100% (minus `[verify:]`-tagged items) before G7.

## 4. Test case format

```
T-<AREA>-<n>  <title>
traces: R-…, R-…
env: single|duo   actors: (created fixtures)
steps: numbered protocol calls
expect: assertions (status codes, bodies, invariants)
```

Fixtures are created through the protocol itself (bootstrap admin → humans via OTP
→ agents → events via YAML) — fixture creation is itself conformance surface.

## 5. Gate structure (used by 07-BUILD-PLAN)

| Gate | Suites that must pass |
|---|---|
| G1 Identity core | T-CORE 1–12, T-ID all |
| G2 Event engine | T-EVENT all, T-CORE feed/receipt tests |
| G3 Collaboration | T-COLLAB all (incl. the 10-writer drill) |
| G4 Unconference E2E | T-UNCONF all |
| G5 Parliamentary E2E | T-PARL all |
| G6 Federation | T-FED all — three instances, at least two clouds — **plus the federation security review sign-off (R-SEC-21)** |
| G7 Hardening | T-SEC-OPS-UI all + `--matrix --strict` green |
| G8 Host/User acceptance | T-ACCEPT all (Original Host, Platform Host, User, Agent, governance-readiness UATs) |

## 6. Coverage Supplement

Requirements below are verified by an existing test indirectly, by human review,
or by an ops drill rather than a dedicated runtime probe. Each line is
machine-parseable by `--matrix`. Review-tagged items must be checked off in the
builder's deviations report (07-BUILD-PLAN handoff artifact #4).

- traces: R-ARCH-1 → T-EVENT-11, T-UI-5 [verify: review]
- traces: R-ARCH-2 — module boundary discipline [verify: review]
- traces: R-ARCH-3 — monolith-permitted deployment shape [verify: review]
- traces: R-ARCH-4 — per-module schema ownership [verify: review]
- traces: R-ARCH-6 → T-EVENT-13 (export works via APIs; code path) [verify: review]
- traces: R-ARCH-7 → T-PARL suite proves second pack; no-engine-change claim [verify: review]
- traces: R-ARCH-8 — pack registration validation [verify: review]
- traces: R-ARCH-10 — engine invariants not overridable by packs [verify: review]
- traces: R-CORE-2 → T-CORE-2 (all paths under /ilp/v1 in OpenAPI)
- traces: R-CORE-5 → T-CORE-13
- traces: R-CORE-10 → T-COLLAB-2, T-EVENT-6 (recovery context on conflicts)
- traces: R-CORE-19 → T-SEC-1 (no passphrase-class credential anywhere) [verify: review]
- traces: R-CORE-25 → T-FED-3, T-FED-8 (home-origin ids in receipts)
- traces: R-CORE-27 → T-CORE-2 (RFC 3339 formats validated via OpenAPI)
- traces: R-DATA-1 — no cross-schema foreign keys [verify: review]
- traces: R-DATA-3 → T-SEC-3 (behavioral); hash-at-rest storage [verify: review]
- traces: R-DATA-4 → T-OPS-1 (single-command migrations from empty DB)
- traces: R-EV-4 → T-EVENT-1 (definition validation); pack-registration path [verify: review]
- traces: R-EV-5 → T-EVENT-6 (schema/role/phase/cap enforcement per action type)
- traces: R-EV-9 — packs cannot execute arbitrary code [verify: review]
- traces: R-EV-18 → T-UNCONF-1, T-PARL-12 (attributed action listings)
- traces: R-FED-1 → T-FED-3 (remote participant hits host APIs directly) [verify: review]
- traces: R-FED-13 → T-SEC-2 (hostile federation directory/claim inputs)
- traces: R-ID-1 → T-ID-5, T-ID-8 (principal model behaviors)
- traces: R-ID-2 → T-ID-8 (groups/memberships as authz)
- traces: R-ID-8 → T-ID-1 (code rendered as text); provider-failure surfacing [verify: review]
- traces: R-ID-16 — break-glass elevation discipline [verify: review]
- traces: R-OPS-5 → T-SEC-4 (trusted-proxy X-Forwarded-For handling)
- traces: R-SEC-4 → T-OPS-1, T-SEC-1 (bootstrap + no shared secrets)
- traces: R-SEC-9 → T-SEC-1 [verify: review]
- traces: R-SEC-10 → T-ID-12, T-FED-6 (revocation effect ≤ 60s on next use)
- traces: R-SEC-11 → T-FED-1, T-FED-4
- traces: R-SEC-12 → T-FED-3, T-FED-5 (shadow principals cannot log in) [verify: review]
- traces: R-SEC-13 → T-CORE-1 (published keys); key storage/rotation [verify: review]
- traces: R-SEC-15 → T-EVENT-12 (python-urllib UA accepted)
- traces: R-SEC-18 → T-SEC-3 (log grep in CI) [verify: review]
- traces: R-UI-4 → T-UI-1, T-UI-3 (plate chip + verification badge rendering)
- traces: R-CORE-28 → T-CORE-2 (responses validate against schemas/)
- traces: R-SEC-19 → T-FED-3 (claim contents), T-SEC-3 (email scan incl. federation payloads)
- traces: R-SEC-20 — account deletion/tombstone flow [verify: review]
- traces: R-SEC-21 — federation security review gate at G6 [verify: review]
