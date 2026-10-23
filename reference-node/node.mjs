// Project Connect reference node — written from ILP 0.0.2, independently of any implementation under test.
// Plays both the Identity Home and the Context Host roles for profile pc-0.1-s1. State is in memory.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalBytes } from "../lib/jcs.mjs";
import { decodeJws, JwsError, sha256B64u, sha256Hex, signDetached, signJws, TYP, verifyJws } from "../lib/jws.mjs";
import { GENESIS_HASH, receiptHash } from "../lib/receipt.mjs";
import { receiveLenient, validate, validateLenient } from "../lib/schemas.mjs";
import { Problem } from "./http.mjs";

const SPEC_VERSIONS = ["0.0.2"];
const SKEW_S = 300;
const nowS = () => Math.floor(Date.now() / 1000);
const iso = (ms = Date.now()) => new Date(ms).toISOString();
// R-CORE-18: tokens are held only as salted verifiers, found by a public lookup prefix (all but the last 32
// characters: prefix + 11 random chars); the remaining 192 random bits never rest anywhere.
const SECRET_TAIL = 32;
const lookupOf = (t) => (typeof t === "string" && t.length >= SECRET_TAIL + 8 ? t.slice(0, -SECRET_TAIL) : null);
const saltedDigest = (salt, t) => createHash("sha256").update(`${salt}\u0000${t}`, "utf8").digest();
function verifier(t) {
  const salt = randomBytes(16).toString("hex");
  return { lookup: lookupOf(t), salt, digest: saltedDigest(salt, t) };
}
const verifies = (t, v) => !!v && typeof t === "string" && timingSafeEqual(saltedDigest(v.salt, t), v.digest);
/** the record stored under the token's lookup prefix, when the token matches its salted verifier */
function findSecret(map, t) {
  const r = map.get(lookupOf(t));
  return r && verifies(t, r.verifier) ? r : null;
}
const random = (prefix) => prefix + randomBytes(32).toString("base64url");
const hostOf = (baseUrl) => new URL(baseUrl).hostname;
const hostOfGid = (gid) => gid.split(":")[1];

/** R-FED-7 step 4.1 re-applied to a home peer's CURRENT record, after an await during which it may have been suspended,
 *  removed or replaced (R-FED-16; nothing may be written for a request step 1 rejects, R-AUTHZ-11). `current` is the record
 *  now registered for the host, `original` the one step 1 accepted. Returns null when admission may continue, the step 1
 *  problem code, or "REPLACED" for a re-added peer (answered 503 REVOCATION_STATE_UNKNOWN). */
export function currentPeerProblem(current, original) {
  if (!current || current.state === "removed" || current.state === "proposed") return "NOT_A_PEER";
  if (current.state === "suspended") return "PEER_SUSPENDED";
  if (current !== original) return "REPLACED";
  return null;
}

// the identity claim's consent_accepted shape, also required of a join body's own consent_accepted (ASTRA-R3-02)
const validConsent = (c) => c === null || (typeof c === "object" && !Array.isArray(c) && Object.keys(c).every((k) => ["kind", "text_version", "text_sha256"].includes(k))
  && typeof c.kind === "string" && typeof c.text_version === "string" && typeof c.text_sha256 === "string" && /^[0-9a-f]{64}$/.test(c.text_sha256));

const PACK = "unconference@1.1";
const ACTIONS = {
  "unconference.proposal": {
    phases: ["proposing"],
    roles: ["participant"],
    max_payload_bytes: 32768,
    validate: (p) => p && typeof p.title === "string" && p.title.length >= 1 && p.title.length <= 300 && typeof p.content === "string" && p.content.length >= 1 && p.content.length <= 10000 && Object.keys(p).every((k) => ["title", "content"].includes(k)),
    cap: 3,
    natural_key: "title", // R-UNCONF-1: duplicates by (author, title) are rejected idempotently
  },
  "unconference.vote": {
    phases: ["voting"],
    roles: ["participant"],
    max_payload_bytes: 1024,
    validate: (p) => p && Object.keys(p).length === 0,
    target: "unconference.proposal",
    cap: 3,
  },
};

export function createNode({ baseUrl, name, key, keyring = [key], build, deploymentId, adminToken, revocationBoundS = 60, fetchImpl = fetch, log = () => {} }) {
  const host = hostOf(baseUrl);
  const gid = (type, id = randomUUID()) => `ilp:${host}:${type}:${id}`;
  // every key in the keyring stays published and verifiable (R-CORE-21); only the active key signs (R-CORE-34(d))
  const publicKeys = keyring.map((k) => ({ kid: k.kid, kty: "OKP", crv: "Ed25519", x: k.x, use: "sig", ...(k.not_after ? { not_after: k.not_after } : {}) }));
  const ownKey = (kid) => publicKeys.find((k) => k.kid === kid) ?? null;

  // ---- state ----
  const credentials = new Map(); // lookup prefix -> {verifier, kind, event?}
  const humans = new Map(); // gid -> {gid, display_name, synthetic, revoked}
  const agents = new Map(); // gid -> {gid, human, display_name, plate, revoked}
  const peers = new Map(); // host -> {host, base_url, state, discovery, keys, spec_versions, updated_at, last_good_refresh_ms, last_seq, revoked:Set}
  const events = new Map(); // id -> event
  const tokens = new Map(); // lookup prefix -> {lookup, verifier, event, principal, agent, plate, remote, home, expires_s, revoked, grant}
  const grants = new Map(); // jti -> {jti, jws, payload, status, changed_at, reason, token_lookup}
  const seenClaims = new Set();
  const revocationsOut = []; // {seq, jws, payload}
  const joinRequests = new Map(); // gid -> {...}
  const directoryFixtures = []; // runner-owned test node only: raw entries served as-is, to exercise peers' input handling

  // ---- helpers ----
  function requireCredential(headers, kinds, eventId) {
    const bearer = (headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!bearer) throw new Problem("AUTH_MISSING");
    if (adminToken && bearer === adminToken) return { kind: "admin" };
    const c = findSecret(credentials, bearer);
    if (!c) throw new Problem("AUTH_INVALID");
    if (c.revoked) throw new Problem("AUTH_REVOKED");
    if (!kinds.includes(c.kind)) throw new Problem("FORBIDDEN", `credential kind ${c.kind} not permitted`);
    if (c.kind === "operator" && eventId && c.event !== eventId) {
      // a credential for another event learns nothing about a private event: NOT_FOUND, exactly as for an absent id (SG2R4-OP-SCOPE)
      if (events.get(eventId)?.visibility === "private") throw new Problem("NOT_FOUND", `event ${eventId}`);
      throw new Problem("FORBIDDEN", "operator credential is scoped to another event");
    }
    return c;
  }
  const requireAdmin = (headers) => requireCredential(headers, []);

  function publishRevocation(kind, subject, reason, extra = {}) {
    const seq = revocationsOut.length + 1;
    const payload = { iss: baseUrl, jti: gid("revocation"), iat: nowS(), kind, subject, revoked_at: iso(), ...(reason ? { reason } : {}), ...extra, seq };
    const jws = signJws(payload, key, TYP.revocation);
    revocationsOut.push({ seq, jws, payload });
    return payload;
  }

  function appendFeed(ev, kind, resource, summary, data = {}) {
    const rec = { seq: ev.feed.length + 1, occurred_at: iso(), kind, resource_global_id: resource, summary, data };
    ev.feed.push(rec);
    return rec;
  }

  function appendReceipt(ev, fields) {
    const r = buildReceipt(ev, fields);
    ev.receipts.push(r);
    return r;
  }
  function buildReceipt(ev, { action_kind, subject_human, subject_agent = null, license_plate = null, mandate = "human_directed", source_class = "engine", authorization_grant, resource }) {
    const r = {
      id: gid("receipt"), event: ev.gid, action_kind, subject_human, subject_agent, license_plate, mandate, source_class,
      ...(authorization_grant ? { authorization_grant } : {}),
      resource, occurred_at: iso(), prev_receipt_hash: ev.receipts.at(-1)?.hash ?? GENESIS_HASH,
    };
    r.hash = receiptHash(r);
    return r;
  }

  /** A private event is visible only to its own participants (token for it), its operator credential, or the admin. */
  function visibleEvent(ref, headers) {
    const ev = eventByRef(ref);
    if (ev.visibility !== "private") return ev;
    const bearer = (headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const t = bearer ? findSecret(tokens, bearer) : null;
    const c = bearer ? findSecret(credentials, bearer) : null;
    const liveToken = t && !t.revoked && nowS() <= t.expires_s && t.event === ev.id; // an expired token sees nothing private (ASTRA-R3-03)
    if ((adminToken && bearer === adminToken) || liveToken || (c && !c.revoked && c.kind === "operator" && c.event === ev.id)) return ev;
    throw new Problem("NOT_FOUND", `event ${ref}`);
  }

  function eventByRef(ref) {
    const id = ref.startsWith("ilp:") ? ref.split(":")[3] : ref;
    const ev = events.get(id) ?? [...events.values()].find((e) => e.slug === ref);
    if (!ev) throw new Problem("NOT_FOUND", `event ${ref}`);
    return ev;
  }

  function discovery() {
    return {
      protocol: "ilp/1",
      protocols: ["ilp/1"],
      spec_versions: SPEC_VERSIONS,
      profiles: ["pc-0.1-s1"],
      instance: { host, name, operator_contact: `mailto:operator@${host}`, software: { name: "project-connect-reference-node", version: "0.0.2", build }, deployment_id: deploymentId },
      keys: publicKeys,
      endpoints: { api: `${baseUrl}/ilp/v1`, federation: `${baseUrl}/ilp/v1/federation`, directory: `${baseUrl}/ilp/v1/federation/events`, revocations: `${baseUrl}/ilp/v1/federation/revocations` },
      packs: [{ id: "unconference", version: "1.1", compatible_versions: ["1.0"] }],
      federation: { mode: "allowlist", join_requests: true, revocation_bound_s: revocationBoundS, active_kid: key.kid, remote_session_policy: { on_stale_revocation_state: "pause", after_s: 2 * revocationBoundS } },
      conformance: { mode: "certification", revocation_bound_s: revocationBoundS, grant_ttl_s: 600, contact: `mailto:operator@${host}` },
    };
  }

  // ---- peers and revocation state ----
  // federation input is untrusted and size-limited (R-FED-13): stop reading past the cap, before parsing
  const MAX_PEER_BODY = 1024 * 1024;
  async function fetchJson(url, timeoutMs = 5000) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const chunks = [];
    let n = 0;
    for await (const c of res.body) {
      n += c.length;
      if (n > MAX_PEER_BODY) throw new Error(`${url} -> body over ${MAX_PEER_BODY} bytes`);
      chunks.push(c);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  async function addPeer(peerBase) {
    if (typeof peerBase === "string" && /^[a-z0-9.-]+$/.test(peerBase)) peerBase = `https://${peerBase}`; // R-FED-3 {host} shorthand
    if (typeof peerBase !== "string" || !/^https?:\/\/[a-z0-9.-]+(:[0-9]+)?$/.test(peerBase)) throw new Problem("VALIDATION_FAILED", "base_url must be scheme://host[:port]");
    let doc;
    try {
      doc = await fetchJson(`${peerBase}/.well-known/interlateral.json`);
    } catch (e) {
      throw new Problem("VALIDATION_FAILED", `peer discovery unreachable: ${e.message}`);
    }
    const v = validateLenient("discovery", doc);
    if (!v.ok) throw new Problem("VALIDATION_FAILED", `peer discovery invalid: ${v.errors.slice(0, 3).join("; ")}`);
    if (!doc.protocols.includes("ilp/1")) throw new Problem("PROTOCOL_UNSUPPORTED", "no common ilp/ family");
    const peerHost = doc.instance.host;
    if (peerHost !== hostOf(peerBase)) throw new Problem("VALIDATION_FAILED", "discovery instance.host does not match base_url host");
    const existing = peers.get(peerHost);
    const p = {
      // re-adding a suspended peer refreshes discovery but never lifts the suspension (only reinstate does)
      host: peerHost, base_url: peerBase, state: existing?.state === "suspended" ? "suspended" : "active", discovery: doc, keys: doc.keys, spec_versions: doc.spec_versions,
      // a (re-)added peer is read from the start of its feed and is not fresh until that read completes
      updated_at: iso(), last_good_refresh_ms: 0, last_seq: 0, revoked: existing?.revoked ?? new Set(),
      bound_s: doc.federation.revocation_bound_s,
    };
    peers.set(peerHost, p);
    await refreshPeer(p).catch(() => {});
    return p;
  }

  const peerRecord = (p) => ({
    host: p.host, base_url: p.base_url, state: p.state, spec_versions: p.spec_versions,
    common_spec_versions: p.spec_versions.filter((v) => SPEC_VERSIONS.includes(v)),
    discovery_sha256: sha256Hex(canonicalBytes(p.discovery)), updated_at: p.updated_at,
  });

  function setPeerState(peerHost, state) {
    const p = peers.get(peerHost);
    if (!p) throw new Problem("NOT_FOUND", `peer ${peerHost}`);
    const prev = p.state;
    p.state = state;
    p.updated_at = iso();
    if (state === "suspended") publishRevocation("peer", peerHost, "suspended");
    if (state === "removed") publishRevocation("peer", peerHost, "removed");
    if (state === "active" && prev === "suspended") publishRevocation("peer", peerHost, "reinstated", { reinstated: true });
    // grants of that peer's principals follow the peer state (R-FED-11, R-FED-16)
    for (const g of grants.values()) {
      if (g.payload.home !== peerHost) continue;
      if (state === "suspended" && g.status === "active") setGrantStatus(g, "suspended", "peer suspended");
      if (state === "active" && g.status === "suspended") setGrantStatus(g, "active", "peer reinstated");
      if (state === "removed" && ["active", "suspended"].includes(g.status)) revokeGrant(g, "peer removed");
    }
    return p;
  }

  function resolvePeerKey(peerHost, kid) {
    const p = peers.get(peerHost);
    return p?.keys.find((k) => k.kid === kid) ?? null;
  }

  // Refreshes of one peer are serialized (R-FED-21/21a): each runs only after the previous one for that host has settled,
  // re-reads the peer's CURRENT record and cursor when it starts, and discards its result if the peer is replaced or removed
  // meanwhile. A late reply from an earlier refresh therefore can never restore freshness or a cursor after a later refresh
  // found the feed reset. A failed refresh releases the queue; other peers are never blocked.
  const refreshQueues = new Map(); // host -> tail promise of the refreshes queued for that peer
  function refreshPeer(target) {
    const peerHost = typeof target === "string" ? target : target.host;
    const run = (refreshQueues.get(peerHost) ?? Promise.resolve()).then(() => refreshPeerNow(peerHost));
    const tail = run.catch(() => {});
    refreshQueues.set(peerHost, tail);
    tail.then(() => { if (refreshQueues.get(peerHost) === tail) refreshQueues.delete(peerHost); });
    return run;
  }

  async function refreshPeerNow(peerHost) {
    const p = peers.get(peerHost);
    if (!p || p.state === "removed") throw new Error(`peer ${peerHost} is not an active peer`);
    // after every await: a replaced or removed peer record is never written (no detached stale-object writes)
    const stillCurrent = () => {
      if (peers.get(peerHost) !== p || p.state === "removed") throw new Error(`peer ${peerHost} was replaced or removed during refresh; result discarded`);
    };
    let since = p.last_seq;
    let latest = null;
    for (let page = 0; page < 1000; page++) {
      const feed = await fetchJson(`${p.base_url}/ilp/v1/federation/revocations?since=${since}`);
      stillCurrent();
      if (!validate("revocation-feed", feed).ok) throw new Error(`malformed revocation feed from ${p.host}`);
      // a feed behind what was already consumed has been reset or replaced: the peer's revocation state is unknown from
      // this moment (freshness dropped, cursor reset) until the replacement feed has been read completely from 0 (R-FED-21)
      if (feed.latest_seq < since) {
        p.last_good_refresh_ms = 0;
        p.last_seq = 0;
        throw new Error(`revocation feed from ${p.host} went backwards (latest_seq ${feed.latest_seq} < consumed ${since}); re-reading from 0`);
      }
      latest = feed.latest_seq;
      for (const item of feed.items) {
        let payload;
        try {
          ({ payload } = verifyJws(item.jws, (kid) => resolvePeerKey(p.host, kid), { typ: TYP.revocation }));
          if (hostOf(payload.iss) !== p.host) throw new Error("iss is not the peer");
          const rv = receiveLenient("revocation-record", payload);
          if (!rv.ok) throw new Error(`record invalid: ${rv.errors.slice(0, 2).join("; ")}`);
          if (payload.seq !== item.seq || payload.seq <= since) throw new Error("seq out of order");
        } catch (e) {
          // incomplete revocation state: do not advance last_seq or freshness (fail closed, R-FED-21)
          throw new Error(`unverifiable revocation record seq ${item.seq} from ${p.host}: ${e.message}`);
        }
        applyPeerRevocation(p, payload);
        since = Math.max(since, payload.seq);
      }
      p.last_seq = since;
      if (since >= latest || !feed.items.length) break;
    }
    // fresh only when the whole advertised feed has been consumed (R-FED-21: incomplete state fails closed)
    if (latest === null || since < latest) throw new Error(`revocation feed from ${p.host} not consumed through latest_seq ${latest}`);
    p.last_good_refresh_ms = Date.now();
  }

  /** A subject the home has revoked is ineligible for admission and for first credential delivery (R-ID-19, R-FED-10). */
  function subjectRevoked(home, { sub, agent, plate, claim_jti }) {
    const p = peers.get(home);
    if (!p) return true;
    return p.revoked.has(`human:${sub}`) || (claim_jti && p.revoked.has(`claim:${claim_jti}`)) || (agent && p.revoked.has(`agent:${agent}`)) || (plate && p.revoked.has(`plate:${plate}`));
  }

  function applyPeerRevocation(p, rec) {
    if (["claim", "human", "agent", "plate"].includes(rec.kind)) {
      p.revoked.add(`${rec.kind}:${rec.subject}`);
      for (const t of tokens.values()) {
        if (t.home !== p.host || t.revoked) continue;
        const hit = (rec.kind === "human" && t.principal === rec.subject) || (rec.kind === "agent" && t.agent === rec.subject) || (rec.kind === "plate" && t.plate === rec.subject) || (rec.kind === "claim" && t.claim_jti === rec.subject);
        if (hit) {
          t.revoked = true;
          const g = t.grant && grants.get(t.grant);
          if (g && g.status !== "revoked") revokeGrant(g, `home revoked ${rec.kind}`);
          log(`ALERT operator: home ${p.host} revoked ${rec.kind} ${rec.subject}; token and grant revoked`);
        }
      }
    }
  }

  const peerFresh = (p) => Date.now() - p.last_good_refresh_ms <= 2 * revocationBoundS * 1000;

  let pollTimer = null;
  // A background poll is skipped for a peer whose refresh work is already queued or running: a periodic tick never queues
  // behind a slow or failing refresh, so background work cannot accumulate while a home is unreachable (fix64). Explicit
  // refreshes (admission, peer add) still always queue and keep their serialized order, current-record re-read and reset
  // handling; other peers are polled independently.
  function pollPeer(p) {
    if (refreshQueues.has(p.host)) return false;
    refreshPeer(p).catch((e) => log(`peer ${p.host} refresh failed: ${e.message}`));
    return true;
  }
  function startPolling(intervalMs = Math.max(1000, Math.floor((revocationBoundS * 1000) / 6))) {
    pollTimer = setInterval(() => {
      for (const p of peers.values()) if (p.state === "active") pollPeer(p);
    }, intervalMs);
    pollTimer.unref?.();
  }

  // ---- grants ----
  // expiry is derived on read, never written as a side effect of a request (R-AUTHZ-11, SG2V2-EXPIRY-WRITE)
  const effective = (g) => (g.status === "active" && nowS() - SKEW_S > g.payload.exp
    ? { status: "expired", changed_at: iso(g.payload.exp * 1000), reason: "exp passed" }
    : { status: g.status, changed_at: g.changed_at, reason: g.reason });
  function setGrantStatus(g, status, reason) {
    g.status = status;
    g.changed_at = iso();
    g.reason = reason;
  }
  function revokeGrant(g, reason) {
    setGrantStatus(g, "revoked", reason);
    const ev = events.get(g.payload.event.split(":")[3]);
    if (ev) {
      appendFeed(ev, "grant.revoked", g.jti, "grant revoked");
      appendReceipt(ev, { action_kind: "federation.grant_revoked", subject_human: g.payload.sub, subject_agent: g.payload.agent?.id ?? null, license_plate: g.payload.agent?.license_plate ?? null, authorization_grant: g.jti, resource: g.jti });
    }
    publishRevocation("grant", g.jti, reason?.slice(0, 200));
  }

  // grant issuance needs the token (credential_binding); the token itself is never stored, only its hash (R-CORE-18)
  function issueGrant(ev, t, token) {
    const iat = nowS();
    const exp = Math.min(iat + ev.grant_ttl_s, t.expires_s);
    const id = randomUUID();
    const payload = {
      iss: baseUrl, aud: baseUrl, jti: gid("grant", id), sub: t.principal,
      agent: t.agent ? { id: t.agent, license_plate: t.plate } : null,
      event: ev.gid, home: t.home, role: "participant",
      authorization_details: [{ type: "ilp.pack_action", pack: PACK, actions: ev.grant_actions }],
      ...(ev.grant_exclusions.length ? { exclusions: ev.grant_exclusions } : {}),
      ...(ev.mandates_allowed ? { mandates_allowed: ev.mandates_allowed } : {}),
      iat, nbf: iat, exp,
      credential_binding: { alg: "S256", value: sha256B64u(Buffer.from(token, "utf8")) },
      status: { uri: `${baseUrl}/ilp/v1/grants/${id}/status` },
      parent_grant: null,
    };
    const jws = signJws(payload, key, TYP.grant);
    const g = { jti: payload.jti, id, jws, payload, status: "active", changed_at: iso(), token_lookup: t.lookup };
    grants.set(payload.jti, g);
    t.grant = payload.jti;
    appendFeed(ev, "grant.issued", payload.jti, "authorization grant issued");
    appendReceipt(ev, { action_kind: "federation.grant_issued", subject_human: t.principal, subject_agent: t.agent, license_plate: t.plate, authorization_grant: payload.jti, resource: payload.jti });
    return g;
  }

  /** Mint a token: returns the token string once; the node keeps only its hash. */
  function mintToken(ev, { principal, agent, plate, remote, home, claim_jti }) {
    const token = random("ilpt_");
    const v = verifier(token);
    const t = { lookup: v.lookup, verifier: v, event: ev.id, principal, agent, plate, remote, home, claim_jti, expires_s: nowS() + 7 * 86400 + 72 * 3600, revoked: false, grant: null };
    tokens.set(t.lookup, t);
    return { t, token };
  }

  const MANDATES = ["human_directed", "human_approved", "standing_instruction", "agent_draft_unaccepted"];

  // ---- enforcement: every reported error follows R-CORE-29, and nothing is written before all checks pass ----
  /** Step 1a classifier: true when the bearer is an identity claim that verifies (this host's or a peer's key). */
  function verifiesAsIdentityClaim(bearer) {
    if (bearer.split(".").length !== 3) return false;
    let decoded = null;
    try {
      decoded = decodeJws(bearer);
    } catch {}
    if (decoded?.header?.typ !== TYP.claim) return false;
    let issHost = null;
    try {
      issHost = hostOf(String(decoded.payload.iss));
    } catch {}
    const p = issHost ? peers.get(issHost) : null;
    try {
      verifyJws(bearer, (kid) => (issHost === host ? ownKey(kid) : p ? resolvePeerKey(p.host, kid) : null), { typ: TYP.claim });
      return true;
    } catch {
      return false;
    }
  }

  function authenticate(headers) {
    // steps 1 and 1a, independent of the requested event
    const bearer = (headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!bearer) throw new Problem("AUTH_MISSING");
    if (!bearer.startsWith("ilpt_")) {
      if (verifiesAsIdentityClaim(bearer)) throw new Problem("AUTHZ_REQUIRED", "an identity claim confers no authority (P11)");
      throw new Problem("AUTH_INVALID", "credential is not a participant token");
    }
    const t = findSecret(tokens, bearer);
    if (!t) throw new Problem("AUTH_INVALID");
    if (t.revoked) throw new Problem("AUTH_REVOKED");
    if (nowS() > t.expires_s) throw new Problem("AUTH_EXPIRED", undefined, { expires_at: iso(t.expires_s * 1000) });
    return { t, bearer };
  }

  // steps 4a–6
  function grantChecks(ev, t, bearer, headers, kind, mandate) {
    let g;
    const presented = headers["ilp-grant"];
    // presence, not truthiness: an empty or malformed ILP-Grant is rejected at 4a, never replaced by the stored grant (ASTRA-R3-01)
    if (presented !== undefined) {
      let decoded;
      try {
        decoded = decodeJws(presented);
      } catch {
        throw new Problem("SIGNATURE_INVALID", "presented grant is not a JWS");
      }
      if (decoded.payload.iss !== baseUrl || decoded.payload.aud !== baseUrl) throw new Problem("GRANT_AUDIENCE_MISMATCH");
      try {
        verifyJws(presented, ownKey, { typ: TYP.grant });
      } catch (e) {
        if (e instanceof JwsError) throw new Problem(e.code === "UNKNOWN_SIGNER" ? "UNKNOWN_SIGNER" : "SIGNATURE_INVALID");
        throw e;
      }
      g = grants.get(decoded.payload.jti);
      if (!g) throw new Problem("UNKNOWN_SIGNER", "grant not issued by this host");
    } else {
      g = t.grant ? grants.get(t.grant) : null;
      if (!g) throw new Problem("AUTHZ_REQUIRED", "no current grant covers this principal for this event");
    }
    if (g.status === "revoked" || g.status === "superseded") throw new Problem("GRANT_REVOKED");
    if (g.status === "suspended") throw new Problem("PEER_SUSPENDED");
    const now = nowS();
    if (now + SKEW_S < g.payload.nbf || now - SKEW_S > g.payload.exp) {
      throw new Problem("GRANT_EXPIRED"); // nothing is written on rejection
    }
    if (g.payload.credential_binding.value !== sha256B64u(Buffer.from(bearer, "utf8"))) throw new Problem("GRANT_BINDING_MISMATCH");
    if (t.remote) {
      const p = peers.get(t.home);
      if (!p || p.state !== "active") throw new Problem("PEER_SUSPENDED");
      if (!peerFresh(p)) throw new Problem("REVOCATION_STATE_UNKNOWN", "remote session paused: home revocation state stale", { retry_after: revocationBoundS });
    }
    if (g.payload.event !== ev.gid) throw new Problem("GRANT_EVENT_MISMATCH");
    if (g.payload.aud !== baseUrl) throw new Problem("GRANT_AUDIENCE_MISMATCH");
    const inScope = g.payload.authorization_details.some((d) => d.type === "ilp.pack_action" && d.pack === PACK && d.actions.includes(kind));
    if (!inScope || (g.payload.exclusions ?? []).includes(kind)) throw new Problem("GRANT_SCOPE_VIOLATION", `${kind} is outside the grant`);
    if (g.payload.mandates_allowed && !g.payload.mandates_allowed.includes(mandate)) throw new Problem("GRANT_SCOPE_VIOLATION", `mandate ${mandate} not allowed`, { code_detail: "MANDATE_NOT_ALLOWED" });
    return g;
  }

  function evaluate(ref, headers, body, idem = null) {
    // step 0: the whole envelope
    if (typeof body.kind !== "string" || !/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_]*$/.test(body.kind)) throw new Problem("VALIDATION_FAILED", "kind is required");
    if (body.payload !== undefined && (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload))) throw new Problem("VALIDATION_FAILED", "payload must be an object");
    if (body.mandate !== undefined && !MANDATES.includes(body.mandate)) throw new Problem("VALIDATION_FAILED", "mandate is not in the registry");
    if (body.expect_phase !== undefined && typeof body.expect_phase !== "string") throw new Problem("VALIDATION_FAILED", "expect_phase must be a string");
    if (body.target_action !== undefined && typeof body.target_action !== "string") throw new Problem("VALIDATION_FAILED", "target_action must be a string");
    if (body.intent !== undefined && (typeof body.intent !== "string" || body.intent.length > 2000)) throw new Problem("VALIDATION_FAILED", "intent must be a string of at most 2000 characters");
    const extra = Object.keys(body).filter((k) => !["kind", "payload", "mandate", "expect_phase", "target_action", "intent"].includes(k));
    if (extra.length) throw new Problem("VALIDATION_FAILED", `unknown member ${extra[0]}`);
    // step 0 size: the pack's per-action payload limit is reported before credentials (ASTRA-R2-09 ruling)
    const sized = ACTIONS[body.kind];
    if (sized && Buffer.byteLength(JSON.stringify(body.payload ?? {}), "utf8") > sized.max_payload_bytes)
      throw new Problem("PAYLOAD_TOO_LARGE", "payload over limit", { limit_bytes: sized.max_payload_bytes });
    const mandate = body.mandate ?? "human_directed";
    // steps 1/1a
    const { t, bearer } = authenticate(headers);
    // step 2: resource and visibility
    const ev = eventByRef(ref);
    if (t.event !== ev.id) {
      if (ev.visibility === "private") throw new Problem("NOT_FOUND", `event ${ref}`);
      // a known, valid token for another event is not an unknown credential: grant checks run in order (4a–5),
      // for remote tokens always and for local tokens whenever a grant is presented (SG2R2-LOCAL-4A)
      if (t.remote || headers["ilp-grant"] !== undefined) {
        grantChecks(ev, t, bearer, headers, body.kind, mandate);
        throw new Problem("GRANT_EVENT_MISMATCH");
      }
      throw new Problem("FORBIDDEN", "this participant token belongs to another event");
    }
    // step 3
    const reg = ev.registrations.get(t.principal);
    if (reg && reg.status === "pending") throw new Problem("FORBIDDEN", "registration pending", { code_detail: "PENDING_APPROVAL" });
    // steps 4a–6
    const g = grantChecks(ev, t, bearer, headers, body.kind, mandate);
    // an authorized retry returns its original result before any rule for a NEW action applies (R-CORE-16)
    if (idem) {
      const prior = ev.idempotency.get(`${t.principal}|${idem}`);
      if (prior) return { ev, t, g, mandate, prior };
    }
    // step 7: status, phase, expect_phase
    // step 7 (status) precedes step 9 (an action kind the pack does not define)
    if (ev.status !== "live") throw new Problem("PHASE_MISMATCH", "event not live", { code_detail: "EVENT_NOT_LIVE" });
    const at = ACTIONS[body.kind];
    if (!at) throw new Problem("VALIDATION_FAILED", `unknown action kind ${body.kind}`);
    if (!at.phases.includes(ev.phase)) throw new Problem("PHASE_MISMATCH", `not allowed in ${ev.phase}`, { code_detail: "ACTION_PHASE_FORBIDDEN", current_phase: ev.phase, allowed_phases: at.phases });
    if (body.expect_phase !== undefined && body.expect_phase !== ev.phase) throw new Problem("PHASE_MISMATCH", "expect_phase does not match", { code_detail: "EXPECT_PHASE_STALE", current_phase: ev.phase });
    // step 8: role
    if (!at.roles.includes(g.payload.role)) throw new Problem("FORBIDDEN", "role");
    // step 9: payload and pack rules
    if (!at.validate(body.payload ?? {})) throw new Problem("VALIDATION_FAILED", "payload invalid for pack action");
    if (at.natural_key) {
      // a duplicate by (author, natural key) returns the original result and records nothing (R-UNCONF-1, R-CORE-16)
      const same = ev.actions.find((a) => a.kind === body.kind && a.subject_human === t.principal && a.payload[at.natural_key] === body.payload[at.natural_key]);
      if (same) return { ev, t, g, mandate, prior: same.result };
    }
    let target = null;
    if (at.target) {
      if (!body.target_action) throw new Problem("VALIDATION_FAILED", `${body.kind} requires target_action`);
      target = ev.actions.find((a) => a.id === body.target_action || a.id.endsWith(`:${body.target_action}`));
      if (!target) throw new Problem("VALIDATION_FAILED", "target_action does not name an action in this event"); // step 9 (SG2R3-TARGET-404)
      if (target.kind !== at.target) throw new Problem("VALIDATION_FAILED", `${body.kind} may only target ${at.target}`);
      if (target.subject_human === t.principal) throw new Problem("FORBIDDEN", "self-action forbidden", { code_detail: "SELF_VOTE_FORBIDDEN" }); // parent per §17.2.2 (dispute SG2R2-SELFVOTE)
      if (ev.actions.some((a) => a.kind === body.kind && a.subject_human === t.principal && a.target === target.id)) throw new Problem("CONFLICT", "already acted on this target", { code_detail: "ALREADY_EXISTS_FOR_TARGET" });
    }
    // step 10: caps
    const count = ev.actions.filter((a) => a.kind === body.kind && a.subject_human === t.principal).length;
    if (count >= at.cap) throw new Problem("CONFLICT", "cap reached", { code_detail: "MAX_OPEN_REACHED", cap: at.cap });
    // step 11: consent — reference events declare no publication-consent requirement
    return { ev, t, g, mandate, target };
  }

  // ---- routes ----
  const routes = [
    ["GET", "/.well-known/interlateral.json", () => ({ body: discovery() })],
    ["GET", "/healthz", () => ({ body: { ok: true } })],

    // admin: scoped credentials (R-CONF-3, R-CONF-6)
    ["POST", "/ilp/v1/admin/credentials", ({ headers, body }) => {
      requireAdmin(headers);
      const kinds = { operator: "ilpo_", peering: "ilpf_", provisioning: "ilpp_" };
      if (!kinds[body.kind]) throw new Problem("VALIDATION_FAILED", "kind must be operator|peering|provisioning");
      const ev = body.kind === "operator" ? eventByRef(String(body.event ?? "")) : null;
      const token = random(kinds[body.kind]);
      const v = verifier(token);
      credentials.set(v.lookup, { verifier: v, kind: body.kind, event: ev?.id, revoked: false });
      return { status: 201, body: { credential: token, kind: body.kind, event: ev?.gid ?? null } };
    }],

    // admin: events (runner's own node)
    ["POST", "/ilp/v1/admin/events", ({ headers, body }) => {
      requireAdmin(headers);
      const id = randomUUID();
      const ev = {
        id, gid: gid("event", id), slug: body.slug ?? `ev-${id.slice(0, 8)}`, title: body.title ?? "Reference event", description: body.description ?? null,
        visibility: body.visibility ?? "federated", remote_participants: body.remote_participants ?? "allowed", status: "live", phase: body.phase ?? "proposing",
        grant_ttl_s: Math.min(body.grant_ttl_s ?? 600, 600), mandates_allowed: body.mandates_allowed ?? null,
        grant_actions: body.grant_actions ?? ["unconference.proposal"], grant_exclusions: body.grant_exclusions ?? ["unconference.vote"],
        starts_at: iso(), updated_at: iso(), registrations: new Map(), actions: [], feed: [], receipts: [], idempotency: new Map(),
      };
      events.set(id, ev);
      appendFeed(ev, "event.created", ev.gid, "event created");
      appendReceipt(ev, { action_kind: "engine.event_created", subject_human: gid("human", "00000000-0000-7000-8000-000000000000"), resource: ev.gid });
      return { status: 201, body: { id, global_id: ev.gid, slug: ev.slug } };
    }],
    ["POST", "/ilp/v1/admin/events/:ref/state", ({ headers, params, body }) => {
      requireAdmin(headers);
      const ev = eventByRef(params.ref);
      if (body.phase) ev.phase = body.phase;
      if (body.status) ev.status = body.status;
      ev.updated_at = iso();
      return { body: { phase: ev.phase, status: ev.status } };
    }],
    ["POST", "/ilp/v1/admin/events/:ref/local-participants", ({ headers, params, body }) => {
      requireAdmin(headers);
      const ev = eventByRef(params.ref);
      const human = gid("human");
      humans.set(human, { gid: human, display_name: body.display_name ?? "Local participant", synthetic: true, revoked: false });
      ev.registrations.set(human, { status: "active", remote: false });
      const { t, token } = mintToken(ev, { principal: human, agent: null, plate: null, remote: false, home: host });
      const g = issueGrant(ev, t, token);
      return { status: 201, body: { human, participant_token: token, grant: g.jws } };
    }],

    ["POST", "/ilp/v1/admin/attestations", ({ headers, body }) => {
      requireAdmin(headers);
      if (typeof body.content_root !== "string" || !/^[0-9a-f]{64}$/.test(body.content_root)) throw new Problem("VALIDATION_FAILED", "content_root must be 64 lowercase hex");
      const payload = { iss: baseUrl, jti: `attestation-${randomUUID()}`, iat: nowS(), role: "node", content_root: body.content_root, profile: String(body.profile ?? ""), build, ...(body.statement ? { statement: String(body.statement).slice(0, 2000) } : {}) };
      return { status: 201, body: { attestation: signJws(payload, key, TYP.attestation) } };
    }],

    // TEST FIXTURE (admin only, runner-owned node): raw directory entries this node serves as-is
    ["POST", "/ilp/v1/admin/directory-fixtures", ({ headers, body }) => {
      requireAdmin(headers);
      if (!Array.isArray(body.entries)) throw new Problem("VALIDATION_FAILED", "entries must be an array");
      directoryFixtures.push(...body.entries.slice(0, 50));
      return { status: 201, body: { fixtures: directoryFixtures.length } };
    }],

    // synthetic principals (SCR-1, R-CONF-6)
    ["POST", "/ilp/v1/admin/synthetic/humans", ({ headers, body }) => {
      requireCredential(headers, ["provisioning"]);
      const human = gid("human");
      humans.set(human, { gid: human, display_name: String(body.display_name ?? "Synthetic human").slice(0, 200), synthetic: true, revoked: false });
      let agent = null;
      if (body.agent_display_name) {
        const a = gid("agent");
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const plate = "IL-" + [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join("");
        agents.set(a, { gid: a, human, display_name: String(body.agent_display_name).slice(0, 200), plate, revoked: false });
        agent = { id: a, display_name: agents.get(a).display_name, license_plate: plate };
      }
      return { status: 201, body: { human, display_name: humans.get(human).display_name, synthetic: true, agent } };
    }],
    // runner-owned admin surface: publish a signed revocation for a subject homed here (used to place a revocation on a
    // RESTARTED home's replacement feed, whose in-memory state no longer holds the subject — regressions SG2R3-W-FEED-RESET)
    ["POST", "/ilp/v1/admin/revocations", ({ headers, body }) => {
      requireAdmin(headers);
      if (!["human", "agent", "plate", "claim"].includes(body.kind)) throw new Problem("VALIDATION_FAILED", "kind must be human|agent|plate|claim");
      if (typeof body.subject !== "string" || (body.kind !== "plate" && hostOfGid(body.subject) !== host)) throw new Problem("VALIDATION_FAILED", "subject must be a global ID homed here");
      const rec = publishRevocation(body.kind, body.subject, String(body.reason ?? "revoked").slice(0, 200));
      return { status: 201, body: { revoked: body.subject, revocation: rec.jti, seq: rec.seq } };
    }],
    ["POST", "/ilp/v1/admin/synthetic/:type/:id/revoke", ({ headers, params, body }) => {
      requireCredential(headers, ["provisioning"]);
      const map = params.type === "humans" ? humans : params.type === "agents" ? agents : null;
      if (!map) throw new Problem("NOT_FOUND");
      const subj = map.get(params.id) ?? map.get(gid(params.type === "humans" ? "human" : "agent", params.id)); // local id or global ID
      if (!subj) throw new Problem("NOT_FOUND");
      if (params.type === "humans" && !subj.synthetic) throw new Problem("FORBIDDEN", "not a synthetic principal");
      if (params.type === "agents" && !humans.get(subj.human)?.synthetic) throw new Problem("FORBIDDEN", "not a synthetic principal");
      subj.revoked = true;
      const rec = publishRevocation(params.type === "humans" ? "human" : "agent", subj.gid, String(body.reason ?? "revoked").slice(0, 200));
      return { body: { revoked: subj.gid, revocation: rec.jti, seq: rec.seq } };
    }],

    // claims (R-ID-17, R-FED-7a)
    ["POST", "/ilp/v1/claims", ({ headers, body }) => {
      requireCredential(headers, ["provisioning"]);
      const human = humans.get(body.on_behalf_of);
      if (!human || !human.synthetic) throw new Problem("FORBIDDEN", "on_behalf_of must be a synthetic human of this node");
      if (human.revoked) throw new Problem("AUTH_REVOKED", "subject revoked");
      if (body.purpose !== "event_join") throw new Problem("VALIDATION_FAILED", "purpose must be event_join");
      if (typeof body.aud !== "string" || typeof body.event !== "string") throw new Problem("VALIDATION_FAILED", "aud and event are required");
      let audHost;
      try {
        audHost = hostOf(body.aud);
      } catch {
        throw new Problem("VALIDATION_FAILED", "aud must be the host base URL");
      }
      const p = peers.get(audHost);
      if (!p || p.state !== "active") throw new Problem("NOT_A_PEER", "audience is not an active peer");
      if (body.event.split(":")[1] !== p.host) throw new Problem("VALIDATION_FAILED", "event is not homed on the audience host");
      let agent = null;
      if (body.agent) {
        const a = agents.get(body.agent);
        if (!a || a.human !== human.gid) throw new Problem("VALIDATION_FAILED", "agent is not this human's agent");
        if (a.revoked) throw new Problem("AUTH_REVOKED", "agent revoked");
        agent = { id: a.gid, display_name: a.display_name, license_plate: a.plate };
      }
      const iat = nowS();
      const payload = {
        iss: baseUrl, sub: human.gid, aud: p.base_url, iat, exp: iat + Math.min(Number(body.ttl_s ?? 3600), 86400),
        jti: `claim-${randomUUID()}`, display_name: human.display_name, verified: true, verified_method: "synthetic",
        agent, purpose: "event_join", event: body.event, consent_accepted: body.consent_accepted ?? null,
      };
      // never sign a claim that is not valid under the strict schema (R-CORE-39(a))
      const out = validate("identity-claim", payload);
      if (!out.ok) throw new Problem("VALIDATION_FAILED", `claim would be invalid: ${out.errors.slice(0, 2).join("; ")}`);
      return { status: 201, body: { claim: signJws(payload, key, TYP.claim), jti: payload.jti, exp: payload.exp } };
    }],

    // peers (R-FED-3, R-FED-4, R-FED-3a)
    ["GET", "/ilp/v1/federation/peers", () => ({ body: { items: [...peers.values()].filter((p) => p.state !== "removed").map(peerRecord), next_cursor: null } })],
    ["POST", "/ilp/v1/federation/peers", async ({ headers, body }) => {
      requireCredential(headers, ["peering"]);
      return { status: 201, body: peerRecord(await addPeer(body.base_url ?? body.host)) };
    }],
    ["POST", "/ilp/v1/federation/peers/:host/:verb", ({ headers, params }) => {
      requireCredential(headers, ["peering"]);
      const state = { suspend: "suspended", reinstate: "active", remove: "removed" }[params.verb];
      if (!state) throw new Problem("NOT_FOUND");
      return { body: peerRecord(setPeerState(params.host, state)) };
    }],

    // directory (R-FED-5, R-FED-6, R-FED-19)
    ["GET", "/ilp/v1/federation/events", async ({ query }) => {
      const own = [...events.values()].filter((e) => e.visibility === "federated").map((e) => ({
        global_id: e.gid, slug: e.slug, title: e.title, description: e.description, pack: { id: "unconference", version: "1.1" },
        status: e.status, starts_at: e.starts_at, policy: { identity_required: true, remote_participants: e.remote_participants },
        home: { host, api: `${baseUrl}/ilp/v1` }, updated_at: e.updated_at,
      }));
      if (query.scope !== "aggregated") return { body: { items: [...own, ...directoryFixtures], next_cursor: null } };
      const remote = [];
      await Promise.all([...peers.values()].filter((p) => p.state === "active").map(async (p) => {
        try {
          const d = await fetchJson(`${p.base_url}/ilp/v1/federation/events`, 3000);
          for (const raw of (Array.isArray(d.items) ? d.items : []).slice(0, 500)) {
            // emit only the pruned, strictly valid entry — never the peer's raw object (R-FED-13, R-CORE-39)
            const r = receiveLenient("directory-entry", raw);
            if (r.ok && r.value.home.host === p.host && r.value.global_id.split(":")[1] === p.host) remote.push(r.value);
          }
        } catch (e) {
          log(`directory: peer ${p.host} unavailable: ${e.message}`);
        }
      }));
      return { body: { items: [...own, ...remote], next_cursor: null } };
    }],

    // revocations (R-FED-10)
    ["GET", "/ilp/v1/federation/revocations", ({ query }) => {
      const since = Number.parseInt(query.since ?? "0", 10) || 0;
      const all = revocationsOut.filter((r) => r.seq > since);
      const items = all.slice(0, 200).map((r) => ({ seq: r.seq, jws: r.jws }));
      // truthful continuation: a cursor whenever more records remain (clients page with since=<last seq>)
      return { body: { items, next_cursor: all.length > items.length ? String(items.at(-1).seq) : null, latest_seq: revocationsOut.length } };
    }],

    // join (§10.4)
    ["POST", "/ilp/v1/events/:ref/join-requests", async ({ params, body }) => {
      const ev = eventByRef(params.ref);
      if (ev.visibility === "private") throw new Problem("NOT_FOUND", `event ${params.ref}`); // does not exist to a remote requester
      if (typeof body.claim !== "string") throw new Problem("VALIDATION_FAILED", "claim is required");
      if (body.consent_accepted !== undefined && !validConsent(body.consent_accepted)) throw new Problem("VALIDATION_FAILED", "consent_accepted must be null or {kind, text_version, text_sha256}");
      let decoded;
      try {
        decoded = decodeJws(body.claim);
      } catch {
        throw new Problem("SIGNATURE_INVALID", "claim is not a JWS");
      }
      const iss = String(decoded.payload.iss ?? "");
      let issHost;
      try {
        issHost = hostOf(iss);
      } catch {
        throw new Problem("VALIDATION_FAILED", "claim iss is not a URL");
      }
      // 1. active peer
      const p = peers.get(issHost);
      if (!p || p.state === "removed" || p.state === "proposed") throw new Problem("NOT_A_PEER");
      if (p.state === "suspended") throw new Problem("PEER_SUSPENDED");
      // 2. signature (refresh keys once on unknown kid)
      try {
        verifyJws(body.claim, (kid) => resolvePeerKey(p.host, kid), { typ: TYP.claim });
      } catch (e) {
        if (!(e instanceof JwsError)) throw e;
        if (e.code === "UNKNOWN_SIGNER") {
          try {
            // replace trusted keys only with a fully valid discovery document for the same host
            const doc = await fetchJson(`${p.base_url}/.well-known/interlateral.json`);
            const dv = receiveLenient("discovery", doc);
            // and only onto the peer's current, not-removed record (no write to a replaced or removed record)
            if (dv.ok && dv.value.instance.host === p.host && peers.get(p.host) === p && p.state !== "removed") {
              p.keys = dv.value.keys;
              p.discovery = dv.value;
            }
          } catch {}
          try {
            verifyJws(body.claim, (kid) => resolvePeerKey(p.host, kid), { typ: TYP.claim });
          } catch (e2) {
            throw new Problem(e2.code === "UNKNOWN_SIGNER" ? "UNKNOWN_SIGNER" : "SIGNATURE_INVALID");
          }
        } else throw new Problem(e.code === "VALIDATION_FAILED" ? "SIGNATURE_INVALID" : e.code);
      }
      const c = decoded.payload;
      // §10.4 step 4 order: audience (3), expiry (4), replay (5) are reported before a schema failure
      // 3. audience
      if (c.aud !== baseUrl) throw new Problem("CLAIM_AUDIENCE_MISMATCH");
      // 4. expiry
      const now = nowS();
      if (Number.isSafeInteger(c.exp) && now - SKEW_S > c.exp) throw new Problem("CLAIM_EXPIRED");
      // 5. replay
      if (typeof c.jti === "string" && seenClaims.has(c.jti)) throw new Problem("CLAIM_REPLAYED");
      const v = validateLenient("identity-claim", c);
      if (!v.ok) throw new Problem("VALIDATION_FAILED", `claim payload: ${v.errors.slice(0, 3).join("; ")}`);
      if (c.exp - c.iat > 86400 || c.iat > now + SKEW_S) throw new Problem("VALIDATION_FAILED", "claim lifetime or iat out of bounds");
      // reserve the jti before any await, so concurrent submissions of one claim cannot both pass (released on failure)
      seenClaims.add(c.jti);
      let accepted = false;
      try {
      // 6. revocation state fresh and clean
      try {
        await refreshPeer(p);
      } catch (e) {
        log(`join: refresh of ${p.host} failed: ${e.message}`);
      }
      // the peer may have been suspended, removed or replaced during the awaits above: re-apply step 1 to its CURRENT record
      // before anything is written (R-FED-7 step 4.1, R-FED-16, R-AUTHZ-11)
      const peerProblem = currentPeerProblem(peers.get(p.host), p);
      if (peerProblem === "REPLACED") throw new Problem("REVOCATION_STATE_UNKNOWN", "home peer record changed during the request", { retry_after: revocationBoundS });
      if (peerProblem) throw new Problem(peerProblem);
      if (!peerFresh(p)) throw new Problem("REVOCATION_STATE_UNKNOWN", "home revocation state cannot be established", { retry_after: revocationBoundS });
      if (p.revoked.has(`claim:${c.jti}`) || p.revoked.has(`human:${c.sub}`) || (c.agent && (p.revoked.has(`agent:${c.agent.id}`) || p.revoked.has(`plate:${c.agent.license_plate}`)))) throw new Problem("SUBJECT_REVOKED");
      if (c.event !== ev.gid) throw new Problem("VALIDATION_FAILED", "claim is for another event");
      // identity evidence binds only the attesting home's own principals
      if (hostOfGid(c.sub) !== p.host || (c.agent && hostOfGid(c.agent.id) !== p.host)) throw new Problem("VALIDATION_FAILED", "claim subject or agent is not homed on the issuing peer");
      const existing = ev.registrations.get(c.sub);
      if (existing && existing.status !== "rejected") throw new Problem("CONFLICT", `a registration for this principal is already ${existing.status}`);
      if (ev.visibility !== "federated" || ev.remote_participants !== "allowed") throw new Problem("FORBIDDEN", "event does not admit remote participants");
      accepted = true;
      // shadow principal (keyed by home global ID; no email) + pending registration
      const jr = {
        gid: gid("join_request"), event: ev.id, status: "pending", subject: c.sub, agent: c.agent?.id ?? null, plate: c.agent?.license_plate ?? null,
        display_name: c.display_name, home: p.host, claim_jti: c.jti, claim_jws: body.claim, consent: c.consent_accepted ?? body.consent_accepted ?? null,
        retrieval: null, grant: null, token_delivered: false,
      };
      const retrieval = random("ilpr_");
      jr.retrieval = verifier(retrieval);
      joinRequests.set(jr.gid, jr);
      ev.registrations.set(c.sub, { status: "pending", remote: true, join_request: jr.gid });
      appendFeed(ev, "join_request.received", jr.gid, "remote join request pending", { home: p.host });
      appendReceipt(ev, { action_kind: "federation.join_requested", subject_human: jr.subject, subject_agent: jr.agent, license_plate: jr.plate, resource: jr.gid });
      return { status: 202, body: { join_request_id: jr.gid, status: "pending", retrieval_key: retrieval } };
      } finally {
        if (!accepted) seenClaims.delete(c.jti);
      }
    }],
    ["GET", "/ilp/v1/events/:ref/join-requests", ({ headers, params }) => {
      requireCredential(headers, ["operator"]); // step 1 before step 2: no existence oracle for private events
      const ev = eventByRef(params.ref);
      requireCredential(headers, ["operator"], ev.id);
      return { body: { items: [...joinRequests.values()].filter((j) => j.event === ev.id).map((j) => ({ join_request_id: j.gid, status: j.status, subject: j.subject, agent: j.agent, home: j.home, display_name: j.display_name })), next_cursor: null } };
    }],
    ["GET", "/ilp/v1/events/:ref/join-requests/:id", ({ headers, params }) => {
      // step 1 before step 2: the retrieval key is validated before the event or join request is resolved (SG2R3-JOIN-GET)
      const bearer = (headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (!bearer) throw new Problem("AUTH_MISSING");
      const keyed = [...joinRequests.values()].find((j) => j.retrieval.lookup === lookupOf(bearer) && verifies(bearer, j.retrieval));
      if (!keyed) throw new Problem("AUTH_INVALID");
      const ev = eventByRef(params.ref);
      const jr = joinRequests.get(params.id) ?? [...joinRequests.values()].find((j) => j.gid.endsWith(`:${params.id}`));
      if (!jr || jr.event !== ev.id || jr !== keyed) throw new Problem("NOT_FOUND");
      const base = { join_request_id: jr.gid, event: ev.gid, status: jr.status, subject: jr.subject };
      if (jr.status !== "approved") return { body: base };
      if (jr.token_delivered) return { body: { ...base, grant: grants.get(jr.grant).jws, token_delivered: true } };
      // a home revocation that arrived after approval blocks first delivery (R-ID-19)
      const hp = peers.get(jr.home);
      if (!hp || hp.state !== "active") throw new Problem("PEER_SUSPENDED");
      if (!peerFresh(hp)) throw new Problem("REVOCATION_STATE_UNKNOWN", "home revocation state is stale", { retry_after: revocationBoundS });
      if (subjectRevoked(jr.home, { sub: jr.subject, agent: jr.agent, plate: jr.plate, claim_jti: jr.claim_jti })) {
        jr.status = "rejected";
        ev.registrations.get(jr.subject).status = "revoked";
        appendFeed(ev, "join_request.revoked", jr.gid, "home revoked the subject before delivery");
        appendReceipt(ev, { action_kind: "federation.join_revoked", subject_human: jr.subject, subject_agent: jr.agent, license_plate: jr.plate, resource: jr.gid });
        throw new Problem("SUBJECT_REVOKED");
      }
      // SCR-7: token and grant are minted together at the first authenticated retrieval; only the hash is kept
      const { t, token } = mintToken(ev, { principal: jr.subject, agent: jr.agent, plate: jr.plate, remote: true, home: jr.home, claim_jti: jr.claim_jti });
      const g = issueGrant(ev, t, token);
      jr.grant = g.jti;
      jr.token_delivered = true;
      return { body: { ...base, participant_token: token, grant: g.jws } };
    }],
    ["POST", "/ilp/v1/events/:ref/join-requests/:id/:verdict", ({ headers, params }) => {
      requireCredential(headers, ["operator"]); // step 1 before step 2
      const ev = eventByRef(params.ref);
      requireCredential(headers, ["operator"], ev.id);
      const jr = joinRequests.get(params.id) ?? [...joinRequests.values()].find((j) => j.gid.endsWith(`:${params.id}`));
      if (!jr || jr.event !== ev.id) throw new Problem("NOT_FOUND");
      if (jr.status !== "pending") throw new Problem("CONFLICT", `join request is ${jr.status}`);
      if (params.verdict === "reject") {
        jr.status = "rejected";
        ev.registrations.get(jr.subject).status = "rejected";
        appendFeed(ev, "join_request.rejected", jr.gid, "remote join rejected");
        appendReceipt(ev, { action_kind: "federation.join_rejected", subject_human: jr.subject, subject_agent: jr.agent, license_plate: jr.plate, resource: jr.gid });
        return { body: { join_request_id: jr.gid, status: "rejected" } };
      }
      if (params.verdict !== "approve") throw new Problem("NOT_FOUND");
      const p = peers.get(jr.home);
      if (!p || p.state !== "active") throw new Problem("PEER_SUSPENDED");
      if (!peerFresh(p)) throw new Problem("REVOCATION_STATE_UNKNOWN", "home revocation state is stale", { retry_after: revocationBoundS });
      if (subjectRevoked(jr.home, { sub: jr.subject, agent: jr.agent, plate: jr.plate, claim_jti: jr.claim_jti })) throw new Problem("SUBJECT_REVOKED");
      jr.status = "approved";
      ev.registrations.get(jr.subject).status = "active";
      appendFeed(ev, "join_request.approved", jr.gid, "remote join approved");
      appendReceipt(ev, { action_kind: "federation.join_approved", subject_human: jr.subject, subject_agent: jr.agent, license_plate: jr.plate, resource: jr.gid });
      return { body: { join_request_id: jr.gid, status: "approved" } };
    }],

    // governed actions
    ["POST", "/ilp/v1/events/:ref/actions", ({ headers, params, body }) => {
      const idem = headers["idempotency-key"];
      const { ev, t, g, mandate, target, prior } = evaluate(params.ref, headers, body, idem);
      if (prior) return { status: 200, body: { ...prior, duplicate: true } };
      // build every record first (anything that can fail fails here); then mutate all together (R-AUTHZ-11)
      const action = { id: gid("action"), kind: body.kind, payload: body.payload ?? {}, subject_human: t.principal, subject_agent: t.agent, license_plate: t.plate, mandate, authorization_grant: g.jti, target: target?.id ?? null, occurred_at: iso() };
      const receipt = buildReceipt(ev, { action_kind: body.kind, subject_human: t.principal, subject_agent: t.agent, license_plate: t.plate, mandate, source_class: "agent_token_api", authorization_grant: g.jti, resource: action.id });
      const feed = appendFeed(ev, "action.accepted", action.id, body.kind, { kind: body.kind });
      ev.actions.push(action);
      ev.receipts.push(receipt);
      const result = { id: action.id, seq: feed.seq, kind: body.kind, state: "accepted", duplicate: false };
      Object.defineProperty(action, "result", { value: result }); // not exported
      if (idem) ev.idempotency.set(`${t.principal}|${idem}`, result);
      return { status: 201, body: result };
    }],
    ["GET", "/ilp/v1/events/:ref/feed", ({ params, query, headers }) => {
      const ev = visibleEvent(params.ref, headers);
      const since = Number.parseInt(query.since ?? "0", 10) || 0;
      return { body: { items: ev.feed.filter((f) => f.seq > since), next_cursor: null, latest_seq: ev.feed.length } };
    }],
    ["GET", "/ilp/v1/events/:ref/receipts", ({ params, headers }) => ({ body: { items: visibleEvent(params.ref, headers).receipts, next_cursor: null } })],

    // grants (R-AUTHZ-9, R-AUTHZ-12)
    ["GET", "/ilp/v1/grants/:id/status", ({ params }) => {
      const g = grants.get(gid("grant", params.id));
      if (!g) throw new Problem("NOT_FOUND");
      const e = effective(g);
      return { body: { status: e.status, changed_at: e.changed_at, ...(e.reason ? { reason: e.reason } : {}) } };
    }],
    ["GET", "/ilp/v1/auth/grant", ({ headers }) => {
      const bearer = (headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const t = findSecret(tokens, bearer);
      if (!t) throw new Problem(bearer ? "AUTH_INVALID" : "AUTH_MISSING");
      if (t.revoked) throw new Problem("AUTH_REVOKED");
      const g = t.grant && grants.get(t.grant);
      if (!g) throw new Problem("AUTHZ_REQUIRED");
      return { body: { grant: g.jws, status: effective(g).status } };
    }],
    ["POST", "/ilp/v1/grants/:id/revoke", ({ headers, params, body }) => {
      requireCredential(headers, ["operator"]); // step 1 before step 2 (SG2R3-REVOKE-PREC)
      const g = grants.get(gid("grant", params.id));
      if (!g) throw new Problem("NOT_FOUND");
      requireCredential(headers, ["operator"], g.payload.event.split(":")[3]);
      if (g.status === "revoked") throw new Problem("CONFLICT", "already revoked");
      revokeGrant(g, String(body.reason ?? "operator revocation").slice(0, 200));
      return { body: { status: "revoked" } };
    }],

    // export (ilp-export/1 with additive grants, revocations, claims)
    ["POST", "/ilp/v1/events/:ref/exports", ({ headers, params }) => {
      // step 1a (ASTRA-R5-EXPORT-1A): a verifying identity claim is a valid credential that confers no authority
      const bearer = (headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (bearer && !(adminToken && bearer === adminToken) && !findSecret(credentials, bearer) && verifiesAsIdentityClaim(bearer))
        throw new Problem("AUTHZ_REQUIRED", "an identity claim confers no authority (P11)");
      requireCredential(headers, ["operator"]); // step 1 before step 2 (SG2R3-EXPORT-ORACLE)
      const ev = eventByRef(params.ref);
      requireCredential(headers, ["operator"], ev.id);
      if (!["closed", "archived"].includes(ev.status)) throw new Problem("VALIDATION_FAILED", "an event is exported only once closed or archived (R-EV-25)", { current_status: ev.status });
      const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
      const evGrants = [...grants.values()].filter((g) => g.payload.event === ev.gid);
      const files = {
        "event.json": JSON.stringify({ global_id: ev.gid, slug: ev.slug, title: ev.title, pack: PACK, status: ev.status, visibility: ev.visibility }, null, 2),
        "actions.jsonl": jsonl(ev.actions),
        "receipts.jsonl": jsonl(ev.receipts),
        "feed.jsonl": jsonl(ev.feed),
        "grants.jsonl": jsonl(evGrants.map((g) => { const e = effective(g); return { jti: g.jti, jws: g.jws, status: e.status, changed_at: e.changed_at }; })),
        "revocations.jsonl": jsonl(revocationsOut.map((r) => ({ seq: r.seq, jws: r.jws }))),
        // SCR-8: the signed identity claim, identifiable by its jti and sub (claims carry no email)
        "claims.jsonl": jsonl([...joinRequests.values()].filter((j) => j.event === ev.id).map((j) => ({ jti: j.claim_jti, sub: j.subject, iss_host: j.home, claim: j.claim_jws, join_request: j.gid, status: j.status }))),
      };
      const manifest = signDetached({
        format: "ilp-export/1", event: ev.gid, created_at: iso(), created_by: gid("human", "00000000-0000-7000-8000-000000000000"),
        instance: { host, kid: key.kid, build },
        files: Object.entries(files).map(([path, content]) => ({ path, sha256: sha256Hex(Buffer.from(content, "utf8")), bytes: Buffer.byteLength(content) })),
        receipts_head_hash: ev.receipts.at(-1)?.hash ?? GENESIS_HASH, consent_versions: [],
        remote_origins: [...new Set([...joinRequests.values()].filter((j) => j.event === ev.id).map((j) => j.home))],
      }, key);
      return { status: 201, body: { manifest, files } };
    }],
  ];

  // secretsAtRest: in-process tests only (tests/reference-node.test.mjs) — what the node holds for its secrets
  const secretsAtRest = () => ({ keys: [...tokens.keys(), ...credentials.keys()], records: [...tokens.values(), ...credentials.values(), ...joinRequests.values()] });
  return { routes, startPolling, stop: () => clearInterval(pollTimer), discovery, host, baseUrl, secretsAtRest };
}

export const fingerprint = (jwk) => createHash("sha256").update(canonicalBytes({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest("base64url");
