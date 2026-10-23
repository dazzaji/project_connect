// Process identity: a PID alone can be reused, so a recorded process is identified by PID + start time ("birth") +
// command line + process group. Signals are sent only when all four still match.
import { execFileSync } from "node:child_process";

export function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  let out;
  try {
    out = execFileSync("ps", ["-o", "pgid=", "-o", "lstart=", "-o", "command=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
  const m = /^(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/.exec(out);
  if (!m) return null;
  return { pid, pgid: Number(m[1]), birth: m[2].replace(/\s+/g, " "), command: m[3] };
}

export function sameProcess(rec) {
  if (!rec || !Number.isSafeInteger(rec.pid)) return false;
  const cur = processIdentity(rec.pid);
  return !!cur && cur.birth === rec.birth && cur.command === rec.command && cur.pgid === rec.pgid;
}

/** Signal the recorded process group only if the recorded leader is still the same process and leads that group. */
export function signalRecordedGroup(rec, signal) {
  if (!sameProcess(rec) || rec.pgid !== rec.pid) return false;
  try { process.kill(-rec.pgid, signal); return true; } catch { return false; }
}

/** True if a process with this pid may exist (signal 0 succeeds, or is refused with EPERM). Used only to fail closed when
 *  the identity cannot be read; it never authorizes a signal. */
export function pidMayBeAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/** True if any process remains in the group (best effort, used after kills). */
export function groupAlive(pgid) {
  if (!Number.isSafeInteger(pgid) || pgid <= 1) return false;
  try { process.kill(-pgid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}
