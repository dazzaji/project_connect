// Runner plumbing: HTTP client, assertions, observables, and the runner's own reference nodes.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
export const seenProblems = () => problems;

/** Assert an RFC 9457 ILP problem with `code` (R-CORE-9). */
export function expectProblem(res, code, what) {
  check(res.json && typeof res.json.type === "string", `${what}: expected problem ${code}, got HTTP ${res.status} ${res.text.slice(0, 200)}`);
  problems.push({ what, status: res.status, contentType: res.contentType, body: res.json });
  const got = res.json.type.replace("urn:ilp:error:", "");
  const codes = [].concat(code);
  check(codes.includes(got), `${what}: expected ${codes.join(" | ")}, got ${got} (${res.json.detail ?? ""})`);
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
  const items = feed.json?.items ?? [];
  return {
    latest_seq: feed.json?.latest_seq ?? null,
    actions: items.filter((f) => f.kind === "action.accepted").length,
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
  const kf = JSON.parse(readFileSync(join(dir, "key.json"), "utf8"));
  const key = kf.keys.find((k) => k.kid === kf.active_kid);
  return { name, base, kind: "ref", admin, key, child, stop: () => { try { process.kill(-child.pid, "SIGTERM"); } catch {} } };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
