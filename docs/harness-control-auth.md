# harness-control-v1: per-target control tokens

A `harness-control-v1` target may require a control credential, as the Alpha harness (`scripts/ilp-harness-control.js`)
does. The service runner sends it only when that target's entry in the job's credential file holds one:

```json
{ "alpha-a": { "control_token": "ilph_…" } }
```

The credential file is `CONNECT_CREDENTIALS_FILE`. It maps each target id to that target's credential object, which the
service builds from the target's `credentials_ref`.

## Where the token comes from

- It is read **only** from the credential file map, for that target id.
- It is never read from public descriptors, request payloads or the environment, and there is no global token.
- **Format:** an RFC 6750 bearer token (`b64token`: letters, digits, `-._~+/`, then optional trailing `=`), at most
  4096 characters. Anything else is refused before any request is sent, and the error message never contains the
  value.
  - Generated Alpha `ilph_` tokens qualify.
  - The grammar excludes quote, backslash and whitespace. A response can therefore only carry the token in another form
    through JSON escapes, which are undone before redaction.
- **Destination check:** the descriptor's `setup.control_url` must be a bare origin, which the service configuration
  already requires. The runner checks this again before it sends a token.

## How it is sent

`Authorization: Bearer <token>` goes to `<control_url>` and to no other origin, for every harness call:
- `GET /nodes`;
- the `/setup/*` calls (event, credential, local-participant, phase, close, attest);
- `/ops/stop`, `/ops/start` and `/ops/key-drill`.

**Redirects:** the runner never follows a redirect with a token. A 3xx answer fails the call, so the token cannot be
forwarded elsewhere.

**Redaction:** happens before response text can reach an error message, a result row or a packet.
- JSON responses are decoded first. Every key and string value is redacted, and the returned text is serialized again
  from that.
- Non-JSON responses are redacted literally.

**Where it is held:** in the setup adapter's closure only. It is not a property of the adapter or node objects, so it
cannot be serialized with them.

**Not sent to the product API:** the target's own ILP API (`base_url`) never receives the control token. Setup does not
call it at all.

## Targets without a token

A target without a `control_token` keeps the legacy behaviour exactly:
- unauthenticated calls through `runner/lib.mjs` `http`;
- covers the reference and Beta harnesses, and `runner/run.mjs`.

**Historical profile bytes are unchanged.**

## Tests

**Unit tests:** `tests/service/control-token80a.test.mjs` runs against fake harnesses on ephemeral loopback ports. It
covers:
- two harnesses with different tokens;
- wrong and missing tokens;
- redaction of an echoed token;
- a redirect to another origin;
- no leak across targets, and none to the product API;
- legacy targets mixed with token targets;
- validation.

**Live check against the real Alpha adapter:** the run evidence of unit 80a.
