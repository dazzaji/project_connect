# T-ID — Identity

env: single. Mailbox capture required.

---

**T-ID-1 — OTP login happy path** · traces: R-ID-5, R-ID-6, C1
POST login {email}; read email. Expect: exactly one email; body contains an 8-digit
code **as text**; contains NO clickable verification link. POST verify {email,code}
→ 200, session cookie set (HttpOnly, Secure, SameSite=Lax) + CSRF cookie. GET
/auth/me → human created, email matches.

**T-ID-2 — OTP hardening** · traces: R-ID-6, R-SEC-1
(a) reuse the consumed code → 401. (b) expired code (fixture clock or 15-min wait
mode) → 401 `AUTH_EXPIRED`-family code. (c) 7 wrong attempts → `RATE_LIMITED`
before/at the documented threshold. (d) login for unknown vs known email → byte-
identical response shape/time-class (no enumeration).

**T-ID-3 — Session lifecycle** · traces: R-ID-7
Session works; logout revokes (next call 401); a second login yields a distinct
session; server-side revocation (admin) kills a live session.

**T-ID-4 — CSRF enforcement** · traces: R-SEC-2
Browser-style mutation (register agent) without CSRF header → 403; with mismatched
Origin → 403; correct double-submit → 200.

**T-ID-5 — Agent + plate issuance** · traces: R-ID-11
h1 registers agent "ada-helper". Expect: plate matches `IL-[A-Z2-9]{8}`; second
identical registration is idempotent (same plate, no orphan). GET plate → resolves
agent + owning human + verification status (P4 chain).

**T-ID-6 — Plate immutability** · traces: R-ID-11, R-ID-12, C5
Attempt: reassign plate to another agent/human via any exposed mutation → none
exists (404/405). Retire agent → plate `retired`, still resolvable with history.

**T-ID-7 — Verification with provenance** · traces: R-ID-9, R-ID-10
Admin verifies h1 (method `workshop_in_person`, note). Expect: /auth/me + plate
lookups show verified + method; verification record immutable; revoke → new record,
history lists both; non-admin attempting verification → 403.

**T-ID-8 — Memberships as sole authz** · traces: R-ID-3, R-ID-4, R-SEC-8
Grant h2 operator role on e1's cohort → h2 can fire operator endpoints on e1 only
(not e2). Remove membership → immediate 403. No profile-text field influences any
authz decision (probe: set org free-text on profile → no change).

**T-ID-9 — Consent records** · traces: R-ID-14, R-EV-21
On a consent-required event, first action without acceptance → 409
`CONSENT_REQUIRED` with text ref; accept (records version+sha256); action passes;
acceptance is write-once (duplicate accept idempotent); stored sha256 equals
sha256 of the served consent text.

**T-ID-10 — Identity audit** · traces: R-ID-15, R-DATA-2
After T-ID-1..9, admin lists audit events. Expect: login, agent_registered,
plate_issued, verification set+revoked, membership grant/revoke, consent accepted
all present with actor/subject/correlation; no UPDATE/DELETE path exposed.

**T-ID-11 — Claim minting** · traces: R-ID-17, R-ID-18
h1 (verified) mints a claim for a (fixture) audience host + event. Expect: EdDSA
JWT verifiable against instance discovery keys; payload fields per spec; exp ≤24h;
second mint → new jti. Unverified h3 minting: allowed, `verified:false` in claim
(host decides), OR instance policy rejects — either way documented behavior
asserted.

**T-ID-12 — Token self-inspection** · traces: R-ID-13
GET /auth/token with k1 → scope (event, human, agent, plate), expires_at; after
human revokes it in /account → `AUTH_REVOKED` on next use.
