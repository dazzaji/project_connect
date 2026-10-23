// Small durable-storage and hashing helpers for the Connect job service.
import { createHash, timingSafeEqual } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalize } from "../lib/jcs.mjs";

export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
export const jcsSha256 = (value) => sha256Hex(Buffer.from(canonicalize(value), "utf8"));

export function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), "hex"), y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function fsyncDir(dir) {
  try { const fd = openSync(dir, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } } catch { /* some platforms cannot fsync a directory */ }
}

/** Write bytes atomically and durably: temp file (exclusive) → fsync → rename → fsync directory. */
export function atomicWrite(path, data, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const fd = openSync(tmp, "wx", mode);
  try { writeSync(fd, typeof data === "string" ? data : Buffer.from(data)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}
export const atomicWriteJson = (path, value, mode) => atomicWrite(path, JSON.stringify(value, null, 2) + "\n", mode);

/** Append one line durably. */
export function appendLine(path, line) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "a", 0o600);
  try { writeSync(fd, line.endsWith("\n") ? line : line + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
