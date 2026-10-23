// S4B complete39 (fast, deterministic parts): runtime profile-byte binding and its effect on qualification, operator trust
// pins in target configuration. No ports: the runner refuses before it starts any node. The long reference/reference run
// (SG-3 late phase, SG-4 export and offline packet verification) is an author run, not part of this file.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTree, ROOT } from "./helpers.mjs";
import { loadConfig } from "../../service/config.mjs";
import { profileQualification } from "../../service/results.mjs";
import { canonicalBytes } from "../../lib/jcs.mjs";
import { sha256Hex } from "../../lib/jws.mjs";

const PROFILE_SHA = sha256Hex(canonicalBytes(JSON.parse(readFileSync(join(ROOT, "profile", "pc-0.1-s1.json"), "utf8"))));

function runRunner(env) {
  const dir = mkdtempSync(join(tmpdir(), "c39-runner-"));
  writeFileSync(join(dir, "targets.json"), JSON.stringify([
    { id: "ref-a", implementation: "x", version: "t", base_url: "http://ref-a.localhost:4598", roles: ["home", "host"], setup: { kind: "reference-admin-v1" }, capabilities: [] },
    { id: "ref-b", implementation: "x", version: "t", base_url: "http://ref-b.localhost:4599", roles: ["home", "host"], setup: { kind: "reference-admin-v1" }, capabilities: [] }]));
  const r = spawnSync(process.execPath, [join(ROOT, "runner", "service-run.mjs"), "--targets", join(dir, "targets.json"), "--pairs", "ref-a:ref-b", "--gate", "SG-2", "--reps", "1",
    "--profile", "pc-0.1-s1", "--out", join(dir, "out"), "--ref-port", "4540", "--aux-port", "4541"], { env: { PATH: "/usr/bin:/bin", ...env }, encoding: "utf8", timeout: 20000 });
  return { ...r, out: join(dir, "out") };
}

test("profile binding: the runner refuses profile bytes that differ from the service-pinned digest, before any test", () => {
  for (const pinned of ["0".repeat(64), "", PROFILE_SHA.replace(/.$/, (c) => (c === "0" ? "1" : "0"))]) {
    const r = runRunner({ CONNECT_PROFILE_SHA256: pinned });
    assert.equal(r.status, 2, `pinned ${pinned || "(empty)"}: exit ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /PROFILE_DIGEST_MISMATCH/);
    assert.ok(!existsSync(join(r.out, "results.jsonl")), "no results for a refused profile");
  }
});

test("qualification needs the runner's own record bound to the job's pinned profile digest (same id is not enough)", () => {
  const ids = ["A", "B"];
  const rows = ids.map((test_id) => ({ test_id, status: "pass", scenario: "x:y", repetition: 1 }));
  const ok = { status: "succeeded" };
  const composition = { profile_sha256: "a".repeat(64) };
  const bound = { profile: { id: "p", sha256: "a".repeat(64), bound_to_service_digest: true } };
  const q = (extra) => profileQualification({ profileTestIds: ids, rows, outcome: ok, composition, runRecord: bound, currentProfileSha256: "a".repeat(64), ...extra });
  assert.equal(q({}).full_profile_qualified, true, "bound record, same digest");
  assert.deepEqual(q({ runRecord: null }).reasons, ["RUN_RECORD_MISSING"]);
  assert.deepEqual(q({ runRecord: { profile: { id: "p", sha256: "b".repeat(64), bound_to_service_digest: true } } }).reasons, ["PROFILE_DIGEST_MISMATCH"], "same id, other bytes");
  assert.deepEqual(q({ runRecord: { profile: { id: "p", sha256: "a".repeat(64), bound_to_service_digest: false } } }).reasons, ["PROFILE_DIGEST_MISMATCH"], "runner did not check the pin");
  assert.deepEqual(q({ currentProfileSha256: "c".repeat(64) }).reasons, ["PROFILE_DIGEST_MISMATCH"], "service profile changed since submission");
  assert.deepEqual(q({ composition: null }).reasons.sort(), ["COMPOSITION_MISSING", "PROFILE_DIGEST_MISMATCH"]);
});

test("trust pins: targets may carry operator-approved trusted_key_thumbprints; malformed pins refuse startup", () => {
  const good = makeTree({ mutate: (cfg) => { cfg.targets[0].trusted_key_thumbprints = ["A".repeat(43)]; } });
  assert.deepEqual(loadConfig(good.config).targets["ref-a"].descriptor.trusted_key_thumbprints, ["A".repeat(43)]);
  for (const bad of [[], ["short"], "A".repeat(43), [42]]) {
    const dirs = makeTree({ mutate: (cfg) => { cfg.targets[0].trusted_key_thumbprints = bad; } });
    assert.throws(() => loadConfig(dirs.config), /trusted_key_thumbprints/, JSON.stringify(bad));
  }
});
