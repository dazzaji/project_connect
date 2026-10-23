# Draft core-service profile `pc-core-service-0.1` (version 0.1.0)

**Status: draft evidence profile. It is not a certification award and not a platform admission decision.**

`profile/pc-core-service-0.1.json` keeps the normative content of `pc-0.1-s1` (tests, traces, expectations, parameters,
exclusions), recorded in `derived_from.sha256`. It differs only in how scenarios are bound: `scenario_binding: "job-pairs"`.
- Scenarios are the pairs of an **operator-pinned job manifest**, not fixed node names.
- The historical `pc-0.1-s1`, its scenarios SC-1–SC-4, `runner/run.mjs`, the default verifier path and the pc-s1 bytes are
  unchanged. A test pins the `pc-0.1-s1` digest, and the historical golden packet verdicts were re-checked as identical.

## Job manifest (`pc-job-manifest/1`)

The service writes one per job at dispatch (`service/supervisor.mjs` `jobManifest`), pins its JCS SHA-256 on the job
(`manifest_sha256`), and gives the file and the pin to the runner. It contains:

| Member | Content |
|---|---|
| `job_id` | the job |
| `profile` | `id` and the job's pinned profile digest |
| `gate`, `also`, `selected_tests` | the exact selection |
| `repetitions` | N |
| `targets` | per descriptor id: `descriptor_sha256` (must equal the digest pinned at submission, otherwise the job fails `COMPOSITION_CHANGED`), `implementation`, `version`, `base_url`, `roles`, `capabilities`, `trusted_key_thumbprints` |
| `pairs` | ordered `{home, host}` descriptor ids |

The runner refuses to run (exit 2) when:
- the core profile has no manifest (`JOB_MANIFEST_REQUIRED`);
- its digest differs from the pin (`JOB_MANIFEST_DIGEST_MISMATCH`);
- it disagrees with the invocation or the target descriptors: pairs, repetitions, selected tests, profile digest or descriptor
  digests (`JOB_MANIFEST_INCONSISTENT`).

The packet carries the manifest at `manifest/job-manifest.json`, referenced by `content.x_job_manifest`.

## Trust file for offline verification

```json
{ "profile_mode": "pc-core-service-0.1", "profile_sha256": "<pinned>", "job_manifest_sha256": "<pinned>",
  "signers": { "<descriptor id>": { "thumbprints": ["<RFC 7638>"] } }, "runner": { "id": "runner:project-connect", "thumbprint": "<per-run key>" } }
```

- `profile_mode` selects the core-service branch (`verifier/core-service.mjs`). Without it, the verifier runs exactly its
  historical checks, so there is no silent fallback either way: a core packet under a historical trust file fails the profile
  check.
- Signer pins come from the operator's target configuration (`trusted_key_thumbprints`), carried through the pinned manifest.
  Keys found in discovery or in the packet are never trusted on their own.

## Offline checks added in core mode
- **profile:** `profile/pc-core-service-0.1.json`, hash equal to the trust pin, `scenario_binding: "job-pairs"`.
- **job-manifest:** the file's JCS hash equals the trust pin (and the content reference); its profile digest equals the trust
  pin; packet subjects are **exactly** the pinned pair endpoints with the pinned base URLs; trust signers are exactly those
  endpoints.
- **results:** exactly one row per selected test (except `PC-VER-1`, which the verifier decides) × pinned pair × repetition 1..N,
  with scenario `home:host`. Any of the following is rejected:
  - an omitted, substituted or extra pair;
  - a missing or duplicate row;
  - an unexpected test id or repetition;
  - a `not_applicable` row not permitted by the profile's applicability rules (evaluated from the manifest);
  - any `fail`;
  - zero passing rows (zero-test or all-N/A evidence).
- **report `qualification`** (only for a verified packet):
  - `full_profile` when every profile test was selected and no row is N/A by a rule of kind `unsupported`;
  - otherwise `partial`, with the unsupported rows listed.

## Applicability rules (`applicability.rules`)

| Test | Not applicable when | Kind |
|---|---|---|
| `PC-DISC-5` | `key-drill` not declared by both targets | unsupported (partial) |
| `PC-REV-4`, `PC-REV-5` | `outage-drill` not declared by both targets | unsupported (partial) |
| `PC-PROV-1` | the home's pinned implementation is `project-connect-reference-node` | not_applicable |
| `PC-INTEROP-AB` | the pinned home and host implementations are equal | not_applicable |
| `PC-INTEROP-BA` | the implementations are equal, or the reverse pair is not pinned | not_applicable |

**Derived interoperability** uses the pinned implementation pair, never scenario labels.
- `AB` passes when the golden thread (PEER-1, IDC-1..3, GRANT-1/2, ENF-1/2, RCPT-1) passed home→host.
- `BA` passes when it also passed host→home in the same repetition.

An implementation label is a declaration, not proof of independence. Each subject's discovery build identity is in the packet
(`content.subjects[].software`), and the composition pins descriptor, runner and lockfile digests. Shared code lineage between
implementations must be recorded separately (S4C) before interop rows are read as independence evidence.

## Implementation descriptors (examples)

```json
[{ "id": "alpha-1", "implementation": "interlateral-platform-alpha", "version": "<build>", "base_url": "http://alpha-1.localhost:4601",
   "roles": ["home", "host"], "setup": { "kind": "harness-control-v1", "control_url": "http://127.0.0.1:4680", "node": "alpha-1" },
   "capabilities": ["outage-drill", "key-drill"], "trusted_key_thumbprints": ["<RFC 7638 of alpha-1's signing key>"] },
 { "id": "beta-1", "implementation": "interlateral-platform-beta", "version": "<build>", "base_url": "http://beta-one.localhost:4101",
   "roles": ["home", "host"], "setup": { "kind": "harness-control-v1", "control_url": "http://127.0.0.1:4180", "node": "beta-one" },
   "capabilities": ["outage-drill", "key-drill"], "trusted_key_thumbprints": ["<RFC 7638 of beta-one's key>"] },
 { "id": "ref-1", "implementation": "project-connect-reference-node", "version": "0.0.2", "base_url": "http://ref-1.localhost:4500",
   "roles": ["home", "host"], "setup": { "kind": "reference-admin-v1" }, "capabilities": [], "credentials_ref": "ref-1.json",
   "trusted_key_thumbprints": ["<RFC 7638 of ref-1's key>"] }]
```

The full S4C matrix is one job with pairs `alpha-1:beta-1`, `beta-1:alpha-1`, `alpha-1:ref-1`, `ref-1:alpha-1`, `beta-1:ref-1`,
`ref-1:beta-1`, `gate: "all"`, and repetitions ≥ 2 on fresh fixtures. Reference/reference is useful evidence but never
Alpha/Beta proof.

### Setup gaps to close when Alpha mounts
1. **Setup kind for Alpha.** Either a `harness-control-v1` control API with the same routes as `scripts/federation-local.mjs`
   (`/nodes`, `/setup/event|credential|local-participant|phase|close|attest`, `/ops/stop|start|key-drill`), or an admin API
   matching `reference-admin-v1` (`/ilp/v1/admin/events|credentials|events/{id}/local-participants|events/{id}/state|attestations`).
2. **Attestation.** SG-4 needs every subject to sign the packet's content root with its instance key (admin `attestations` or
   harness `/setup/attest`).
3. **Reachability.** Targets must reach the runner's `pc-aux` node (`http://pc-aux.localhost:<aux-port>`) and each other; this
   slice is same-host.
4. **Drills.** `outage-drill`/`key-drill` must be declared only where the setup kind can perform them.
5. **Concurrency.** Concurrent jobs against the same targets conflict, because runner nodes share hostnames. Run one matrix job at
   a time.

## Proposed certification record (separate from any job result and from platform admission)

```json
{ "format": "pc-certification-record/0 (proposal)", "issuer": "<policy owner, e.g. Interlateral conformance board>", "policy": "<policy id/version and URL>",
  "subject": { "implementation": "<name>", "build": "<discovery software.build>", "deployment_config_sha256": "<…>", "descriptor_sha256": "<…>" },
  "profile": { "id": "pc-core-service-0.1", "version": "0.1.0", "sha256": "<…>" }, "roles": ["home", "host"],
  "evidence": [{ "content_root": "<packet>", "job_manifest_sha256": "<…>", "verifier_report_sha256": "<…>", "qualification": "full_profile" }],
  "counterparts": ["<implementation × direction pairs covered>"], "issued_at": "<date>", "expires_at": "<date>",
  "retest_triggers": ["build change", "profile revision", "key compromise or rotation", "failed spot check"],
  "withdrawal": "<process and status URL>", "signature": "<issuer JWS over the record>" }
```

A record is issued by a policy owner after reviewing verified evidence. A job's `full_profile` qualification is an input to that
decision, not the decision. Whether a node, operator or identity issuer is admitted to a platform is a separate governance act.
