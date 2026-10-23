# Verifying B5 export provenance companions (opt-in)

This implements the offline-verifier half of the frozen Beta producer contract (producer47: `docs/export-provenance.md`
sha256 `7ed3533f…d9d0`; row schema sha256 `b3307588…25cd`, vendored byte-for-byte as
`verifier/contracts/ilp-action-provenance-1.schema.json`, pinned by a test). Code: `verifier/export-provenance.mjs`.

## When it runs
- **Packet verifier:** only when the operator's trust file sets `"export_provenance": "ilp-action-provenance/1"`. Then every
  export in the packet must carry a manifest-covered `action-provenance.jsonl`, and all semantic checks below must pass.
  - Otherwise the exports guard is exactly the historical one, and the report states
    `export_provenance: { checked: false, reason: "not requested: legacy export checks only (not B5-complete)" }`.
  - The historical golden packet keeps byte-identical verdicts.
  - In opt-in mode the packet guard also checks the export manifest's signed **length** of every listed file, and requires
    every file the export carries to be covered by its manifest.
  - The report distinguishes `requested` from `checked`. `checked: true` only when every export's companion checks completed.
- **Standalone:** `verifyExportBundle({manifest, files}, trustedKeys, { issuer })` needs both operator inputs (it refuses
  without the issuer base URL). It applies the same prerequisites the packet verifier applies to an export:
  - export-manifest schema and detached signature;
  - every listed file's hash **and** signed length (a missing length is rejected);
  - receipt schema and chain;
  - every grant's signature, `jti`, issuer/audience = `issuer`, and, for agent-token receipts, subject/agent, event and validity
    at the historical action time.
  Then the semantics.
- An integrity PASS alone is never reported as semantic acceptance. A legacy export without the companion is rejected when the
  companion is requested (`legacy export … B5 provenance not established`), and is never labelled B5-complete.

## Semantic checks
0. **Evidence presence:** `actions.jsonl`, `receipts.jsonl` and `grants.jsonl` must be manifest-covered (empty is allowed,
   absent is not). No export-local file may be outside the manifest. Artifacts imply a covered `revisions.jsonl`. Every
   companion and source line is parsed with the strict JSON parser (`lib/json.mjs`: duplicate member names and non-integer
   numbers are rejected) before schema validation.
1. **Rows:** every row validates against the frozen schema, including version, the closed member set, and the null/non-null
   pairing of `authorization_grant` with `grant_jws_sha256`.
2. **Bijection:** exactly one row per `actions.jsonl` id. A duplicate, orphan or missing row is rejected.
3. **Receipt join:**
   - `receipt` is a unique `receipts.jsonl` id, not shared by two rows;
   - `receipt_hash` equals the receipt's original `hash`, which also recomputes;
   - `resource` equals the action, `action_kind` equals the action kind, and `mandate` and the human and agent subjects equal the
     action's.
4. **Grant:** the receipt's own `authorization_grant` (absent means null) equals the row's.
   - A non-null JTI must select exactly one `grants.jsonl` entry. Its exact compact JWS has the row's SHA-256, it
     signature-verifies with an operator-trusted key, and its payload `jti` equals the JTI.
   - A null JTI requires a null digest.
5. **Revisions:** keys are exact and typed (`artifact` a string, `rev` a safe integer on both sides, never coerced). When revisions exist, `revision-provenance.jsonl` must be manifest-covered and form an `(artifact, rev)`
   bijection with `revisions.jsonl`. No revision-to-receipt link is inferred, and extra members are rejected.

The result reports per-label counts (`mandate_source_declared`) and always `human_approval: "not_established"`. A
`caller`/`human_approved` or `default`/`human_directed` label, or a valid signature, is recorded provenance, never independent
human approval.

## Evidence (unit51)
`tests/export-provenance.test.mjs`:
- an own Ed25519-signed fixture (signed grant, hash-chained receipts, revisions);
- 30 **re-signed** semantic negatives (the manifest is valid, so only the semantics can reject);
- original-manifest tamper and delete cases;
- the real producer47 bundle (`tests/fixtures/b5-real-bundle.json`, secret-scanned; no mailbox or private keys) as a positive
  control.
