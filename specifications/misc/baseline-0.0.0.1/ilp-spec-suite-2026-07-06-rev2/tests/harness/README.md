# Conformance Harness (skeleton)

Black-box runner for the T-* suites. Node ≥ 20, no framework required
(`node:test` + `fetch`). The builder fleshes out cases following the pattern in
`cases/`; the T-*.md files are the source of truth for what each case asserts.

## Usage

```bash
cd tests/harness
npm install
cp config.example.json config.json   # point at your instance(s)
npm test                             # env=single suites
npm run test:duo                     # federation suites (needs A and B)
npm run matrix                       # R→T coverage check over ../T-*.md
```

## Layout

```
harness/
  package.json
  config.example.json
  lib/client.mjs     # ILP client: base-url, auth helpers, problem-doc assertions
  lib/mailbox.mjs    # OTP capture: smtp-catcher | provider-sandbox adapters
  lib/verify.mjs     # offline verifiers: receipts chain, export bundle, JCS, Ed25519
  lib/fixtures.mjs   # protocol-built fixtures (admin→humans→agents→events)
  run.mjs            # discovers cases/, runs by tag (single|duo), emits JUnit + matrix
  cases/
    core.test.mjs    # T-CORE-*
    id.test.mjs      # T-ID-*
    event.test.mjs   # T-EVENT-*
    collab.test.mjs  # T-COLLAB-* (incl. the 10-writer drill worker pool)
    unconf.test.mjs  # T-UNCONF-*
    parl.test.mjs    # T-PARL-*
    fed.test.mjs     # T-FED-* (duo)
    sec-ops-ui.test.mjs
```

## Conventions

- Two-level traceability (`run.mjs --matrix`):
  - **Spec level** (must stay green): every R-id defined in the spec suite
    appears on a `traces:` line in `tests/*.md` (T-cases, T-ACCEPT, or the
    Coverage Supplement in 00-CONFORMANCE-PLAN). Range syntax `R-X-1..9`
    is expanded.
  - **Executable level**: R-ids in `traces: [...]` literals inside
    `cases/*.test.mjs`. Reported always; enforced by `--matrix --strict`
    (Gate G7). The skeleton ships with ~4 traced cases by design.
- Tests must be order-independent within a file; fixtures namespaced per run
  (slug prefix `t-<runid>-…`).
- Timer-dependent tests (grace windows, ballot deadlines) use the instance's
  test-mode clock hook if configured (`config.clockHook`), else real waits.
