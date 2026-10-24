// Verifier branch for the draft core-service profile (pc-core-service-0.1, scenario_binding "job-pairs"). Selected ONLY when
// the operator's trust file says `profile_mode: "pc-core-service-0.1"`; every other trust file keeps the historical checks.
// Coverage comes from the operator-pinned job manifest (its JCS SHA-256 is a trust input), never from the packet's own claims.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalBytes } from "../lib/jcs.mjs";
import { sha256Hex } from "../lib/jws.mjs";
import { validate } from "../lib/schemas.mjs";

export const CORE_PROFILE_ID = "pc-core-service-0.1";
export const CORE_PROFILE_PATH = `profile/${CORE_PROFILE_ID}.json`;
export const JOB_MANIFEST_PATH = "manifest/job-manifest.json";
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** True only for the explicit core-service mode. */
export const isCoreServiceTrust = (trust) => trust?.profile_mode === CORE_PROFILE_ID;

/** Structural check of a pc-job-manifest/1 document (the operator's pinned description of one job). */
export function checkJobManifest(m) {
  need(m && m.format === "pc-job-manifest/1", "job manifest format");
  need(m.profile?.id === CORE_PROFILE_ID && /^[0-9a-f]{64}$/.test(m.profile?.sha256 ?? ""), "job manifest profile");
  need(Number.isSafeInteger(m.repetitions) && m.repetitions >= 1 && m.repetitions <= 10, "job manifest repetitions");
  need(Array.isArray(m.selected_tests) && m.selected_tests.length > 0 && new Set(m.selected_tests).size === m.selected_tests.length, "job manifest selected_tests");
  need(m.targets && typeof m.targets === "object", "job manifest targets");
  for (const [id, t] of Object.entries(m.targets)) {
    need(ID.test(id), `job manifest target id ${id}`);
    need(/^[0-9a-f]{64}$/.test(t.descriptor_sha256 ?? "") && typeof t.implementation === "string" && t.implementation && typeof t.base_url === "string", `job manifest target ${id}`);
    need(Array.isArray(t.roles) && Array.isArray(t.capabilities), `job manifest target ${id} roles/capabilities`);
  }
  need(Array.isArray(m.pairs) && m.pairs.length > 0, "job manifest pairs");
  const seen = new Set();
  for (const p of m.pairs) {
    need(m.targets[p.home]?.roles.includes("home") && m.targets[p.host]?.roles.includes("host") && p.home !== p.host, `job manifest pair ${p.home}:${p.host}`);
    const k = `${p.home}:${p.host}`;
    need(!seen.has(k), `job manifest duplicate pair ${k}`);
    seen.add(k);
  }
  return m;
}

/** The profile's applicability rule for (test, pair), from the pinned manifest only: null = applicable. */
export function ruleFor(profile, manifest, testId, pair) {
  const home = manifest.targets[pair.home], host = manifest.targets[pair.host];
  for (const r of profile.applicability?.rules ?? []) {
    if (r.test !== testId) continue;
    const reverse = manifest.pairs.some((p) => p.home === pair.host && p.host === pair.home);
    const hit = r.when === "capability_absent" ? !(home.capabilities.includes(r.capability) && host.capabilities.includes(r.capability))
      : r.when === "home_implementation" ? home.implementation === r.implementation
      : r.when === "same_implementation" ? home.implementation === host.implementation
      : r.when === "same_implementation_or_reverse_unpinned" ? home.implementation === host.implementation || !reverse
      : false;
    if (hit) return r;
  }
  return null;
}

/** A core-service result row: the test-result v1 shape with a "home:host" scenario naming a pinned pair. */
export function validCoreResult(r) {
  if (!r || typeof r.scenario !== "string" || !/^[a-z0-9-]+:[a-z0-9-]+$/.test(r.scenario)) return false;
  return validate("test-result", { ...r, scenario: "SC-1" }).ok;
}

/** profile guard (core mode): the pinned profile file, its id and binding. */
export function coreProfile(P, content, trust, parseStrict) {
  need(content.profile.id === CORE_PROFILE_ID, `packet profile ${content.profile.id} is not ${CORE_PROFILE_ID}`);
  need(content.profile.sha256 === trust.profile_sha256, "profile hash differs from the trust pin");
  need(existsSync(P(CORE_PROFILE_PATH)), "profile file missing");
  const profile = parseStrict(readFileSync(P(CORE_PROFILE_PATH), "utf8"));
  need(sha256Hex(canonicalBytes(profile)) === content.profile.sha256, "profile file does not match its hash");
  need(profile.id === CORE_PROFILE_ID && profile.scenario_binding === "job-pairs", "profile is not the core-service job-pairs profile");
  return profile;
}

/** manifest guard: the job manifest in the packet is exactly the operator-pinned one, and the subjects are exactly its targets. */
export function coreManifest(P, content, trust, parseStrict) {
  need(content.x_job_manifest?.path === JOB_MANIFEST_PATH, "content does not reference the job manifest");
  need(/^[0-9a-f]{64}$/.test(trust.job_manifest_sha256 ?? ""), "no job manifest pin in the trust file");
  need(existsSync(P(JOB_MANIFEST_PATH)), "job manifest missing");
  const m = checkJobManifest(parseStrict(readFileSync(P(JOB_MANIFEST_PATH), "utf8")));
  need(sha256Hex(canonicalBytes(m)) === trust.job_manifest_sha256, "job manifest differs from the trust pin");
  need(content.x_job_manifest.sha256 === trust.job_manifest_sha256, "content's job manifest digest differs from the trust pin");
  need(m.profile.sha256 === trust.profile_sha256, "job manifest names another profile");
  const used = [...new Set(m.pairs.flatMap((p) => [p.home, p.host]))].sort();
  const subjects = content.subjects.map((s) => s.label).sort();
  need(JSON.stringify(subjects) === JSON.stringify(used), `subjects ${subjects.join(",")} are not exactly the pinned pair endpoints ${used.join(",")}`);
  for (const s of content.subjects) need(s.base_url === m.targets[s.label].base_url, `${s.label}: base URL differs from the pinned target`);
  need(JSON.stringify(Object.keys(trust.signers ?? {}).sort()) === JSON.stringify(used), "trust pins are not exactly the pinned pair endpoints");
  return m;
}

/** results guard (core mode): exact coverage of selected tests × pinned pairs × repetitions; N/A only by a profile rule. */
export function coreResults(P, profile, manifest, content) {
  const rpath = "results/results.jsonl";
  need(existsSync(P(rpath)), "results missing");
  const rows = readFileSync(P(rpath), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const profileIds = new Set(profile.tests.map((t) => t.id));
  for (const id of manifest.selected_tests) need(profileIds.has(id), `selected test ${id} is not in the profile`);
  const inPacket = manifest.selected_tests.filter((id) => id !== "PC-VER-1"); // PC-VER-1 is decided by this verifier
  const expected = new Map();
  for (const p of manifest.pairs) for (let rep = 1; rep <= manifest.repetitions; rep++) for (const id of inPacket) expected.set(`${id}|${p.home}:${p.host}|${rep}`, { id, pair: p });
  const seen = new Set(), failed = [], badNa = [], unsupported = [], unexpected = [];
  let passed = 0;
  for (const r of rows) {
    need(validCoreResult(r), `invalid result ${r?.test_id} ${r?.scenario}`);
    const k = `${r.test_id}|${r.scenario}|${r.repetition}`;
    need(!seen.has(k), `duplicate result ${k}`);
    seen.add(k);
    const e = expected.get(k);
    if (!e) { unexpected.push(k); continue; }
    if (r.status === "fail") failed.push(k);
    else if (r.status === "pass") passed++;
    else {
      const rule = ruleFor(profile, manifest, r.test_id, e.pair);
      if (!rule) badNa.push(k);
      else if (rule.kind === "unsupported") unsupported.push(k);
    }
  }
  const missing = [...expected.keys()].filter((k) => !seen.has(k));
  need(!unexpected.length, `unexpected results (pair, test or repetition not pinned): ${unexpected.slice(0, 6).join(", ")}`);
  need(!missing.length, `missing results: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` (+${missing.length - 6})` : ""}`);
  need(!badNa.length, `not_applicable not permitted by the profile: ${badNa.slice(0, 6).join(", ")}`);
  need(!failed.length, `failing results: ${failed.slice(0, 6).join(", ")}`);
  need(passed > 0, "no passing result: zero-test or all-not-applicable evidence proves nothing");
  // a rule only permits not_applicable; a test that ran and passed where a rule would allow N/A is still a valid pass
  const sm = content.summary;
  need(sm.tests === rows.length && sm.passed === passed && sm.failed === failed.length, "summary does not match results");
  const allSelected = profile.tests.every((t) => manifest.selected_tests.includes(t.id));
  return {
    detail: `${rows.length} results cover ${inPacket.length} tests × ${manifest.pairs.length} pairs × ${manifest.repetitions} repetitions`,
    qualification: { scope: allSelected && !unsupported.length ? "full_profile" : "partial", all_profile_tests_selected: allSelected, unsupported: unsupported.slice(0, 50), passed },
  };
}
