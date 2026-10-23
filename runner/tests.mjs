// Black-box tests for pc-0.1-s1. Each test reaches nodes only through their declared public interfaces
// (profile.interfaces). Setup (events, credentials) happened before; see setup.mjs.
import { createHash } from "node:crypto";
import { decodeJws, signJws, TYP, verifyJws, b64u, generateKey } from "../lib/jws.mjs";
import { verifyReceiptChain } from "../lib/receipt.mjs";
import { validate } from "../lib/schemas.mjs";
import { check, expectNoSideEffects, expectOk, expectProblem, expectRefusal, http, observe, observeJoins } from "./lib.mjs";
// triage248 (S4 composition only): when E1 declares the host's publication consent (setup returned exactly
// {kind, text_version, text_sha256}), the SYNTHETIC golden-thread participant opts in through its own home claim request;
// undeclared keeps the prior request byte-for-byte. Never a real user's consent; no host acceptance is written.
const e1ConsentOptIn = (ctx) => (ctx.events?.E1?.consent ? { consent_accepted: { kind: ctx.events.E1.consent.kind, text_version: ctx.events.E1.consent.text_version, text_sha256: ctx.events.E1.consent.text_sha256 } } : {});

const S256 = (s) => createHash("sha256").update(s, "utf8").digest("base64url");
const CLAIM_MEMBERS = new Set(["iss", "sub", "aud", "iat", "exp", "jti", "display_name", "verified", "verified_method", "agent", "purpose", "event", "consent_accepted"]);
const nowS = () => Math.floor(Date.now() / 1000);

async function discoveryOf(node) {
  const r = await http("GET", `${node.base}/.well-known/interlateral.json`);
  expectOk(r, 200, `${node.name} discovery`);
  return r.json;
}
const keyResolver = (doc) => (kid) => doc.keys.find((k) => k.kid === kid) ?? null;
function schemaOk(name, doc, what) {
  const v = validate(name, doc);
  check(v.ok, `${what}: ${name} schema: ${v.errors.slice(0, 4).join("; ")}`);
}

// ---------------- SG-2 golden thread ----------------
export const TESTS = {
  async "PC-DISC-1"(ctx) {
    const out = {};
    for (const node of [ctx.home, ctx.host]) {
      const r = await http("GET", `${node.base}/.well-known/interlateral.json`);
      expectOk(r, 200, `${node.name} discovery`);
      check(r.contentType.startsWith("application/json"), `${node.name}: discovery content-type ${r.contentType}`);
      schemaOk("discovery", r.json, node.name);
      out[node.name] = "valid";
    }
    return out;
  },
  async "PC-DISC-2"(ctx) {
    const out = {};
    for (const node of [ctx.home, ctx.host]) {
      const a = await discoveryOf(node);
      const b = await discoveryOf(node);
      check(a.instance.software.build && a.instance.deployment_id, `${node.name}: build and deployment_id required`);
      check(a.instance.software.build === b.instance.software.build && a.instance.deployment_id === b.instance.deployment_id, `${node.name}: build identity not stable across fetches`);
      ctx.identity[node.name] = { build: a.instance.software.build, deployment_id: a.instance.deployment_id };
      out[node.name] = ctx.identity[node.name];
    }
    return out;
  },
  async "PC-DISC-3"(ctx) {
    for (const node of [ctx.home, ctx.host]) {
      const d = await discoveryOf(node);
      check(d.spec_versions.includes(ctx.profile.spec_version), `${node.name}: spec_versions lacks ${ctx.profile.spec_version}`);
      check(d.protocols.includes("ilp/1"), `${node.name}: protocols lacks ilp/1`);
      check(/^[a-z0-9.-]+$/.test(d.instance.host) && d.instance.host === new URL(node.base).hostname, `${node.name}: instance.host must be the bare hostname of the base URL`);
    }
    return { spec_version: ctx.profile.spec_version };
  },
  async "PC-DISC-4"(ctx) {
    const out = {};
    for (const node of [ctx.home, ctx.host]) {
      const d = await discoveryOf(node);
      for (const k of d.keys) check(k.kty === "OKP" && k.crv === "Ed25519" && k.use === "sig", `${node.name}: key ${k.kid} is not an Ed25519 signing JWK`);
      check(d.keys.some((k) => k.kid === d.federation.active_kid), `${node.name}: active_kid not listed`);
      check(d.federation.revocation_bound_s <= ctx.profile.parameters.revocation_bound_s, `${node.name}: revocation_bound_s ${d.federation.revocation_bound_s} exceeds profile bound`);
      const pol = d.federation.remote_session_policy;
      const req = ctx.profile.parameters.remote_session_policy;
      check(pol?.on_stale_revocation_state === req.on_stale_revocation_state && pol.after_s <= req.after_s_max, `${node.name}: remote_session_policy ${JSON.stringify(pol)} does not meet ${JSON.stringify(req)}`);
      ctx.activeKid[node.name] = d.federation.active_kid;
      out[node.name] = { active_kid: d.federation.active_kid, bound: d.federation.revocation_bound_s };
    }
    ctx.deferred.push(() => {
      for (const node of [ctx.home.name, ctx.host.name]) for (const kid of ctx.observedKids[node] ?? []) check(kid === ctx.activeKid[node], `${node}: a signed object carried kid ${kid}, not the active kid ${ctx.activeKid[node]}`);
    });
    return out;
  },
  async "PC-PEER-1"(ctx) {
    const pairs = [[ctx.home, ctx.host], [ctx.host, ctx.home], [ctx.host, ctx.aux], [ctx.aux, ctx.host], [ctx.home, ctx.aux], [ctx.aux, ctx.home]];
    for (const [a, b] of pairs) expectOk(await http("POST", `${a.base}/ilp/v1/federation/peers`, { bearer: ctx.creds.peering[a.name], body: { base_url: b.base } }), [200, 201], `${a.name} peers with ${b.name}`);
    for (const [a, b] of [[ctx.home, ctx.host], [ctx.host, ctx.home]]) {
      const l = expectOk(await http("GET", `${a.base}/ilp/v1/federation/peers`), 200, `${a.name} peer list`);
      const rec = l.items.find((p) => p.host === new URL(b.base).hostname);
      check(rec, `${a.name} does not list ${b.name}`);
      schemaOk("peer-record", rec, `${a.name} peer record`);
      check(rec.state === "active", `${a.name} lists ${b.name} as ${rec.state}`);
      check(rec.common_spec_versions.length > 0, `${a.name}/${b.name}: no common spec version`);
    }
    return { mutual: true };
  },
  async "PC-IDC-1"(ctx) {
    const { home, host } = ctx;
    const syn = expectOk(await http("POST", `${home.base}/ilp/v1/admin/synthetic/humans`, { bearer: ctx.creds.provisioning, body: { display_name: `Synthetic ${ctx.tag}`, agent_display_name: `Agent ${ctx.tag}` } }), 201, "create synthetic principal");
    ctx.subject = syn;
    // a claim whose audience is not an active peer is refused
    const bogus = await http("POST", `${home.base}/ilp/v1/claims`, { bearer: ctx.creds.provisioning, body: { purpose: "event_join", event: "ilp:not-a-peer.localhost:event:00000000-0000-7000-8000-000000000000", aud: "http://not-a-peer.localhost:4999", agent: syn.agent.id, on_behalf_of: syn.human } });
    expectProblem(bogus, "NOT_A_PEER", "claim for a non-peer audience");
    const r = expectOk(await http("POST", `${home.base}/ilp/v1/claims`, { bearer: ctx.creds.provisioning, body: { purpose: "event_join", event: ctx.events.E1.global_id, aud: host.base, agent: syn.agent.id, on_behalf_of: syn.human, ...e1ConsentOptIn(ctx) } }), 201, "mint claim");
    const hd = await discoveryOf(home);
    const { header, payload } = verifyJws(r.claim, keyResolver(hd), { typ: TYP.claim });
    ctx.observe(home.name, header.kid);
    schemaOk("identity-claim", payload, "claim payload");
    check(Object.keys(payload).every((k) => CLAIM_MEMBERS.has(k)), "claim carries an out-of-schema member");
    check(!JSON.stringify(payload).includes("@"), "claim carries an email-like value");
    check(payload.sub === syn.human, `claim sub ${payload.sub} is not the on_behalf_of synthetic human`);
    check(payload.aud === host.base, `claim aud ${payload.aud} is not the host`);
    check(payload.exp - payload.iat <= ctx.profile.parameters.claim_ttl_max_s, "claim lifetime exceeds 86400 s");
    check(payload.agent?.id === syn.agent.id && payload.agent.license_plate === syn.agent.license_plate, "claim agent does not match");
    ctx.claim = r.claim;
    return { sub: payload.sub, kid: header.kid, lifetime_s: payload.exp - payload.iat };
  },
  async "PC-IDC-2"(ctx) {
    const { host } = ctx;
    const E1 = ctx.events.E1;
    const j = await http("POST", `${host.base}/ilp/v1/events/${E1.id}/join-requests`, { body: { claim: ctx.claim } });
    expectOk(j, 202, "join request");
    check(j.json.status === "pending" && j.json.retrieval_key && j.json.join_request_id, "join response shape");
    ctx.join = j.json;
    const before = await observe(host, E1.id);
    const idAsAuth = await http("POST", `${host.base}/ilp/v1/events/${E1.id}/actions`, { bearer: ctx.claim, body: { kind: "unconference.proposal", payload: { title: "identity is not authority", content: "x" } } });
    expectProblem(idAsAuth, "AUTHZ_REQUIRED", "identity claim presented as authority");
    await expectNoSideEffects(host, E1.id, before, "identity-as-authority");
    const list = expectOk(await http("GET", `${host.base}/ilp/v1/events/${E1.id}/join-requests`, { bearer: ctx.creds.operator.E1 }), 200, "operator join list");
    const entry = list.items.find((x) => x.join_request_id === j.json.join_request_id);
    check(entry && entry.subject === ctx.subject.human, "shadow principal is not keyed by the home global ID");
    check(!JSON.stringify(entry).includes("@"), "shadow principal carries an email-like value");
    const st = expectOk(await http("GET", `${host.base}/ilp/v1/events/${E1.id}/join-requests/${j.json.join_request_id.split(":").pop()}`, { bearer: j.json.retrieval_key }), 200, "pending retrieval");
    schemaOk("join-request", st, "join-request (pending)");
    check(st.status === "pending" && !st.participant_token && !st.grant, "pending retrieval must not deliver credentials");
    return { join_request: j.json.join_request_id };
  },
  async "PC-IDC-3"(ctx) {
    const { host, home, aux } = ctx;
    const E1 = ctx.events.E1;
    // rejected claims must create no join request and change no event state (observed before/after)
    const joins = () => observeJoins(host, E1.id, ctx.creds.operator.E1);
    const refuse = (claim, code, what) => expectRefusal(host, E1.id, ctx.creds.operator.E1, () => http("POST", `${host.base}/ilp/v1/events/${E1.id}/join-requests`, { body: { claim } }), code, what);
    await refuse(ctx.claim, "CLAIM_REPLAYED", "replayed claim");
    // a claim legitimately minted by the home for another audience (pc-aux)
    const other = expectOk(await http("POST", `${home.base}/ilp/v1/claims`, { bearer: ctx.creds.provisioning, body: { purpose: "event_join", event: ctx.auxEvent.global_id, aud: aux.base, agent: ctx.subject.agent.id, on_behalf_of: ctx.subject.human } }), 201, "claim for another audience");
    await refuse(other.claim, "CLAIM_AUDIENCE_MISMATCH", "claim for another audience");
    // expired: signed by the runner-owned pc-aux (never a key of a node under test)
    const t = nowS() - 3600;
    const expired = signJws({ iss: aux.base, sub: `ilp:${new URL(aux.base).hostname}:human:00000000-0000-7000-8000-00000000e001`, aud: host.base, iat: t - 600, exp: t, jti: `claim-expired-${ctx.tag}-${Date.now()}`, display_name: "Expired", verified: true, verified_method: "synthetic", agent: null, purpose: "event_join", event: E1.global_id, consent_accepted: null }, aux.key, TYP.claim);
    await refuse(expired, "CLAIM_EXPIRED", "expired claim");
    // tampered: a fresh valid claim with one payload byte altered
    const fresh = expectOk(await http("POST", `${home.base}/ilp/v1/claims`, { bearer: ctx.creds.provisioning, body: { purpose: "event_join", event: E1.global_id, aud: host.base, agent: ctx.subject.agent.id, on_behalf_of: ctx.subject.human, ...e1ConsentOptIn(ctx) } }), 201, "claim to tamper");
    const [h, p, s] = fresh.claim.split(".");
    // one character of the display name changed; the payload stays valid JSON, so the failure is the signature
    const text = b64u.decode(p).toString("utf8");
    check(text.includes("Synthetic"), "cannot construct tampered claim");
    const tampered = `${h}.${b64u.encode(Buffer.from(text.replace("Synthetic", "Synthetik"), "utf8"))}.${s}`;
    await refuse(tampered, "SIGNATURE_INVALID", "tampered claim");
    // paired failure: tampered AND for another audience → the signature (step 2) is reported before the audience (step 3)
    const [oh, op, os] = other.claim.split(".");
    const otext = b64u.decode(op).toString("utf8");
    const tamperedOther = `${oh}.${b64u.encode(Buffer.from(otext.replace("Synthetic", "Synthetik"), "utf8"))}.${os}`;
    await refuse(tamperedOther, "SIGNATURE_INVALID", "tampered claim for another audience (precedence)");
    // concurrent replay: one fresh claim submitted twice at once → exactly one acceptance
    const race = expectOk(await http("POST", `${home.base}/ilp/v1/claims`, { bearer: ctx.creds.provisioning, body: { purpose: "event_join", event: ctx.events.E1.global_id, aud: host.base, agent: null, on_behalf_of: (expectOk(await http("POST", `${home.base}/ilp/v1/admin/synthetic/humans`, { bearer: ctx.creds.provisioning, body: { display_name: `Race ${ctx.tag}` } }), 201, "race subject")).human } }), 201, "race claim").claim;
    // Each preceding rejection was checked separately; the race below intentionally admits one join.
    const joinsBefore = await joins();
    const both = await Promise.all([0, 1].map(() => http("POST", `${host.base}/ilp/v1/events/${E1.id}/join-requests`, { body: { claim: race } })));
    const accepted = both.filter((r) => r.status === 202).length;
    check(accepted === 1, `concurrent replay: ${accepted} acceptances (want exactly 1)`);
    expectProblem(both.find((r) => r.status !== 202), "CLAIM_REPLAYED", "concurrent replay");
    const joinsAfter = await joins();
    check(joinsAfter.length === joinsBefore.length + 1 && joinsBefore.every(j => joinsAfter.includes(j)), "concurrent replay must persist exactly one join request without altering existing admissions");
    ctx.spareClaim = fresh.claim; // untouched original, unused so far
    return { replay: "CLAIM_REPLAYED", audience: "CLAIM_AUDIENCE_MISMATCH", expired: "CLAIM_EXPIRED", tampered: "SIGNATURE_INVALID" };
  },
  async "PC-GRANT-1"(ctx) {
    const { host } = ctx;
    const E1 = ctx.events.E1;
    const jid = ctx.join.join_request_id.split(":").pop();
    expectOk(await http("POST", `${host.base}/ilp/v1/events/${E1.id}/join-requests/${jid}/approve`, { bearer: ctx.creds.operator.E1, body: {} }), 200, "operator approves");
    const st = expectOk(await http("GET", `${host.base}/ilp/v1/events/${E1.id}/join-requests/${jid}`, { bearer: ctx.join.retrieval_key }), 200, "approved retrieval");
    schemaOk("join-request", st, "join-request (approved)");
    check(st.status === "approved" && st.participant_token && st.grant, "approved retrieval must deliver token and grant");
    const hd = await discoveryOf(host);
    const { header, payload: g } = verifyJws(st.grant, keyResolver(hd), { typ: TYP.grant });
    ctx.observe(host.name, header.kid);
    schemaOk("authorization-grant", g, "grant payload");
    check(g.iss === host.base && g.aud === host.base, "grant iss/aud must be the host");
    check(g.sub === ctx.subject.human, "grant sub must be the home global ID");
    check(g.agent?.id === ctx.subject.agent.id && g.agent.license_plate === ctx.subject.agent.license_plate, "grant must bind the agent");
    check(g.event === E1.global_id, "grant event");
    check(g.home === new URL(ctx.home.base).hostname, "grant home");
    check(g.authorization_details.some((d) => d.pack === ctx.profile.parameters.pack && d.actions.includes(ctx.profile.parameters.permitted_action)), "grant must permit unconference.proposal on unconference@1.1");
    check(g.exp - g.iat <= ctx.profile.parameters.test_grant_ttl_max_s, `grant lifetime ${g.exp - g.iat} s exceeds the test-grant TTL`);
    check(g.credential_binding.alg === "S256" && g.credential_binding.value === S256(st.participant_token), "credential_binding must be S256(token)");
    check(g.parent_grant === null, "parent_grant must be null");
    ctx.token = st.participant_token;
    ctx.grant = st.grant;
    ctx.grantPayload = g;
    return { jti: g.jti, lifetime_s: g.exp - g.iat, kid: header.kid };
  },
  async "PC-GRANT-2"(ctx) {
    const { host } = ctx;
    const s = expectOk(await http("GET", ctx.grantPayload.status.uri), 200, "grant status");
    schemaOk("grant-status", s, "grant status");
    check(s.status === "active", `grant status ${s.status}`);
    check(!JSON.stringify(s).includes("ilpt_"), "grant status leaks a token");
    const re = expectOk(await http("GET", `${host.base}/ilp/v1/auth/grant`, { bearer: ctx.token }), 200, "grant re-fetch");
    check(re.grant === ctx.grant, "re-fetched grant differs");
    return { status: s.status };
  },
  async "PC-ENF-1"(ctx) {
    const { host } = ctx;
    const E1 = ctx.events.E1;
    const before = await observe(host, E1.id);
    const r = await http("POST", `${host.base}/ilp/v1/events/${E1.id}/actions`, { bearer: ctx.token, headers: { "idempotency-key": `enf1-${ctx.tag}` }, body: { kind: "unconference.proposal", payload: { title: `Proposal ${ctx.tag}`, content: "Governed remote proposal" }, mandate: "human_directed" } });
    expectOk(r, 201, "permitted proposal");
    const after = await observe(host, E1.id);
    check(after.actions === before.actions + 1, `expected exactly one new action (${before.actions} → ${after.actions})`);
    ctx.actionId = r.json.id;
    return { action: r.json.id };
  },
  async "PC-RCPT-1"(ctx) {
    const { host } = ctx;
    const E1 = ctx.events.E1;
    const rc = expectOk(await http("GET", `${host.base}/ilp/v1/events/${E1.id}/receipts`), 200, "receipts");
    for (const r of rc.items) schemaOk("receipt", r, `receipt ${r.action_kind}`);
    const chain = verifyReceiptChain(rc.items, { event: E1.global_id });
    check(chain.ok, `receipt chain: ${JSON.stringify(chain.errors.slice(0, 3))}`);
    const r = rc.items.find((x) => x.resource === ctx.actionId);
    check(r, "no receipt for the permitted act");
    check(r.authorization_grant === ctx.grantPayload.jti, "receipt authorization_grant");
    check(r.subject_human === ctx.subject.human, "receipt subject_human must be the home global ID");
    check(r.subject_agent === ctx.subject.agent.id && r.license_plate === ctx.subject.agent.license_plate, "receipt subject_agent / plate");
    check(r.mandate === "human_directed" && r.source_class === "agent_token_api", "receipt mandate / source_class");
    return { receipt: r.id, chain_length: rc.items.length };
  },
  async "PC-ENF-2"(ctx) {
    const { host } = ctx;
    const E1 = ctx.events.E1;
    const before = await observe(host, E1.id);
    const r = await http("POST", `${host.base}/ilp/v1/events/${E1.id}/actions`, { bearer: ctx.token, body: { kind: "unconference.vote", payload: {}, target_action: ctx.actionId.split(":").pop() } });
    expectProblem(r, "GRANT_SCOPE_VIOLATION", "out-of-scope vote");
    await expectNoSideEffects(host, E1.id, before, "out-of-scope vote");
    return { rejected: "GRANT_SCOPE_VIOLATION" };
  },
};

export const SG2_ORDER = ["PC-DISC-1", "PC-DISC-2", "PC-DISC-3", "PC-DISC-4", "PC-PEER-1", "PC-IDC-1", "PC-IDC-2", "PC-IDC-3", "PC-GRANT-1", "PC-GRANT-2", "PC-ENF-1", "PC-RCPT-1", "PC-ENF-2", "PC-ENF-6", "PC-ENF-10"];

export { generateKey, decodeJws };
