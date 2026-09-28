#!/usr/bin/env node
// Regression probes keyed by review-finding ID (not acceptance tests; the frozen profile is unchanged).
// Each probe drives a node under test through its public interfaces, against both implementations.
//   node runner/regressions.mjs --harness http://127.0.0.1:4180 [--out FILE]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { b64u, decodeJws, generateKey, signJws, TYP } from "../lib/jws.mjs";
import { check, expectOk, expectProblem, http, observe, PC_ROOT, sleep, startReferenceNode } from "./lib.mjs";
import { adapter } from "./setup.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const harness = args.harness ?? "http://127.0.0.1:4180";
const work = join(PC_ROOT, ".run", `regressions-${Date.now()}`);
const nowS = () => Math.floor(Date.now() / 1000);
const local = (g) => g.split(":").pop();
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
async function admitted(host, tag, { approve = true } = {}) {
  const ev = await host.createEvent({ slug: `reg-${tag}-${Date.now().toString(36)}` });
  const op = await host.credential("operator", ev.id);
  const syn = expectOk(await http("POST", `${aux.base}/ilp/v1/admin/synthetic/humans`, { bearer: auxProv, body: { display_name: `Reg ${tag}`, agent_display_name: `Reg agent ${tag}` } }), 201, "synthetic");
  const claim = expectOk(await http("POST", `${aux.base}/ilp/v1/claims`, { bearer: auxProv, body: { purpose: "event_join", event: ev.global_id, aud: host.base, agent: syn.agent.id, on_behalf_of: syn.human } }), 201, "claim").claim;
  const j = expectOk(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim } }), 202, "join");
  if (approve) expectOk(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests/${local(j.join_request_id)}/approve`, { bearer: op, body: {} }), 200, "approve");
  return { ev, op, syn, claim, j };
}
const retrieve = (host, a) => http("GET", `${host.base}/ilp/v1/events/${a.ev.id}/join-requests/${local(a.j.join_request_id)}`, { bearer: a.j.retrieval_key });

const PROBES = {
  // revoked before first delivery → no credentials, no act (ASTRA-R2-01)
  async "ASTRA-R2-01"(host) {
    const a = await admitted(host, "r01");
    expectOk(await http("POST", `${aux.base}/ilp/v1/admin/synthetic/agents/${local(a.syn.agent.id)}/revoke`, { bearer: auxProv, body: {} }), 200, "home revokes agent");
    let r;
    for (let i = 0; i < 30; i++) {
      r = await retrieve(host, a);
      if (r.status !== 200 || !r.json?.participant_token) break;
      await sleep(1000);
    }
    check(!r.json?.participant_token, "credentials were delivered to a subject the home had revoked");
    return { first_retrieval: r.status, code: r.json?.title ?? null };
  },
  // a peer cannot attest another home's agent (ASTRA-R2-03)
  async "ASTRA-R2-03"(host) {
    const ev = await host.createEvent({ slug: `reg-r03-${Date.now().toString(36)}` });
    const t = nowS();
    const c = signJws({ iss: aux.base, sub: `ilp:${hostOf(aux.base)}:human:00000000-0000-7000-8000-00000000r003`, aud: host.base, iat: t, exp: t + 600, jti: `claim-r03-${Date.now()}`, display_name: "Foreign agent", verified: true, verified_method: null, agent: { id: "ilp:someone-else.localhost:agent:00000000-0000-7000-8000-000000000001", display_name: "Theirs", license_plate: "IL-AAAAAAAA" }, purpose: "event_join", event: ev.global_id, consent_accepted: null }, aux.key, TYP.claim);
    expectProblem(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim: c } }), "VALIDATION_FAILED", "foreign agent");
    return { rejected: true };
  },
  // a claim with a malformed required member is rejected (ASTRA-R2-04)
  async "ASTRA-R2-04"(host) {
    const ev = await host.createEvent({ slug: `reg-r04-${Date.now().toString(36)}` });
    const t = nowS();
    const c = signJws({ iss: aux.base, sub: `ilp:${hostOf(aux.base)}:human:00000000-0000-7000-8000-00000000r004`, aud: host.base, iat: t, exp: t + 600, jti: `claim-r04-${Date.now()}`, display_name: "Malformed", verified: "yes", verified_method: null, agent: null, purpose: "event_join", event: ev.global_id, consent_accepted: null }, aux.key, TYP.claim);
    expectProblem(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim: c } }), "VALIDATION_FAILED", "verified: 'yes'");
    return { rejected: true };
  },
  // an oversized per-action payload is reported at step 0, before credentials (ASTRA-R2-09, ruled FINDING_STANDS)
  async "ASTRA-R2-09"(host) {
    const ev = await host.createEvent({ slug: `reg-r09-${Date.now().toString(36)}` });
    expectProblem(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/actions`, { body: { kind: "unconference.proposal", payload: { title: "big", content: "x".repeat(40000) } } }), "PAYLOAD_TOO_LARGE", "unauthenticated oversized payload");
    return { reported: "PAYLOAD_TOO_LARGE" };
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
    expectProblem(await act(tampered), "SIGNATURE_INVALID", "local token + tampered grant on another event");
    expectProblem(await act(null), "FORBIDDEN", "local token on another event, no grant");
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
    expectProblem(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/actions`, { bearer: tok, body: { kind: "unconference.bogus", payload: {} } }), "PHASE_MISMATCH", "undefined kind on a closed event");
    return { reported: "PHASE_MISMATCH" };
  },
  // operator routes: step 1 before step 2 — no existence oracle (SG2R2-JOIN-ORDER)
  async "SG2R2-JOIN-ORDER"(host) {
    const priv = await host.createEvent({ slug: `reg-jo-${Date.now().toString(36)}`, visibility: "private" });
    expectProblem(await http("GET", `${host.base}/ilp/v1/events/${priv.id}/join-requests`), "AUTH_MISSING", "unauthenticated, private event");
    expectProblem(await http("GET", `${host.base}/ilp/v1/events/00000000-0000-7000-8000-000000000000/join-requests`), "AUTH_MISSING", "unauthenticated, no such event");
    return { both: "AUTH_MISSING" };
  },
  // §10.4 order: audience is reported before a schema failure (SG2R2-CLAIM-ORDER)
  async "SG2R2-CLAIM-ORDER"(host) {
    const ev = await host.createEvent({ slug: `reg-co-${Date.now().toString(36)}` });
    const t = nowS();
    const c = signJws({ iss: aux.base, sub: `ilp:${hostOf(aux.base)}:human:00000000-0000-7000-8000-00000000c0de`, aud: "http://elsewhere.localhost:4999", iat: t, exp: t + 600, jti: `claim-co-${Date.now()}`, display_name: "Order", verified: "yes", verified_method: null, agent: null, purpose: "event_join", event: ev.global_id, consent_accepted: null }, aux.key, TYP.claim);
    expectProblem(await http("POST", `${host.base}/ilp/v1/events/${ev.id}/join-requests`, { body: { claim: c } }), "CLAIM_AUDIENCE_MISMATCH", "wrong audience and schema-invalid");
    return { reported: "CLAIM_AUDIENCE_MISMATCH" };
  },
  // join state changes are receipted (ASTRA-R2-16)
  async "ASTRA-R2-16"(host) {
    const a = await admitted(host, "r16", { approve: false });
    const rc = expectOk(await http("GET", `${host.base}/ilp/v1/events/${a.ev.id}/receipts`), 200, "receipts").items;
    check(rc.some((r) => r.resource === a.j.join_request_id && r.action_kind === "federation.join_requested"), "no receipt for the join submission");
    return { receipted: true };
  },
  // a second join by an admitted principal does not demote the admission (ASTRA-R2-11)
  async "ASTRA-R2-11"(host) {
    const a = await admitted(host, "r11");
    const tok = (await retrieve(host, a)).json.participant_token;
    const claim2 = expectOk(await http("POST", `${aux.base}/ilp/v1/claims`, { bearer: auxProv, body: { purpose: "event_join", event: a.ev.global_id, aud: host.base, agent: a.syn.agent.id, on_behalf_of: a.syn.human } }), 201, "claim 2").claim;
    const r2 = await http("POST", `${host.base}/ilp/v1/events/${a.ev.id}/join-requests`, { body: { claim: claim2 } });
    check(r2.status >= 400, "a duplicate join for an admitted principal was accepted");
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
    const lp = await host.localParticipant(ev);
    expectOk(await http("GET", `${host.base}/ilp/v1/events/${ev.id}/feed?since=0`, { bearer: lp.participant_token }), 200, "own private feed");
    expectProblem(await http("GET", `${host.base}/ilp/v1/events/${ev.id}/feed?since=0`), "NOT_FOUND", "anonymous private feed");
    return { own: 200, anonymous: 404 };
  },
  // claim minting refuses a claim that would be schema-invalid (ASTRA-R2-14)
  async "ASTRA-R2-14"(host) {
    const ev = await aux.createEvent({ slug: `reg-r14-${Date.now().toString(36)}` });
    const prov = await host.credential("provisioning");
    const syn = expectOk(await http("POST", `${host.base}/ilp/v1/admin/synthetic/humans`, { bearer: prov, body: { display_name: "Mint" } }), 201, "synthetic");
    expectProblem(await http("POST", `${host.base}/ilp/v1/claims`, { bearer: prov, body: { purpose: "event_join", event: ev.global_id, aud: aux.base, agent: null, on_behalf_of: syn.human, consent_accepted: { text_version: "v" } } }), "VALIDATION_FAILED", "incomplete consent");
    expectProblem(await http("POST", `${host.base}/ilp/v1/claims`, { bearer: prov, body: { purpose: "event_join", event: ev.global_id, aud: "not-a-url", agent: null, on_behalf_of: syn.human } }), "VALIDATION_FAILED", "malformed aud");
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

const results = [];
for (const [label, host] of [["beta-one", beta], ["pc-ref", ref]]) {
  for (const [id, fn] of Object.entries(PROBES)) {
    try {
      const obs = await fn(host);
      results.push({ id, node: label, status: "pass", obs });
    } catch (e) {
      results.push({ id, node: label, status: "fail", error: e.message });
    }
    console.log(`${results.at(-1).status === "pass" ? "PASS" : "FAIL"} ${id} @ ${label}${results.at(-1).error ? ` — ${results.at(-1).error}` : ""}`);
  }
  try {
    results.push({ id: "ASTRA-R2-02", node: label, status: "pass", obs: await paginationProbe(host) });
  } catch (e) {
    results.push({ id: "ASTRA-R2-02", node: label, status: "fail", error: e.message });
  }
  console.log(`${results.at(-1).status === "pass" ? "PASS" : "FAIL"} ASTRA-R2-02 @ ${label}${results.at(-1).error ? ` — ${results.at(-1).error}` : ""}`);
}
const out = args.out ?? join(work, "regressions.json");
writeFileSync(out, JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.status === "fail").length;
console.log(`\n${results.length} regression probes, ${results.length - failed} pass, ${failed} fail — ${out}`);
process.exit(failed ? 1 : 0);
