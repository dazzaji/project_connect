// Runner plumbing: HTTP client, assertions, observables, and the runner's own reference nodes.
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { validate as validateSchema, validateAt } from "../lib/schemas.mjs";
import { canonicalize } from "../lib/jcs.mjs";
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
export function isProblemMediaType(contentType) {
  const token = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
  const quoted = '"(?:[\\t\\x20-\\x21\\x23-\\x5b\\x5d-\\x7e\\x80-\\xff]|\\\\[\\t\\x20-\\x7e\\x80-\\xff])*"';
  const media = new RegExp(`^[ \\t]*application/problem\\+json[ \\t]*(?:;[ \\t]*${token}=(?:${token}|${quoted})[ \\t]*)*$`, "i");
  return typeof contentType === "string" && media.test(contentType);
}
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
  // Exact HTTP media essence, case insensitive; parameters must be token or quoted-string values.
  check(isProblemMediaType(res.contentType), `${what}: content-type ${res.contentType}`);
  const v = validateSchema("problem", res.json);
  check(v.ok, `${what}: problem schema: ${v.errors.join("; ")}`);
  return res.json;
}
export function expectOk(res, status, what) {
  check([].concat(status).includes(res.status), `${what}: expected HTTP ${status}, got ${res.status} ${res.text.slice(0, 300)}`);
  return res.json;
}

/** Observables for no-side-effect checks (profile.no_side_effect_observables). */
// Bound observation work and fail closed if a collection cannot be consumed completely. Cursors are data,
// appended to the same fixed endpoint; a peer never supplies the next URL or an observation hook.
export async function observationPages(url, bearer, what) {
  const items = [], cursors = new Set(); let cursor = null, latest = null;
  const feed = new URL(url).pathname.endsWith("/feed");
  for (let page = 0; page < 100; page++) {
    const next = new URL(url);
    if (cursor !== null) next.searchParams.set(feed && typeof cursor === "number" ? "since" : "cursor", String(cursor));
    const r = await http("GET", next.href, bearer ? { bearer } : {});
    check(r.status === 200 && r.json && Array.isArray(r.json.items), `${what}: unreadable HTTP ${r.status}`);
    const nc = r.json.next_cursor;
    check(Object.hasOwn(r.json, "next_cursor") && (nc === null || typeof nc === "string" && nc.length > 0 || feed && Number.isSafeInteger(nc) && nc >= 0), `${what}: invalid/missing next_cursor`);
    if (feed) {
      check(Number.isSafeInteger(r.json.latest_seq) && r.json.latest_seq >= 0, `${what}: invalid latest_seq`);
      if (latest !== null) check(latest === r.json.latest_seq, `${what}: feed changed during pagination`);
      latest = r.json.latest_seq;
    }
    items.push(...r.json.items); check(items.length <= 20000, `${what}: observation record bound exceeded`);
    // R-CORE-13/14 feeds continue by since=<seq>. Beta returns the numeric tail even at the head (T-A3-2);
    // list endpoints retain R-CORE-12 opaque cursor semantics. Never substitute a peer-supplied URL.
    if (feed && typeof nc === "number") {
      const tail = r.json.items.at(-1)?.seq;
      check(Number.isSafeInteger(tail) && tail > 0 && nc === tail && nc <= latest, `${what}: invalid feed continuation`);
      if (nc === latest) return { items, latest_seq: latest };
    }
    cursor = nc;
    if (cursor === null) return { items, latest_seq: latest };
    check(!cursors.has(cursor) && r.json.items.length > 0, `${what}: stalled/repeated cursor`); cursors.add(cursor);
  }
  throw new TestFailure(`${what}: observation page bound exceeded`);
}
const observationHash = value => createHash("sha256").update(canonicalize(value)).digest("hex");
// `bearer` (optional) observes a private event through a credential that may see it (its operator's)
export async function observe(node, eventRef, bearer = null) {
  const feed = await observationPages(`${node.base}/ilp/v1/events/${eventRef}/feed?since=0`, bearer, `observe ${node.name} feed`);
  const rc = await observationPages(`${node.base}/ilp/v1/events/${eventRef}/receipts`, bearer, `observe ${node.name} receipts`);
  const items = feed.items; let seq = 0;
  for (const row of items) {
    check(row && Number.isSafeInteger(row.seq) && row.seq > seq && row.seq <= feed.latest_seq, "observe feed: invalid/nonmonotonic seq"); seq = row.seq;
    check(typeof row.kind === "string" && row.kind.length > 0 && typeof row.summary === "string" && Object.hasOwn(row, "data"), "observe feed: unreadable record");
    check(validateAt("receipt", "/properties/occurred_at", row.occurred_at) && validateAt("receipt", "/properties/resource", row.resource_global_id), "observe feed: invalid time/resource");
  }
  check(seq === feed.latest_seq, "observe feed: incomplete head");
  const receiptIds = new Set();
  for (const row of rc.items) {
    const v = validateSchema("receipt", row); check(v.ok, `observe receipt: ${v.errors.join("; ")}`);
    check(!receiptIds.has(row.id), "observe receipts: duplicate id across pages"); receiptIds.add(row.id);
  }
  return {
    latest_seq: feed.latest_seq,
    actions: items.filter((f) => f.kind === "action.accepted").length,
    // every tally or artifact change in slice 1 is itself a feed record (R-CORE-13), so the feed tail covers them
    tail: items.at(-1) ? `${items.at(-1).seq}:${items.at(-1).kind}:${items.at(-1).resource_global_id}` : null,
    receipts: rc.items.length,
    head: rc.items.at(-1)?.hash ?? null,
    feed_hash: observationHash(items.map(({seq,occurred_at,kind,resource_global_id,summary,data}) => ({seq,occurred_at,kind,resource_global_id,summary,data}))), receipts_hash: observationHash(rc.items),
  };
}
// Operator list rows differ from the retrieval schema: no token, grant or event is required here.
export async function observeJoins(node, eventRef, bearer) {
  const { items } = await observationPages(`${node.base}/ilp/v1/events/${eventRef}/join-requests`, bearer, `observe ${node.name} join requests`);
  const ids = new Set();
  for (const row of items) {
    check(row && validateAt("join-request", "/properties/join_request_id", row.join_request_id) && validateAt("join-request", "/properties/status", row.status) && validateAt("join-request", "/properties/subject", row.subject), "observe join requests: unreadable identity/status/subject");
    if (Object.hasOwn(row, "agent")) check(validateAt("receipt", "/properties/subject_agent", row.agent), "observe join requests: invalid agent");
    for (const field of ["home", "display_name"]) if (Object.hasOwn(row, field)) check(typeof row[field] === "string", `observe join requests: invalid ${field}`);
    check(!ids.has(row.join_request_id), "observe join requests: duplicate id across pages"); ids.add(row.join_request_id);
  }
  return items.map(j => canonicalize(Object.fromEntries(["join_request_id", "status", "subject", "agent", "home", "display_name"].filter(k => Object.hasOwn(j, k)).map(k => [k, j[k]])))).sort();
}
/** A negative event-scoped operation must preserve both public effects and operator-visible admission state. */
export async function expectRefusal(node, eventRef, bearer, request, code, what) {
  const before = await observe(node, eventRef, bearer), joins = await observeJoins(node, eventRef, bearer);
  const response = await request(); expectProblem(response, code, what);
  await expectNoSideEffects(node, eventRef, before, what, bearer);
  const after = await observeJoins(node, eventRef, bearer);
  check(JSON.stringify(after) === JSON.stringify(joins), `${what}: admission state changed`);
  return response;
}
export async function expectNoSideEffects(node, eventRef, before, what, bearer = null) {
  const after = await observe(node, eventRef, bearer);
  check(JSON.stringify(after) === JSON.stringify(before), `${what}: side effects observed ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
}

// ---- the runner's own reference nodes (runner-as-node, R-CONF-3) ----
// `baseUrl`/`listenPort`: a node may declare one origin (e.g. a runner-owned proxy in front of it) while listening elsewhere
// `detached: false` keeps the node in the caller's process group (the service runner: a supervisor that terminates the
// runner's group then also reaches the runner's own nodes)
// `host` (optional): the listen address passed as --host. Unset keeps the reference node's own default (historical callers);
// the service runner and its fixtures pass loopback explicitly (unit57)
export async function startReferenceNode({ name, port, work, bound = 60, baseUrl = null, listenPort = null, detached = true, host = null }) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  const admin = randomBytes(24).toString("base64url");
  writeFileSync(join(dir, "admin.token"), admin, { mode: 0o600 });
  const base = baseUrl ?? `http://${name}.localhost:${port}`;
  const lp = listenPort ?? port;
  const child = spawn(process.execPath, [join(PC_ROOT, "reference-node", "main.mjs"), "--base-url", base, "--port", String(lp), "--key-file", join(dir, "key.json"), "--admin-token-file", join(dir, "admin.token"), "--dev", "--bound", String(bound), ...(host ? ["--host", host] : [])], { stdio: ["ignore", "ignore", "pipe"], detached });
  child.stderr.on("data", (d) => writeFileSync(join(dir, "node.log"), d, { flag: "a" }));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${lp}/healthz`)).ok) break;
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
  const exited = new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : child.once("exit", () => r())));
  return { name, base, kind: "ref", admin, key, child, exited, stop: () => { try { if (detached) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } catch {} } };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
