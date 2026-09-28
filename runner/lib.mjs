// Runner plumbing: HTTP client, assertions, observables, and the runner's own reference nodes.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { validate as validateSchema } from "../lib/schemas.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export class TestFailure extends Error {}
export const check = (cond, msg) => {
  if (!cond) throw new TestFailure(msg);
};

/** fetch JSON; never throws on HTTP status. */
export async function http(method, url, { body, bearer, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json, text, contentType: res.headers.get("content-type") ?? "" };
}

const problems = []; // every negative response seen in the run (PC-CORE-1)

// registered HTTP status per problem code, read from the specification's §17.2 table (the authority)
const REGISTERED = (() => {
  const text = readFileSync(join(PC_ROOT, "specifications", "ilp_spec.md"), "utf8");
  const s = text.slice(text.indexOf("#### 17.2.1 Codes"), text.indexOf("#### 17.2.2"));
  return Object.fromEntries([...s.matchAll(/^\| `([A-Z_]+)` \| (\d{3}) \|/gm)].map((m) => [m[1], Number(m[2])]));
})();
export const registeredStatus = (code) => REGISTERED[code];
export const seenProblems = () => problems;

/** Assert an RFC 9457 ILP problem with `code` (R-CORE-9). */
export function expectProblem(res, code, what) {
  check(res.json && typeof res.json.type === "string", `${what}: expected problem ${code}, got HTTP ${res.status} ${res.text.slice(0, 200)}`);
  problems.push({ what, status: res.status, contentType: res.contentType, body: res.json });
  const got = res.json.type.replace("urn:ilp:error:", "");
  const codes = [].concat(code);
  check(codes.includes(got), `${what}: expected ${codes.join(" | ")}, got ${got} (${res.json.detail ?? ""})`);
  // the whole problem envelope, not just the type (R-CORE-9): registered status, media type, schema, title
  check(REGISTERED[got] !== undefined, `${what}: ${got} is not a registered code (§17.2)`);
  check(res.status === REGISTERED[got], `${what}: ${got} must be HTTP ${REGISTERED[got]}, got ${res.status}`);
  check(res.json.status === res.status, `${what}: problem.status ${res.json.status} != HTTP ${res.status}`);
  check(res.json.title === got, `${what}: problem.title ${res.json.title} != ${got}`);
  check(res.contentType.startsWith("application/problem+json"), `${what}: content-type ${res.contentType}`);
  const v = validateSchema("problem", res.json);
  check(v.ok, `${what}: problem schema: ${v.errors.join("; ")}`);
  return res.json;
}
export function expectOk(res, status, what) {
  check([].concat(status).includes(res.status), `${what}: expected HTTP ${status}, got ${res.status} ${res.text.slice(0, 300)}`);
  return res.json;
}

/** Observables for no-side-effect checks (profile.no_side_effect_observables). */
export async function observe(node, eventRef) {
  const feed = await http("GET", `${node.base}/ilp/v1/events/${eventRef}/feed?since=0`);
  const rc = await http("GET", `${node.base}/ilp/v1/events/${eventRef}/receipts`);
  // an observation that cannot be made fails the test; it never compares as "unchanged"
  check(feed.status === 200 && Array.isArray(feed.json?.items) && Number.isInteger(feed.json?.latest_seq), `observe ${node.name} feed: HTTP ${feed.status}`);
  check(rc.status === 200 && Array.isArray(rc.json?.items), `observe ${node.name} receipts: HTTP ${rc.status}`);
  const items = feed.json.items;
  return {
    latest_seq: feed.json?.latest_seq ?? null,
    actions: items.filter((f) => f.kind === "action.accepted").length,
    // every tally or artifact change in slice 1 is itself a feed record (R-CORE-13), so the feed tail covers them
    tail: items.at(-1) ? `${items.at(-1).seq}:${items.at(-1).kind}:${items.at(-1).resource_global_id}` : null,
    receipts: rc.json?.items?.length ?? null,
    head: rc.json?.items?.at(-1)?.hash ?? null,
  };
}
export async function expectNoSideEffects(node, eventRef, before, what) {
  const after = await observe(node, eventRef);
  check(JSON.stringify(after) === JSON.stringify(before), `${what}: side effects observed ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
}

// ---- the runner's own reference nodes (runner-as-node, R-CONF-3) ----
export async function startReferenceNode({ name, port, work, bound = 60 }) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  const admin = randomBytes(24).toString("base64url");
  writeFileSync(join(dir, "admin.token"), admin, { mode: 0o600 });
  const base = `http://${name}.localhost:${port}`;
  const child = spawn(process.execPath, [join(PC_ROOT, "reference-node", "main.mjs"), "--base-url", base, "--port", String(port), "--key-file", join(dir, "key.json"), "--admin-token-file", join(dir, "admin.token"), "--dev", "--bound", String(bound)], { stdio: ["ignore", "ignore", "pipe"], detached: true });
  child.stderr.on("data", (d) => writeFileSync(join(dir, "node.log"), d, { flag: "a" }));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  let kf;
  try {
    kf = JSON.parse(readFileSync(join(dir, "key.json"), "utf8"));
  } catch {
    throw new Error(`reference node ${name} did not start on port ${port} (port in use?) — see ${join(dir, "node.log")}`);
  }
  const key = kf.keys.find((k) => k.kid === kf.active_kid);
  return { name, base, kind: "ref", admin, key, child, stop: () => { try { process.kill(-child.pid, "SIGTERM"); } catch {} } };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
