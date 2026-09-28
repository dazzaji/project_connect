# `specifications/misc/` — Provenance for the ILP Specification

This folder preserves every source used to produce the first consolidated Interlateral Protocol specification, together with the evidence gathered while doing so.

The files are **verbatim**, except for a small set of documented redactions made before publication:

- personal contact details;
- production-infrastructure identifiers;
- machine-local file paths.

The redactions are listed in §5.

> **The current specification is [`../ilp_spec.md`](../ilp_spec.md) — ILP Specification version 0.0.1 (Working Draft).**
> It is the cleaned-up, reconciled, single normative document. Read it, not the files in this folder, to learn what the protocol requires. The files here are *records*: they show where 0.0.1 came from and let anyone check every claim it makes about its sources.

---

## 1. Why this folder exists

The Interlateral project committed to being **protocol-first**: the protocol, not any one platform, is meant to be the stable center, and independent implementations prove themselves against it. Until 2026-09-27, however, the protocol had no home.

**Problem 1 — the main specification was untracked.** The main specification suite — five protocol documents, a security model, packs, a conformance plan, and 13 JSON Schemas — lived as files inside an implementation repository (`interlateral_platform_alpha`, under `docs/2026-07-06-FEDERATED-MODULAR-GOVERNANABLE-SPEC/`).

- **55 of its 56 files were untracked** in that repository's git.
- The remaining one was staged but modified.
- In effect, the specification existed only on one workstation.

**Problem 2 — an implementation depended on that location.** The reference implementation (Interlateral Platform Beta) treated those files as canonical. Its schema-drift check pointed at them by an absolute path on that workstation.

**Problem 3 — a second line of drafts disagreed with the first.** The Project Connect drafts in this repository (`docs/*-v0.1.md`) conflict with that suite on the central question of **signed authorization**, and on test topology.

**The fix, in two steps:**

1. Preserve every source here, verbatim apart from the documented redactions (§5), so nothing is lost and every derivation can be audited.
2. Consolidate the sources into one cleaned-up, versioned document: [`../ilp_spec.md`](../ilp_spec.md).

---

## 2. The version line

| Version | What it is | Where |
|---|---|---|
| **`0.0.0.1`** | The **baseline**: everything that existed before consolidation. The label is retroactive, and it is the only four-part version that will ever be used. | This folder (`baseline-0.0.0.1/`) |
| **`0.0.1`** | The first consolidated, cleaned-up specification (Working Draft) | [`../ilp_spec.md`](../ilp_spec.md) |
| `0.0.x` → `0.1.0` … `0.4.0` | Consolidation completed; slice 1 frozen; federation complete; role profiles; event and pack profiles | Planned — spec §1.4 |
| **`0.5.0`** | **Test-stable**: specification and test suite stable enough to test and certify Interlateral Platform implementations | Planned |
| `1.0.0` | Stable; Semantic Versioning thereafter | Planned |

Spec §1 defines precisely how the specification version relates to the other versioned artifacts: the protocol family `ilp/1`, schema `$id` generations, pack versions, conformance-profile IDs (`pc-<M.m>-<slice>`), finding labels, and permanent requirement and test IDs.

---

## 3. What is in this folder

| Path | Contents | Origin | How captured | Status in its origin |
|---|---|---|---|---|
| `baseline-0.0.0.1/ilp-spec-suite-2026-07-06-rev2/` | The ILP specification suite "2026-07-06 rev 2": **47 of its 56 files**. The other 9 are non-normative correspondence and working notes, retained privately (§3.1). | `github.com/dazzaji/interlateral_platform_alpha`, path `docs/2026-07-06-FEDERATED-MODULAR-GOVERNANABLE-SPEC/`; repository HEAD `7682e89` at capture | `rsync`, excluding `.DS_Store`. Verified identical by SHA-256 at capture; 2 published files were later redacted (§5). | 55 files untracked; 1 (`schemas/procedure-pack.schema.json`) staged but modified |
| *(not duplicated)* | The Project Connect drafts: Acceptance Profile, Evidence Packet, Node Certification Evidence Pack | This repository, `docs/` at commit `81e73d2` | Not copied. They are already published in `docs/`, and git history preserves the exact baseline versions: `git show 81e73d2:docs/<file>`. | Committed |
| `as-built-reference/interlateral-platform-beta-2a0b39d/packs/` | Pack definitions `unconference@1.0/1.1`, `parliamentary@1.0/1.1`, `meeting-simple@1.0`, plus that folder's README | Interlateral Platform Beta (private repository), `packs/` at commit `2a0b39d` | `git show 2a0b39d:packs/<file>` (committed blobs) | Committed in Beta |
| `evidence/2026-09-27/` | `open-events-discovery.json` (a live capture) and `OBSERVATIONS.md` (dated findings) | Produced while preparing 0.0.1 | Public HTTPS GETs; local test runs; source inspection | New |
| `MANIFEST.sha256`, `MANIFEST.pre-redaction.sha256` | SHA-256 of every published file, as published and as originally captured | Generated | `shasum -a 256` | New |

**Not duplicated here:** Beta's 13 JSON Schemas at `2a0b39d` are **byte-identical** to the suite's `schemas/`, so one copy suffices.

### 3.1 Inside the baseline suite

The suite's own `00-README.md` declares what was normative:

- **Normative (in the baseline):**
  - the numbered documents `00`–`07`;
  - `GLOSSARY.md`;
  - `protocols/ILP-*.md` (CORE, ID, EVENT, COLLAB, FED);
  - `event-types/*-pack.md`;
  - `schemas/*.json` (governing object shape);
  - `tests/` (the conformance plan, T-* test documents, and a runnable harness skeleton);
  - `conform-and-interop-test-service/README.md` (a test-service design).
- **Non-normative (in the baseline):**
  - `_working-notes/` — exploration digests;
  - `codex_helper/` — prompts and review correspondence between the maintainer and the drafting and reviewing agents, including the review that produced "rev 2".

  **These 9 files are retained privately by the maintainer, not published.** They are raw working correspondence, not specification. The design reasoning in them that still matters is carried, with rationale, in `ilp_spec.md`.

  The suite's `00-README.md` (3 references) and `tests/harness/run.mjs` (1 reference) still mention these folders. Those references are historical.

  They are preserved because they are provenance: they explain *why* the baseline says what it says.

### 3.2 How the baseline came to be

| Date | What happened |
|---|---|
| **2026-07-06** | The suite was drafted as a protocol-first, federated "clean-room rebuild" specification for Interlateral Platform v2, then revised after an independent review (rev 2). |
| **July–August 2026** | Interlateral Platform Beta was built against the suite, and a drift guard kept its schemas byte-identical to it. During implementation, several approved design changes were made in Beta but never written back into the suite: the pre-approval token model, receipt `source_class`, the feed envelope, the error `title`/`code_detail` convention, and the 1.1 packs plus `meeting-simple`. |
| **2026-09-23 / 24** | The Project Connect drafts were written. They made **signed authorization grants** a first-class protocol object, and chose a two-node-plus-runner test topology. The suite had neither. |

The result was two partially conflicting specification lines and one implementation that had moved past both. Version 0.0.1 resolves this.

---

## 4. What changed in 0.0.1, and why

Every change is marked inline in `ilp_spec.md` (§0.4), with **[CHANGED 0.0.1]**, **[NEW 0.0.1]**, **[AS-BUILT 0.0.1]**, and **[DRAFT]**, and is summarized in spec §1.6 and §18. The groups below explain the reasoning.

### 4.1 Consolidation and versioning

- **Before:** The suite's five protocol documents, security and architecture requirements, and the conformance essentials were separate files. The Project Connect drafts were separate again.
- **Now:** All of it is **one** document, `ilp_spec.md`, on **one** version line (spec §1).
- **Why:** Interoperability testing needs one authoritative text, with versions that tests can cite exactly.
- **New versioning requirements** (`R-VER-1` to `R-VER-9`) define:
  - what PATCH and MINOR releases may change during `0.x`;
  - what "frozen" means;
  - release records with schema hashes;
  - how the specification and test suite version together;
  - that requirement and test IDs are never reused.

### 4.2 Cleanup — what was left out of the normative text, and why

The originals of everything below remain here, unmodified.

| Left out of the normative text | Reason |
|---|---|
| Instructions to a specific "builder agent", build milestones M0–M7, build gates G1–G8 | These were a build plan for one implementation, not protocol. The gate names also collided with Project Connect's acceptance gates G0–G8 (spec §15.9). |
| `_working-notes/`, `codex_helper/` | Already non-normative in the baseline |
| Machine-local paths and one workstation's directory layout | Meaningless to anyone else, and private |
| A personal contact address used in examples | Examples now use `example.org` |
| The roadmap and future-feature routing (`06-ROADMAP.md`) | Belongs in project roadmaps, not the protocol |
| UI and database-layout requirements (`R-UI-*`, `R-DATA-*`) | Implementation requirements, not wire behavior. Retained by reference (spec Appendix A.4). |

### 4.3 Reconciling the two specification lines

| Topic | Baseline suite | Project Connect drafts | 0.0.1 decision | Spec |
|---|---|---|---|---|
| Authority after admission | Host issues a plain bearer participant token | A **signed authorization grant**, distinct from identity | Grants adopted as the new **ILP-AUTHZ** module; the token stays the bearer credential; the grant is bound to it by hash | §7 |
| Revocation | Unsigned records; kinds claim, human, agent, plate | Signed revocation evidence; grant revocation; peer suspension | Individually signed revocation records; kinds `grant` and `peer` added; declared propagation bound; fail-closed freshness | §10.5 |
| Test topology | Three instances across two or more clouds, as a *protocol* requirement | Two independent nodes plus an independent runner | Topology is a *conformance* matter. Pairwise is the minimum; the trio is an extended profile. | §15.6 |
| Request signing (RFC 9421) | Required | Not mentioned | Kept, but flagged as an open question now that records are signed | §10.2, OI-3 |
| Finding labels | — | `ILP-CONFORMANCE-v0.1`, `ILP-INTEROP-PAIR-v0.1` | Kept, and extended with `-SELF` and `-REF` so that same-implementation and reference-node results are labeled honestly | §15.5 |

### 4.4 New normative material (all in 0.0.1; most marked [DRAFT])

| Addition | What it does | Spec |
|---|---|---|
| **Authorization grants** | A signed, scoped, time-bounded, credential-bound, revocable statement of authority, separate from identity. Also covers evaluation, narrowing-only semantics, a public status endpoint, receipt linkage, no side effects on rejection, and mandate discipline. | §7 |
| **Canonicalization profile** | JCS restricted to integers; floats rejected | R-CORE-35 |
| **Signature envelopes** | Exactly two: JWS-EdDSA with explicit `typ`, and detached Ed25519 over JCS | R-CORE-36 |
| **Normative test vectors** | Published vectors take precedence over any prose reading | R-CORE-37 |
| **Error precedence** | A fixed order for reporting multiple failures, so that negative tests isolate one cause | R-CORE-29 |
| **Build identity** | Discovery carries the exact build and deployment | R-CORE-30 |
| **Declared spec versions** | `spec_versions` in discovery | R-CORE-31 |
| **Key custody** | Fail closed; one active key | R-CORE-34 |
| **Receipt hashing** | Exact wire form and hash computation | R-CORE-40 |
| **Strict emit, lenient receive** | Resolves the closed-schema versus forward-compatibility contradiction | R-CORE-39 |
| **Test provisioning without hooks** | The runner acts as a federation node; scoped operator credentials; certification mode | R-CONF-3, R-OPS-10 |
| **Evidence hygiene** | No reusable secrets in evidence | R-SEC-22 |

### 4.5 Reference-implementation behavior adopted ([AS-BUILT])

These are Beta's approved design changes, written into the protocol at last:

- the pre-approval token model;
- agent binding at token claim;
- `source_class`;
- the always-`200` feed envelope;
- `title` = error code, plus `code_detail` sub-codes;
- `AUTH_INVALID`;
- the routing-only `current_event`;
- the canonical public origin;
- the Event Home board and available-actions contract;
- registrant-only token handoff;
- the SKILL as a tested contract;
- the packs `unconference@1.1`, `parliamentary@1.1`, and `meeting-simple@1.0` (preserved in `as-built-reference/`).

Beta's **defects** were *not* adopted; they are recorded as findings instead.

### 4.6 Defects found and resolved

Spec §18 lists 22 findings, K-1 to K-22. The evidence for several is in `evidence/2026-09-27/OBSERVATIONS.md`. The most consequential:

| Finding | Summary |
|---|---|
| K-3 / K-4 | Beta's **live** discovery document fails its own normative schema, because the schemas are closed while the protocol says to ignore unknown fields |
| K-7 | Three canonical-JSON implementations that disagree about numbers |
| K-8 | Key files that are silently regenerated and overwritten on any read error |
| K-21 | Receipts served as `resource_global_id` while the schema and hash use `resource` |
| K-22 | As-built `parliamentary@1.1` diverges from the baseline `parliamentary@1.0` document |

---

## 5. Redactions applied before publication (2026-09-27)

**This repository is public.** A scan of every file in this folder found **no secrets**. The scan covered:

- participant tokens and API keys;
- database URLs with credentials;
- private keys, cookies, and JWTs.

It did find personal and operational details that are unnecessary for understanding the protocol. At the owner's direction, these were **replaced in place with descriptive placeholders**, chosen so each passage still reads naturally and remains useful.

| Category | Replaced with | Published files | Lines |
|---|---|---|---|
| Personal contact email | `mailto:operator@example.org` in the protocol example. In the collaborator guide, a pointer to the Project Connect issue tracker, so the guide remains actionable. | `COLLABORATOR-GUIDE.md`, `protocols/ILP-CORE.md` | 3 |

The same scrub was also applied to the 6 privately retained files (§3.1) before they were set aside. Those files carried:

- production host details: IP address, droplet name, droplet ID, region;
- local locations of credential files;
- about 60 machine-local paths.

In those files:

- host details became `<production-host-ip>`, `<production-droplet-name>`, `<droplet-id>`, and `<region>`;
- credential-file locations became `<operator-secrets-dir>/<provider>.env`;
- machine-local paths became repository-relative paths.

None of these redacted details appear in anything published.

**Conventions for future contributors:**

- Placeholders use `<angle-brackets>`.
- Nothing else in these files was altered.
- Of the published files, only the two listed above differ from their originals.

**Provenance is still verifiable:**

- `MANIFEST.pre-redaction.sha256` records the SHA-256 of every **published** file **as originally captured**. Anyone holding the original baseline files can confirm the capture. The maintainer keeps a full version covering the retained files privately.
- `MANIFEST.sha256` records the files **as published**.

**Licensing note:** the pack files in `as-built-reference/` come from Interlateral Platform Beta, which is now licensed Apache-2.0 (repository still private). Publishing them here under this repository's Apache-2.0 license is therefore consistent.

## 6. Intentionally not included

- **The baseline's non-normative folders, `codex_helper/` and `_working-notes/`** (9 files). They are retained privately by the maintainer (§3.1).
- **Copies of the Project Connect drafts.** They are already in `docs/`, and git history preserves the baseline versions at `81e73d2`.

- **Internal gap analyses and planning notes.** These are kept private by design, in `project_connect/internal/` (git-excluded) and `interlateral_connect/working/`. They informed 0.0.1, but every requirement they motivated is stated, with its rationale, in `ilp_spec.md`.
- **Beta source code.** Only declarative pack data was needed, and the relevant code facts are described in `evidence/2026-09-27/OBSERVATIONS.md`.
- **Raw test logs.** They are summarized in `OBSERVATIONS.md` §3.

## 7. Integrity and rules for this folder

**Verify** from this folder:

```bash
shasum -a 256 -c MANIFEST.sha256               # files as published (post-redaction)
shasum -a 256 -c MANIFEST.pre-redaction.sha256 # originals as captured; the 2 redacted files will report FAILED here, by design
```

**Rules:**

- **Never edit** anything under `baseline-0.0.0.1/` or `as-built-reference/`. They are records.
- **Further redactions** must be recorded in §5, with both manifests updated.
- **Corrections to the protocol** go into `ilp_spec.md` through the Spec Change Request process (spec §1.5).
- **New evidence** goes in a new dated folder under `evidence/`.
