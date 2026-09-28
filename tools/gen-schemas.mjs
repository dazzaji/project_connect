// Generates specifications/schemas/*.schema.json (ILP 0.0.2, OI-1/OI-2).
// Strict on emit: closed member sets, except that `x_` extension members are always permitted (R-CORE-39(c)).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = process.env.ILP_GEN_OUT ? join(process.env.ILP_GEN_OUT, "schemas") : join(dirname(fileURLToPath(import.meta.url)), "..", "specifications", "schemas");
const S = "https://json-schema.org/draft/2020-12/schema";

const X = { "^x_": {} };
const obj = (required, properties, extra = {}) => ({
  type: "object",
  additionalProperties: false,
  patternProperties: X,
  required,
  properties,
  ...extra,
});
// Identity claims are a closed member set (R-ID-18, R-SEC-19): no extension members, at any level.
const closed = (required, properties, extra = {}) => {
  const strip = (s) => {
    if (!s || typeof s !== "object") return s;
    if (Array.isArray(s)) return s.map(strip);
    const { patternProperties, ...rest } = s;
    return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, strip(v)]));
  };
  return strip(obj(required, properties, extra));
};
const globalId = { type: "string", pattern: "^ilp:[a-z0-9.-]+:[a-z_]+:[A-Za-z0-9-]+$" };
const gid = (type) => ({ type: "string", pattern: `^ilp:[a-z0-9.-]+:${type}:[A-Za-z0-9-]+$` });
const host = { type: "string", pattern: "^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", maxLength: 253 };
const baseUrl = { type: "string", pattern: "^https?://[a-z0-9.-]+(:[0-9]{1,5})?$", $comment: "scheme + host [+ port], no path" };
const url = { type: "string", pattern: "^https?://[^\\s]+$" };
const numericDate = { type: "integer", minimum: 0, maximum: 9007199254740991 };
const dateTime = { type: "string", format: "date-time" };
const hex64 = { type: "string", pattern: "^[0-9a-f]{64}$" };
const b64u = { type: "string", pattern: "^[A-Za-z0-9_-]+$" };
const plate = { type: "string", pattern: "^IL-[A-Z2-9]{8}$" };
const jwsCompact = { type: "string", pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$" };
const specVersion = { type: "string", pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$" };
const mandate = { enum: ["human_directed", "human_approved", "standing_instruction", "agent_draft_unaccepted"] };
const packRef = { type: "string", pattern: "^[a-z0-9][a-z0-9-]*@[0-9]+\\.[0-9]+$" };
const jwk = obj(["kid", "kty", "crv", "x", "use"], {
  kid: { type: "string", minLength: 1 },
  kty: { const: "OKP" },
  crv: { const: "Ed25519" },
  x: { ...b64u, minLength: 43, maxLength: 43 },
  use: { const: "sig" },
  not_after: dateTime,
});

const schema = (name, title, body, comment) => ({
  $schema: S,
  $id: `urn:ilp:schema:${name.id}:v${name.gen}`,
  title,
  ...(comment ? { $comment: comment } : {}),
  ...body,
});

const schemas = {
  discovery: schema(
    { id: "discovery", gen: 2 },
    "ILP instance discovery document (/.well-known/interlateral.json) — R-CORE-20, R-CORE-30..33",
    obj(["protocol", "protocols", "spec_versions", "instance", "keys", "endpoints", "packs", "federation"], {
      protocol: { const: "ilp/1" },
      protocols: { type: "array", minItems: 1, items: { type: "string", pattern: "^ilp/[0-9]+$" } },
      spec_versions: { type: "array", minItems: 1, items: specVersion, uniqueItems: true },
      profiles: { type: "array", items: { type: "string" }, uniqueItems: true },
      instance: obj(["host", "name", "software", "deployment_id"], {
        host,
        name: { type: "string", minLength: 1, maxLength: 200 },
        operator_contact: { type: "string" },
        federation_policy_url: url,
        software: obj(["name", "version", "build"], {
          name: { type: "string", minLength: 1 },
          version: { type: "string", minLength: 1 },
          build: { type: "string", minLength: 1, $comment: "immutable identifier of the running code (R-CORE-30)" },
        }),
        deployment_id: { type: "string", minLength: 1 },
      }),
      keys: {
        type: "array",
        minItems: 1,
        items: jwk,
        $comment: "Exactly one key is active (R-CORE-34(d)); the active kid is `federation.active_kid`.",
      },
      endpoints: obj(["api", "federation", "directory", "revocations"], {
        api: url,
        federation: url,
        directory: url,
        revocations: url,
      }),
      packs: {
        type: "array",
        items: obj(["id", "version"], {
          id: { type: "string" },
          version: { type: "string", pattern: "^[0-9]+\\.[0-9]+$" },
          compatible_versions: { type: "array", items: { type: "string", pattern: "^[0-9]+\\.[0-9]+$" } },
        }),
      },
      federation: obj(["mode", "join_requests", "revocation_bound_s", "active_kid", "remote_session_policy"], {
        mode: { enum: ["allowlist"] },
        join_requests: { type: "boolean" },
        revocation_bound_s: { type: "integer", minimum: 1, maximum: 600 },
        active_kid: { type: "string", minLength: 1, $comment: "SCR-3: the single active signing key (R-CORE-34(g))" },
        remote_session_policy: obj(["on_stale_revocation_state", "after_s"], {
          on_stale_revocation_state: { enum: ["pause", "continue"] },
          after_s: { type: "integer", minimum: 1, $comment: "default 2 × revocation_bound_s (R-FED-21a)" },
        }),
      }),
      conformance: obj(["mode"], {
        mode: { enum: ["production", "certification"] },
        revocation_bound_s: { type: "integer", minimum: 1 },
        grant_ttl_s: { type: "integer", minimum: 1 },
        contact: { type: "string" },
      }, { $comment: "R-OPS-10: declared parameters of a node under certification" }),
      current_event: obj(["slug", "title", "url"], {
        slug: { type: "string" },
        title: { type: "string" },
        url,
        skill_md: url,
      }),
    }),
  ),

  "identity-claim": schema(
    { id: "identity-claim", gen: 2 },
    "ILP identity claim — payload of an ilp-claim+jwt (R-ID-17)",
    closed(
      ["iss", "sub", "aud", "iat", "exp", "jti", "display_name", "verified", "verified_method", "agent", "purpose", "event", "consent_accepted"],
      {
        iss: baseUrl,
        sub: gid("human"),
        aud: baseUrl,
        iat: numericDate,
        exp: numericDate,
        jti: { type: "string", minLength: 16, maxLength: 200 },
        display_name: { type: "string", minLength: 1, maxLength: 200 },
        verified: { type: "boolean" },
        verified_method: { type: ["string", "null"] },
        agent: {
          oneOf: [
            { type: "null" },
            obj(["id", "display_name", "license_plate"], {
              id: gid("agent"),
              display_name: { type: "string", minLength: 1, maxLength: 200 },
              license_plate: plate,
            }),
          ],
        },
        purpose: { const: "event_join" },
        event: gid("event"),
        consent_accepted: {
          oneOf: [
            { type: "null" },
            obj(["kind", "text_version", "text_sha256"], { kind: { type: "string" }, text_version: { type: "string" }, text_sha256: hex64 }),
          ],
        },
      },
    ),
    "exp − iat ≤ 86400 is a semantic rule (R-ID-18). The member set is CLOSED, including to `x_` extensions (R-ID-18 overrides R-CORE-39(c) for claims); a receiver still ignores unknown members (R-CORE-39(b)).",
  ),

  "authorization-grant": schema(
    { id: "authorization-grant", gen: 1 },
    "ILP authorization grant — payload of an ilp-grant+jwt (R-AUTHZ-4)",
    obj(
      ["iss", "aud", "jti", "sub", "agent", "event", "home", "role", "authorization_details", "iat", "nbf", "exp", "credential_binding", "status", "parent_grant"],
      {
        iss: baseUrl,
        aud: baseUrl,
        jti: gid("grant"),
        sub: gid("human"),
        agent: {
          oneOf: [{ type: "null" }, obj(["id", "license_plate"], { id: gid("agent"), license_plate: plate })],
        },
        event: gid("event"),
        home: host,
        role: { type: "string", minLength: 1 },
        authorization_details: {
          type: "array",
          minItems: 1,
          items: obj(["type", "pack", "actions"], {
            type: { const: "ilp.pack_action" },
            pack: packRef,
            actions: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^[a-z0-9_-]+\\.[a-z0-9_.-]+$" } },
            limits: { type: "object" },
          }),
        },
        exclusions: { type: "array", uniqueItems: true, items: { type: "string" } },
        mandates_allowed: { type: "array", minItems: 1, uniqueItems: true, items: mandate },
        consent: obj(["text_version", "text_sha256"], { text_version: { type: "string" }, text_sha256: hex64 }),
        iat: numericDate,
        nbf: numericDate,
        exp: numericDate,
        credential_binding: obj(["alg", "value"], { alg: { const: "S256" }, value: { ...b64u, minLength: 43, maxLength: 43 } }),
        status: obj(["uri"], { uri: url }),
        parent_grant: { type: "null" },
      },
    ),
    "aud equals iss (a grant is evaluated only by its issuer). nbf ≤ exp; exp bounded by the credential (R-AUTHZ-5).",
  ),

  "grant-status": schema(
    { id: "grant-status", gen: 1 },
    "ILP grant status document — GET /ilp/v1/grants/{id}/status (R-AUTHZ-9)",
    obj(["status", "changed_at"], {
      status: { enum: ["active", "revoked", "expired", "superseded", "suspended"] },
      changed_at: dateTime,
      reason: { type: "string", maxLength: 500 },
    }),
  ),

  "revocation-record": schema(
    { id: "revocation-record", gen: 1 },
    "ILP revocation record — payload of an ilp-revocation+jwt (R-FED-10)",
    obj(["iss", "jti", "iat", "kind", "subject", "revoked_at", "seq"], {
      iss: baseUrl,
      jti: gid("revocation"),
      iat: numericDate,
      kind: { enum: ["claim", "human", "agent", "plate", "grant", "peer"] },
      subject: { type: "string", minLength: 1, maxLength: 300 },
      revoked_at: dateTime,
      reason: { type: "string", maxLength: 200 },
      reinstated: { type: "boolean", $comment: "SCR-4: true on a peer record that lifts an earlier suspension" },
      seq: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    }),
  ),

  "revocation-feed": schema(
    { id: "revocation-feed", gen: 1 },
    "ILP revocation feed page — GET /ilp/v1/federation/revocations?since=<seq>",
    obj(["items", "next_cursor", "latest_seq"], {
      items: { type: "array", items: obj(["seq", "jws"], { seq: { type: "integer", minimum: 1 }, jws: jwsCompact }) },
      next_cursor: { type: ["string", "null"] },
      latest_seq: { type: "integer", minimum: 0 },
    }),
  ),

  "peer-record": schema(
    { id: "peer-record", gen: 1 },
    "ILP peer record — GET /ilp/v1/federation/peers items (R-FED-3, R-FED-4, R-FED-15)",
    obj(["host", "base_url", "state", "spec_versions", "common_spec_versions", "updated_at"], {
      host,
      base_url: baseUrl,
      state: { enum: ["proposed", "active", "suspended", "removed"] },
      spec_versions: { type: "array", items: specVersion },
      common_spec_versions: { type: "array", items: specVersion, $comment: "an empty array surfaces a version mismatch (R-FED-15)" },
      discovery_sha256: hex64,
      policy_url: url,
      updated_at: dateTime,
    }),
  ),

  "directory-entry": schema(
    { id: "directory-entry", gen: 1 },
    "ILP federated directory entry (R-FED-5, R-FED-19)",
    obj(["global_id", "slug", "title", "description", "pack", "status", "starts_at", "policy", "home", "updated_at"], {
      global_id: gid("event"),
      slug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$" },
      title: { type: "string", maxLength: 300 },
      description: { type: ["string", "null"], maxLength: 5000 },
      pack: obj(["id", "version"], { id: { type: "string" }, version: { type: "string" }, known: { type: "boolean" } }),
      status: { enum: ["draft", "open", "live", "closed", "archived"] },
      starts_at: { type: ["string", "null"], format: "date-time" },
      policy: obj(["identity_required", "remote_participants"], {
        identity_required: { type: "boolean" },
        remote_participants: { enum: ["allowed", "denied"] },
      }),
      home: obj(["host", "api"], { host, api: url }),
      updated_at: dateTime,
    }),
  ),

  "join-request": schema(
    { id: "join-request", gen: 1 },
    "ILP join request status — GET /ilp/v1/events/{event}/join-requests/{id} (§10.4 step 6)",
    obj(["join_request_id", "event", "status", "subject"], {
      join_request_id: gid("join_request"),
      event: gid("event"),
      status: { enum: ["pending", "approved", "rejected"] },
      subject: gid("human"),
      participant_token: { type: "string", pattern: "^ilpt_[A-Za-z0-9_-]{16,}$", $comment: "present only when approved; a host MAY deliver it only once (then token_delivered is true)" },
      grant: { ...jwsCompact, $comment: "the ilp-grant+jwt; present only when approved" },
      token_delivered: { type: "boolean", $comment: "true when the token was already delivered by an earlier retrieval (SCR-7)" },
      reason: { type: "string", maxLength: 500 },
    }, {
      allOf: [
        // credentials only on an approved request
        { if: { properties: { status: { not: { const: "approved" } } } }, then: { properties: { participant_token: false, grant: false } } },
        // a token is never re-delivered (SCR-7)
        { if: { properties: { token_delivered: { const: true } }, required: ["token_delivered"] }, then: { properties: { participant_token: false } } },
        // an approved response carries the grant, and either the token (first retrieval) or token_delivered: true
        { if: { properties: { status: { const: "approved" } }, required: ["status"] }, then: { required: ["grant"], anyOf: [{ required: ["participant_token"] }, { properties: { token_delivered: { const: true } }, required: ["token_delivered"] }] } },
      ],
    }),
  ),

  receipt: schema(
    { id: "receipt", gen: 2 },
    "ILP receipt (R-CORE-22..25, R-CORE-40)",
    closed(["id", "event", "action_kind", "subject_human", "subject_agent", "license_plate", "mandate", "resource", "occurred_at", "prev_receipt_hash", "hash"], {
      id: gid("receipt"),
      event: gid("event"),
      action_kind: { type: "string", minLength: 1 },
      subject_human: gid("human"),
      subject_agent: { oneOf: [gid("agent"), { type: "null" }] },
      license_plate: { oneOf: [plate, { type: "null" }] },
      mandate,
      source_class: { enum: ["browser_ui", "agent_token_api", "engine"] },
      authorization_grant: gid("grant"),
      resource: globalId,
      occurred_at: dateTime,
      prev_receipt_hash: hex64,
      hash: hex64,
    }),
    "Wire members equal the hash-body members plus `hash` (R-CORE-40.1), so the set is CLOSED, including to `x_` members, which the hash would not cover; `resource_global_id` is not a member (K-21).",
  ),

  "export-manifest": schema(
    { id: "export-manifest", gen: 2 },
    "ILP export bundle manifest (ilp-export/1, R-EV-25, §14.1)",
    obj(["format", "event", "created_at", "created_by", "instance", "files", "receipts_head_hash", "consent_versions", "kid", "signature"], {
      format: { const: "ilp-export/1" },
      event: gid("event"),
      created_at: dateTime,
      created_by: globalId,
      instance: obj(["host", "kid"], { host, kid: { type: "string" }, build: { type: "string" } }),
      files: {
        type: "array",
        minItems: 1,
        items: obj(["path", "sha256", "bytes"], {
          path: { type: "string", pattern: "^[A-Za-z0-9_./-]+$", not: { pattern: "(^|/)\\.\\.(/|$)" } },
          sha256: hex64,
          bytes: { type: "integer", minimum: 0 },
        }),
      },
      receipts_head_hash: hex64,
      consent_versions: {
        type: "array",
        items: obj(["kind", "text_version", "text_sha256"], { kind: { type: "string" }, text_version: { type: "string" }, text_sha256: hex64, license_id: { type: "string" } }),
      },
      remote_origins: { type: "array", items: host },
      kid: { type: "string", $comment: "R-CORE-36(b): the signing kid is a member of the signed object" },
      signature: b64u,
    }),
    "Additive files in 0.0.2: grants.jsonl, revocations.jsonl, claims.jsonl (consent-filtered).",
  ),

  attestation: schema(
    { id: "attestation", gen: 1 },
    "ILP attestation — payload of an ilp-attestation+jwt over an evidence packet content root (R-CORE-36(a))",
    obj(["iss", "jti", "iat", "role", "content_root", "profile", "build"], {
      iss: { type: "string", minLength: 1, $comment: "node base URL, or runner:<id>" },
      jti: { type: "string", minLength: 1 },
      iat: numericDate,
      role: { enum: ["node", "runner", "verifier"] },
      content_root: hex64,
      profile: { type: "string" },
      build: { type: "string" },
      statement: { type: "string", maxLength: 2000 },
    }),
  ),

  "test-result": schema(
    { id: "test-result", gen: 1 },
    "Project Connect test result",
    obj(["test_id", "scenario", "repetition", "status", "traces", "started_at", "elapsed_ms", "observations"], {
      test_id: { type: "string", pattern: "^PC-[A-Z]+-[A-Z0-9]+$" },
      scenario: { type: "string", pattern: "^SC-[0-9]+$" },
      repetition: { type: "integer", minimum: 1 },
      status: { enum: ["pass", "fail", "not_applicable"] },
      traces: { type: "array", items: { type: "string", pattern: "^R-[A-Z]+-[0-9]+[a-z]?$" } },
      started_at: dateTime,
      elapsed_ms: { type: "integer", minimum: 0 },
      observations: { type: "object" },
      failure: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
    }),
  ),

  "evidence-packet-manifest": schema(
    { id: "evidence-packet-manifest", gen: 1 },
    "Project Connect evidence packet — content manifest (content.json) and envelope manifest (envelope.json)",
    {
      oneOf: [{ $ref: "#/$defs/content" }, { $ref: "#/$defs/envelope" }],
      $defs: {
        content: obj(["format", "run_id", "profile", "spec_version", "subjects", "runner", "files", "summary"], {
          format: { const: "pc-evidence/1" },
          run_id: { type: "string", minLength: 1 },
          profile: obj(["id", "sha256"], { id: { type: "string" }, sha256: hex64 }),
          spec_version: specVersion,
          subjects: {
            type: "array",
            minItems: 2,
            items: obj(["label", "host", "base_url", "software", "deployment_id", "discovery_sha256", "keys"], {
              label: { type: "string" },
              host,
              base_url: baseUrl,
              software: obj(["name", "version", "build"], { name: { type: "string" }, version: { type: "string" }, build: { type: "string" } }),
              deployment_id: { type: "string" },
              discovery_sha256: hex64,
              keys: { type: "array", minItems: 1, items: jwk },
            }),
          },
          runner: obj(["id", "build"], { id: { type: "string" }, build: { type: "string" } }),
          files: {
            type: "array",
            minItems: 1,
            items: obj(["path", "sha256", "bytes"], {
              path: { type: "string", pattern: "^[A-Za-z0-9_./-]+$", not: { pattern: "(^|/)\\.\\.(/|$)" } },
              sha256: hex64,
              bytes: { type: "integer", minimum: 0 },
            }),
          },
          summary: obj(["tests", "passed", "failed", "not_applicable"], {
            tests: { type: "integer", minimum: 0 },
            passed: { type: "integer", minimum: 0 },
            failed: { type: "integer", minimum: 0 },
            not_applicable: { type: "integer", minimum: 0 },
          }),
        }),
        envelope: obj(["format", "content_manifest", "content_root", "attestations"], {
          format: { const: "pc-evidence-envelope/1" },
          content_manifest: obj(["path", "sha256"], { path: { const: "content.json" }, sha256: hex64 }),
          content_root: hex64,
          attestations: {
            type: "array",
            minItems: 1,
            items: obj(["path", "sha256", "signer"], { path: { type: "string" }, sha256: hex64, signer: { type: "string" } }),
          },
        }),
      },
    },
    "content_root = SHA-256 of JCS(content.json). Attestations sign content_root. The verifier report is produced outside the packet.",
  ),

  problem: schema(
    { id: "problem", gen: 2 },
    "ILP problem document (RFC 9457 profile, R-CORE-9, R-CORE-9a)",
    {
      type: "object",
      required: ["type", "title", "status"],
      properties: {
        type: { type: "string", pattern: "^urn:ilp:error:[A-Z0-9_]+$" },
        title: { type: "string", pattern: "^[A-Z0-9_]+$" },
        status: { type: "integer", minimum: 400, maximum: 599 },
        detail: { type: "string" },
        instance: { type: "string" },
        code_detail: { type: "string", pattern: "^[A-Z0-9_]+$" },
        recovery: { type: "string" },
        retry_after: { type: "integer", minimum: 0 },
      },
      additionalProperties: true,
      $comment: "`title` equals the code in `type`, and `status` equals the HTTP status (semantic rules). Recovery-context members are open (R-CORE-10).",
    },
  ),
};

mkdirSync(OUT, { recursive: true });
for (const [name, s] of Object.entries(schemas)) {
  writeFileSync(join(OUT, `${name}.schema.json`), JSON.stringify(s, null, 2) + "\n");
}
console.log(`wrote ${Object.keys(schemas).length} schemas to ${OUT}`);
