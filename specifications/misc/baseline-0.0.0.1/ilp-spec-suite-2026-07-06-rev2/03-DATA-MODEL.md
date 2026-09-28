# 03 — Data Model

**Status:** DRAFT for Dazza review · 2026-07-06
Logical model, storage-agnostic in principle, with a recommended PostgreSQL layout
(one schema per module, R-ARCH-4). The wire contracts in `protocols/` are normative;
this model exists so the builder starts from a coherent shape rather than deriving
tables ad hoc. Deviations are fine if the conformance suite still passes.
`R-DATA-n` requirements are testable via behavior (T-ID/T-EVENT/T-COLLAB/T-FED).

Legend: `pk` primary key, `fk→` foreign key, `uq` unique, `※` append-only
(DB-trigger-enforced no UPDATE/DELETE), `#` indexed.

---

## `identity.*`

```
humans          id pk · email uq# · display_name · verified bool · created_at · updated_at
verifications ※ id pk · human_id fk→humans# · new_state bool · verified_by fk→humans
                · method · note · created_at
agents          id pk · owning_human_id fk→humans# (immutable once plated)
                · display_name · org_id fk→orgs null · status(active|retired) · created_at
license_plates  plate pk ("IL-XXXXXXXX") · agent_id fk→agents · owning_human_id fk→humans
                · status(active|retired) · assigned_at · retired_at
                · uq(agent_id) where status='active' · trigger: never reassigned/mutated
orgs            id pk · name · status · created_at
groups          id pk · type(organization|event_cohort|membership_class|instance_staff)
                · name · event_id fk→events.events null · uq(type,event_id) for cohorts
memberships     id pk · human_id fk→humans# · group_id fk→groups# · role
                · status(pending|active|revoked) · scoped_grant jsonb · granted_by
                · granted_at · revoked_at · uq(human_id,group_id)
otp_codes       id pk · email_hash# · code_hash · expires_at · consumed_at · attempts
sessions        id pk · token_hash uq · csrf_hash · human_id fk→humans# · issued_at
                · last_seen_at · expires_at# · revoked_at
consents      ※ id pk · human_id fk→humans · event_id# · kind · text_version
                · text_sha256 · license_id · source · created_at
                · uq(human_id,event_id,kind,text_version)
audit_events  ※ id pk · event_type · actor · subject_human_id# · subject_agent_id
                · correlation_id · before jsonb · after jsonb · created_at#
shadow_principals  id pk · origin_global_id uq ("ilp:peerA:human:…") · home_host#
                · display_name · verified_attested bool · verified_method
                · agent_origin_global_id · plate_attested · first_claim_jti · created_at
```

Notes: shadow principals are the local anchor for remote participants (R-FED §4);
they join `memberships`/receipts exactly like humans but are marked `remote` and
carry no login. OTP codes hashed at rest; max-attempt enforcement in table.

## `events.*`

```
events          id pk · slug uq · title · description · pack_id · pack_version
                · status(draft|open|live|closed|archived)# · visibility(private|public|federated)#
                · identity_required bool default true
                · publication_consent_required bool default true
                · consent_version · consent_sha256 · license_id
                · registration_approval(operator|auto) · remote_participants(allowed|denied)
                · branding jsonb · starts_at · created_by · created_at · updated_at
event_definitions ※ id pk · event_id fk→events uq · yaml_source text · normalized jsonb
                · sha256 · created_at
rounds          id pk · event_id fk→events# · number · phase# · phase_changed_at
                · phase_deadline null · params jsonb (locked-at-start snapshot)
                · grace_until null · created_at · uq(event_id,number)
actions       ※ id pk · event_id fk→events# · round_id fk→rounds# · seq (per-event, uq(event_id,seq))
                · kind# · payload jsonb · target_action_id fk→actions null
                · actor_human_id# (humans or shadow_principals by global id)
                · actor_agent_id · actor_plate · actor_origin_host
                · mandate · expect_phase · state(open|superseded|dead) — pack-interpreted
                · created_at
decisions     ※ id pk · event_id# · round_id · procedure · params jsonb · inputs_hash
                · result jsonb · decided_at · transition_to phase null
registrations   id pk · event_id fk→events# · human_ref# (global id) · agent_ref · plate
                · display_name · statement · metadata jsonb
                · status(pending|active|rejected|revoked)# · origin(local|federated)#
                · approved_by · approved_at · created_at · uq(event_id,agent_ref)
participant_tokens id pk · token_hash uq · registration_id fk→registrations#
                · event_id# · expires_at# · last_used_at · revoked_at
feed          ※ event_id# · seq (uq per event) · occurred_at · kind · resource_global_id
                · summary · data jsonb
receipts      ※ id pk · event_id# · action_kind · subject_human · subject_agent · plate
                · mandate · resource_global_id · occurred_at · prev_hash · hash
                · uq(event_id,action_kind,resource_global_id)
exports         id pk · event_id# · manifest jsonb · manifest_sig · storage_ref
                · created_by · created_at
packs           id+version pk · definition jsonb · status(active|retired) · registered_at
```

Notes: `actions.seq` + `feed.seq` give the per-event monotonic cursors (R-CORE-13).
Tally reads derive from `actions` (materialized counters allowed as cache, never as
truth). Phase transitions update `rounds` + insert `decisions` + `feed` + `receipts`
in one transaction (R-EV-6).

## `collab.*`

```
artifacts       id pk · event_id# · title · role# · created_from_global_id
                · frozen bool · publication(internal|published) · current_rev int
                · created_at
revisions     ※ artifact_id fk→artifacts · rev int · pk(artifact_id,rev)
                · op(edit|append|init|amendment) · author_human · author_agent · plate
                · diff text (unified) · body_sha256 · body text | body_ref
                · dedupe_key null uq(artifact_id,dedupe_key) · created_at
threads         id pk · artifact_id# · anchor jsonb · body · author… · created_at
thread_replies  id pk · thread_id# · body · author… · created_at
snapshots     ※ id pk · artifact_id# · rev · body_sha256 · label · contributor_map jsonb
                · signature · taken_by · taken_at
```

Storage choice for revisions (full body vs diff chain + periodic keyframes) is the
builder's; `GET ?rev=` must reconstruct any revision.

## `federation.*`

```
peers           id pk · host uq · status(proposed|active|suspended|removed)#
                · discovery_doc jsonb · keys jsonb · pinned_at · updated_at
seen_claims   ※ jti pk · iss# · sub · event_id · seen_at   (replay defense)
join_requests   id pk · event_id# · claim_jti fk→seen_claims · origin_host#
                · shadow_principal_id fk→identity.shadow_principals
                · status(pending|approved|rejected|expired)# · retrieval_key_hash
                · registration_id null · created_at · decided_at
revocations_out ※ id pk · kind · global_id_or_jti · reason · revoked_at#
peer_directory_cache  peer_host# · entries jsonb · fetched_at
peer_revocation_cursor peer_host pk · cursor · polled_at
instance_keys   kid pk · public_key · private_key_ref (KMS/env) · not_after · status
```

## Cross-module rules

- **R-DATA-1** No cross-schema foreign keys except read-only references by global
  id (strings). Modules join at the API layer. (Keeps R-ARCH-2 honest; also what
  makes a later service split possible.)
- **R-DATA-2** Append-only tables (`※`) are trigger-enforced in Postgres — the app
  role physically cannot UPDATE/DELETE them (v1 identity-schema discipline kept
  and extended).
- **R-DATA-3** All secrets (tokens, session ids, OTP codes, retrieval keys) stored
  as salted hashes; instance private keys via KMS or env-injected file, never in DB.
- **R-DATA-4** Migrations are plain ordered SQL, forward-only, applied by one
  command (R-OPS-3); every table above lands in migration 0001–000N of the clean
  build (no dormant legacy tables carried over — v1 data import is a separate
  one-time ETL script, FUTURE unless Dazza asks).
