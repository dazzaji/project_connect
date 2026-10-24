#!/usr/bin/env node
// Project Connect runner entry for the job service (service/README.md, "Runner contract"). The historical
// runner/run.mjs (fixed Beta harness scenarios) is unchanged; both run the same normative tests (runner/tests*.mjs).
//
//   node runner/service-run.mjs --targets FILE --pairs home:host[,…] --gate SG-2 --reps N --profile ID --out DIR
//                               --ref-port P1 --aux-port P2 [--also IDS]
//
// Targets are the job's registered public descriptors; credentials come only from CONNECT_CREDENTIALS_FILE (target id →
// credential object). Setup goes through the descriptor's declared setup kind (reference-admin-v1: the node's admin
// token; harness-control-v1: its control API), never through request-supplied URLs or commands. The runner owns two
// reference nodes on the leased ports (pc-ref, pc-aux; R-CONF-3).
//
// Output: DIR/results.jsonl — exactly one row per (selected test, pair, repetition):
//   { test_id, status: pass|fail|not_applicable, scenario: "home:host", repetition, requirement_ids, reason?, detail? }
// and DIR/run.json (composition: profile and descriptor digests, selected tests, pairs, repetitions, capabilities).
// Exit: 0 every row pass or not_applicable; 1 any fail, or no rows; 2 invalid invocation or setup failure (no rows).
// Profile binding: when the service sets CONNECT_PROFILE_SHA256 (the job's pinned profile digest), the loaded profile bytes
// must have exactly that JCS SHA-256, or the runner refuses before any test (exit 2). The same id is not enough.
// SG-3 late phase and SG-4 follow runner/run.mjs: short-TTL grants are admitted per pair/rep, the runner waits until
// exp + clock_skew_s + 5 s, then runs the late tests; exports (PC-EXP-1) are checked; the packet is assembled and verified
// offline (PC-VER-1, with the negative packets) against trust roots from the operator-approved descriptors
// (`trusted_key_thumbprints`), never from keys found in the packet or discovery alone.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalBytes } from "../lib/jcs.mjs";
import { sha256Hex } from "../lib/jws.mjs";
import { http, PC_ROOT, sleep, startReferenceNode, TestFailure } from "./lib.mjs";
import { adapter, controlClient, validControlToken } from "./setup.mjs";
import { SG2_ORDER, TESTS } from "./tests.mjs";
import { LATE_ORDER, SG3_ORDER, SG3_TESTS } from "./tests-sg3.mjs";
import { assemblePacket, checkExport, exportHostEvent, negativeCases, verifyPacket } from "./sg4.mjs";
import { checkJobManifest, CORE_PROFILE_ID, JOB_MANIFEST_PATH, ruleFor } from "../verifier/core-service.mjs";
import { coreNegativeCases } from "./core-negatives.mjs";

const log = (...m) => console.error(`[service-run ${new Date().toISOString().slice(11, 19)}]`, ...m);
function usage(msg) {
  console.error(`service-run: ${msg}`);
  process.exit(2);
}

// tests that need a declared target capability; without it they are not_applicable, never silently passed
export const CAPABILITY_OF = { "PC-DISC-5": "key-drill", "PC-REV-4": "outage-drill", "PC-REV-5": "outage-drill" };
const DERIVED = new Set(["PC-INTEROP-AB", "PC-INTEROP-BA"]);
const GOLDEN_THREAD = ["PC-PEER-1", "PC-IDC-1", "PC-IDC-2", "PC-IDC-3", "PC-GRANT-1", "PC-GRANT-2", "PC-ENF-1", "PC-ENF-2", "PC-RCPT-1"];

/** Core-service derived interoperability verdict for one pair/rep, from the pinned implementation pair. AB reads this context,
 *  BA the reverse pair's context in the same repetition. A setup or prerequisite failure in EITHER context it reads (including a
 *  deferred PC-DISC-4 failure recorded after its rows were emitted) makes the verdict SETUP_FAILED, never a pass (fix59, P46-1). */
export function coreDerivedVerdict(id, ctx, ctxs, profile, manifest) {
  const pair = { home: ctx.scenario.home, host: ctx.scenario.host };
  const setupErrorOf = (c) => c?.sg3SetupError ?? c?.prereqError ?? null;
  const own = setupErrorOf(ctx);
  if (own) return { status: "fail", reason: "SETUP_FAILED", failure: `setup failed: ${own.message}` };
  const rule = ruleFor(profile, manifest, id, pair);
  if (rule) return { status: "not_applicable", reason: rule.when === "same_implementation" ? "SAME_IMPLEMENTATION" : "SAME_IMPLEMENTATION_OR_REVERSE_UNPINNED" };
  const src = id === "PC-INTEROP-AB" ? ctx : ctxs.find((c) => c.scenario.home === pair.host && c.scenario.host === pair.home && c.rep === ctx.rep);
  if (!src) return { status: "fail", reason: "TEST_FAILED", failure: "reverse pair context missing" };
  const srcError = setupErrorOf(src);
  if (srcError) return { status: "fail", reason: "SETUP_FAILED", failure: `setup failed in ${src.scenario.id}: ${srcError.message}` };
  const bad = GOLDEN_THREAD.filter((t) => src.resultOf(t) !== "pass");
  if (bad.length) return { status: "fail", reason: "TEST_FAILED", failure: `golden thread incomplete in ${src.scenario.id}: ${bad.join(", ")}` };
  return { status: "pass", observations: { from: src.scenario.id, implementations: [manifest.targets[pair.home].implementation, manifest.targets[pair.host].implementation] } };
}

// the runner's own reference nodes listen on loopback only (unit57); targets reach them as http://pc-aux.localhost:<port>
export const RUNNER_NODE_HOST = "127.0.0.1";

/** A prerequisite failure discovered after dependent rows were emitted: those rows become SETUP_FAILED (never a target verdict),
 *  and the context carries the error so later (late, SG-4) rows of this pair/rep are SETUP_FAILED too. */
export function failDependents(ctx, records, meta, err) {
  ctx.prereqError ??= err;
  for (const r of records) {
    if (r.scenario !== ctx.scenario.id || r.repetition !== ctx.rep || SG2_ORDER.includes(r.test_id)) continue;
    r.status = "fail";
    r.failure = `setup failed: ${err.message}`;
    meta.set(r, { reason: "SETUP_FAILED" });
  }
}

/** The profile scenario a pair stands for, or null: both descriptor ids must be that scenario's profile node ids and declare the
 *  profile's implementation for them. Pair labels are report labels only; they never decide applicability by themselves. */
export function profileScenarioFor(profile, home, host, byId) {
  const sc = profile.scenarios.find((s) => s.home === home && s.host === host);
  if (!sc) return null;
  const same = (id) => byId.get(id)?.implementation === profile.nodes[id]?.implementation;
  return same(home) && same(host) ? sc.id : null;
}

/** Adapters for the job's targets, keyed by descriptor id (R3: harness-local names and control URLs never collapse). */
export async function targetAdapters(descriptors, creds, { get = http } = {}) {
  const out = {};
  const seenHarnessNodes = new Map();
  for (const d of descriptors) {
    if (d.setup?.kind === "reference-admin-v1") {
      const token = creds[d.id]?.admin_token;
      if (typeof token !== "string" || !token) throw new Error(`target ${d.id}: reference-admin-v1 needs credentials.admin_token`);
      out[d.id] = adapter({ name: d.id, base: d.base_url, kind: "ref", admin: token }, { harness: null });
    } else if (d.setup?.kind === "harness-control-v1") {
      const url = d.setup.control_url, local = d.setup.node;
      if (typeof url !== "string" || typeof local !== "string" || !local) throw new Error(`target ${d.id}: harness-control-v1 needs setup.control_url and setup.node`);
      const k = `${url}|${local}`;
      if (seenHarnessNodes.has(k)) throw new Error(`targets ${seenHarnessNodes.get(k)} and ${d.id} name the same harness node ${local} at ${url}`);
      seenHarnessNodes.set(k, d.id);
      // optional per-target control token: only from this target's entry in the credential file, sent only to its registered
      // control origin; a target without one keeps the legacy unauthenticated harness calls
      const token = creds[d.id]?.control_token;
      if (token !== undefined && !validControlToken(token)) throw new Error(`target ${d.id}: credentials.control_token must be an RFC 6750 bearer token (b64token) of at most 4096 characters`);
      if (token !== undefined && new URL(url).origin !== url) throw new Error(`target ${d.id}: a control token is sent only to a bare control origin`);
      const nodes = token ? await controlClient(url, token)("GET", "/nodes") : await get("GET", `${url}/nodes`);
      if (token && nodes.status !== 200) throw new Error(`target ${d.id}: harness /nodes: ${nodes.status}`);
      const hn = nodes.json?.[local];
      if (!hn) throw new Error(`target ${d.id}: harness ${url} has no node ${local}`);
      out[d.id] = adapter({ name: d.id, harnessNode: local, harnessUrl: url, base: d.base_url, kind: "beta", adminHuman: hn.admin_human }, { harness: url, controlToken: token });
    } else throw new Error(`target ${d.id}: unsupported setup kind ${d.setup?.kind}`);
  }
  return out;
}

/** PC-DISC-5 for each target of the pair through that target's own control API and harness-local name (R3), using the shared
 *  normative drill; the row passes only if both targets pass. */
export async function keyDrillPerTarget(ctx, drill) {
  const out = {};
  for (const [role, n] of [["home", ctx.home], ["host", ctx.host]]) {
    const local = { ...n, name: n.harnessNode ?? n.name };
    out[`${role}:${n.name}`] = await drill({ ...ctx, home: local, host: local, harness: n.harnessUrl ?? null });
  }
  return out;
}

// SG-4 tests decided outside the per-pair loop (exports after the late phase; the packet verifier over the whole run)
const SG4 = new Set(["PC-EXP-1", "PC-VER-1"]);

export function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined) usage(`malformed arguments near ${argv[i]}`);
    a[argv[i].slice(2)] = argv[i + 1];
  }
  for (const k of ["targets", "pairs", "gate", "reps", "profile", "out", "ref-port", "aux-port"]) if (!a[k]) usage(`--${k} is required`);
  const reps = Number(a.reps), refPort = Number(a["ref-port"]), auxPort = Number(a["aux-port"]);
  if (!Number.isSafeInteger(reps) || reps < 1 || reps > 10) usage("--reps must be 1..10");
  for (const p of [refPort, auxPort]) if (!Number.isSafeInteger(p) || p < 1024 || p > 65535) usage("ports must be 1024..65535");
  if (refPort === auxPort) usage("--ref-port and --aux-port must differ");
  if (!/^[a-z0-9.-]+$/i.test(a.profile)) usage("--profile must be a profile id");
  const pairs = a.pairs.split(",").map((s) => { const m = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(s); if (!m) usage(`bad pair ${s}`); return { home: m[1], host: m[2] }; });
  const also = a.also ? a.also.split(",").filter(Boolean) : [];
  return { targetsFile: a.targets, pairs, gate: a.gate, reps, profileId: a.profile, out: a.out, refPort, auxPort, also };
}

/** The exact test ids a job selects (same rule as service/results.mjs expectedCoverage). */
export function selectedTests(profile, gate, also) {
  const ids = profile.tests.filter((t) => gate === "all" || t.gate === gate).map((t) => t.id);
  for (const id of also) if (!ids.includes(id)) ids.push(id);
  return ids;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  mkdirSync(o.out, { recursive: true });
  let profileRaw;
  try { profileRaw = readFileSync(join(PC_ROOT, "profile", `${o.profileId}.json`), "utf8"); } catch { usage(`unknown profile ${o.profileId}`); }
  const profile = JSON.parse(profileRaw);
  if (profile.id !== o.profileId) usage(`profile file id ${profile.id} does not match ${o.profileId}`);
  const profileSha = sha256Hex(canonicalBytes(profile));
  const pinnedProfile = process.env.CONNECT_PROFILE_SHA256 ?? null;
  if (pinnedProfile !== null && pinnedProfile !== profileSha) usage(`PROFILE_DIGEST_MISMATCH: loaded ${o.profileId} bytes ${profileSha} differ from the service-selected ${pinnedProfile}`);
  // the operator-pinned job manifest (service: CONNECT_JOB_MANIFEST_FILE + CONNECT_JOB_MANIFEST_SHA256); required by the
  // core-service profile (scenario_binding "job-pairs"), whose scenarios are exactly the manifest's pairs
  const core = profile.scenario_binding === "job-pairs";
  const manifestPin = process.env.CONNECT_JOB_MANIFEST_SHA256 || null;
  let jobManifest = null, jobManifestText = null;
  if (process.env.CONNECT_JOB_MANIFEST_FILE) {
    try { jobManifestText = readFileSync(process.env.CONNECT_JOB_MANIFEST_FILE, "utf8"); jobManifest = JSON.parse(jobManifestText); } catch { usage("JOB_MANIFEST_UNREADABLE"); }
    if (sha256Hex(canonicalBytes(jobManifest)) !== manifestPin) usage("JOB_MANIFEST_DIGEST_MISMATCH: the job manifest differs from the service pin");
  }
  if (core && !jobManifest) usage(`JOB_MANIFEST_REQUIRED: ${profile.id} runs only against an operator-pinned job manifest`);
  const known = new Set(profile.tests.map((t) => t.id));
  for (const id of o.also) if (!known.has(id)) usage(`--also ${id} is not a test of ${profile.id}`);
  if (!["SG-2", "SG-3", "all"].includes(o.gate)) usage(`unknown gate ${o.gate}`);
  const descriptors = JSON.parse(readFileSync(o.targetsFile, "utf8"));
  if (!Array.isArray(descriptors)) usage("--targets must hold an array of descriptors");
  const byId = new Map(descriptors.map((d) => [d.id, d]));
  for (const p of o.pairs) {
    if (!byId.get(p.home)?.roles?.includes("home")) usage(`pair ${p.home}:${p.host}: ${p.home} is not a registered home target`);
    if (!byId.get(p.host)?.roles?.includes("host")) usage(`pair ${p.home}:${p.host}: ${p.host} is not a registered host target`);
  }
  const credsFile = process.env.CONNECT_CREDENTIALS_FILE;
  const creds = credsFile ? JSON.parse(readFileSync(credsFile, "utf8")) : {};

  const selected = selectedTests(profile, o.gate, o.also);
  if (core) {
    try { checkJobManifest(jobManifest); } catch (e) { usage(`JOB_MANIFEST_INVALID: ${e.message}`); }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (jobManifest.profile.sha256 !== profileSha) usage("JOB_MANIFEST_INCONSISTENT: profile digest");
    if (jobManifest.repetitions !== o.reps || !same(jobManifest.pairs.map((p) => `${p.home}:${p.host}`), o.pairs.map((p) => `${p.home}:${p.host}`))) usage("JOB_MANIFEST_INCONSISTENT: pairs or repetitions");
    if (!same([...jobManifest.selected_tests].sort(), [...selected].sort())) usage("JOB_MANIFEST_INCONSISTENT: selected tests");
    for (const [id, t] of Object.entries(jobManifest.targets)) if (!byId.get(id) || sha256Hex(canonicalBytes(byId.get(id))) !== t.descriptor_sha256) usage(`JOB_MANIFEST_INCONSISTENT: descriptor ${id}`);
  }
  const spec = Object.fromEntries(profile.tests.map((t) => [t.id, t]));
  const ALL = { ...TESTS, ...SG3_TESTS };

  // runner-owned reference nodes on the leased ports
  const bound = profile.parameters.revocation_bound_s;
  // in this process's group (not detached): when the service terminates the runner's group, these nodes go with it
  const pcRef = await startReferenceNode({ name: "pc-ref", port: o.refPort, work: o.out, bound, detached: false, host: RUNNER_NODE_HOST });
  const pcAux = await startReferenceNode({ name: "pc-aux", port: o.auxPort, work: o.out, bound, detached: false, host: RUNNER_NODE_HOST });
  const stopOwn = () => { for (const n of [pcRef, pcAux]) n.stop(); };
  process.on("exit", stopOwn);
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { stopOwn(); process.exit(1); });

  // targets through their declared setup kind only, each keyed by its globally unique descriptor id
  const nodes = { "pc-ref": adapter(pcRef, { harness: null }), "pc-aux": adapter(pcAux, { harness: null }) };
  let targetNodes;
  try { targetNodes = await targetAdapters([...new Set(o.pairs.flatMap((p) => [p.home, p.host]))].map((id) => byId.get(id)), creds); } catch (e) { usage(e.message); }
  Object.assign(nodes, targetNodes);
  const harnessOf = Object.fromEntries(Object.entries(targetNodes).filter(([, n]) => n.harnessUrl).map(([id, n]) => [id, n.harnessUrl]));
  const peering = {}, provisioning = {};
  for (const [k, n] of Object.entries(nodes)) {
    peering[n.name] = await n.credential("peering");
    provisioning[n.name] = await n.credential("provisioning");
    if (k !== n.name) { peering[k] = peering[n.name]; provisioning[k] = provisioning[n.name]; }
  }
  const auxEvent = await nodes["pc-aux"].createEvent({ slug: "aux-audience-fixture" });

  const records = []; // run.mjs-format test results (the packet's results/results.jsonl)
  const meta = new Map(); // record → { reason, detail } for the service rows
  const key = (id, sc, rep) => `${id}|${sc}|${rep}`;
  const push = (r, m = {}) => { records.push(r); meta.set(r, m); log(`${r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "N/A "} ${r.scenario}.${r.repetition} ${r.test_id}${r.failure ? ` — ${r.failure}` : m.detail ? ` — ${m.detail}` : ""}`); return r; };
  const record = (id, sc, rep) => ({ test_id: id, scenario: sc, repetition: rep, status: "pass", traces: spec[id]?.traces ?? [], started_at: new Date().toISOString(), elapsed_ms: 0, observations: {} });
  const activeKid = {}, observedKids = {};
  const ctxs = [], lateCtxs = [];
  const wantsLate = selected.some((id) => LATE_ORDER.includes(id));
  const needsSg3 = selected.some((id) => SG3_ORDER.includes(id) || LATE_ORDER.includes(id));

  async function runOne(ctx, id, caps, setupError) {
    const sc = ctx.scenario.id, rep = ctx.rep;
    const r = record(id, sc, rep);
    const started = Date.now();
    const cap = CAPABILITY_OF[id];
    let m = {};
    try {
      if (!ALL[id]) { r.status = "fail"; r.failure = "not implemented by the runner"; m = { reason: "NOT_SUPPORTED_BY_SERVICE_RUNNER" }; }
      else if (cap && !(caps.home.has(cap) && caps.host.has(cap))) { r.status = "not_applicable"; m = { reason: "CAPABILITY_ABSENT", detail: `requires ${cap} on both targets` }; }
      else if (setupError) { r.status = "fail"; r.failure = `setup failed: ${setupError.message}`; m = { reason: "SETUP_FAILED" }; }
      else if (DERIVED.has(id)) {
        // R2: the derived interoperability verdicts are defined only for the profile's own scenarios; a pair maps to one only
        // when both descriptors are registered as that scenario's profile nodes, with the profile's implementations
        const mapped = profileScenarioFor(profile, ctx.scenario.home, ctx.scenario.host, byId);
        const mctx = { ...ctx, scenario: { ...ctx.scenario, id: mapped ?? ctx.scenario.id } };
        if (!mapped) { r.status = "not_applicable"; m = { reason: "DERIVED_VERDICT_UNSUPPORTED_FOR_PAIR", detail: `${id} is defined for profile scenarios only; ${ctx.scenario.id} is not registered as one` }; }
        else if (!ALL[id].applies(mctx)) { r.status = "not_applicable"; m = { reason: "NOT_APPLICABLE_TO_SCENARIO", detail: `${id} does not apply to ${mapped}` }; }
        else r.observations = (await ALL[id](mctx)) ?? {};
      }
      else if (ALL[id].applies && !ALL[id].applies(ctx)) { r.status = "not_applicable"; m = { reason: "NOT_APPLICABLE_TO_PAIR" }; }
      else if (id === "PC-DISC-5") r.observations = await keyDrillPerTarget(ctx, ALL[id]);
      else r.observations = (await ALL[id](ctx)) ?? {};
    } catch (e) {
      r.status = "fail";
      r.failure = e instanceof TestFailure ? e.message : `${e.name}: ${e.message}`;
      m = { reason: "TEST_FAILED" };
    }
    r.elapsed_ms = Date.now() - started;
    push(r, m);
  }

  for (const pair of o.pairs) {
    const scenarioLabel = `${pair.home}:${pair.host}`;
    const home = nodes[pair.home], host = nodes[pair.host];
    const caps = { home: new Set(byId.get(pair.home).capabilities ?? []), host: new Set(byId.get(pair.host).capabilities ?? []) };
    for (let rep = 1; rep <= o.reps; rep++) {
      const tag = `svc-${pair.home}-${pair.host}-r${rep}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      // alpha207 (S4 composition only): when PC_S4_CONSENT_FIXTURE_NODE names this host, E1 declares the host's NATIVE publication
      // consent at setup ({native:true}, consent228) and the golden-thread participant opts in through its own signed claim; otherwise unchanged.
      const consentFixture = process.env.PC_S4_CONSENT_FIXTURE_NODE && process.env.PC_S4_CONSENT_FIXTURE_NODE === host.name
        ? { publication_consent: { native: true } } /* consent228: the named Alpha fixture host declares its own native terms; no host text is copied into acceptance */ : {};
      const events = { E1: await host.createEvent({ slug: `${tag}-e1`, ...consentFixture }) };
      const operator = { E1: await host.credential("operator", events.E1.id) };
      const ctx = {
        scenario: { id: scenarioLabel, home: pair.home, host: pair.host }, rep, tag, profile, home, host, aux: nodes["pc-aux"], ref: nodes["pc-ref"], nodes,
        harness: harnessOf[pair.home] ?? harnessOf[pair.host] ?? null, auxEvent, events,
        creds: { peering, provisioning: provisioning[home.name], provisioningOf: provisioning, operator },
        identity: {}, activeKid, observedKids, deferred: [], observe: (node, kid) => (observedKids[node] ??= new Set()).add(kid), caps,
      };
      // a requested row's status, else the outcome of the same function run as an unrequested prerequisite
      ctx.prereq = {};
      ctx.resultOf = (id) => records.find((x) => x.test_id === id && x.scenario === scenarioLabel && x.repetition === rep)?.status ?? ctx.prereq[id];
      ctxs.push(ctx);
      if (needsSg3) { try { await SG3_TESTS.__setup(ctx); } catch (e) { ctx.sg3SetupError = e; } }
      // R1: later-gate tests need the SG-2 golden thread (subject, claim, join, token, grant, action) whatever rows were
      // requested. Unrequested SG-2 functions run as prerequisites only (no rows); a prerequisite failure is a setup failure
      // of the dependent rows (SETUP_FAILED), never reported as the target's verdict on an unrequested test
      const needsThread = selected.some((x) => !SG2_ORDER.includes(x));
      for (const id of SG2_ORDER) {
        if (selected.includes(id)) await runOne(ctx, id, caps, null);
        else if (needsThread && !ctx.prereqError) {
          try { await ALL[id](ctx); ctx.prereq[id] = "pass"; log(`prerequisite ${scenarioLabel}.${rep} ${id} ok`); }
          catch (e) { ctx.prereq[id] = "fail"; ctx.prereqError = new Error(`prerequisite ${id} (not requested) failed: ${e instanceof TestFailure ? e.message : `${e.name}: ${e.message}`}`); log(ctx.prereqError.message); }
        }
      }
      // short-TTL admission as soon as peering exists, so one wait covers every short grant in the run (run.mjs)
      if (wantsLate && !ctx.sg3SetupError && !ctx.prereqError) {
        try { ctx.shortExp = await SG3_TESTS.__admitShort(ctx); lateCtxs.push(ctx); } catch (e) { ctx.lateSetupError = e; }
      }
      for (const id of SG3_ORDER.filter((x) => selected.includes(x) && !(core && DERIVED.has(x)))) await runOne(ctx, id, caps, ctx.sg3SetupError ?? ctx.prereqError ?? null);
      for (const id of selected.filter((x) => !SG2_ORDER.includes(x) && !SG3_ORDER.includes(x) && !LATE_ORDER.includes(x) && !SG4.has(x))) await runOne(ctx, id, caps, ctx.prereqError ?? null);
      for (const fn of ctx.deferred) {
        try { fn(); } catch (e) {
          const r = records.find((x) => x.test_id === "PC-DISC-4" && x.scenario === scenarioLabel && x.repetition === rep);
          if (r) { r.status = "fail"; r.failure = e.message; meta.set(r, { reason: "TEST_FAILED" }); }
          // closure42 C42-2: PC-DISC-4 ran only as an unrequested prerequisite: its deferred failure is a setup failure of every
          // dependent row already emitted for this pair/rep, and of the late/SG-4 rows still to come
          else failDependents(ctx, records, meta, new Error(`prerequisite PC-DISC-4 (not requested) failed: ${e.message}`));
        }
      }
    }
  }

  // core-service derived interoperability: from the pinned implementation pair (manifest), never from labels. AB: pinned
  // implementations differ and the golden thread passed home→host; BA: also the reverse pair is pinned and passed host→home
  if (core) for (const ctx of ctxs) for (const id of [...DERIVED].filter((x) => selected.includes(x))) {
    const r = record(id, ctx.scenario.id, ctx.rep);
    const v = coreDerivedVerdict(id, ctx, ctxs, profile, jobManifest);
    r.status = v.status;
    if (v.failure) r.failure = v.failure;
    if (v.observations) r.observations = v.observations;
    push(r, v.reason ? { reason: v.reason } : {});
  }

  // late phase: never shortened — wait until every short grant is past exp + clock skew
  let lateWaitS = null;
  if (wantsLate) {
    if (lateCtxs.length) {
      const until = Math.max(...lateCtxs.map((c) => c.shortExp)) + profile.parameters.clock_skew_s + 5;
      const waitMs = Math.max(0, until * 1000 - Date.now());
      lateWaitS = Math.round(waitMs / 1000);
      log(`late phase: waiting ${lateWaitS} s for short-TTL grants to pass exp + skew`);
      await sleep(waitMs);
    }
    for (const ctx of ctxs) for (const id of LATE_ORDER.filter((x) => selected.includes(x))) {
      const err = ctx.sg3SetupError ?? ctx.prereqError ?? ctx.lateSetupError ?? (lateCtxs.includes(ctx) ? null : new Error("short-TTL admission did not run"));
      await runOne(ctx, id, ctx.caps, err);
    }
  }

  // SG-4: exports per pair/rep (host side, scoped operator credential), then the packet and its offline verification
  const bundles = [];
  if (selected.includes("PC-EXP-1")) for (const ctx of ctxs) {
    const r = record("PC-EXP-1", ctx.scenario.id, ctx.rep);
    const started = Date.now();
    let m = {};
    try {
      if (ctx.prereqError) { r.status = "fail"; r.failure = `setup failed: ${ctx.prereqError.message}`; m = { reason: "SETUP_FAILED" }; throw null; }
      if (!ctx.grantPayload) throw new TestFailure("no golden-thread grant in this pair/rep (PC-GRANT-1 not run or failed)");
      // packet paths allow only [A-Za-z0-9_./-]: name the bundle by the pair without the "home:host" colon
      const b = await exportHostEvent({ ...ctx, scenario: { ...ctx.scenario, id: `${ctx.scenario.home}--${ctx.scenario.host}` } });
      r.observations = await checkExport(ctx, b);
      bundles.push(b);
    } catch (e) { if (e !== null) { r.status = "fail"; r.failure = e.message; m = { reason: "TEST_FAILED" }; } }
    r.elapsed_ms = Date.now() - started;
    push(r, m);
  }
  let packet = null;
  if (selected.includes("PC-VER-1")) {
    const jobTargets = [...new Set(o.pairs.flatMap((p) => [p.home, p.host]))];
    // core mode: trust pins come from the operator-pinned manifest (copied there from the operator's target configuration)
    const pinsOf = (id) => (core ? jobManifest.targets[id]?.trusted_key_thumbprints : byId.get(id).trusted_key_thumbprints);
    const unpinned = jobTargets.filter((id) => !(Array.isArray(pinsOf(id)) && pinsOf(id).length));
    let verOk = false, verDetail = null, verReason = null;
    if (unpinned.length) { verReason = "TRUST_ROOTS_NOT_CONFIGURED"; verDetail = `no operator-approved trusted_key_thumbprints for ${unpinned.join(", ")}; the packet is not verified`; }
    else if (!bundles.length) { verReason = "TEST_FAILED"; verDetail = "no verified export to package (PC-EXP-1)"; }
    else {
      try {
        const subjects = [];
        for (const id of jobTargets) {
          const n = nodes[id];
          subjects.push({ label: id, base_url: n.base, discovery: (await http("GET", `${n.base}/.well-known/interlateral.json`)).json, revocations: (await http("GET", `${n.base}/ilp/v1/federation/revocations?since=0`)).json });
        }
        const runnerBuild = `sha256:${createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex")}`;
        const attest = async (label, contentRoot) => {
          const n = nodes[label];
          const r = n.kind === "ref"
            ? await http("POST", `${n.base}/ilp/v1/admin/attestations`, { bearer: n.admin, body: { content_root: contentRoot, profile: profile.id } })
            : await n.harnessControl("/setup/attest", { node: n.harnessNode ?? n.name, content_root: contentRoot, profile: profile.id });
          if (!r.json?.attestation) throw new Error(`attestation by ${label} failed: ${r.text.slice(0, 200)}`);
          return r.json.attestation;
        };
        const assembled = await assemblePacket({ dir: join(o.out, "packet"), runId: `svc-${Date.now().toString(36)}`, profile, profileRaw, results: records, subjects, exports: bundles, runnerBuild, attest,
          ...(core ? { profilePath: `profile/${profile.id}.json`, jobManifest: { path: JOB_MANIFEST_PATH, text: jobManifestText, sha256: manifestPin } } : {}) });
        // trust roots: operator-approved descriptor pins and the service-pinned profile digest, never the packet's own keys;
        // only the runner's per-run key (this process) is pinned from the assembly
        const trust = {
          $comment: "built by runner/service-run.mjs from operator-approved target descriptors (trusted_key_thumbprints) and the service-pinned profile digest",
          profile_sha256: pinnedProfile ?? profileSha,
          signers: Object.fromEntries(jobTargets.map((id) => [id, { thumbprints: pinsOf(id) }])),
          runner: assembled.trust.runner,
          ...(core ? { profile_mode: CORE_PROFILE_ID, job_manifest_sha256: manifestPin } : {}),
        };
        writeFileSync(join(o.out, "trust.json"), JSON.stringify(trust, null, 2) + "\n");
        const report = verifyPacket(assembled.dir, trust);
        writeFileSync(join(o.out, "verifier-report.json"), JSON.stringify(report, null, 2) + "\n");
        const negatives = core ? coreNegativeCases(assembled.dir, trust) : negativeCases(assembled.dir, trust);
        writeFileSync(join(o.out, "negative-verification.json"), JSON.stringify(negatives, null, 2) + "\n");
        const badNeg = negatives.filter((n) => !(n.rejected && n.right_reason));
        verOk = report.ok && !badNeg.length;
        const failedChecks = report.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
        packet = { content_root: assembled.contentRoot, verifier_ok: report.ok, failed_checks: failedChecks, negatives: negatives.length, negatives_rejected_right_reason: negatives.length - badNeg.length, ...(core ? { profile_mode: report.profile_mode, qualification: report.qualification } : {}) };
        if (!verOk) { verReason = "TEST_FAILED"; verDetail = [...failedChecks, ...badNeg.map((n) => `negative not rejected correctly: ${n.id}`)].join("; ").slice(0, 400); }
      } catch (e) { verReason = "TEST_FAILED"; verDetail = `packet assembly/verification error: ${e.message}`; }
    }
    for (const ctx of ctxs) {
      const r = record("PC-VER-1", ctx.scenario.id, ctx.rep);
      if (!verOk) { r.status = "fail"; r.failure = verDetail; }
      else r.observations = { content_root: packet.content_root, negatives: packet.negatives };
      push(r, verOk ? {} : { reason: verReason, detail: verDetail });
    }
  }

  // service rows, in run order; exactly one per (selected test, pair, repetition)
  const rows = records.map((r) => {
    const m = meta.get(r) ?? {};
    return { test_id: r.test_id, status: r.status, scenario: r.scenario, repetition: r.repetition, requirement_ids: r.traces ?? [], ...(m.reason ? { reason: m.reason } : {}), ...(r.failure || m.detail ? { detail: r.failure ?? m.detail } : {}) };
  });
  writeFileSync(join(o.out, "results.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  const digest = (d) => sha256Hex(canonicalBytes(d));
  writeFileSync(join(o.out, "run.json"), JSON.stringify({
    runner: "project-connect/runner/service-run.mjs",
    profile: { id: profile.id, spec_version: profile.spec_version, sha256: profileSha, bound_to_service_digest: pinnedProfile !== null },
    gate: o.gate, also: o.also, selected_tests: selected, repetitions: o.reps,
    pairs: o.pairs.map((p) => `${p.home}:${p.host}`),
    targets: Object.fromEntries([...new Set(o.pairs.flatMap((p) => [p.home, p.host]))].map((id) => [id, { descriptor_sha256: digest(byId.get(id)), version: byId.get(id).version, implementation: byId.get(id).implementation, setup_kind: byId.get(id).setup?.kind, capabilities: byId.get(id).capabilities ?? [], trusted_key_thumbprints: byId.get(id).trusted_key_thumbprints ?? [] }])),
    runner_nodes: { "pc-ref": pcRef.base, "pc-aux": pcAux.base },
    job_manifest: jobManifest ? { sha256: manifestPin, bound: true } : null,
    late_phase: wantsLate ? { short_grants: lateCtxs.length, waited_s: lateWaitS, clock_skew_s: profile.parameters.clock_skew_s } : null,
    packet,
    counts: { pass: rows.filter((r) => r.status === "pass").length, fail: rows.filter((r) => r.status === "fail").length, not_applicable: rows.filter((r) => r.status === "not_applicable").length },
  }, null, 2) + "\n");
  const failed = rows.filter((r) => r.status === "fail").length;
  log(`${rows.length} rows, ${failed} fail`);
  if (!rows.length) console.error("service-run: no results were produced: failing the run");
  // the runner's own nodes are gone before it exits, so a finished runner leaves no members in its process group
  stopOwn();
  await Promise.race([Promise.all([pcRef.exited, pcAux.exited]), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(failed || !rows.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`service-run: ${e.stack ?? e.message}`); process.exit(2); });
}
