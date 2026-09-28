#!/usr/bin/env node
// usage: node reference-node/main.mjs --base-url http://pc-ref.localhost:4190 --port 4190 --key-file <path> --admin-token-file <path> [--dev] [--bound 60]
// Keys fail closed (R-CORE-34(b)): a missing or invalid key file stops startup unless --dev, which may create one but never overwrite.
import { execFileSync } from "node:child_process";
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
try {
  const kf = JSON.parse(readFileSync(keyFile, "utf8"));
  key = kf.keys.find((k) => k.kid === kf.active_kid);
  if (!key?.d || !key?.x || key.crv !== "Ed25519") throw new Error("no valid active Ed25519 key");
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

const node = createNode({ baseUrl, name: "Project Connect reference node", key, build, deploymentId, adminToken, revocationBoundS: Number(args.bound ?? 60), log: (m) => console.error(`[${new Date().toISOString()}] ${m}`) });
node.startPolling();
await serve({ port, host: args.host ?? "::", routes: node.routes, log: console.error });
console.error(`reference node ${baseUrl} (build ${build}, kid ${key.kid}) listening on ${port}`);
