# ILP-ID — Identity, Access, and Attribution

**Status:** DRAFT for Dazza review · 2026-07-06 · Inherits ILP-CORE.
Carries forward `roadmap/IDENTITY.md` (canonical v1 model) and the deployed
Identity v0 semantics, with the Supabase-Auth dependency removed (C9).
Requirement IDs: `R-ID-n`. Tests: `tests/T-ID.md`.

---

## 1. Principals

Three principal types (P4): **Human**, **Organization**, **Agent**.

- **R-ID-1** A Human is the root of responsibility and the unit of verification.
  Every Agent has exactly one owning Human; an Agent MAY carry an Organization
  context. Organizations are first-class records, never free text.
- **R-ID-2** Groups generalize collectives: `type ∈ {organization, event_cohort,
  membership_class, instance_staff}` with Memberships
  `(human, group, role, status ∈ {pending, active, revoked}, scoped_grant?,
  granted_by, granted_at, revoked_at)`. Exactly one `event_cohort` group per event.
- **R-ID-3** **All authorization derives from membership/role records** (C5). Roles
  in v2: cohort roles `participant | operator | owner`; instance_staff roles
  `admin`. Procedure packs may define additional event roles (e.g. `chair`,
  `clerk`) recorded as membership metadata on the cohort.
- **R-ID-4** Instance administration (create events, manage peers, verify humans) is
  authorized by `instance_staff:admin` membership — no environment-variable
  passphrase (R-CORE-19). The first admin is created by a one-time bootstrap command
  on the server (documented, audited).

## 2. Human login — email OTP

- **R-ID-5** Login is: `POST /ilp/v1/auth/login {email}` → the instance emails an
  **8-digit one-time code** (never a magic link — C1; both new and returning users
  get a code). `POST /ilp/v1/auth/verify {email, code}` → sets an opaque
  `il_session` cookie (HttpOnly, Secure, SameSite=Lax) + a readable CSRF cookie for
  double-submit on browser mutations.
- **R-ID-6** OTP rules: code valid 15 minutes, single-use, ≥ 6 attempts per email per
  5 minutes rejected (`RATE_LIMITED`), responses never reveal whether an email is
  registered. First successful verify creates the Human record (email-anchored).
- **R-ID-7** Sessions: 7-day sliding TTL, server-side revocable, hash-at-rest,
  `POST /ilp/v1/auth/logout` revokes. `GET /ilp/v1/auth/me` returns the human's
  profile, memberships, agents, and verification status.
- **R-ID-8** Email delivery goes through the notifier adapter (SMTP or API
  provider); OTP templates are instance-branded and MUST render the code as text.
  A failed provider MUST surface a retriable error to the user, not silence.
- Social login / SSO are FUTURE (ID-1B/ID-9); the model reserves
  `humans.auth_providers[]` for them but v2 ships email-OTP only.

## 3. Verification

- **R-ID-9** `verified` is a first-class boolean on Human, default false, changed
  only by an authorized verifier (instance admin, or a human holding a
  `verifier` scoped grant). Every change writes a verification record with
  provenance: `verified_by`, `verified_at`, `verified_method` (open enum:
  `workshop_in_person | linkedin_group | partner_attestation | …`), `verified_note`,
  plus an audit event. History is never deleted.
- **R-ID-10** Verification is orthogonal to org membership and is a **trust signal**
  surfaced everywhere the human or their agents appear (green check + resolvable
  provenance). Unverified humans may participate where the event allows it.

## 4. Agents and license plates

- **R-ID-11** Agents are registered by their owning human:
  `POST /ilp/v1/agents {display_name}` (session + CSRF) → creates the Agent and
  issues a **license plate** `IL-XXXXXXXX` (8 chars, A–Z/2–9, no reassignment ever;
  retirement keeps history resolvable). One active plate per agent; the
  (agent → human) link is immutable once a plate exists.
- **R-ID-12** `GET /ilp/v1/plates/{plate}` is public and resolves to: agent, owning
  human (display + verification status), org context, memberships, status — the
  attribution chain (P4 §5). This endpoint also resolves **retired** plates.
- **R-ID-13** Agent capability tokens are **event-scoped participant tokens**
  (`ilpt_…`), issued per ILP-EVENT registration, bound to (human, agent, event),
  with expiry ≤ event end + 72h, revocable by the human, the operator, or the
  instance admin. Token metadata (`expires_at`, scope) is readable by its bearer at
  `GET /ilp/v1/auth/token` — token lifecycle is in-band, with `AUTH_EXPIRED` /
  `AUTH_REVOKED` codes on use. *[Murch #4.]*

## 5. Consent records

- **R-ID-14** Consent (e.g. publication consent) is captured as an immutable
  acceptance record: `(human, event, consent_kind, text_version, text_sha256,
  license_id, source, accepted_at)`, write-once per (human, event, kind, version).
  Enforcement (which actions require which consents) is defined by the event
  (ILP-EVENT §7); ILP-ID only stores and attests acceptances.

## 6. Audit

- **R-ID-15** Append-only identity audit events (DB-enforced no UPDATE/DELETE) for:
  login, session revoke, agent registered, plate issued/retired, verification
  set/revoked, group created, membership granted/role-changed/revoked, scoped grant
  issued/revoked, consent accepted, admin bootstrap, break-glass elevation.
  Each carries actor, subject ids, correlation id, before/after JSON.
- **R-ID-16** Break-glass elevation (emergency authority) MUST be explicit,
  time-bounded, dual-logged (audit event + receipt), and visible in the operator UI.

## 7. Portable identity claims (federation surface)

The federation-facing part of identity; transport in ILP-FED.

- **R-ID-17** A home instance can mint an **Identity Claim** for one of its humans
  (and optionally one of that human's agents): an EdDSA JWT, JCS-canonical payload:

```json
{
  "iss": "https://home.example",
  "kid": "2026-07-a",
  "sub": "ilp:home.example:human:<uuid>",
  "aud": "https://host.example",
  "exp": "<now + ≤24h>", "iat": "...", "jti": "<uuid>",
  "display_name": "Ada L.",
  "verified": true,
  "verified_method": "workshop_in_person",
  "agent": { "id": "ilp:home.example:agent:<uuid>",
             "display_name": "ada-helper", "license_plate": "IL-7Q3K2M9P" } ,
  "purpose": "event_join",
  "event": "ilp:host.example:event:<uuid>"
}
```

- **R-ID-18** Claims attest identity + verification only — they carry **no
  authority** on the host (admission is always the host's decision, P10/C7).
  Single-use (`jti` replay-rejected by the host), audience-bound, ≤ 24h.
- **R-ID-19** The home instance MUST expose claim revocation checks (ILP-FED
  `revocations` endpoint); hosts MUST check at join time and MAY re-check
  periodically. Revocation of the underlying human/agent at home revokes the claim.

## 8. Endpoint summary

| Method+Path | Auth | Purpose |
|---|---|---|
| POST `/ilp/v1/auth/login` | public | send OTP code |
| POST `/ilp/v1/auth/verify` | public | verify code → session |
| POST `/ilp/v1/auth/logout` | session+CSRF | revoke session |
| GET `/ilp/v1/auth/me` | session | current human |
| GET `/ilp/v1/auth/token` | participant token | token self-inspection |
| POST `/ilp/v1/agents` | session+CSRF | register agent + plate |
| GET `/ilp/v1/agents/{id}` | public | agent profile |
| GET `/ilp/v1/plates/{plate}` | public | attribution chain lookup |
| POST `/ilp/v1/humans/{id}/verification` | admin/verifier | set/revoke verified |
| GET `/ilp/v1/orgs` / POST … | admin | organization CRUD (minimal v2) |
| POST `/ilp/v1/claims` | session+CSRF | mint identity claim for a remote join |
| GET `/ilp/v1/audit` | admin | audit event listing (cursor) |

## 9. Explicitly carried v1 lessons

1. OTP code, never magic link (scanner prefetch) — C1.
2. Session cookies + exact-origin CSRF double-submit (v1 `identity.js` pattern).
3. License plates trigger-enforced never-reassigned (v1 invariant kept).
4. Cohort membership state machine pending→active→revoked kept, but approval is an
   engine registration concern (ILP-EVENT) that *activates* the membership.
5. Dual-subject receipts generalized to all consequential actions (R-CORE-22).
6. No dependence on an external auth provider's user table — the Human record is
   local; email is the anchor; federation uses claims, not shared auth.
