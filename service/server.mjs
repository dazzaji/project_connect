// Authenticated job API. Submitters see and cancel only their own jobs; admins see all. Jobs name registered target ids
// and a configured profile only — never URLs, commands or setup data. Errors are application/problem+json.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex, safeEqualHex } from "./util.mjs";
import { TERMINAL } from "./store.mjs";
import { hasOwn } from "./config.mjs";

const GATES = ["SG-2", "SG-3", "all"];
const STATUS = { BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, QUEUE_FULL: 429, INTERNAL: 500 };
class ApiError extends Error { constructor(code, detail) { super(detail); this.code = code; } }

function send(res, status, body, type = "application/json") {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(data), "cache-control": "no-store" });
  res.end(data);
}
const problem = (res, code, detail, instance) => send(res, STATUS[code], { type: `urn:connect:error:${code}`, title: code, status: STATUS[code], detail, instance }, "application/problem+json");

function readBody(req, max) {
  return new Promise((ok, bad) => {
    if (Number(req.headers["content-length"]) > max) { req.resume(); return bad(new ApiError("PAYLOAD_TOO_LARGE", `body over ${max} bytes`)); }
    let n = 0, over = false; const chunks = [];
    // past the cap nothing more is buffered; the rest is drained so a 413 can still be answered
    req.on("data", (c) => { n += c.length; if (n > max) over = true; else chunks.push(c); });
    req.on("end", () => (over ? bad(new ApiError("PAYLOAD_TOO_LARGE", `body over ${max} bytes`)) : ok(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", bad);
  });
}

export function validateJobRequest(body, config) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("BAD_REQUEST", "body must be a JSON object");
  for (const k of Object.keys(body)) if (!["profile", "gate", "pairs", "reps", "also"].includes(k)) throw new ApiError("BAD_REQUEST", `unknown member ${k}`);
  if (!hasOwn(config.profiles, body.profile)) throw new ApiError("BAD_REQUEST", "profile is not configured");
  const profile = config.profiles[body.profile];
  const gate = body.gate ?? "SG-2";
  if (!GATES.includes(gate)) throw new ApiError("BAD_REQUEST", `gate must be one of ${GATES.join(", ")}`);
  const reps = body.reps ?? 1;
  if (!Number.isSafeInteger(reps) || reps < 1 || reps > config.limits.max_reps) throw new ApiError("BAD_REQUEST", `reps must be an integer in [1, ${config.limits.max_reps}]`);
  const pairs = body.pairs;
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > config.limits.max_pairs) throw new ApiError("BAD_REQUEST", `pairs must contain 1..${config.limits.max_pairs} entries`);
  const clean = pairs.map((p, i) => {
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => k !== "home" && k !== "host")) throw new ApiError("BAD_REQUEST", `pairs[${i}] must be {home, host}`);
    for (const role of ["home", "host"]) {
      if (!hasOwn(config.targets, p[role])) throw new ApiError("BAD_REQUEST", `pairs[${i}].${role} is not a registered target`);
      const t = config.targets[p[role]];
      if (!t.descriptor.roles.includes(role)) throw new ApiError("BAD_REQUEST", `target ${p[role]} is not registered for role ${role}`);
    }
    if (p.home === p.host) throw new ApiError("BAD_REQUEST", `pairs[${i}] home and host must differ`);
    return { home: p.home, host: p.host };
  });
  const also = body.also ?? [];
  if (!Array.isArray(also) || also.length > 20 || also.some((x) => typeof x !== "string" || !profile.test_ids.includes(x))) throw new ApiError("BAD_REQUEST", "also must list test ids of the profile");
  return { profile: body.profile, gate, reps, pairs: clean, also: [...new Set(also)] };
}

export function createApi({ config, store, supervisor, composition }) {
  const principalOf = (req) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
    if (!m) throw new ApiError("UNAUTHORIZED", "bearer token required");
    const h = sha256Hex(m[1]);
    const p = config.tokens.find((t) => safeEqualHex(t.token_sha256, h));
    if (!p) throw new ApiError("UNAUTHORIZED", "unknown token");
    return p;
  };
  // a job the caller may not see is indistinguishable from an absent one
  const visibleJob = (who, id) => { const job = store.get(id); if (!job || (who.role !== "admin" && job.owner !== who.id)) throw new ApiError("NOT_FOUND", "unknown job"); return job; };
  // `qualification` (terminal jobs): job success is not profile conformance; only scope "full_profile" is whole-profile evidence
  const view = (job) => ({ id: job.id, owner: job.owner, status: job.status, reason: job.reason ?? null, qualification: job.qualification ?? null, request: job.request, composition: job.composition,
    created_at: job.created_at, started_at: job.started_at ?? null, finished_at: job.finished_at ?? null });

  const handler = async (req, res) => {
    let path = "/";
    try {
      try { path = new URL(req.url, "http://x").pathname; } catch { throw new ApiError("BAD_REQUEST", "invalid request target"); }
      if (req.method === "GET" && path === "/healthz") return send(res, 200, { ok: true });
      if (req.method === "GET" && path === "/readyz") return send(res, 200, { ready: true, queued: supervisor.queuedCount() });
      const who = principalOf(req);
      if (req.method === "POST" && path === "/v1/jobs") {
        let body;
        try { body = JSON.parse(await readBody(req, config.limits.max_request_bytes)); } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError("BAD_REQUEST", "body is not JSON"); }
        const request = validateJobRequest(body, config);
        if (supervisor.queuedCount() >= config.limits.max_queued) throw new ApiError("QUEUE_FULL", "job queue is full");
        const targets = Object.fromEntries([...new Set(request.pairs.flatMap((p) => [p.home, p.host]))].map((id) => [id, config.targets[id].digest]));
        const job = store.create({ owner: who.id, request, composition: { ...composition, profile_sha256: config.profiles[request.profile].sha256, target_descriptor_sha256: targets } });
        supervisor.kick();
        return send(res, 201, view(job));
      }
      let m;
      if (req.method === "GET" && (m = /^\/v1\/jobs\/([^/]+)$/.exec(path))) return send(res, 200, view(visibleJob(who, m[1])));
      if (req.method === "GET" && (m = /^\/v1\/jobs\/([^/]+)\/results$/.exec(path))) {
        const job = visibleJob(who, m[1]);
        if (!TERMINAL.includes(job.status)) throw new ApiError("CONFLICT", `job is ${job.status}`);
        const f = join(store.dirOf(job.id), "report.json");
        if (!existsSync(f)) throw new ApiError("INTERNAL", "report missing");
        return send(res, 200, JSON.parse(readFileSync(f, "utf8")));
      }
      if (req.method === "POST" && (m = /^\/v1\/jobs\/([^/]+)\/cancel$/.exec(path))) {
        const job = visibleJob(who, m[1]);
        if (TERMINAL.includes(job.status)) throw new ApiError("CONFLICT", `job is already ${job.status}`);
        supervisor.cancel(job);
        return send(res, 202, view(store.get(job.id)));
      }
      throw new ApiError("NOT_FOUND", "no such route");
    } catch (e) {
      if (e instanceof ApiError) return problem(res, e.code, e.message, path);
      return problem(res, "INTERNAL", "internal error", path);
    }
  };
  // no rejection may escape a request, whatever the input
  return createServer((req, res) => { handler(req, res).catch(() => { try { if (!res.headersSent) problem(res, "INTERNAL", "internal error", "/"); else res.destroy(); } catch {} }); });
}
