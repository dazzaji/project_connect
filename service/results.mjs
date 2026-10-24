// Result evaluation and sanitization. Missing, malformed, empty, incomplete, duplicated or unexpected results fail closed.
// Served reports are an allowlist projection; every field is fully redacted BEFORE it is truncated, and every loaded
// secret value is redacted regardless of length.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STATUSES = ["pass", "fail", "not_applicable"];
const CREDENTIAL_PATTERNS = [
  /\b(?:ilp[a-z])_[A-Za-z0-9_-]{8,}/g, // ilpo_, ilpt_, ilpr_, ilpp_ … credentials and tokens
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, // compact JWS/JWT
];

export function redact(text, secrets) {
  let s = String(text);
  // longest first, so a secret that contains another is removed whole
  for (const v of [...secrets].sort((a, b) => b.length - a.length)) if (v) s = s.split(v).join("[REDACTED]");
  for (const re of CREDENTIAL_PATTERNS) s = s.replace(re, "[REDACTED]");
  return s;
}

/** Every non-empty string leaf of the loaded credential objects (values to redact), whatever its length. */
export function secretValues(objs) {
  const out = new Set();
  const walk = (v) => { if (typeof v === "string") { if (v) out.add(v); } else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  objs.forEach(walk);
  return [...out];
}

/** The exact (test, scenario, repetition) set a job must report: gate-selected profile tests plus `also`, per pair and rep. */
export function expectedCoverage({ profile, request }) {
  const gates = request.gate === "all" ? null : [request.gate];
  const ids = new Set(profile.tests.filter((t) => !gates || gates.includes(t.gate)).map((t) => t.id));
  for (const id of request.also ?? []) ids.add(id);
  const keys = new Set();
  for (const p of request.pairs) for (let rep = 1; rep <= request.reps; rep++) for (const id of ids) keys.add(`${id}|${p.home}:${p.host}|${rep}`);
  return keys;
}

/** Parse runner output in rawDir. Returns { ok, reason, rows }. */
export function readRunnerResults(rawDir) {
  const file = join(rawDir, "results.jsonl");
  if (!existsSync(file)) return { ok: false, reason: "RESULTS_MISSING", rows: [] };
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  if (!lines.length) return { ok: false, reason: "RESULTS_EMPTY", rows: [] };
  const rows = [];
  for (const [i, line] of lines.entries()) {
    let r;
    try { r = JSON.parse(line); } catch { return { ok: false, reason: `RESULTS_MALFORMED line ${i + 1}`, rows: [] }; }
    if (!r || typeof r.test_id !== "string" || !STATUSES.includes(r.status) || typeof r.scenario !== "string" || !Number.isSafeInteger(r.repetition))
      return { ok: false, reason: `RESULTS_MALFORMED line ${i + 1}`, rows: [] };
    rows.push(r);
  }
  return { ok: true, rows };
}

export const REASON_MAX = 200;
/** The only reason text that is persisted or served: redacted first, then bounded. Reasons are built from structural codes
 *  (never runner-supplied text); this is defence in depth. */
export function sanitizeReason(reason, secrets) {
  if (reason === undefined || reason === null) return null;
  return redact(String(reason), secrets).slice(0, REASON_MAX);
}

export function sanitizedReport({ job, rows, secrets, outcome, profileTestIds = [], runRecord = undefined, currentProfileSha256 = undefined }) {
  let redacted = false;
  const clean = (v, max = 500) => {
    if (v === undefined || v === null) return null;
    const full = String(v);
    const r = redact(full, secrets);
    if (r !== full) redacted = true;
    return r.slice(0, max);
  };
  const results = rows.map((r) => ({
    test_id: clean(r.test_id, 100),
    requirement_ids: Array.isArray(r.requirement_ids) ? r.requirement_ids.slice(0, 20).map((x) => clean(x, 50)) : [],
    scenario: clean(r.scenario, 200),
    repetition: Number.isSafeInteger(r.repetition) ? r.repetition : null,
    status: r.status,
    reason: clean(r.reason ?? r.code ?? null, 100),
    detail: clean(r.detail ?? r.error ?? null),
  }));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, results.filter((r) => r.status === s).length]));
  // qualification is computed from the validated rows only (row ids are runner text, so they are never echoed unless they are
  // profile test ids)
  const q = profileQualification({ profileTestIds, rows: results.filter((r) => profileTestIds.includes(r.test_id)), outcome, composition: job.composition ? { ...job.composition, job_manifest_sha256: job.manifest_sha256 ?? null } : null, runRecord, currentProfileSha256 });
  return { job_id: job.id, status: outcome.status, reason: clean(outcome.reason, REASON_MAX), qualification: q, counts, results, redacted };
}

/** Profile qualification, which is NOT job success. A job can succeed (its requested coverage ran, complete, without a
 *  failure) and still be only partial evidence. The job qualifies for the whole profile only when every test of the profile
 *  was selected and every row passed: a test not selected, any not_applicable row (for example a missing capability) or any
 *  failure leaves it "partial". Job status and reason are unchanged by this. */
export function profileQualification({ profileTestIds = [], rows = [], outcome, composition = null, runRecord = undefined, currentProfileSha256 = undefined }) {
  const ran = new Set(rows.map((r) => r.test_id));
  const not_selected = profileTestIds.filter((id) => !ran.has(id));
  const not_applicable = [...new Set(rows.filter((r) => r.status === "not_applicable").map((r) => r.test_id))];
  const failed = [...new Set(rows.filter((r) => r.status === "fail").map((r) => r.test_id))];
  const reasons = [];
  if (outcome?.status !== "succeeded") reasons.push("JOB_NOT_SUCCEEDED");
  if (!profileTestIds.length) reasons.push("PROFILE_UNKNOWN");
  if (not_selected.length) reasons.push("PROFILE_TESTS_NOT_SELECTED");
  // core-service profile: not_applicable rows are judged by the offline verifier against the profile's applicability rules and
  // the pinned job manifest; only a verified packet whose verifier qualification is full_profile clears them
  const verifiedFull = runRecord?.packet?.verifier_ok === true && runRecord?.packet?.qualification?.scope === "full_profile";
  if (not_applicable.length && !verifiedFull) reasons.push("NOT_APPLICABLE_ROWS");
  if (failed.length) reasons.push("FAILED_ROWS");
  // runtime binding: the runner's own record must exist and name exactly the profile bytes the job pinned (and the service
  // still serves); a matching id alone is not enough. `runRecord === undefined` means the caller did not supply it.
  if (runRecord !== undefined) {
    const pinned = composition?.profile_sha256 ?? null;
    if (!pinned) reasons.push("COMPOSITION_MISSING");
    if (!runRecord) reasons.push("RUN_RECORD_MISSING");
    else if (runRecord.profile?.sha256 !== pinned || runRecord.profile?.bound_to_service_digest !== true) reasons.push("PROFILE_DIGEST_MISMATCH");
    if (currentProfileSha256 !== undefined && currentProfileSha256 !== pinned && !reasons.includes("PROFILE_DIGEST_MISMATCH")) reasons.push("PROFILE_DIGEST_MISMATCH");
    // the runner must have run against exactly the job manifest the service pinned (when the service pinned one)
    if (runRecord && composition?.job_manifest_sha256 && runRecord.job_manifest?.sha256 !== composition.job_manifest_sha256) reasons.push("JOB_MANIFEST_MISMATCH");
  }
  return { scope: reasons.length ? "partial" : "full_profile", full_profile_qualified: reasons.length === 0, reasons, not_selected, not_applicable, failed };
}

/** Decide the terminal status. Coverage must be exact; zero counted (pass/fail) results is a failure. */
export function decideOutcome({ exitCode, signal, parsed, expected }) {
  if (!parsed.ok) return { status: "failed", reason: parsed.reason };
  if (!(expected instanceof Set) || !expected.size) return { status: "failed", reason: "NO_EXPECTED_COVERAGE" };
  const seen = new Set();
  // reasons name the row by position only: runner-supplied text (test_id, scenario) never enters a reason
  for (const [i, r] of parsed.rows.entries()) {
    const key = `${r.test_id}|${r.scenario}|${r.repetition}`;
    if (!expected.has(key)) return { status: "failed", reason: `UNEXPECTED_RESULT row ${i + 1}` };
    if (seen.has(key)) return { status: "failed", reason: `DUPLICATE_RESULT row ${i + 1}` };
    seen.add(key);
  }
  if (seen.size !== expected.size) return { status: "failed", reason: `INCOMPLETE_RESULTS ${seen.size}/${expected.size}` };
  const counted = parsed.rows.filter((r) => r.status !== "not_applicable");
  if (!counted.length) return { status: "failed", reason: "NO_COUNTED_RESULTS" };
  if (counted.some((r) => r.status === "fail")) return { status: "failed", reason: "TEST_FAILURES" };
  if (exitCode !== 0 || signal) return { status: "failed", reason: `RUNNER_EXIT ${exitCode ?? signal}` };
  return { status: "succeeded", reason: null };
}
