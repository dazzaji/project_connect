#!/usr/bin/env node
// usage: node reference-node/main.mjs --base-url http://pc-ref.localhost:4190 --port 4190 --key-file <path> --admin-token-file <path> [--dev] [--bound 60]
// Keys fail closed (R-CORE-34(b)): a missing or invalid key file stops startup unless --dev, which may create one but never overwrite.
import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKey } from "../lib/jws.mjs";
import { serve } from "./http.mjs";
import { createNode } from "./node.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));
const die = (m) => (console.error(`reference-node: ${m}`), process.exit(1));
const baseUrl = args["base-url"] ?? die("--base-url is required");
const port = Number(args.port ?? new URL(baseUrl).port);

let key;
const keyFile = args["key-file"] ?? die("--key-file is required");
if (!existsSync(keyFile)) {
  if (!args.dev) die(`key file ${keyFile} is missing; refusing to start (R-CORE-34(b)). Use --dev to create one.`);
  const k = generateKey(`ref-${new Date().toISOString().slice(0, 10)}-a`);
  writeFileSync(keyFile, JSON.stringify({ active_kid: k.kid, keys: [k.privateJwk] }, null, 2), { mode: 0o600, flag: "wx" });
}
let keyring;
try {
  const kf = JSON.parse(readFileSync(keyFile, "utf8"));
  if (!Array.isArray(kf.keys) || !kf.keys.length) throw new Error("empty keyring");
  // every key must be a real Ed25519 private key whose public half matches its published x
  const kids = new Set();
  for (const k of kf.keys) {
    if (typeof k.kid !== "string" || !k.kid) throw new Error("a key has no kid");
    if (kids.has(k.kid)) throw new Error(`duplicate kid ${k.kid}`);
    kids.add(k.kid);
    // not_after must be a calendar-valid RFC 3339 date-time (the discovery schema's date-time): Date.parse alone accepts Feb 31
    if (k.not_after !== undefined) {
      const d = new Date(k.not_after);
      if (typeof k.not_after !== "string" || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== k.not_after.slice(0, 10)) throw new Error(`key ${k.kid} not_after is not a calendar-valid date-time`);
    }
    const derived = createPublicKey(createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: k.d, x: k.x }, format: "jwk" })).export({ format: "jwk" });
    if (derived.crv !== "Ed25519" || derived.x !== k.x || Buffer.from(k.d, "base64url").length !== 32) throw new Error(`key ${k.kid} is not a consistent Ed25519 key pair`);
  }
  key = kf.keys.find((k) => k.kid === kf.active_kid);
  if (!key) throw new Error("active_kid is not in the keyring");
  keyring = kf.keys;
} catch (e) {
  die(`key file ${keyFile} is invalid (${e.message}); refusing to start`);
}
const adminToken = args["admin-token-file"] ? readFileSync(args["admin-token-file"], "utf8").trim() : die("--admin-token-file is required");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let build = "unknown";
try {
  const sha = execFileSync("git", ["-C", root, "rev-parse", "--short=12", "HEAD"]).toString().trim();
  const dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--", "reference-node", "lib"]).toString().trim() ? "+dirty" : "";
  build = `git:${sha}${dirty}`;
} catch {}
const deploymentId = `${new URL(baseUrl).hostname}-${new Date().toISOString()}`;

const node0 = createNode({ baseUrl, name: "Project Connect reference node", key, keyring, build, deploymentId, adminToken, revocationBoundS: Number(args.bound ?? 60), log: (m) => console.error(`[${new Date().toISOString()}] ${m}`) });
// the discovery document this node will publish is validated strictly against the frozen schema before it serves anything
// (R-CORE-39(a)); malformed key metadata stops startup (ASTRA-17)
{
  const { validate } = await import("../lib/schemas.mjs");
  const v = validate("discovery", node0.discovery());
  if (!v.ok) die(`discovery document invalid: ${v.errors.slice(0, 3).join("; ")}; refusing to start`);
}
const node = node0;
node.startPolling();
await serve({ port, host: args.host ?? "::", routes: node.routes, log: console.error });
console.error(`reference node ${baseUrl} (build ${build}, kid ${key.kid}) listening on ${port}`);
