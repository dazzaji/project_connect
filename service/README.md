# Project Connect job service (vertical slice)

A small authenticated job/status/results service that runs a configured conformance runner as a supervised child
process per job, against **registered** target descriptors only. No new dependencies (`node:http`, `node:fs`).
It runs the real conformance runner `runner/service-run.mjs` (see "The real runner" below); the fixture runner `tests/service/fixtures/fake-runner.mjs` remains for the service's own lifecycle tests.

```sh
node service/cli.mjs serve --config CONFIG_DIR
CONNECT_TOKEN=… node service/cli.mjs submit --url http://127.0.0.1:4300 --file request.json
CONNECT_TOKEN=… node service/cli.mjs status|results|cancel --url http://127.0.0.1:4300 --job JOB_ID
```

## Configuration (operator-owned; validated at startup, any problem refuses startup)

`CONFIG_DIR/service.json`:

```json
{ "state_dir": "/abs/state", "secrets_dir": "/abs/secrets", "listen": { "host": "127.0.0.1", "port": 4300 },
  "limits": { "max_concurrent_jobs": 1, "max_reps": 2, "max_pairs": 4, "job_timeout_s": 1800, "max_queued": 10, "cancel_grace_ms": 5000, "max_request_bytes": 16384 },
  "profiles": { "pc-0.1-s1": "/abs/profile/pc-0.1-s1.json" },
  "runner": { "node": "/abs/node", "entry": "/abs/project_connect/runner/service-run.mjs", "env": {} },
  "port_pool": { "from": 47100, "to": 47199 } }
```

- `listen.host` must be loopback; expose it only through a reviewed proxy.
- `max_concurrent_jobs` is fixed at 1 in this slice.

`CONFIG_DIR/tokens.json` — API principals; tokens are stored only as SHA-256:

```json
[{ "id": "alice", "role": "submitter", "token_sha256": "<64 hex>" }, { "id": "ops", "role": "admin", "token_sha256": "<64 hex>" }]
```

`CONFIG_DIR/targets.json` — the only things a job can test:

```json
[{ "id": "ref-a", "implementation": "project-connect-reference-node", "version": "x.y", "base_url": "http://ref-a.example:4193",
   "roles": ["home", "host"], "setup": { "kind": "reference-admin-v1" }, "capabilities": [], "credentials_ref": "ref-a.json" }]
```

- `setup.kind` is `reference-admin-v1` or `harness-control-v1` (the latter also requires `control_url` and `node`; a per-target
  `control_token`, when the harness requires one, comes only from the target's credential file: [docs/harness-control-auth.md](../docs/harness-control-auth.md)).
- `capabilities` is a subset of `outage-drill`, `key-drill`.
- `credentials_ref` is a path inside `secrets_dir`. It must be a regular JSON file, owned by the service user, and not
  group/world accessible.
- Descriptor digests exclude `credentials_ref` entirely.
- `trusted_key_thumbprints` (optional): 1–16 RFC 7638 thumbprints of the target's signing keys, approved by the operator out of
  band. They are the only trust roots used for offline packet verification (`PC-VER-1`); without them `PC-VER-1` fails with
  `TRUST_ROOTS_NOT_CONFIGURED`. Keys found in discovery or in the packet are never trusted on their own.

## API

Bearer token on every `/v1` route. Errors are `application/problem+json` (`urn:connect:error:*`).

| Route | Who | Notes |
|---|---|---|
| `GET /healthz`, `GET /readyz` | anyone | liveness / readiness |
| `POST /v1/jobs` | submitter, admin | body `{profile, gate?, pairs:[{home, host}], reps?, also?}`; registered target ids and roles only; no URLs, commands or setup data; `429` when the queue is full; `413` over the size limit |
| `GET /v1/jobs/{id}` | owner, admin | others get `404`; includes the composition record |
| `GET /v1/jobs/{id}/results` | owner, admin | sanitized report; `409` until terminal |
| `POST /v1/jobs/{id}/cancel` | owner, admin | queued → cancelled; running → SIGTERM then SIGKILL to the verified runner group; `409` for a terminal job |

Job status ∈ `queued, starting, running, succeeded, failed, cancelled, interrupted, timed_out`.

## Guarantees

- **Single service per state dir.** The lease record is written completely and then hard-linked into place, so it is never
  observed half-written. It is identified by PID, start time, command and process group. A live holder blocks a second
  service; a stale lease is moved aside (`service.lease.stale-*`); an unreadable lease is never replaced. If the holder's
  identity cannot be read (for example `ps` fails) while a process with its PID still exists, startup is refused rather than
  the lease reclaimed: a failed lookup is never taken as proof that the holder died.
- **Private directories.** `state_dir` and `secrets_dir` must be real directories owned by the service user with no
  group/world access. Credential files are re-validated when each job starts: path inside `secrets_dir`, no symlink, regular,
  owner-only, same inode.
- **Durable state.** Each job lives in its own 0700 directory with an atomic, fsynced `job.json` and an append-only
  `events.jsonl`. Raw runner output and logs are private (0700/0600) and never served. The per-job credentials file is
  deleted when the job ends.
- **Restart.** Jobs left `starting`/`running` become `interrupted`. The runner's PID/PGID is journalled in `job.json`
  immediately after spawn, before the service awaits anything. At restart a recorded runner group is killed only if its
  recorded identity (PID, start time, command, group) still matches; an unverifiable group is never signalled. Jobs are
  never re-run automatically; a retry is a new job. A gracefully stopped service also leaves its running job to be marked
  interrupted at the next start. Interrupted reasons: `SERVICE_RESTART_KILLED_VERIFIED_RUNNER`,
  `SERVICE_RESTART_UNVERIFIED_GROUP_REMAINS`, `SERVICE_RESTART_STARTING_UNRECORDED` (the job was `starting` with no process
  record, so a runner may exist unjournalled), `SERVICE_RESTART` (no live runner group).
- **Ports.** Each job leases two unique free ports from `port_pool` for runner-owned nodes. They return to the pool when the
  job ends with its processes verified gone. They are **quarantined** instead (moved to the job's `ports_quarantined`, and
  never leased again by this state dir) when the service cannot prove that: an unverified group remains, or a `starting` job
  has no process record.
- **Quarantine handoff (operator).** The service never clears quarantine itself. For each terminal job with
  `ports_quarantined` (`SERVICE_RESTART_UNVERIFIED_GROUP_REMAINS` or `SERVICE_RESTART_STARTING_UNRECORDED`):
  1. stop the service;
  2. check the ports and the job's recorded PGID by hand (`lsof -nP -iTCP:<port>`, `ps -o pid,pgid,lstart,command -g <pgid>`),
     and stop any leftover runner yourself after confirming what it is;
  3. archive the job directory (`state_dir/jobs/<id>/`) outside `state_dir`. Its `job.json` is terminal and immutable, so
     quarantine is cleared by removing the job from the state dir, not by editing it;
  4. start the service.
- **Terminal jobs are immutable.** Once a job is terminal, no field of `job.json` (status, reason, ports, timestamps) can be
  rewritten, not even to the same value; later bookkeeping only appends to `events.jsonl`.
- **Fail-closed results.** Missing, malformed or empty `results.jsonl`, or zero counted (pass/fail) results, gives `failed`.
  Any test failure, or a non-zero runner exit, also gives `failed`.
- **Sanitized reports.** An allowlist projection with credential-shaped strings and every loaded secret value redacted.
  Every field is redacted before it is truncated. Failure reasons are structural codes and never contain runner-supplied
  text (an unexpected or duplicate result is named by its row number). As defence in depth, the reason is also redacted and
  bounded to 200 characters before it is written to `job.json`, `events.jsonl` or `report.json`. `report.redacted` is true
  only when something was actually redacted.

## Platform and known limits

- **Supported platform:** macOS (developed and tested on Darwin 25 with Node 22). Process identity uses
  `ps -o pgid=,lstart=,command=` and POSIX process groups. Linux is expected to work but is **untested**: its `ps lstart`
  format and process-group behaviour have not been verified here. Windows is not supported.
- **Residual, unproven (closure02 F3):** after the runner leader exits, its group is reaped by PGID. A process-group id is
  not reused while the group has members, but there is a check-then-signal window between "the group is alive" and
  `kill(-pgid)` (about 50 ms) in which the group could empty and its id be taken by a new group leader. This has not been
  reproduced or excluded by tests. Closing it needs a long-lived supervising leader or Linux pidfds, which is a redesign and
  out of scope for this slice.
- Concurrent multi-process lease contention is argued from the guard design, but only sequential cases are tested.

## Runner contract (what the service invokes)

`node ENTRY --targets FILE --pairs home:host[,…] --gate G --reps N --profile ID --out DIR --ref-port P1 --aux-port P2 [--also IDS]`

- `FILE` holds the public descriptors of the job's targets.
- Credentials arrive only via the file named by `CONNECT_CREDENTIALS_FILE` (JSON map target id → credential object).
- The child environment is `PATH=/usr/bin:/bin`, plus `runner.env` and `CONNECT_JOB_ID`.
- The runner must write `DIR/results.jsonl`: one `{test_id, status ∈ pass|fail|not_applicable, scenario, repetition,
  requirement_ids?, reason?, detail?}` per line.
- `scenario` is the pair as `home:host`, and `repetition` is 1..N.
- Coverage must be **exact**: one row for every profile test of the selected gate (all gates for `all`) plus `--also`, for
  every pair and repetition. A missing, duplicated or unexpected row fails the job.
- After the runner (the process-group leader) exits, any remaining member of its group is terminated, and the job fails with
  `RUNNER_LEFT_DESCENDANTS`.

## The real runner: `runner/service-run.mjs`

Configure `"runner": { "node": "/abs/node", "entry": "/abs/project_connect/runner/service-run.mjs", "env": {} }` and point
`profiles."pc-0.1-s1"` at the same package's `profile/pc-0.1-s1.json`: the runner loads `profile/<id>.json` from its own package.
**Runtime profile binding:** the service passes the job's pinned digest (`composition.profile_sha256`) as
`CONNECT_PROFILE_SHA256`; the runner refuses (exit 2, no rows) when the JCS SHA-256 of the bytes it loaded differs — the same id is
not enough — and records `profile.sha256` and `profile.bound_to_service_digest` in `run.json`. A job whose run record is missing,
unbound or names other bytes, or whose composition is missing or no longer matches the service's profile, is never qualified.

- **Target identity (review36 R3):** each target is identified by its descriptor `id`. For `harness-control-v1`, setup and drill
  operations go to that descriptor's own `setup.control_url` with its harness-local `setup.node`; equal local names on different
  harnesses stay distinct targets. Two descriptors naming the same harness node, or a node the harness does not report, are
  refused before any test.
- **Prerequisites (review36 R1):** whenever SG-3, late or SG-4 tests are selected, the SG-2 golden thread runs for each
  pair/repetition even if its rows were not requested (no rows are written for it). If a prerequisite fails, the dependent rows
  fail with `reason: "SETUP_FAILED"` naming the prerequisite — a runner/setup failure, not a verdict on an unrequested test.
- **Derived verdicts (review36 R2):** `PC-INTEROP-AB`/`PC-INTEROP-BA` are defined for the profile's scenarios. A pair maps to
  one only when both descriptor ids are that scenario's profile nodes and declare the profile's implementations for them;
  otherwise the rows are `not_applicable` with `reason: "DERIVED_VERDICT_UNSUPPORTED_FOR_PAIR"`. Reference/reference or legacy
  Beta/Beta evidence is never Alpha/Beta interoperability.
- **Normative tests:** the same `runner/tests.mjs` / `runner/tests-sg3.mjs` functions as the historical `runner/run.mjs` (which
  is unchanged and still drives the fixed Beta-harness scenarios). Nothing is cloned or answered synthetically.
- **Setup is separate from assertions** and uses only the descriptor's declared kind:
  - `reference-admin-v1`: the target's credential file holds `{ "admin_token": "…" }`; events, scoped credentials and local
    participants are created through the node's admin API;
  - `harness-control-v1`: `setup.control_url` / `setup.node` name a harness control API (as `scripts/federation-local.mjs`).
  A request can name only registered target ids; it never carries URLs, commands or setup data.
- **Runner-owned nodes** (R-CONF-3): `pc-ref` on `--ref-port` and `pc-aux` on `--aux-port` (the job's leased ports), started in
  the runner's own process group, so cancel/timeout/restart reach them with the runner; they are stopped before a normal exit.
  The targets must be able to reach `http://pc-aux.localhost:<aux-port>` (peering both ways): this slice therefore supports
  targets on the same host as the service.
- **Coverage and applicability:** exactly one row per (selected test × pair × repetition), selection = profile tests of the
  gate plus `--also` (the service's own rule).
  - Capability-gated tests are `not_applicable` with `reason: "CAPABILITY_ABSENT"` unless **both** targets of the pair declare
    the capability: `PC-DISC-5` → `key-drill`; `PC-REV-4`, `PC-REV-5` → `outage-drill`.
  - A test whose own applicability rule excludes the pair: `not_applicable`, `NOT_APPLICABLE_TO_PAIR`.
  - **SG-3 late phase** (`PC-GRANT-3`, `PC-ENF-7`), as `runner/run.mjs`: a short-TTL grant is admitted per pair/repetition, then
    one unshortened wait until the latest `exp + clock_skew_s + 5 s` (about 5.5 minutes with the profile's 20 s TTL and 300 s
    skew), then the late tests.
  - **SG-4:** `PC-EXP-1` closes and exports each pair/repetition's host event and checks the signed export; `PC-VER-1`
    assembles the evidence packet (subjects attest through their setup kind), verifies it offline against the operator trust
    pins and the pinned profile digest, and requires every negative packet to be rejected for the right reason. The packet,
    `trust.json`, `verifier-report.json` and `negative-verification.json` stay private next to `results.jsonl`.
  - **Normative limit:** the offline verifier checks result coverage against the profile's own fixed scenarios (`SC-1`…`SC-4`,
    profile nodes `beta-one`, `beta-two`, `pc-ref`). A packet for other registered pairs (for example `ref-a:ref-b`) therefore
    fails the verifier's results check by design, and `PC-VER-1` fails; this is reported, not relaxed.
  - A test id the runner does not implement: `fail`, `NOT_SUPPORTED_BY_SERVICE_RUNNER`.
  - Failures carry `reason: "TEST_FAILED"` and the failure text in `detail` (redacted and bounded by the service).
- **`run.json`** (private, next to `results.jsonl`): profile id/spec version/sha256, gate, `also`, selected tests, repetitions,
  pairs, per-target descriptor sha256 (JCS), implementation, version, setup kind and declared capabilities, counts.
- **Exit codes:** 0 every row `pass`/`not_applicable`; 1 any `fail` or no rows; 2 invalid invocation or setup failure (for
  example an unknown pair target, a wrong role or a missing `admin_token`), with no rows. The service fails any job that is
  not exit 0 with exact, complete coverage.

## Job success is not profile conformance

`succeeded` means only that the requested coverage ran completely with no failing row. Every terminal job and every results
report carries a separate `qualification`:

- `scope: "full_profile"`, `full_profile_qualified: true` **only** when every test of the profile was selected (gate `all`, or
  equivalent `also`) **and** every row passed;
- otherwise `scope: "partial"`, `full_profile_qualified: false`, with `reasons` from `JOB_NOT_SUCCEEDED`,
  `PROFILE_TESTS_NOT_SELECTED`, `NOT_APPLICABLE_ROWS` (for example a missing capability), `FAILED_ROWS`, `PROFILE_UNKNOWN`, and
  (in the report) the `not_selected`, `not_applicable` and `failed` test ids.

A missing capability or an unselected test therefore never yields whole-profile qualification, and a requested test cannot
disappear: any missing, duplicated or unexpected row fails the job (`INCOMPLETE_RESULTS`, `DUPLICATE_RESULT`,
`UNEXPECTED_RESULT`). An SG-2 job (for example 15 pass + 1 `CAPABILITY_ABSENT`) is partial evidence. Because `PC-VER-1` is bound
to the profile's fixed scenarios, a whole-profile result for `pc-0.1-s1` additionally needs targets registered as the
profile's scenario nodes; no job result is a certification.

## Standalone export and digests

`node tools/export-service.mjs DEST` copies exactly the service, the runner, the reference node, the profile and the
specification schemas into a new directory and writes `DEST/MANIFEST.sha256` (sorted per-file SHA-256); two exports of the
same tree have identical manifests. Install dependencies there with `npm ci --offline` (ajv, ajv-formats only). The export
contains no Beta code and reads no Beta checkout (`runner/walkthrough.mjs`, a Beta-harness script, is excluded).
`npm test` runs the root tests and then `tests/service/` (one file at a time).

The service's `composition` record also pins the runtime: `service_commit`, `package_lock_sha256`, `runner_node_sha256`,
`runner_entry_sha256`, `profile_sha256` and each target's descriptor sha256.

API description: `service/openapi.json`. Examples: `service/examples/`.
