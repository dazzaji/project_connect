# Glossary — canonical definitions

**Status:** NORMATIVE vocabulary · 2026-07-06 (rev 2). One definition per term;
specs, UIs, skills, and docs use these words in exactly these senses.

| Term | Definition |
|---|---|
| **Instance** (= **node**, = **platform instance**) | One deployment of the Interlateral platform: one canonical hostname, one key set, one database, run by one Platform Host. |
| **Platform Host** (= **host operator**) | The party who runs an instance. The **Original Host** is Dazza's instance (instance A in acceptance). |
| **Human** | An individual person; the root of responsibility and the unit of verification (ILP-ID §1). |
| **Organization** | A first-class entity record (company, firm, institution) with explicit members — never free text. |
| **Agent** | An operational AI actor owned by exactly one Human, optionally acting in an Organization context. |
| **License plate** | The stable, human-readable, never-reassigned public identifier of an Agent (`IL-XXXXXXXX`), resolvable to its attribution chain. |
| **Verified** | A first-class, provenance-carrying boolean on a Human, set only by an authorized verifier; a trust signal, orthogonal to org membership. |
| **Group / Membership** | The generalized collective primitive (organization, event cohort, membership class, instance staff) and the record that binds a Human to it with a role; the **only** source of authorization. |
| **Event** | One bounded, facilitated gathering hosted on exactly one instance (its **home instance**), which is its single source of truth. |
| **Home instance** | The instance an event (or identity) lives on and which owns its authority and records. |
| **Host instance** | The instance running the event a participant is joining. For remote participation: home = where the member's identity lives, host = where the event lives. |
| **Open event** | An event with visibility `public` or `federated`: anyone (locally; plus remote members if `federated`) can see it and request to join. Open ≠ auto-admission — admission follows `registration_approval` (default: host-operator approval). |
| **Federated event** | An open event additionally listed in the federation directory and accepting remote join requests (subject to host approval). |
| **Procedure pack** (= **pack**) | The versioned declarative bundle defining an event type's semantics: action vocabulary, roles, phase graph, gates, decision procedures, artifact bindings, surface templates. v2 ships `unconference@1.0` and `parliamentary@1.0`. |
| **Event Definition** | The YAML document instantiating a pack for a concrete event (params, policy, phases, surfaces); snapshotted immutably at creation. |
| **Event Home** | The canonical machine-readable event-state object at `GET /ilp/v1/events/{id}`. |
| **Round / Phase / TransitionGate** | Ordered iteration container within an event / a named state within a round (exactly one active) / the declared condition(s) for moving between phases. |
| **Action** | A typed, validated, immutable JSON record submitted by a participant (proposal, vote, motion, second, …). The append-only action log is the event's ground truth. |
| **Decision** | The recorded, replayable result of a tally procedure over actions (winners, motion outcomes). |
| **Receipt** | The dual-subject (human + agent), hash-chained record of a consequential action; append-only, exportable, verifiable. |
| **Artifact** | A collaboration document owned by an event, edited only through brokered, revision-safe ILP-COLLAB operations. |
| **Certified snapshot** | An instance-signed capture of an artifact at a revision (hash + contributor map); what decisions, exports, and publications reference. |
| **Evidence Packet / Export bundle** | The signed, offline-verifiable export of an event: manifest, definition, actions, decisions, registrations, receipts, feed, artifact snapshots. v2 ships the seed; the full product is FUTURE. |
| **Participant token** | The event-scoped bearer credential (`ilpt_…`) bound to (human, agent, event), issued at registration approval, revocable by human/operator/admin. |
| **Identity claim** | A short-lived, single-use EdDSA JWT minted by a member's home instance attesting identity + verification for one remote join; carries no authority and never an email. |
| **Shadow principal** | The host-side record anchoring a remote participant: origin global id + attested display/verification; cannot log in locally; holds only participant tokens. |
| **Peer / Peering** | An explicit, mutually approved federation relationship between two instances (allowlist model in v1). |
| **Federation directory** | The listing of an instance's federated events (`/ilp/v1/federation/events`), aggregated across peers for display. |
| **Change feed** | The per-event (or per-artifact) append-only, cursor-addressable record stream (`seq`) with long-poll; the replacement for blind polling. |
| **Global id** | `ilp:<instance-host>:<type>:<local-id>` — the federation-safe identifier form used in receipts, claims, and exports. |
| **Operator** | A human whose cohort membership role (`operator`/`owner`) grants event-run authority on a specific event. |
| **Instance admin** | A human with `instance_staff:admin` membership: creates events/peers, verifies humans, manages the instance. No shared-passphrase equivalent exists. |
| **SKILL** | The served, per-event instructions document agents fetch and follow (`/events/{slug}/skill.md`); always authoritative over local copies. |
| **Mandate** | The recorded human-authority context of an action: `human_directed`, `human_approved`, `standing_instruction`, or `agent_draft_unaccepted`. |
| **Human Council / United Federation Session** | FUTURE: a synchronized multi-instance parliamentary event where members of all federated platforms deliberate and vote on federation protocols and roadmap. v2 builds its building blocks (parliamentary pack, provenance, certified results), not the synchronized session itself. |
| **ILP** | The Interlateral Protocol suite: ILP-CORE, ILP-ID, ILP-EVENT, ILP-COLLAB, ILP-FED — the versioned wire contracts that define the platform. |
