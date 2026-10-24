# Observations — 2026-09-27

**Recorded by:** Claude Code (`claude-code-intensive`) while preparing ILP Specification 0.0.1

**Purpose:** Direct evidence behind several findings in `../../../ilp_spec.md` §18.

**Environment:** local macOS workstation, Node v22.23.2, disposable PostgreSQL 16.12 on 127.0.0.1:5433 (torn down after use).

These are point-in-time observations. They support, but do not by themselves certify, anything.

## 1. Live discovery probes (public HTTPS GETs only)

| URL | HTTP status | Note |
|---|---|---|
| `https://open-events.interlateral.com/.well-known/interlateral.json` | 200 | Captured verbatim as `open-events-discovery.json` (SHA-256 `b04050b0eac8acfcb4906147c5fefeb4da4c605bf80d7054719998e47f851b1c`). |
| `https://events.interlateral.com/.well-known/interlateral.json` | 404 | No ILP discovery document is served. Supports: the Alpha implementation has no federation surface. |
| `https://open-tester.interlateral.com/` | 401 | Access-controlled test service. |

Observed in the captured discovery document:
- `instance.software.version` is `"0.0.1"`. This is hard-coded in source, not tied to a build. Supports defect K-15.
- `federation.join_requests` is `false`.
- The document carries a top-level `current_event` member.

## 2. Schema validation of the live discovery document

The captured document was validated against `discovery.schema.json` using Ajv (JSON Schema 2020-12, `ajv-formats`).

**Result: INVALID.**

```text
/ must NOT have additional properties {"additionalProperty":"current_event"}
```

The schema is byte-identical in the baseline suite and in the reference implementation. It sets `additionalProperties: false` at the top level, so the reference implementation's live output fails its own normative schema.

The baseline conformance test T-CORE-1 checks individual fields rather than validating against the schema, so the failure went undetected. This supports defects K-3 and K-4 and requirements R-CORE-32 and R-CORE-39 in the 0.0.1 specification.

## 3. Reference implementation test baseline

Interlateral Platform Beta @ `2a0b39d` (`main`, clean tree).

| Suite | Command | Result |
|---|---|---|
| Clean-repo, boundary, and scaffold checks | `npm run check` | PASS — 7/7 |
| Black-box conformance cases | `node tests/conformance/run.mjs` | **156/156 PASS** (~34 s) |
| Browser UAT (Playwright, 56-step script) | `bash tests/uat/run-uat.sh` | **72/72 steps PASS**; 120 mutations audited |
| Schema drift guard | `node scripts/check-schema-sync.mjs` | 13/13 identical — against a hard-coded path into the baseline's untracked location |
| Tester package | `tester: node --test tests/*.test.mjs` | 6/6 PASS |

## 4. Traceability measurement (baseline requirements vs executable cases)

Method:
- Requirement IDs were extracted from the baseline protocol and vision documents.
- Test IDs were extracted from the baseline `tests/T-*.md`.
- Both were compared against the literal IDs present in the reference implementation's executable conformance cases.

| Family | Normative items | Traced or implemented by executable cases |
|---|---|---|
| `R-FED-*` requirements | 18 | **0** |
| `T-FED-*` tests | 15 | **0** |
| `T-OPS-*` tests | 5 | 0 |
| All `R-*` requirements | 154 | ≈ 87 |

**Caveat:** split identifiers (e.g. `T-ID-2` implemented as `T-ID-2a/2b/2c`) cause a few false negatives in test-level counts. Requirement-level counts are the more reliable figures.

## 5. Other source observations (reference implementation @ `2a0b39d`)

**Key handling** — `src/core/keys.mjs`:
- Any failure to read the instance key file causes a new Ed25519 keyring to be generated and written, silently, in any mode. Supports K-8.
- `src/export/service.mjs` signs exports with `keys[0]` regardless of rotation state. Supports K-9.

**Canonical JSON** — three independent implementations exist:
- `src/core/jcs.mjs` rejects non-integer numbers.
- `packages/conformance-cases/lib/verify.mjs` and `tester/src/mock-peer/server.mjs` accept them.

Supports K-7.

**Test provisioning** — `packages/conformance-cases/lib/login.mjs` requires `ILP_MAILBOX_DIR` and reads one-time codes from the node's local filesystem mailbox, so these cases can only run co-located with the node. Supports K-14.

**Federation surface** — `src/federation/discovery.mjs`: the peers, directory, and revocations endpoints return empty lists. They are placeholders.

**Pack IDs** — `packs/` contains `unconference@1.0/1.1`, `parliamentary@1.0/1.1`, and `meeting-simple@1.0`. The 1.1 versions and `meeting-simple` exist only there. Copied under `../../as-built-reference/`.

**Receipt member naming** (source inspection only; not runtime-validated):
- `src/events/service.mjs` (`appendReceipt`) computes each receipt's `hash` over a body whose resource member is named **`resource`**.
- `GET /ilp/v1/events/{id}/receipts` (`src/events/routes.mjs`) and the export bundle (`src/export/service.mjs`) both serve receipts with the database column name **`resource_global_id`** instead, and no `resource` member.
- `receipt.schema.json` requires `resource` and sets `additionalProperties: false`, so served receipts do not match the normative schema.
- The implementation's own verifier (`packages/conformance-cases/lib/verify.mjs`) silently maps `resource_global_id → resource` before recomputing hashes. An independent implementation following the schema cannot know to do this.

Supports K-21.
