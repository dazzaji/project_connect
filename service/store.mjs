// Durable job store: one private directory per job (0700) with job.json (atomic, fsynced) and events.jsonl (append, fsynced).
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { appendLine, atomicWriteJson, readJson } from "./util.mjs";

export const TERMINAL = ["succeeded", "failed", "cancelled", "interrupted", "timed_out"];

export function createStore(stateDir) {
  const jobsDir = join(stateDir, "jobs");
  mkdirSync(jobsDir, { recursive: true, mode: 0o700 });
  const dirOf = (id) => join(jobsDir, id);
  const get = (id) => (/^[0-9a-f-]{36}$/.test(id) && existsSync(join(dirOf(id), "job.json")) ? readJson(join(dirOf(id), "job.json")) : null);
  const save = (job) => atomicWriteJson(join(dirOf(job.id), "job.json"), job);
  const event = (job, type, detail = {}) => appendLine(join(dirOf(job.id), "events.jsonl"), JSON.stringify({ t: new Date().toISOString(), type, status: job.status, ...detail }));
  return {
    dirOf,
    get,
    list: () => readdirSync(jobsDir).map(get).filter(Boolean).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
    create(fields) {
      const id = randomUUID();
      mkdirSync(dirOf(id), { recursive: true, mode: 0o700 });
      const job = { id, status: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...fields };
      save(job);
      event(job, "created");
      return job;
    },
    update(job, patch, type = "updated", detail = {}) {
      // a terminal job is final: no field (status, reason, ports, timestamps) may change, not even to the same value.
      // Only an empty patch is accepted, and it appends a bookkeeping event without rewriting job.json.
      const persisted = get(job.id);
      if (persisted && TERMINAL.includes(persisted.status)) {
        const keys = Object.keys(patch);
        if (keys.length) throw new Error(`job ${job.id} is already ${persisted.status}; refusing to change ${keys.join(", ")}`);
        Object.assign(job, persisted);
        event(persisted, type, detail);
        return job;
      }
      Object.assign(job, patch, { updated_at: new Date().toISOString() });
      save(job);
      event(job, type, detail);
      return job;
    },
  };
}
