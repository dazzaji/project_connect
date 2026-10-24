// Operator-owned configuration: service.json, tokens.json, targets.json in one config directory. Everything is validated
// at startup and any problem refuses startup. API callers can never supply URLs, commands or setup data.
import { closeSync, constants as FS, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { jcsSha256 } from "./util.mjs";

export class ConfigError extends Error {}
const fail = (m) => { throw new ConfigError(m); };
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (o, allowed, where) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${where}: unknown member ${k}`); };
const int = (v, min, max, where) => (Number.isSafeInteger(v) && v >= min && v <= max ? v : fail(`${where} must be an integer in [${min}, ${max}]`));
const absPath = (v, where) => (typeof v === "string" && isAbsolute(v) ? v : fail(`${where} must be an absolute path`));
const loadJson = (dir, name) => { try { return JSON.parse(readFileSync(join(dir, name), "utf8")); } catch (e) { fail(`${name}: ${e.message}`); } };

export const ROLES = ["submitter", "admin"];
export const SETUP_KINDS = ["reference-admin-v1", "harness-control-v1"];
export const CAPABILITIES = ["outage-drill", "key-drill"];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const hasOwn = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

function baseUrl(v, where) {
  let u;
  try { u = new URL(v); } catch { fail(`${where} is not a URL`); }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash)
    fail(`${where} must be scheme://host[:port] with no credentials, path, query or fragment`);
  return `${u.protocol}//${u.host}`;
}

/** Validate and read a credentials file at the moment of use: the resolved path must stay inside secrets_dir, the final
 * component must not be a symlink (O_NOFOLLOW), and the opened file must be a regular file owned by the service user,
 * not group/world accessible, and the same inode as the resolved path. Returns the parsed JSON. */
export function readCredentialFile(secretsDir, ref, where = "credentials") {
  if (typeof ref !== "string" || !ref || isAbsolute(ref) || ref.includes("\0")) fail(`${where}: credentials_ref must be a relative path inside secrets_dir`);
  let real;
  try { real = realpathSync(resolve(secretsDir, ref)); } catch { fail(`${where}: credentials file missing`); }
  const rel = relative(realpathSync(secretsDir), real);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) fail(`${where}: credentials_ref escapes secrets_dir`);
  let fd;
  try { fd = openSync(real, FS.O_RDONLY | FS.O_NOFOLLOW); } catch { fail(`${where}: credentials file cannot be opened safely`); }
  try {
    const st = fstatSync(fd), byPath = statSync(real);
    if (!st.isFile()) fail(`${where}: credentials file is not a regular file`);
    if (st.ino !== byPath.ino || st.dev !== byPath.dev) fail(`${where}: credentials file changed while being opened`);
    if (st.mode & 0o077) fail(`${where}: credentials file must not be group/world accessible (mode ${(st.mode & 0o777).toString(8)})`);
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) fail(`${where}: credentials file must be owned by the service user`);
    const text = readFileSync(fd, "utf8");
    try { return JSON.parse(text); } catch { fail(`${where}: credentials file is not JSON`); }
  } finally { closeSync(fd); }
}

/** state_dir/secrets_dir: a real directory (not a symlink), owned by the service user, with no group/world access. */
function privateDir(path, where, create) {
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  let st;
  try { st = lstatSync(path); } catch { fail(`${where} does not exist`); }
  if (!st.isDirectory()) fail(`${where} must be a directory, not a symlink or file`);
  if (st.mode & 0o077) fail(`${where} must not be group/world accessible (mode ${(st.mode & 0o777).toString(8)})`);
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) fail(`${where} must be owned by the service user`);
}

/** Digest of a target descriptor for composition records; the credential reference is excluded entirely. */
export function descriptorDigest(t) {
  const { credentials_ref, ...pub } = t;
  return jcsSha256(pub);
}

export function loadConfig(configDir) {
  const svc = loadJson(configDir, "service.json");
  if (!isObj(svc)) fail("service.json must be an object");
  onlyKeys(svc, ["state_dir", "secrets_dir", "listen", "limits", "profiles", "runner", "port_pool"], "service.json");
  const state_dir = absPath(svc.state_dir, "state_dir");
  const secrets_dir = absPath(svc.secrets_dir, "secrets_dir");
  privateDir(state_dir, "state_dir", true);
  privateDir(secrets_dir, "secrets_dir", false);
  const listen = svc.listen ?? {};
  if (!isObj(listen)) fail("listen must be an object");
  onlyKeys(listen, ["host", "port"], "listen");
  const host = listen.host ?? "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) fail("listen.host must be a loopback address (front with a reviewed proxy for anything else)");
  const port = int(listen.port ?? 4300, 0, 65535, "listen.port");
  const L = svc.limits ?? {};
  if (!isObj(L)) fail("limits must be an object");
  onlyKeys(L, ["max_concurrent_jobs", "max_reps", "max_pairs", "job_timeout_s", "max_queued", "cancel_grace_ms", "max_request_bytes"], "limits");
  const limits = {
    max_concurrent_jobs: int(L.max_concurrent_jobs ?? 1, 1, 1, "limits.max_concurrent_jobs"),
    max_reps: int(L.max_reps ?? 2, 1, 10, "limits.max_reps"),
    max_pairs: int(L.max_pairs ?? 4, 1, 16, "limits.max_pairs"),
    job_timeout_s: int(L.job_timeout_s ?? 1800, 1, 86400, "limits.job_timeout_s"),
    max_queued: int(L.max_queued ?? 10, 1, 1000, "limits.max_queued"),
    cancel_grace_ms: int(L.cancel_grace_ms ?? 5000, 100, 60000, "limits.cancel_grace_ms"),
    max_request_bytes: int(L.max_request_bytes ?? 16384, 256, 1048576, "limits.max_request_bytes"),
  };
  if (!isObj(svc.profiles) || !Object.keys(svc.profiles).length) fail("profiles must map profile ids to profile files");
  const profiles = Object.create(null); // own entries only: "__proto__", "toString" … are never profiles
  for (const [id, p] of Object.entries(svc.profiles)) {
    if (!/^[a-z0-9][a-z0-9.-]{0,62}$/.test(id)) fail(`profile id ${id} is invalid`);
    const prof = (() => { try { return JSON.parse(readFileSync(absPath(p, `profiles.${id}`), "utf8")); } catch (e) { fail(`profile ${id}: ${e.message}`); } })();
    const tests = Array.isArray(prof.tests) ? prof.tests : [];
    if (!tests.length || tests.some((t) => typeof t?.id !== "string" || typeof t?.gate !== "string")) fail(`profile ${id} must declare tests with string id and gate`);
    if (new Set(tests.map((t) => t.id)).size !== tests.length) fail(`profile ${id} has duplicate test ids`);
    profiles[id] = { path: p, tests: tests.map((t) => ({ id: t.id, gate: t.gate })), test_ids: tests.map((t) => t.id), sha256: jcsSha256(prof) };
  }
  const R = svc.runner;
  if (!isObj(R)) fail("runner must be an object");
  onlyKeys(R, ["node", "entry", "env"], "runner");
  const runner = { node: absPath(R.node, "runner.node"), entry: absPath(R.entry, "runner.entry"), env: R.env ?? {} };
  if (!isObj(runner.env) || Object.values(runner.env).some((v) => typeof v !== "string")) fail("runner.env must map names to strings");
  const pp = svc.port_pool;
  if (!isObj(pp)) fail("port_pool must be an object");
  onlyKeys(pp, ["from", "to"], "port_pool");
  const port_pool = { from: int(pp.from, 1024, 65535, "port_pool.from"), to: int(pp.to, 1024, 65535, "port_pool.to") };
  if (port_pool.to - port_pool.from < 1) fail("port_pool must contain at least two ports");

  const tokens = loadJson(configDir, "tokens.json");
  if (!Array.isArray(tokens) || !tokens.length) fail("tokens.json must be a non-empty array");
  const ids = new Set();
  for (const [i, t] of tokens.entries()) {
    if (!isObj(t)) fail(`tokens[${i}] must be an object`);
    onlyKeys(t, ["id", "role", "token_sha256"], `tokens[${i}]`);
    if (typeof t.id !== "string" || !ID_RE.test(t.id) || ids.has(t.id)) fail(`tokens[${i}].id invalid or duplicate`);
    ids.add(t.id);
    if (!ROLES.includes(t.role)) fail(`tokens[${i}].role must be one of ${ROLES.join(", ")}`);
    if (!/^[0-9a-f]{64}$/.test(t.token_sha256 ?? "")) fail(`tokens[${i}].token_sha256 must be 64 hex characters`);
  }

  const targetsRaw = loadJson(configDir, "targets.json");
  if (!Array.isArray(targetsRaw) || !targetsRaw.length) fail("targets.json must be a non-empty array");
  const targets = Object.create(null);
  for (const [i, t] of targetsRaw.entries()) {
    const w = `targets[${i}]`;
    if (!isObj(t)) fail(`${w} must be an object`);
    onlyKeys(t, ["id", "implementation", "version", "base_url", "roles", "setup", "capabilities", "credentials_ref", "trusted_key_thumbprints"], w);
    if (typeof t.id !== "string" || !ID_RE.test(t.id) || targets[t.id]) fail(`${w}.id invalid or duplicate`);
    for (const k of ["implementation", "version"]) if (typeof t[k] !== "string" || !t[k] || t[k].length > 200) fail(`${w}.${k} required`);
    const roles = t.roles;
    if (!Array.isArray(roles) || !roles.length || roles.some((r) => !["home", "host"].includes(r))) fail(`${w}.roles must be a non-empty subset of home, host`);
    if (!isObj(t.setup) || !SETUP_KINDS.includes(t.setup.kind)) fail(`${w}.setup.kind must be one of ${SETUP_KINDS.join(", ")}`);
    onlyKeys(t.setup, ["kind", "control_url", "node"], `${w}.setup`);
    if (t.setup.kind === "harness-control-v1") {
      baseUrl(t.setup.control_url, `${w}.setup.control_url`);
      if (typeof t.setup.node !== "string" || !t.setup.node) fail(`${w}.setup.node required for harness-control-v1`);
    }
    const caps = t.capabilities ?? [];
    if (!Array.isArray(caps) || caps.some((c) => !CAPABILITIES.includes(c))) fail(`${w}.capabilities must be a subset of ${CAPABILITIES.join(", ")}`);
    // operator-approved trust roots for offline packet verification (RFC 7638 thumbprints of the target's signing keys)
    const pins = t.trusted_key_thumbprints;
    if (pins !== undefined && (!Array.isArray(pins) || !pins.length || pins.length > 16 || pins.some((x) => typeof x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(x)))) fail(`${w}.trusted_key_thumbprints must be 1..16 base64url SHA-256 thumbprints`);
    const desc = { ...t, base_url: baseUrl(t.base_url, `${w}.base_url`), capabilities: caps };
    if (t.credentials_ref !== undefined) readCredentialFile(secrets_dir, t.credentials_ref, w); // validated now and again at use
    targets[t.id] = { descriptor: desc, digest: descriptorDigest(desc), credentialsRef: t.credentials_ref ?? null };
  }
  return { state_dir, secrets_dir, listen: { host, port }, limits, profiles, runner, port_pool, tokens, targets };
}
