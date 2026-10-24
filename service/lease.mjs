// Single-service lease on a state directory.
// - First acquisition: the complete record is written to a private temp file and hard-linked into place (atomic; a
//   contender sees either no lease or a complete one).
// - A live holder (PID + birth + command + group all match) blocks a second service.
// - Reclaiming a stale lease is serialized by an exclusive guard file. Under the guard the lease is re-read and must still
//   be the same stale record (same inode and nonce) before it is moved aside. Two starters can therefore never both
//   reclaim. A leftover guard (a crash during reclaim) or an unreadable lease refuses startup with a recovery diagnostic;
//   it is never guessed stale.
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { pidMayBeAlive, processIdentity } from "./proc.mjs";

export class LeaseHeld extends Error {}

function writeExclusive(path, text) {
  const fd = openSync(path, "wx", 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
}
function readLease(path) {
  let text, st;
  try { st = statSync(path); text = readFileSync(path, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  try { return { rec: JSON.parse(text), ino: st.ino }; } catch { throw new LeaseHeld(`service lease ${path} is unreadable; refusing to start (inspect and remove it manually if no service is running)`); }
}

/** "live" when the recorded holder still matches, "unverifiable" when its identity cannot be read (e.g. `ps` failed) but a
 *  process with that pid may exist, otherwise "stale". A missing identity is never treated as proof that the holder died. */
function holderState(rec, identity) {
  if (!rec || !Number.isSafeInteger(rec.pid) || rec.pid <= 1) return "stale";
  const cur = identity(rec.pid);
  if (cur) return cur.birth === rec.birth && cur.command === rec.command && cur.pgid === rec.pgid ? "live" : "stale";
  return pidMayBeAlive(rec.pid) ? "unverifiable" : "stale";
}
function refuseIfHeld(rec, identity) {
  const state = holderState(rec, identity);
  if (state === "live") throw new LeaseHeld(`state directory is leased by live service pid ${rec.pid}`);
  if (state === "unverifiable") throw new LeaseHeld(`state directory lease holder pid ${rec.pid} may still be running but its identity cannot be verified; refusing to reclaim (check it is not a running service, then retry)`);
}

// `holderIdentity` exists so tests can simulate a failing identity lookup; production uses processIdentity.
export function acquireLease(stateDir, { holderIdentity = processIdentity } = {}) {
  const path = join(stateDir, "service.lease"), guard = join(stateDir, "service.lease.reclaim");
  const me = processIdentity(process.pid);
  if (!me) throw new Error("cannot determine this process's identity for the service lease");
  const rec = { ...me, nonce: randomBytes(12).toString("hex"), acquired_at: new Date().toISOString() };
  const tmp = join(stateDir, `.service.lease.${process.pid}.${rec.nonce}`);
  writeExclusive(tmp, JSON.stringify(rec) + "\n");
  const granted = () => ({ path, rec, release: () => releaseLease(path, rec.nonce) });
  try {
    try { linkSync(tmp, path); return granted(); } catch (e) { if (e.code !== "EEXIST") throw e; }
    const seen = readLease(path);
    if (!seen) { linkSync(tmp, path); return granted(); }
    refuseIfHeld(seen.rec, holderIdentity);
    // stale: reclaim under an exclusive guard, re-checking that it is still the same stale record
    try { writeExclusive(guard, JSON.stringify({ pid: process.pid, nonce: rec.nonce }) + "\n"); }
    catch (e) { if (e.code === "EEXIST") throw new LeaseHeld(`another service start is reclaiming the lease (or crashed doing so): remove ${guard} after checking no service is running`); throw e; }
    try {
      const again = readLease(path);
      if (again && (again.ino !== seen.ino || again.rec.nonce !== seen.rec.nonce)) throw new LeaseHeld("the service lease changed during reclaim; another service won");
      if (again) refuseIfHeld(again.rec, holderIdentity);
      if (again) renameSync(path, `${path}.stale-${Date.now()}-${randomBytes(4).toString("hex")}`);
      linkSync(tmp, path);
      return granted();
    } finally { try { unlinkSync(guard); } catch {} }
  } finally { try { unlinkSync(tmp); } catch {} }
}

function releaseLease(path, nonce) {
  try {
    if (!existsSync(path)) return;
    const held = JSON.parse(readFileSync(path, "utf8"));
    if (held.nonce === nonce) unlinkSync(path);
  } catch { /* leave it; a later start will judge it */ }
}
