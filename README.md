# Project Connect

Project Connect is the interoperability and conformance-testing project for the
first Interlateral Protocol-enabled implementations. Eventually, once this is stable and production-ready, the name should become something like "Interlateral Connect" and can have a simple certification mark for systems that conform to the protocol and are confirmed to be interoperable (ie they have permission to use an "Interlateral Connect" logo, can be listed in a directory of certified systems, and can be connected to the federation so their events and users and activities are part of the network). 

The initial purpose of this repo is to prove that independently operated platforms can use a
shared protocol to discover events, establish governed trust, admit remote
participants, preserve human and agent identity provenance, issue and verify
signed authorization, exchange receipts, and produce verifiable event records
without sharing a database or surrendering local control.

## What you can use today

The specification is a working draft and every result below is a **candidate
result only. Nothing here is certified.** Three things work now, on one machine,
over loopback, with no database, tunnel, or network access beyond `npm ci`. Each
has a tested walkthrough in the [Quickstart](#quickstart).

1. **Run a reference node and read its discovery document.**
   `node reference-node/main.mjs --base-url http://ref-a.localhost:4740 --port 4740 --host 127.0.0.1 --key-file .run/ref-a/key.json --admin-token-file .run/ref-a/admin.token --dev`,
   then `curl -fsS http://ref-a.localhost:4740/.well-known/interlateral.json`.
2. **Run the standalone conformance job service against nodes you control and
   get a report.** `node service/cli.mjs submit --url http://127.0.0.1:4742 --file .run/svc/request.json`,
   then `node service/cli.mjs results …`. The report gives a row per test, counts, and a
   `qualification` that stays `partial` unless every profile test was selected.
3. **Export the job's evidence packet, verify it offline, and see a tampered
   copy rejected.** `node verifier/cli.mjs .run/packet --trust .run/trust.json --out .run/report`
   prints `PASS`; the same command on a copy with one flipped bit prints `FAIL`.

Everything else (formal acceptance gates, certification, multi-party
interoperability between independently operated implementations, a hosted
service) is **not yet usable**. See [ROADMAP.md](ROADMAP.md).

## Initial implementations

The first integration targets are:

- the production Interlateral Platform at `events.interlateral.com`, connected
  through a bounded protocol adapter; and
- the protocol-first Interlateral Platform beta/reference implementation at
  `open-events.interlateral.com`.

Project Connect is intended to test the protocol from the outside. Conformance
must be demonstrated through public protocol surfaces and observable behavior,
not through shared implementation internals.

## Initial scope

1. Instance discovery and protocol-version negotiation.
2. Explicit, allowlisted peer establishment.
3. Federated event directory publication and aggregation.
4. Audience-bound, short-lived remote identity claims.
5. Cryptographically signed authorization grants, distinct from identity
   claims, that state who granted what authority to which human or agent, for
   which event and actions, under what limits, and until when.
6. Host-controlled remote registration and approval.
7. Host-issued, event-scoped participant credentials bound to the signed grant,
   participant identity, agent identity when present, and home node.
8. Human, agent, authorization, and origin provenance in actions, receipts, and
   exports.
9. Signed authorization revocation, peer suspension, expiry, replay, and
   peer-failure behavior.
10. Black-box conformance tests and reproducible evidence.

Identity and authorization are separate protocol concerns. An identity claim
answers **who the principal is**. A signed authorization grant answers **whether
that principal may perform a particular action, who granted that authority, and
under which scope, mandate, constraints, and expiration**. A conforming
implementation must not infer authority merely from a valid identity claim.

## First success milestone

Two independently deployed implementations pass a shared conformance profile:

- an event created on one instance appears on the other;
- a verified participant from the second instance requests access;
- the event host approves the request and issues a signed, event-scoped
  authorization grant plus credentials bound to that grant;
- the remote participant completes an action permitted by the grant;
- an out-of-scope action is rejected;
- expired, replayed, tampered, or revoked authorization is rejected;
- authorization signatures and revocation evidence can be verified without
  trusting either implementation's private database; and
- the resulting receipt and export preserve the participant's home-instance
  identity, agent, authorization-grant, issuer, and action provenance and verify
  without database access.

The detailed first test and its proof requirements are discussion drafts:

- [Acceptance Profile v0.1](docs/ACCEPTANCE-PROFILE-v0.1.md)
- [Evidence Packet v0.1](docs/EVIDENCE-PACKET-v0.1.md)
- [Node Certification Evidence Pack v0.1](docs/NODE-CERTIFICATION-EVIDENCE-PACK-v0.1.md)

The result deliberately separates per-implementation conformance from pairwise
interoperability. The first passing run should yield two implementation results
and one result for the exact tested implementation pair.

## Project posture

- Each event has one authoritative home instance.
- Identity evidence from a peer does not confer authority on the host.
- Authorization is explicit, signed, scoped, time-bounded, independently
  verifiable, and revocable; possession of identity or credentials alone is not
  proof of authority.
- Each host retains admission, moderation, data, and publication control.
- Federation is explicit and governed; it is not an automatic open mesh.
- Participant content and remote protocol input are untrusted data.
- Protocol claims are supported by executable conformance tests.

## Status

Working draft. This repository contains the draft specification (`0.0.2`), two
candidate conformance profiles (`pc-0.1-s1` and the draft `pc-core-service-0.1`),
a reference node, a black-box runner, a standalone conformance job service, and
an offline evidence-packet verifier. Results are candidate results only: they are
not frozen-profile conformance and not certification. Formal acceptance,
certification, and multi-party interoperability are not yet usable.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Repository layout

| Path | Contents |
|---|---|
| `specifications/ilp_spec.md` | The Interlateral Protocol specification (working draft, currently `0.0.2`) |
| `specifications/schemas/` | Strict JSON Schemas (Draft 2020-12) for every wire-visible object |
| `specifications/releases/` | Release records pinning every normative artifact by SHA-256 |
| `profile/pc-0.1-s1.json` | The **candidate** slice-1 conformance profile: tests, scenarios, parameters, exclusions, actors, interfaces |
| `vectors/` | Canonicalization, JWS, receipt-chain, and detached-signature test vectors (deterministic; `npm run vectors`) |
| `lib/` | Minimal reference library: JCS, EdDSA JWS, receipt hashing, schema validation |
| `reference-node/` | A spec-derived reference node (home and host roles) used as a test counterpart |
| `runner/` | The black-box conformance runner |
| `service/` | The standalone conformance job service ([service/README.md](service/README.md)) |
| `verifier/` | `pc-verify`, the standalone offline evidence-packet verifier |
| `tools/` | Generators for schemas, vectors, the profile, and release records |

Results against `0.0.x` are **exploratory**. They are not frozen-profile conformance and not certification.

## Quickstart

Needs Node.js 22 or newer, `openssl`, and `curl`. The job service is tested on
macOS; Linux is untested and Windows is unsupported (see
[service/README.md](service/README.md)). Run everything from the repository root.

```sh
npm ci
npm test
```

Runtime files go in `.run/`, which is gitignored. They include admin tokens and
private keys. Do not commit them.

### 1. Start a reference node and read its discovery document

```sh
umask 077
mkdir -p .run/ref-a .run/ref-b
openssl rand -hex 32 > .run/ref-a/admin.token
openssl rand -hex 32 > .run/ref-b/admin.token
node reference-node/main.mjs --base-url http://ref-a.localhost:4740 --port 4740 --host 127.0.0.1 --key-file .run/ref-a/key.json --admin-token-file .run/ref-a/admin.token --dev
```

`--dev` creates the key file once (mode `0600`) and never overwrites it. Pass
`--host 127.0.0.1`: without it the node listens on `::`, which is every
interface. `*.localhost` names resolve to loopback. In a second shell:

```sh
curl -fsS http://ref-a.localhost:4740/.well-known/interlateral.json
```

Expect `"protocol":"ilp/1"`, `instance.software.name`
`project-connect-reference-node`, `federation.active_kid`, and one public Ed25519
key. `/healthz` returns `{"ok":true}`. The `conformance.mode` value
`certification` is a protocol field, not a certification of the node.

Step 2 needs a pair, so start a second node in a third shell:

```sh
node reference-node/main.mjs --base-url http://ref-b.localhost:4741 --port 4741 --host 127.0.0.1 --key-file .run/ref-b/key.json --admin-token-file .run/ref-b/admin.token --dev
```

### 2. Run the conformance service against nodes you control

The service runs only targets the operator registered. A job request names
registered target ids; it never carries URLs, commands, or setup data. This
writes the configuration for the two nodes above into `.run/svc/` (absolute,
owner-only paths, as the service requires):

```sh
umask 077
mkdir -p .run/svc/config .run/svc/state .run/svc/secrets
openssl rand -hex 32 > .run/svc/api.token
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { thumbprint } from "./verifier/verify.mjs";
const S = `${process.cwd()}/.run/svc`, put = (f, v) => writeFileSync(`${S}/${f}`, JSON.stringify(v, null, 2) + "\n");
const nodes = { "ref-a": 4740, "ref-b": 4741 };
put("config/service.json", { state_dir: `${S}/state`, secrets_dir: `${S}/secrets`, listen: { host: "127.0.0.1", port: 4742 },
  profiles: { "pc-core-service-0.1": `${process.cwd()}/profile/pc-core-service-0.1.json` },
  runner: { node: process.execPath, entry: `${process.cwd()}/runner/service-run.mjs`, env: {} }, port_pool: { from: 4743, to: 4744 } });
put("config/tokens.json", [{ id: "me", role: "submitter",
  token_sha256: createHash("sha256").update(readFileSync(`${S}/api.token`, "utf8").trim()).digest("hex") }]);
put("config/targets.json", Object.entries(nodes).map(([id, port]) => {
  put(`secrets/${id}.json`, { admin_token: readFileSync(`.run/${id}/admin.token`, "utf8").trim() });
  const key = JSON.parse(readFileSync(`.run/${id}/key.json`, "utf8")); // your own key file is the out-of-band trust source
  return { id, implementation: "project-connect-reference-node", version: "0.0.2", base_url: `http://${id}.localhost:${port}`,
    roles: ["home", "host"], setup: { kind: "reference-admin-v1" }, capabilities: [], credentials_ref: `${id}.json`,
    trusted_key_thumbprints: key.keys.filter((k) => k.kid === key.active_kid).map(thumbprint) };
}));
put("request.json", { profile: "pc-core-service-0.1", gate: "SG-2", pairs: [{ home: "ref-a", host: "ref-b" }], reps: 1, also: ["PC-EXP-1", "PC-VER-1"] });
EOF
```

Start the service in its own shell, then submit the job from another:

```sh
node service/cli.mjs serve --config .run/svc/config
```

```sh
export CONNECT_TOKEN="$(cat .run/svc/api.token)"
node service/cli.mjs submit --url http://127.0.0.1:4742 --file .run/svc/request.json
node service/cli.mjs status --url http://127.0.0.1:4742 --job JOB_ID
node service/cli.mjs results --url http://127.0.0.1:4742 --job JOB_ID > .run/job-report.json
```

`submit` prints the job `id`; use it as `JOB_ID`. The job takes a few seconds.
`results` answers `409` until the job is terminal. The report has one row per
test (17 for this request), `counts`, and `qualification`. `succeeded` means only
that the requested tests ran and none failed. This request selects gate `SG-2`
plus `PC-EXP-1` and `PC-VER-1`, so `qualification.scope` is `partial`. The drill
tests run only through a harness control API, so a job on two reference nodes
stays partial. The runner starts two reference nodes of its own on ports
`4743` and `4744` from the service's port pool and stops them before it exits. Configuration, profiles,
and limits: [service/README.md](service/README.md) and
[docs/core-service-profile.md](docs/core-service-profile.md).

### 3. Export the evidence packet, verify it offline, and reject a flipped byte

`PC-VER-1` makes the job assemble an evidence packet and the trust file the
packet is checked against. Both stay private in the job directory. Copy them out:

```sh
JOB=JOB_ID
cp -R .run/svc/state/jobs/$JOB/raw/packet .run/packet
cp .run/svc/state/jobs/$JOB/raw/trust.json .run/trust.json
node verifier/cli.mjs .run/packet --trust .run/trust.json --out .run/report
```

Exit `0` and `PASS`. The `results` check counts 16 rows, not 17: the verifier
itself decides `PC-VER-1`, so that row is not in the packet. The verifier reads
only the packet and the trust file. The
trust file pins the profile digest, the job manifest digest, the node key
thumbprints from `targets.json`, and the runner's per-run key; a key found only
inside the packet is never trusted. Before you rely on a packet someone else sent, check those pins against
thumbprints you approved yourself. The packet format is `pc-evidence/1`:
`content.json` lists every file's SHA-256, `envelope.json` binds it, and
`attestations/*.jws` are the node and runner signatures over it.

Flip one bit in a copy and verify again:

```sh
cp -R .run/packet .run/packet-flipped
node -e 'const fs=require("fs"),f=process.argv[1],b=fs.readFileSync(f);b[b.length>>1]^=1;fs.writeFileSync(f,b)' .run/packet-flipped/results/results.jsonl
node verifier/cli.mjs .run/packet-flipped --trust .run/trust.json --out .run/report-flipped
```

Exit `1` and `FAIL`, with `FAIL files: hash mismatch results/results.jsonl`.

On macOS, `node runner/offline.mjs DIR` (where `DIR` holds `packet/` and
`trust.json`) repeats the verification from a fresh clone under a sandbox that
denies network and private-file access. Its tamper step appends to
`profile/pc-0.1-s1.json`, so on a `pc-core-service-0.1` packet the tampered copy
is rejected as `unlisted file`, not as a hash mismatch.

Stop the service and both nodes with Ctrl-C.
