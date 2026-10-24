// SETUP ONLY (outside the black-box run): events, scoped credentials, local participants.
// Beta nodes are set up through their harness control API; reference nodes through their admin token.
import { http } from "./lib.mjs";

// RFC 6750 b64token, at most 4096 characters: no quote, backslash, space or control character, so the only ways a
// response can carry the token in another form are JSON escapes, which are undone before redaction
// alpha207 (S4 composition only): a host harness that DECLARES optional synthetic publication consent at event setup
// returns x_publication_consent; ONLY {kind, text_version, text_sha256} is taken from it, after validation. Nothing here
// records an acceptance; the synthetic participant opts in through its own home /claims request (tests-sg3 admit()).
export function consentFromSetup(x) {
  if (x === undefined || x === null) return null;
  if (typeof x !== "object" || Array.isArray(x) || x.kind !== "publication" || typeof x.text_version !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(x.text_version)
    || typeof x.text_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(x.text_sha256)) throw new Error("x_publication_consent is malformed");
  return { kind: "publication", text_version: x.text_version, text_sha256: x.text_sha256 };
}
export const validControlToken = (t) => typeof t === "string" && t.length <= 4096 && /^[A-Za-z0-9\-._~+/]+=*$/.test(t);
const redact = (v, token) =>
  typeof v === "string" ? v.split(token).join("[redacted]")
  : Array.isArray(v) ? v.map((x) => redact(x, token))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [redact(k, token), redact(x, token)]))
  : v;

// harness-control-v1 client for one target. With a control token (only ever from the job's per-target credential file):
// Bearer to the registered control origin itself, redirects are never followed, and the token is redacted from response
// text before it can reach an error or a result. Without one: the legacy unauthenticated path, unchanged.
export function controlClient(harness, token) {
  if (!token) return (method, path, body) => http(method, `${harness}${path}`, body === undefined ? {} : { body });
  if (!validControlToken(token)) throw new Error("control token must be an RFC 6750 bearer token of at most 4096 characters");
  return async (method, path, body) => {
    const res = await fetch(`${harness}${path}`, {
      method,
      redirect: "manual",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    // redaction after decoding: a JSON response may carry the token escaped (\" or \\ in an accepted token), so every
    // decoded key and string value is redacted and the returned text is re-serialized from that; a non-JSON body is
    // redacted literally
    const raw = await res.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {}
    json = redact(json, token);
    const text = (json !== null ? JSON.stringify(json) : raw).split(token).join("[redacted]");
    return { status: res.status, json, text, contentType: res.headers.get("content-type") ?? "" };
  };
}

async function control(call, path, body) {
  const r = await call("POST", path, body);
  if (r.status !== 200) throw new Error(`harness ${path}: ${r.status} ${r.text.slice(0, 300)}`);
  return r.json;
}

// `node.harnessNode` (optional): the node's name inside its harness when it differs from the runner's identity for it (the
// service runner keys targets by globally unique descriptor id); `run.mjs` does not set it, so its calls are unchanged
// `controlToken` (optional, harness-control-v1): kept in this closure only, never on the returned node
export function adapter(node, { harness, controlToken }) {
  const isRef = node.kind === "ref";
  const call = harness ? controlClient(harness, controlToken) : null;
  return {
    ...node,
    ...(call ? { harnessControl: (path, body) => call("POST", path, body) } : {}),
    async createEvent(spec) {
      const policy = { grant_ttl_s: spec.grant_ttl_s ?? 600, mandates_allowed: spec.mandates_allowed ?? null, grant_actions: spec.grant_actions ?? null, grant_exclusions: spec.grant_exclusions ?? null };
      if (isRef) {
        const r = await http("POST", `${node.base}/ilp/v1/admin/events`, { bearer: node.admin, body: { slug: spec.slug, title: spec.slug, visibility: spec.visibility ?? "federated", remote_participants: spec.remote_participants ?? "allowed", phase: spec.phase, ...Object.fromEntries(Object.entries(policy).filter(([, v]) => v !== null)) } });
        if (r.status !== 201) throw new Error(`ref event: ${r.text}`);
        return { id: r.json.id, global_id: r.json.global_id, slug: r.json.slug };
      }
      const e = await control(call, "/setup/event", { node: node.harnessNode ?? node.name, slug: spec.slug, visibility: spec.visibility ?? "federated", remote_participants: spec.remote_participants ?? "allowed", registration_approval: spec.registration_approval ?? "operator", policy: Object.fromEntries(Object.entries(policy).filter(([, v]) => v !== null)), ...(spec.publication_consent ? { publication_consent: spec.publication_consent } : {}) });
      const consent = spec.publication_consent ? consentFromSetup(e.x_publication_consent) : null;
      if (spec.publication_consent && !consent) throw new Error("publication consent was requested but not declared by the host harness");
      return { id: e.id, global_id: e.global_id, slug: e.slug, ...(consent ? { consent } : {}) };
    },
    async credential(kind, eventId) {
      if (isRef) {
        const r = await http("POST", `${node.base}/ilp/v1/admin/credentials`, { bearer: node.admin, body: { kind, ...(eventId ? { event: eventId } : {}) } });
        if (r.status !== 201) throw new Error(`ref credential: ${r.text}`);
        return r.json.credential;
      }
      return (await control(call, "/setup/credential", { node: node.harnessNode ?? node.name, kind, event: eventId })).credential;
    },
    async localParticipant(ev) {
      if (isRef) {
        const r = await http("POST", `${node.base}/ilp/v1/admin/events/${ev.id}/local-participants`, { bearer: node.admin, body: {} });
        return { participant_token: r.json.participant_token, human: r.json.human };
      }
      return control(call, "/setup/local-participant", { node: node.harnessNode ?? node.name, slug: ev.slug });
    },
    async setPhase(ev, phase) {
      if (isRef) return http("POST", `${node.base}/ilp/v1/admin/events/${ev.id}/state`, { bearer: node.admin, body: { phase } });
      // Beta advances along its phase graph one step at a time (e.g. proposing → voting); the target phase is checked by the caller
      return control(call, "/setup/phase", { node: node.harnessNode ?? node.name, slug: ev.slug, body: {} });
    },
    async close(ev) {
      if (isRef) return http("POST", `${node.base}/ilp/v1/admin/events/${ev.id}/state`, { bearer: node.admin, body: { status: "closed" } });
      return control(call, "/setup/close", { node: node.harnessNode ?? node.name, slug: ev.slug });
    },
    async stop() {
      if (isRef) return node.stop();
      return control(call, "/ops/stop", { node: node.harnessNode ?? node.name });
    },
    async start() {
      if (isRef) throw new Error("reference nodes are restarted by the runner");
      return control(call, "/ops/start", { node: node.harnessNode ?? node.name });
    },
  };
}
