// Minimal HTTP plumbing for the reference node: routing, JSON bodies, RFC 9457 problem documents.
import { createServer } from "node:http";

export const STATUS = {
  VALIDATION_FAILED: 400, NOT_FOUND: 404, PAYLOAD_TOO_LARGE: 413, INTERNAL: 500,
  AUTH_MISSING: 401, AUTH_INVALID: 401, AUTH_EXPIRED: 401, AUTH_REVOKED: 401, FORBIDDEN: 403,
  CONFLICT: 409, PHASE_MISMATCH: 409, VOTE_CAP_EXCEEDED: 409, CONSENT_REQUIRED: 409,
  NOT_A_PEER: 403, PROTOCOL_UNSUPPORTED: 409, CLAIM_EXPIRED: 401, CLAIM_REPLAYED: 409,
  CLAIM_AUDIENCE_MISMATCH: 401, SUBJECT_REVOKED: 403, AUTHZ_REQUIRED: 403, GRANT_SCOPE_VIOLATION: 403,
  GRANT_EXPIRED: 403, GRANT_REVOKED: 403, GRANT_EVENT_MISMATCH: 403, GRANT_AUDIENCE_MISMATCH: 403,
  GRANT_BINDING_MISMATCH: 401, SIGNATURE_INVALID: 401, UNKNOWN_SIGNER: 401, PEER_SUSPENDED: 403,
  REVOCATION_STATE_UNKNOWN: 503,
};

export class Problem extends Error {
  constructor(code, detail, extra = {}) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
    if (!(code in STATUS)) throw new Error(`unregistered problem code ${code}`);
    this.code = code;
    this.detail = detail;
    this.extra = extra;
  }
  body(instance) {
    return { type: `urn:ilp:error:${this.code}`, title: this.code, status: STATUS[this.code], ...(this.detail ? { detail: this.detail } : {}), instance, ...this.extra };
  }
}

const MAX_BODY = 262144;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > MAX_BODY) {
        reject(new Problem("PAYLOAD_TOO_LARGE", `body exceeds ${MAX_BODY} bytes`, { limit_bytes: MAX_BODY }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** routes: array of [method, pathPattern (":param" segments), handler(ctx)] ; handler returns {status?, body, headers?} */
export function serve({ port, host = "::", routes, log = () => {} }) {
  const compiled = routes.map(([method, pattern, handler]) => {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:([a-z_]+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
    return { method, re, keys, handler };
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body, headers = {}) => {
      const isProblem = body && typeof body.type === "string" && body.type.startsWith("urn:ilp:error:");
      const payload = body === undefined ? "" : JSON.stringify(body);
      res.writeHead(status, { "content-type": `${isProblem ? "application/problem+json" : "application/json"}; charset=utf-8`, ...headers });
      res.end(payload);
    };
    try {
      const route = compiled.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!route) throw new Problem("NOT_FOUND", `no route ${req.method} ${url.pathname}`);
      const m = url.pathname.match(route.re);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let body = null;
      if (req.method === "POST") {
        const raw = await readBody(req);
        if (raw.length) {
          try {
            body = JSON.parse(raw.toString("utf8"));
          } catch {
            throw new Problem("VALIDATION_FAILED", "body is not JSON");
          }
        }
      }
      const out = await route.handler({ req, url, params, body: body ?? {}, query: Object.fromEntries(url.searchParams), headers: req.headers });
      send(out.status ?? 200, out.body, out.headers);
    } catch (e) {
      if (e instanceof Problem) return send(STATUS[e.code], e.body(url.pathname));
      log(`internal error: ${e.stack}`);
      send(500, new Problem("INTERNAL", "internal error").body(url.pathname));
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
