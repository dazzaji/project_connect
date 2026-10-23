#!/usr/bin/env node
// Regression probes keyed by review-finding ID (not acceptance tests; the frozen profile is unchanged).
// Each probe drives a node under test through its public interfaces, against both implementations.
//   node runner/regressions.mjs --harness http://127.0.0.1:4180 [--out FILE]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { b64u, decodeJws, generateKey, signJws, TYP } from "../lib/jws.mjs";
import { check, expectNoSideEffects, expectOk, expectProblem, expectRefusal, http, observe, observeJoins, PC_ROOT, sleep, startReferenceNode } from "./lib.mjs";
import { selectProbes } from "./select.mjs";
import { adapter } from "./setup.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const harness = args.harness ?? "http://127.0.0.1:4180";
const work = join(PC_ROOT, ".run", `regressions-${Date.now()}`);
const nowS = () => Math.floor(Date.now() / 1000);
const local = (g) => g.split(":").pop();
// operator-visible admission state: every join id and its status. Feed and receipts alone miss a silently inserted or
// mutated pending join (SG2R4-FEED-RESET-GREEN, r5): an observation that cannot be made fails the probe
async function joinState(node, eventRef, bearer) {
  return observeJoins(node, eventRef, bearer);
}
const hostOf = (b) => new URL(b).hostname;

const pcRef = await startReferenceNode({ name: "pc-ref", port: 4193, work });
const pcAux = await startReferenceNode({ name: "pc-aux", port: 4194, work });
process.on("exit", () => { for (const n of [pcRef, pcAux]) { try { process.kill(-n.child.pid, "SIGCONT"); } catch {} n.stop(); } });
const betaNodes = (await http("GET", `${harness}/nodes`)).json;
const beta = adapter({ name: "beta-one", base: betaNodes["beta-one"].base_url, kind: "beta", adminHuman: betaNodes["beta-one"].admin_human }, { harness });
const ref = adapter(pcRef, { harness });
const aux = adapter(pcAux, { harness });
const peering = {};
for (const n of [beta, ref, aux]) peering[n.name] = await n.credential("peering");
const peer = async (a, b) => expectOk(await http("POST", `${a.base}/ilp/v1/federation/peers`, { bearer: peering[a.name], body: { base_url: b.base } }), [200, 201], `${a.name}→${b.name}`);
for (const [a, b] of [[beta, aux], [aux, beta], [ref, aux], [aux, ref]]) await peer(a, b);
const auxProv = await aux.credential("provisioning");

// admit a fresh aux-homed synthetic subject to a new event on `host`
async function admitted(host, tag, { approve = true, ...spec } = {}) {
  const ev = await host.createEvent({ slug: `reg-${tag}-${Date.now().toString(36)}`, ...spec });
  const op = await host.credential("operator", ev.id);
  const syn = expectOk(await http("POST", `${aux.base}/ilp/v1/admin/synthetic/humans`, { bearer: auxProv, body: { display_name: `Reg ${tag}`, agent_display_name: `Reg agent ${tag}` } }), 201, "synthetic");
  const claim = expectOk(await http("POST", `${aux.base}/ilp/v1/claims`, { bearer: auxProv, body: { purpose: "event_join", event: ev.global_id, aud: host.base, agent: syn.agent.id, on_behalf_of: syn.human } }), 201, "claim").claim;
  const j = expectOk(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim } }), 202, "join");
  if (approve) expectOk(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests/${local(j.join_request_id)}/approve`, { bearer: op, body: {} }), 200, "approve");
  return { ev, op, syn, claim, j };
}
// a subject revoked by its home after approval and before first retrieval, retrieved only once the host must have
// consumed the revocation (revocation_bound_s); memoized per host (ASTRA-R2-01, ASTRA-R2-16, ASTRA-R3-04)
const revokedBeforeDelivery = new Map();
function revokeThenRetrieve(host) {
  if (!revokedBeforeDelivery.has(host.name)) revokedBeforeDelivery.set(host.name, (async () => {
    const a = await admitted(host, "r01");
    const before = expectOk(await http("GET", `${host.base}/ilp/v1/events/${a.ev.id}/receipts`, { bearer: a.op }), 200, "receipts").items.length;
    expectOk(await http("POST", `${aux.base}/ilp/v1/admin/synthetic/agents/${local(a.syn.agent.id)}/revoke`, { bearer: auxProv, body: {} }), 200, "home revokes agent");
    const bound = (await http("GET", `${host.base}/.well-known/interlateral.json`)).json.federation.revocation_bound_s;
    await sleep((bound + 2) * 1000);
    const responses = [], observations = [];
    for (let i = 0; i < 2; i++) {
      const before = await observe(host, a.ev.id, a.op), joinsBefore = await joinState(host, a.ev.id, a.op);
      responses.push(await retrieve(host, a));
      observations.push({ before, after: await observe(host, a.ev.id, a.op), joinsBefore, joinsAfter: await joinState(host, a.ev.id, a.op) });
    }
    // The revocation cascade is an expected receipted state transition (ASTRA-R2-16), not an unchanged-state claim.
    return { a, before, bound, responses, observations };
  })());
  return revokedBeforeDelivery.get(host.name);
}
const retrieve = (host, a) => http("GET", `${host.base}/ilp/v1/events/${a.ev.id}/join-requests/${local(a.j.join_request_id)}`, { bearer: a.j.retrieval_key });

const PROBES = {
  // revoked before first delivery → no credentials, no act (ASTRA-R2-01)
  // every retrieval after the bound fails for any delivered token; the first is the precise rejection (ASTRA-R3-04)
  async "ASTRA-R2-01"(host) {
    const { responses, bound, observations } = await revokeThenRetrieve(host);
    for (const [i, r] of responses.entries()) check(!r.json?.participant_token, `retrieval ${i + 1} delivered a participant token to a subject the home had revoked`);
    expectProblem(responses[0], "SUBJECT_REVOKED", "first retrieval after the revocation bound");
    return { waited_s: bound + 2, first_retrieval: responses[0].json?.title, second_retrieval: responses[1].status, observations };
  },
  // a peer cannot attest another home's agent (ASTRA-R2-03)
  async "ASTRA-R2-03"(host) {
    const ev = await host.createEvent({ slug: `reg-r03-${Date.now().toString(36)}` });
    const t = nowS();
    const c = signJws({ iss: aux.base, sub: `ilp:${hostOf(aux.base)}:human:00000000-0000-7000-8000-00000000r003`, aud: host.base, iat: t, exp: t + 600, jti: `claim-r03-${Date.now()}`, display_name: "Foreign agent", verified: true, verified_method: null, agent: { id: "ilp:someone-else.localhost:agent:00000000-0000-7000-8000-000000000001", display_name: "Theirs", license_plate: "IL-AAAAAAAA" }, purpose: "event_join", event: ev.global_id, consent_accepted: null }, aux.key, TYP.claim);
    await expectRefusal(host, ev.id, await host.credential("operator", ev.id), () => http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim: c } }), "VALIDATION_FAILED", "foreign agent");
    return { rejected: true };
  },
  // a claim with a malformed required member is rejected (ASTRA-R2-04)
  async "ASTRA-R2-04"(host) {
    const ev = await host.createEvent({ slug: `reg-r04-${Date.now().toString(36)}` });
    const t = nowS();
    const c = signJws({ iss: aux.base, sub: `ilp:${hostOf(aux.base)}:human:00000000-0000-7000-8000-00000000r004`, aud: host.base, iat: t, exp: t + 600, jti: `claim-r04-${Date.now()}`, display_name: "Malformed", verified: "yes", verified_method: null, agent: null, purpose: "event_join", event: ev.global_id, consent_accepted: null }, aux.key, TYP.claim);
    await expectRefusal(host, ev.id, await host.credential("operator", ev.id), () => http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim: c } }), "VALIDATION_FAILED", "verified: 'yes'");
    return { rejected: true };
  },
  // an oversized per-action payload is reported at step 0, before credentials (ASTRA-R2-09, ruled FINDING_STANDS), and has
  // no effect: the event's public feed/receipts and its operator-visible admission state are unchanged (oracle122)
  async "ASTRA-R2-09"(host) {
    const ev = await host.createEvent({ slug: `reg-r09-${Date.now().toString(36)}` });
    const op = await host.credential("operator", ev.id);
    const before = await observe(host, ev.id);
    const joinsBefore = await joinState(host, ev.id, op);
    expectProblem(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/actions`, { body: { kind: "unconference.proposal", payload: { title: "big", content: "x".repeat(40000) } } }), "PAYLOAD_TOO_LARGE", "unauthenticated oversized payload");
    await expectNoSideEffects(host, ev.id, before, "oversized payload");
    const joinsAfter = await joinState(host, ev.id, op);
    check(JSON.stringify(joinsAfter) === JSON.stringify(joinsBefore), `oversized payload: admission state changed ${JSON.stringify(joinsBefore)} → ${JSON.stringify(joinsAfter)}`);
    return { reported: "PAYLOAD_TOO_LARGE", unchanged: before };
  },
  // a local token on another event with a presented grant: 4a is reported, not an unknown credential (SG2R2-LOCAL-4A / ENF3-GREEN)
  async "SG2R2-LOCAL-4A"(host) {
    const e1 = await host.createEvent({ slug: `reg-l4a1-${Date.now().toString(36)}`, visibility: "public", registration_approval: "auto" });
    const e2 = await host.createEvent({ slug: `reg-l4a2-${Date.now().toString(36)}` });
    const lp = await host.localParticipant(e1);
    const a = await admitted(host, "l4a");
    const g = (await retrieve(host, a)).json.grant;
    const [h, p, s] = g.split(".");
    const tampered = `${h}.${b64u.encode(Buffer.from(b64u.decode(p).toString("utf8").replace('"participant"', '"participanu"'), "utf8"))}.${s}`;
    const act = (grant) => http("POST", `${host.base}/ilp/v1/events/${e2.id}/actions`, { bearer: lp.participant_token, headers: grant ? { "ilp-grant": grant } : {}, body: { kind: "unconference.proposal", payload: { title: "x", content: "y" } } });
    const op = await host.credential("operator", e2.id);
    await expectRefusal(host, e2.id, op, () => act(tampered), "SIGNATURE_INVALID", "local token + tampered grant on another event");
    await expectRefusal(host, e2.id, op, () => act(null), "FORBIDDEN", "local token on another event, no grant");
    return { tampered: "SIGNATURE_INVALID", plain: "FORBIDDEN" };
  },
  // event status (7) is reported before an undefined in-scope action kind (9) (SG2R2-KIND-PHASE)
  async "SG2R2-KIND-PHASE"(host) {
    const ev = await host.createEvent({ slug: `reg-kp-${Date.now().toString(36)}`, grant_actions: ["unconference.proposal", "unconference.bogus"], grant_exclusions: [] });
    const op = await host.credential("operator", ev.id);
    const syn = expectOk(await http("POST", `${aux.base}/ilp/v1/admin/synthetic/humans`, { bearer: auxProv, body: { display_name: "KP" } }), 201, "synthetic");
    const claim = expectOk(await http("POST", `${aux.base}/ilp/v1/claims`, { bearer: auxProv, body: { purpose: "event_join", event: ev.global_id, aud: host.base, agent: null, on_behalf_of: syn.human } }), 201, "claim").claim;
    const j = expectOk(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim } }), 202, "join");
    expectOk(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests/${local(j.join_request_id)}/approve`, { bearer: op, body: {} }), 200, "approve");
    const tok = (await http("GET", `${host.base}/ilp/v1/events/${ev.id}/join-requests/${local(j.join_request_id)}`, { bearer: j.retrieval_key })).json.participant_token;
    await host.close(ev);
    await expectRefusal(host, ev.id, op, () => http("POST", `${host.base}/ilp/v1/events/${ev.id}/actions`, { bearer: tok, body: { kind: "unconference.bogus", payload: {} } }), "PHASE_MISMATCH", "undefined kind on a closed event");
    return { reported: "PHASE_MISMATCH" };
  },
  // operator routes: step 1 before step 2 — no existence oracle (SG2R2-JOIN-ORDER)
  async "SG2R2-JOIN-ORDER"(host) {
    const priv = await host.createEvent({ slug: `reg-jo-${Date.now().toString(36)}`, visibility: "private" });
    const op = await host.credential("operator", priv.id);
    const nil = "00000000-0000-7000-8000-000000000000";
    await expectRefusal(host, priv.id, op, () => http("GET", `${host.base}/ilp/v1/events/${priv.id}/join-requests`), "AUTH_MISSING", "unauthenticated, private event");
    await expectRefusal(host, priv.id, op, () => http("GET", `${host.base}/ilp/v1/events/${nil}/join-requests`), "AUTH_MISSING", "unauthenticated, no such event");
    // an invalid bearer or session is reported identically whether or not the event exists (r3: still-failing for bearer "bogus")
    for (const bearer of ["bogus", "ilpo_" + "A".repeat(43), "ilpt_" + "A".repeat(43)]) {
      await expectRefusal(host, priv.id, op, () => http("GET", `${host.base}/ilp/v1/events/${priv.id}/join-requests`, { bearer }), "AUTH_INVALID", `bearer ${bearer.slice(0, 5)}…, private event`);
      await expectRefusal(host, priv.id, op, () => http("GET", `${host.base}/ilp/v1/events/${nil}/join-requests`, { bearer }), "AUTH_INVALID", `bearer ${bearer.slice(0, 5)}…, no such event`);
    }
    const cookie = { cookie: "il_session=ils_" + "A".repeat(43) };
    const a = await expectRefusal(host, priv.id, op, () => http("GET", `${host.base}/ilp/v1/events/${priv.id}/join-requests`, { headers: cookie }), ["AUTH_INVALID", "AUTH_MISSING"], "invalid session, private event");
    const b = await expectRefusal(host, priv.id, op, () => http("GET", `${host.base}/ilp/v1/events/${nil}/join-requests`, { headers: cookie }), ["AUTH_INVALID", "AUTH_MISSING"], "invalid session, no such event");
    // each answer is a complete registered ILP problem envelope (oracle122: status, media type, schema, title), the
    // credential step's code, and identical for the private and the absent event (no existence oracle)
    expectProblem(a, ["AUTH_INVALID", "AUTH_MISSING"], "invalid session, private event");
    expectProblem(b, ["AUTH_INVALID", "AUTH_MISSING"], "invalid session, no such event");
    check(a.json.title === b.json.title && a.status === b.status, `invalid session: private ${a.status} ${a.json.title} vs absent ${b.status} ${b.json.title}`);
    return { unauthenticated: "AUTH_MISSING", invalid_bearer: "AUTH_INVALID", invalid_session: a.json.title };
  },
  // an empty ILP-Grant header is a presented grant: rejected at 4a, never replaced by the stored grant (ASTRA-R3-01)
  async "ASTRA-R3-01"(host) {
    const a = await admitted(host, "r3-01");
    const tok = (await retrieve(host, a)).json.participant_token;
    const act = (headers) => http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/actions`, { bearer: tok, headers, body: { kind: "unconference.proposal", payload: { title: "empty grant", content: "x" } } });
    await expectRefusal(host, a.ev.id, a.op, () => act({ "ilp-grant": "" }), "SIGNATURE_INVALID", "empty ILP-Grant");
    await expectRefusal(host, a.ev.id, a.op, () => act({ "ilp-grant": "not.a.jws" }), "SIGNATURE_INVALID", "malformed ILP-Grant");
    return { empty: "SIGNATURE_INVALID" };
  },
  // a join body's own consent_accepted is validated before any admission state (ASTRA-R3-02)
  async "ASTRA-R3-02"(host) {
    const ev = await host.createEvent({ slug: `reg-r3-02-${Date.now().toString(36)}` });
    const op = await host.credential("operator", ev.id);
    const syn = expectOk(await http("POST", `${aux.base}/ilp/v1/admin/synthetic/humans`, { bearer: auxProv, body: { display_name: "Consent" } }), 201, "synthetic");
    const claim = expectOk(await http("POST", `${aux.base}/ilp/v1/claims`, { bearer: auxProv, body: { purpose: "event_join", event: ev.global_id, aud: host.base, agent: null, on_behalf_of: syn.human } }), 201, "claim").claim;
    await expectRefusal(host, ev.id, op, () => http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim, consent_accepted: { text_version: "incomplete" } } }), "VALIDATION_FAILED", "malformed body consent");
    const joins = expectOk(await http("GET", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { bearer: op }), 200, "join list").items;
    check(joins.length === 0, `a malformed-consent join left ${joins.length} join request(s)`);
    return { rejected: "VALIDATION_FAILED", persisted: 0 };
  },
  // unauthenticated export: step 1 before step 2 (SG2R3-EXPORT-ORACLE); a live event is not exported (SG2R3-EXPORT-LIVE)
  async "SG2R3-EXPORT"(host) {
    const priv = await host.createEvent({ slug: `reg-exp-${Date.now().toString(36)}`, visibility: "private" });
    const op = await host.credential("operator", priv.id);
    const a1 = await expectRefusal(host, priv.id, op, () => http("POST", `${host.base}/ilp/v1/events/${priv.id}/exports`, { body: {} }), "AUTH_MISSING", "unauthenticated export, private event");
    const a2 = await expectRefusal(host, priv.id, op, () => http("POST", `${host.base}/ilp/v1/events/00000000-0000-7000-8000-000000000000/exports`, { body: {} }), "AUTH_MISSING", "unauthenticated export, no such event");
    expectProblem(a1, "AUTH_MISSING", "unauthenticated export, private event");
    expectProblem(a2, "AUTH_MISSING", "unauthenticated export, no such event");
    const live = await expectRefusal(host, priv.id, op, () => http("POST", `${host.base}/ilp/v1/events/${priv.id}/exports`, { bearer: op, body: {} }), "VALIDATION_FAILED", "export of a live event");
    expectProblem(live, "VALIDATION_FAILED", "export of a live event (R-EV-25)");
    return { unauthenticated: "AUTH_MISSING", live: live.json?.title };
  },
  // unauthenticated grant revocation: step 1 before step 2 (SG2R3-REVOKE-PREC)
  async "SG2R3-REVOKE-PREC"(host) {
    const a = await admitted(host, "rvp");
    const g = decodeJws((await retrieve(host, a)).json.grant).payload.jti;
    await expectRefusal(host, a.ev.id, a.op, () => http("POST", `${host.base}/ilp/v1/grants/${local(g)}/revoke`, { body: {} }), "AUTH_MISSING", "unauthenticated revoke, real grant");
    await expectRefusal(host, a.ev.id, a.op, () => http("POST", `${host.base}/ilp/v1/grants/00000000-0000-7000-8000-000000000088/revoke`, { body: {} }), "AUTH_MISSING", "unauthenticated revoke, no such grant");
    return { both: "AUTH_MISSING" };
  },
  // join retrieval: the retrieval key is checked before the join request is resolved (SG2R3-JOIN-GET)
  async "SG2R3-JOIN-GET"(host) {
    const a = await admitted(host, "jg", { approve: false });
    const nilJ = `${host.base}/ilp/v1/events/${a.ev.id}/join-requests/00000000-0000-7000-8000-000000000099`;
    const realJ = `${host.base}/ilp/v1/events/${a.ev.id}/join-requests/${local(a.j.join_request_id)}`;
    await expectRefusal(host, a.ev.id, a.op, () => http("GET", nilJ), "AUTH_MISSING", "no key, no such join request");
    await expectRefusal(host, a.ev.id, a.op, () => http("GET", realJ), "AUTH_MISSING", "no key, real join request");
    await expectRefusal(host, a.ev.id, a.op, () => http("GET", nilJ, { bearer: "ilpr_" + "A".repeat(43) }), "AUTH_INVALID", "unknown key, no such join request");
    await expectRefusal(host, a.ev.id, a.op, () => http("GET", realJ, { bearer: "ilpr_" + "A".repeat(43) }), "AUTH_INVALID", "unknown key, real join request");
    expectOk(await http("GET", realJ, { bearer: a.j.retrieval_key }), 200, "own key");
    return { missing: "AUTH_MISSING", invalid: "AUTH_INVALID" };
  },
  // R-UNCONF-1: a duplicate proposal by (author, title) returns the original and records nothing (SG2R3-DUP-TITLE)
  async "SG2R3-DUP-TITLE"(host) {
    const a = await admitted(host, "dt");
    const tok = (await retrieve(host, a)).json.participant_token;
    const act = (content) => http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/actions`, { bearer: tok, body: { kind: "unconference.proposal", payload: { title: "Same", content } } });
    const first = expectOk(await act("one"), 201, "first proposal");
    const before = await observe(host, a.ev.id);
    const dup = await act("two");
    check(dup.status < 300 && dup.json?.id === first.id && dup.json?.duplicate === true, `duplicate title: HTTP ${dup.status} id ${dup.json?.id} (first ${first.id})`);
    await expectNoSideEffects(host, a.ev.id, before, "duplicate (author, title)");
    return { duplicate: "original returned" };
  },
  // step 9: an unknown vote target is VALIDATION_FAILED, not NOT_FOUND (SG2R3-TARGET-404)
  async "SG2R3-TARGET-404"(host) {
    const a = await admitted(host, "t404", { grant_actions: ["unconference.proposal", "unconference.vote"], grant_exclusions: [] });
    const tok = (await retrieve(host, a)).json.participant_token;
    // Beta's gate needs one proposal before voting opens; a vote in the wrong phase would report PHASE_MISMATCH, not VALIDATION_FAILED
    expectOk(await http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/actions`, { bearer: tok, body: { kind: "unconference.proposal", payload: { title: "gate", content: "x" } } }), 201, "proposal");
    await host.setPhase(a.ev, "voting");
    await expectRefusal(host, a.ev.id, a.op, () => http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/actions`, { bearer: tok, body: { kind: "unconference.vote", payload: {}, target_action: "00000000-0000-7000-8000-000000000077" } }), "VALIDATION_FAILED", "vote on an unknown target");
    return { reported: "VALIDATION_FAILED" };
  },
  // a home whose revocation feed resets (latest_seq behind what was consumed) is not fresh: no first delivery (SG2R3-W-FEED-RESET, writer-found)
  async "SG2R3-W-FEED-RESET"(host) {
    const name = `pc-rst${host.name === "beta-one" ? "b" : "r"}`;
    let n = await startReferenceNode({ name, port: 4195, work });
    try {
      const rst = adapter(n, { harness });
      const prov = await rst.credential("provisioning");
      // advance the home's feed before peering, so the host's initial read consumes through seq 3
      for (let i = 0; i < 3; i++) {
        const s = expectOk(await http("POST", `${rst.base}/ilp/v1/admin/synthetic/humans`, { bearer: prov, body: { display_name: `Seed ${i}` } }), 201, "seed");
        await http("POST", `${rst.base}/ilp/v1/admin/synthetic/humans/${local(s.human)}/revoke`, { bearer: prov, body: {} });
      }
      const rstPeering = await rst.credential("peering");
      expectOk(await http("POST", `${host.base}/ilp/v1/federation/peers`, { bearer: peering[host.name], body: { base_url: rst.base } }), [200, 201], "host→rst");
      expectOk(await http("POST", `${rst.base}/ilp/v1/federation/peers`, { bearer: rstPeering, body: { base_url: host.base } }), [200, 201], "rst→host");
      const ev = await host.createEvent({ slug: `reg-rst-${Date.now().toString(36)}` });
      const op = await host.credential("operator", ev.id);
      const syn = expectOk(await http("POST", `${rst.base}/ilp/v1/admin/synthetic/humans`, { bearer: prov, body: { display_name: "Reset subject" } }), 201, "synthetic");
      const claim = expectOk(await http("POST", `${rst.base}/ilp/v1/claims`, { bearer: prov, body: { purpose: "event_join", event: ev.global_id, aud: host.base, agent: null, on_behalf_of: syn.human } }), 201, "claim").claim;
      const j = expectOk(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim } }), 202, "join");
      expectOk(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests/${local(j.join_request_id)}/approve`, { bearer: op, body: {} }), 200, "approve");
      // claims minted before the restart (same home keys): a clean second subject, and the soon-revoked subject again
      const clean = expectOk(await http("POST", `${rst.base}/ilp/v1/admin/synthetic/humans`, { bearer: prov, body: { display_name: "Clean subject" } }), 201, "clean synthetic");
      const mint = async (human) => expectOk(await http("POST", `${rst.base}/ilp/v1/claims`, { bearer: prov, body: { purpose: "event_join", event: ev.global_id, aud: host.base, agent: null, on_behalf_of: human } }), 201, "claim").claim;
      const cleanClaim = await mint(clean.human);
      const revokedClaim = await mint(syn.human);
      // the home restarts with an EMPTY feed (same keys) and then revokes the approved subject: that revocation is seq 1 of
      // the replacement feed — invisible to a host that keeps its cursor at 3 and stays "fresh" (SG2R4-FEED-RESET-GREEN)
      n.stop();
      await sleep(500);
      n = await startReferenceNode({ name, port: 4195, work });
      // the very next admission discovers the reset (no sleep, no poll wait first): it cannot be decided on the pre-reset
      // state, so it fails 503 REVOCATION_STATE_UNKNOWN with retry_after and leaves no join, receipt or feed trace
      const beforeDiscover = await observe(host, ev.id, op);
      const joinsBeforeDiscover = await joinState(host, ev.id, op);
      const discover = await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim: cleanClaim } });
      const joinsAfterDiscover = await joinState(host, ev.id, op);
      expectProblem(discover, "REVOCATION_STATE_UNKNOWN", "the admission that discovers the home's feed reset");
      check(discover.status === 503 && discover.json?.retry_after != null, `reset-discovering admission: ${discover.status}, retry_after ${discover.json?.retry_after}`);
      check(JSON.stringify(joinsAfterDiscover) === JSON.stringify(joinsBeforeDiscover), `reset-discovering admission changed join requests ${JSON.stringify(joinsBeforeDiscover)} → ${JSON.stringify(joinsAfterDiscover)}`);
      await expectNoSideEffects(host, ev.id, beforeDiscover, "reset-discovering admission", op);
      // the restarted home no longer knows the subject; its admin surface publishes the signed revocation directly (seq 1 of the new feed)
      expectOk(await http("POST", `${n.base}/ilp/v1/admin/revocations`, { bearer: n.admin, body: { kind: "human", subject: syn.human, reason: "revoked after restart" } }), 201, "restarted home revokes the subject");
      const bound = (await http("GET", `${host.base}/.well-known/interlateral.json`)).json.federation.revocation_bound_s;
      // well inside the freshness window: two poll intervals (bound/6 each) is enough to detect the reset and re-read from 0
      await sleep((Math.max(2, Math.floor(bound / 3)) + 3) * 1000);
      const beforeRetrieval = { effects: await observe(host, ev.id, op), joins: await joinState(host, ev.id, op) };
      const r = await http("GET", `${host.base}/ilp/v1/events/${ev.id}/join-requests/${local(j.join_request_id)}`, { bearer: j.retrieval_key });
      const afterRetrieval = { effects: await observe(host, ev.id, op), joins: await joinState(host, ev.id, op) };
      check(!r.json?.participant_token, "a token was delivered to a subject revoked on the home's replacement feed");
      check(["SUBJECT_REVOKED", "REVOCATION_STATE_UNKNOWN"].includes(r.json?.title), `retrieval after the feed reset: ${r.status} ${r.json?.title}`);
      expectProblem(r, ["SUBJECT_REVOKED", "REVOCATION_STATE_UNKNOWN"], "retrieval after the feed reset");
      // once the replacement feed has been read completely, the revocation has been applied: the join is rejected
      // (a host may report SUBJECT_REVOKED, or the join's status as rejected) and no token is ever delivered
      await sleep((Math.max(2, Math.floor(bound / 3)) + 3) * 1000);
      const beforeReread = { effects: await observe(host, ev.id, op), joins: await joinState(host, ev.id, op) };
      const r2 = await http("GET", `${host.base}/ilp/v1/events/${ev.id}/join-requests/${local(j.join_request_id)}`, { bearer: j.retrieval_key });
      const afterReread = { effects: await observe(host, ev.id, op), joins: await joinState(host, ev.id, op) };
      check(!r2.json?.participant_token, "a token was delivered after the replacement feed was consumed");
      check(r2.json?.title === "SUBJECT_REVOKED" || (r2.status === 200 && r2.json?.status === "rejected"), `after the re-read: ${r2.status} ${r2.json?.title ?? r2.json?.status}`);
      if (r2.status !== 200) expectProblem(r2, "SUBJECT_REVOKED", "retrieval after the complete re-read");
      // after the complete re-read from 0: the revoked subject is denied admission, the clean subject is admitted
      await expectRefusal(host, ev.id, op, () => http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim: revokedClaim } }), "SUBJECT_REVOKED", "revoked subject after the re-read");
      const admitted2 = await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim: cleanClaim } });
      expectOk(admitted2, 202, "clean subject after the re-read (positive control; the 503 did not consume its claim)");
      return { discovering_admission: `${discover.status} ${discover.json?.title}`, in_window: r.json?.title, after_reread: r2.json?.title ?? r2.json?.status, revoked_after_reread: "SUBJECT_REVOKED", clean_after_reread: admitted2.status, retrieval_observations: { beforeRetrieval, afterRetrieval, beforeReread, afterReread } };
    } finally {
      n.stop();
    }
  },
  // an Idempotency-Key is per principal: another principal's identical key is a new request (SG2R3-IDEM-SCOPE)
  async "SG2R3-IDEM-SCOPE"(host) {
    const ev = await host.createEvent({ slug: `reg-idem-${Date.now().toString(36)}`, visibility: "public", registration_approval: "auto" });
    const [p1, p2] = [await host.localParticipant(ev), await host.localParticipant(ev)];
    const act = (p, title) => http("POST", `${host.base}/ilp/v1/events/${ev.id}/actions`, { bearer: p.participant_token, headers: { "idempotency-key": "shared-key" }, body: { kind: "unconference.proposal", payload: { title, content: "x" } } });
    const r1 = expectOk(await act(p1, "from one"), 201, "principal 1");
    const r2 = expectOk(await act(p2, "from two"), 201, "principal 2");
    check(r1.id !== r2.id, "a second principal's request was answered with the first principal's action");
    return { distinct: true };
  },
  // §10.4 order: audience is reported before a schema failure (SG2R2-CLAIM-ORDER)
  async "SG2R2-CLAIM-ORDER"(host) {
    const ev = await host.createEvent({ slug: `reg-co-${Date.now().toString(36)}` });
    const t = nowS();
    const c = signJws({ iss: aux.base, sub: `ilp:${hostOf(aux.base)}:human:00000000-0000-7000-8000-00000000c0de`, aud: "http://elsewhere.localhost:4999", iat: t, exp: t + 600, jti: `claim-co-${Date.now()}`, display_name: "Order", verified: "yes", verified_method: null, agent: null, purpose: "event_join", event: ev.global_id, consent_accepted: null }, aux.key, TYP.claim);
    await expectRefusal(host, ev.id, await host.credential("operator", ev.id), () => http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim: c } }), "CLAIM_AUDIENCE_MISMATCH", "wrong audience and schema-invalid");
    return { reported: "CLAIM_AUDIENCE_MISMATCH" };
  },
  // join state changes are receipted (ASTRA-R2-16)
  async "ASTRA-R2-16"(host) {
    const a = await admitted(host, "r16", { approve: false });
    const rc = expectOk(await http("GET", `${host.base}/ilp/v1/events/${a.ev.id}/receipts`), 200, "receipts").items;
    check(rc.some((r) => r.resource === a.j.join_request_id && r.action_kind === "federation.join_requested"), "no receipt for the join submission");
    // the revocation-before-delivery state change is receipted too (still-failing in r3, original ID kept)
    const rv = await revokeThenRetrieve(host);
    const after = expectOk(await http("GET", `${host.base}/ilp/v1/events/${rv.a.ev.id}/receipts`, { bearer: rv.a.op }), 200, "receipts after revocation").items;
    check(after.length > rv.before && after.some((r) => r.resource === rv.a.j.join_request_id && r.action_kind === "federation.join_revoked"), `no receipt for the revocation before delivery (${rv.before} → ${after.length})`);
    return { receipted: ["federation.join_requested", "federation.join_revoked"] };
  },
  // a second join by an admitted principal does not demote the admission (ASTRA-R2-11)
  async "ASTRA-R2-11"(host) {
    const a = await admitted(host, "r11");
    const tok = (await retrieve(host, a)).json.participant_token;
    const claim2 = expectOk(await http("POST", `${aux.base}/ilp/v1/claims`, { bearer: auxProv, body: { purpose: "event_join", event: a.ev.global_id, aud: host.base, agent: a.syn.agent.id, on_behalf_of: a.syn.human } }), 201, "claim 2").claim;
    const r2 = await expectRefusal(host, a.ev.id, a.op, () => http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/join-requests`, { body: { claim: claim2 } }), "CONFLICT", "a duplicate join for an admitted principal");
    expectProblem(r2, "CONFLICT", "a duplicate join for an admitted principal");
    expectOk(await http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/actions`, { bearer: tok, body: { kind: "unconference.proposal", payload: { title: "still admitted", content: "x" } } }), 201, "original admission still acts");
    return { duplicate: r2.json?.title };
  },
  // idempotent retry after the cap returns the original result (ASTRA-R2-15)
  async "ASTRA-R2-15"(host) {
    const a = await admitted(host, "r15");
    const tok = (await retrieve(host, a)).json.participant_token;
    const act = (n, key) => http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/actions`, { bearer: tok, headers: key ? { "idempotency-key": key } : {}, body: { kind: "unconference.proposal", payload: { title: `p${n}`, content: "x" } } });
    const first = expectOk(await act(1, "k1"), 201, "first");
    for (const n of [2, 3]) expectOk(await act(n), 201, `proposal ${n}`);
    const retry = await act(1, "k1");
    check(retry.status === 200 && retry.json.id === first.id, `retry after the cap: HTTP ${retry.status} ${retry.json?.title ?? ""}`);
    return { retry: "original result" };
  },
  // optional intent is accepted (ASTRA-R2-13)
  async "ASTRA-R2-13"(host) {
    const a = await admitted(host, "r13");
    const tok = (await retrieve(host, a)).json.participant_token;
    expectOk(await http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/actions`, { bearer: tok, body: { kind: "unconference.proposal", payload: { title: "with intent", content: "x" }, intent: "Propose this topic" } }), 201, "intent accepted");
    return { accepted: true };
  },
  // a private event's feed is visible to its own participant token (ASTRA-R2-12) and hidden otherwise (SG2-PRIV-FEED)
  async "ASTRA-R2-12"(host) {
    const ev = await host.createEvent({ slug: `reg-r12-${Date.now().toString(36)}`, visibility: "private", registration_approval: "auto" });
    const op = await host.credential("operator", ev.id);
    // a caller without membership cannot register on the private event: it answers exactly like an absent id (SG2R5-PRIV-ROUTE)
    const absent = "00000000-0000-7000-8000-000000000000";
    const anonPriv = await expectRefusal(host, ev.id, op, () => http("POST", `${host.base}/ilp/v1/events/${ev.id}/registrations`, { body: {} }), "NOT_FOUND", "anonymous private registration");
    const anonAbsent = await expectRefusal(host, ev.id, op, () => http("POST", `${host.base}/ilp/v1/events/${absent}/registrations`, { body: {} }), "NOT_FOUND", "anonymous absent registration");
    check(`${anonPriv.status} ${anonPriv.json?.title}` === `${anonAbsent.status} ${anonAbsent.json?.title}`, `anonymous registration: private ${anonPriv.status} ${anonPriv.json?.title} vs absent ${anonAbsent.status} ${anonAbsent.json?.title}`);
    // the member is an ordinary participant prepared by the node's own setup surface; registration/token claim and the feed read
    // below are the tested behavior. Any setup-fixture provenance the adapter reports is recorded as supplemental setup evidence
    // only, never asserted here (implementation-neutral; S4 externalizes fixture setup).
    const lp = await host.localParticipant(ev);
    expectOk(await http("GET", `${host.base}/ilp/v1/events/${ev.id}/feed?since=0`, { bearer: lp.participant_token }), 200, "own private feed");
    await expectRefusal(host, ev.id, op, () => http("GET", `${host.base}/ilp/v1/events/${ev.id}/feed?since=0`), "NOT_FOUND", "anonymous private feed");
    return { own: 200, anonymous: 404, anonymous_register: `${anonPriv.status} ${anonPriv.json?.title}`, fixture: lp.fixture ?? null };
  },
  // claim minting refuses a claim that would be schema-invalid (ASTRA-R2-14)
  async "ASTRA-R2-14"(host) {
    const ev = await aux.createEvent({ slug: `reg-r14-${Date.now().toString(36)}` });
    const prov = await host.credential("provisioning");
    const op = await aux.credential("operator", ev.id);
    const syn = expectOk(await http("POST", `${host.base}/ilp/v1/admin/synthetic/humans`, { bearer: prov, body: { display_name: "Mint" } }), 201, "synthetic");
    await expectRefusal(aux, ev.id, op, () => http("POST", `${host.base}/ilp/v1/claims`, { bearer: prov, body: { purpose: "event_join", event: ev.global_id, aud: aux.base, agent: null, on_behalf_of: syn.human, consent_accepted: { text_version: "v" } } }), "VALIDATION_FAILED", "incomplete consent");
    await expectRefusal(aux, ev.id, op, () => http("POST", `${host.base}/ilp/v1/claims`, { bearer: prov, body: { purpose: "event_join", event: ev.global_id, aud: "not-a-url", agent: null, on_behalf_of: syn.human } }), "VALIDATION_FAILED", "malformed aud");
    return { rejected: 2 };
  },
  // SCR-8: the export carries the signed claim JWS (ASTRA-R2-10)
  async "ASTRA-R2-10"(host) {
    const a = await admitted(host, "r10");
    await retrieve(host, a);
    await host.close(a.ev);
    const ex = expectOk(await http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/exports`, { bearer: a.op, body: {} }), [200, 201], "export");
    const lines = ex.files["claims.jsonl"].split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const row = lines.find((l) => l.jti === decodeJws(a.claim).payload.jti);
    check(row && row.claim === a.claim && row.sub === a.syn.human, "claims.jsonl lacks the signed claim JWS");
    return { claim_jws_exported: true };
  },
  // re-adding a suspended peer keeps it suspended (SG2-REPEER-SUSPEND)
  async "SG2-REPEER-SUSPEND"(host) {
    const auxHost = hostOf(aux.base);
    expectOk(await http("POST", `${host.base}/ilp/v1/federation/peers/${auxHost}/suspend`, { bearer: peering[host.name], body: {} }), 200, "suspend");
    try {
      await http("POST", `${host.base}/ilp/v1/federation/peers`, { bearer: peering[host.name], body: { base_url: aux.base } });
      const st = expectOk(await http("GET", `${host.base}/ilp/v1/federation/peers`), 200, "peers").items.find((p) => p.host === auxHost)?.state;
      check(st === "suspended", `re-adding a suspended peer made it ${st}`);
    } finally {
      await http("POST", `${host.base}/ilp/v1/federation/peers/${auxHost}/reinstate`, { bearer: peering[host.name], body: {} });
    }
    return { stays: "suspended" };
  },
  // discovery never derives URLs from the Host header (SG2-DISC-HOST)
  async "SG2-DISC-HOST"(host) {
    const r = await fetch(`${host.base}/.well-known/interlateral.json`, { headers: { "x-forwarded-host": "attacker.example" } });
    const d = await r.json();
    const u = new URL(host.base);
    // a raw Host override is not possible with fetch; use the declared origin as the oracle
    check(d.endpoints.api.startsWith(host.base) || d.endpoints.api.startsWith(`https://${u.hostname}`), `endpoints.api ${d.endpoints.api} is not the canonical origin`);
    check(!JSON.stringify(d).includes("attacker.example"), "discovery reflects a forwarded host");
    return { api: d.endpoints.api };
  },
};

// feed pagination (ASTRA-R2-02) needs >200 records: one probe per implementation's own feed, run once
async function paginationProbe(node) {
  const prov = await node.credential("provisioning");
  for (let i = 0; i < 205; i++) {
    const s = expectOk(await http("POST", `${node.base}/ilp/v1/admin/synthetic/humans`, { bearer: prov, body: { display_name: `Page ${i}` } }), 201, "synthetic");
    await http("POST", `${node.base}/ilp/v1/admin/synthetic/humans/${local(s.human)}/revoke`, { bearer: prov, body: {} });
  }
  const f = expectOk(await http("GET", `${node.base}/ilp/v1/federation/revocations?since=0`), 200, "feed");
  check(f.items.length < f.latest_seq ? f.next_cursor !== null : true, `feed returned ${f.items.length} of ${f.latest_seq} with next_cursor=null`);
  return { page: f.items.length, latest_seq: f.latest_seq, next_cursor: f.next_cursor };
}

// --only: validated before any probe runs (unknown, empty or valueless selections fail); default is the full catalog
let selected;
try {
  selected = selectProbes([...Object.keys(PROBES), "ASTRA-R2-02"], process.argv.includes("--only") ? (args.only ?? "") : undefined);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const results = [];
for (const [label, host] of [["beta-one", beta], ["pc-ref", ref]]) {
  for (const [id, fn] of Object.entries(PROBES)) {
    // --only ID[,ID]: a focused run of named probes (writer pre/post proof); the default remains the complete set
    if (!selected.includes(id)) continue;
    try {
      const obs = await fn(host);
      results.push({ id, node: label, status: "pass", obs });
    } catch (e) {
      results.push({ id, node: label, status: "fail", error: e.message });
    }
    console.log(`${results.at(-1).status === "pass" ? "PASS" : "FAIL"} ${id} @ ${label}${results.at(-1).error ? ` — ${results.at(-1).error}` : ""}`);
  }
  if (!selected.includes("ASTRA-R2-02")) continue;
  try {
    results.push({ id: "ASTRA-R2-02", node: label, status: "pass", obs: await paginationProbe(host) });
  } catch (e) {
    results.push({ id: "ASTRA-R2-02", node: label, status: "fail", error: e.message });
  }
  console.log(`${results.at(-1).status === "pass" ? "PASS" : "FAIL"} ASTRA-R2-02 @ ${label}${results.at(-1).error ? ` — ${results.at(-1).error}` : ""}`);
}
const out = args.out ?? join(work, "regressions.json");
writeFileSync(out, JSON.stringify(results, null, 2));
// a filter that selects nothing is a failed run, never "0 fail" (zero-test false green)
if (!results.length) { console.error(`no regression probes ran${args.only ? ` for --only ${args.only}` : ""}`); process.exit(1); }
const failed = results.filter((r) => r.status === "fail").length;
console.log(`\n${results.length} regression probes, ${results.length - failed} pass, ${failed} fail — ${out}`);
process.exit(failed ? 1 : 0);
