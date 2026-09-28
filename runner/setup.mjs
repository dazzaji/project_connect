// SETUP ONLY (outside the black-box run): events, scoped credentials, local participants.
// Beta nodes are set up through their harness control API; reference nodes through their admin token.
import { http } from "./lib.mjs";

async function control(harness, path, body) {
  const r = await http("POST", `${harness}${path}`, { body });
  if (r.status !== 200) throw new Error(`harness ${path}: ${r.status} ${r.text.slice(0, 300)}`);
  return r.json;
}

export function adapter(node, { harness }) {
  const isRef = node.kind === "ref";
  return {
    ...node,
    async createEvent(spec) {
      const policy = { grant_ttl_s: spec.grant_ttl_s ?? 600, mandates_allowed: spec.mandates_allowed ?? null, grant_actions: spec.grant_actions ?? null, grant_exclusions: spec.grant_exclusions ?? null };
      if (isRef) {
        const r = await http("POST", `${node.base}/ilp/v1/admin/events`, { bearer: node.admin, body: { slug: spec.slug, title: spec.slug, visibility: spec.visibility ?? "federated", remote_participants: spec.remote_participants ?? "allowed", phase: spec.phase, ...Object.fromEntries(Object.entries(policy).filter(([, v]) => v !== null)) } });
        if (r.status !== 201) throw new Error(`ref event: ${r.text}`);
        return { id: r.json.id, global_id: r.json.global_id, slug: r.json.slug };
      }
      const e = await control(harness, "/setup/event", { node: node.name, slug: spec.slug, visibility: spec.visibility ?? "federated", remote_participants: spec.remote_participants ?? "allowed", registration_approval: spec.registration_approval ?? "operator", policy: Object.fromEntries(Object.entries(policy).filter(([, v]) => v !== null)) });
      return { id: e.id, global_id: e.global_id, slug: e.slug };
    },
    async credential(kind, eventId) {
      if (isRef) {
        const r = await http("POST", `${node.base}/ilp/v1/admin/credentials`, { bearer: node.admin, body: { kind, ...(eventId ? { event: eventId } : {}) } });
        if (r.status !== 201) throw new Error(`ref credential: ${r.text}`);
        return r.json.credential;
      }
      return (await control(harness, "/setup/credential", { node: node.name, kind, event: eventId })).credential;
    },
    async localParticipant(ev) {
      if (isRef) {
        const r = await http("POST", `${node.base}/ilp/v1/admin/events/${ev.id}/local-participants`, { bearer: node.admin, body: {} });
        return { participant_token: r.json.participant_token, human: r.json.human };
      }
      return control(harness, "/setup/local-participant", { node: node.name, slug: ev.slug });
    },
    async setPhase(ev, phase) {
      if (isRef) return http("POST", `${node.base}/ilp/v1/admin/events/${ev.id}/state`, { bearer: node.admin, body: { phase } });
      // Beta advances along its phase graph one step at a time (e.g. proposing → voting); the target phase is checked by the caller
      return control(harness, "/setup/phase", { node: node.name, slug: ev.slug, body: {} });
    },
    async close(ev) {
      if (isRef) return http("POST", `${node.base}/ilp/v1/admin/events/${ev.id}/state`, { bearer: node.admin, body: { status: "closed" } });
      return control(harness, "/setup/close", { node: node.name, slug: ev.slug });
    },
    async stop() {
      if (isRef) return node.stop();
      return control(harness, "/ops/stop", { node: node.name });
    },
    async start() {
      if (isRef) throw new Error("reference nodes are restarted by the runner");
      return control(harness, "/ops/start", { node: node.name });
    },
  };
}
