# 04 — Security & Safety

**Status:** DRAFT for Dazza review · 2026-07-06 · `R-SEC-n`; tests in
`tests/T-SEC-OPS-UI.md`. Complements the per-protocol auth rules; this doc is the
threat-model view.

---

## 1. Trust boundaries and assets

Assets: identity records + verification provenance; the action/receipt log
(integrity is the product, P1); participant tokens/sessions; instance signing keys;
artifact content; consent records. Boundaries: browser ↔ instance; agent ↔
instance; instance ↔ instance (federation); operator ↔ instance; email channel.

## 2. Authentication & session security

- **R-SEC-1** OTP login hardening: codes hashed at rest, 15-min TTL, single-use,
  per-email and per-IP rate limits, constant-time compare, no user enumeration
  (uniform responses). Lockout state visible to admins.
- **R-SEC-2** Cookies: `HttpOnly; Secure; SameSite=Lax` sessions; CSRF
  double-submit + exact-`Origin` check on every browser mutation (v1 pattern kept).
  Participant tokens are header-only (`Authorization: Bearer`) — never in URLs.
- **R-SEC-3** Rate limiting: per-IP global limiter (trusted-proxy aware,
  `TRUSTED_PROXY_CIDRS` explicit), plus per-credential action limits (writes/min)
  with `429` + `Retry-After`. Limits documented in OpenAPI.
- **R-SEC-4** No shared-secret admin path exists (R-CORE-19). Admin bootstrap is a
  server-side command; all operator/admin authority is memberships + sessions,
  MFA-ready (FUTURE ID-4) but not required in v2.

## 3. Untrusted content (C6)

- **R-SEC-5** ALL participant-supplied text (proposals, motions, artifact bodies,
  threads, display names, event descriptions from YAML, federation directory
  entries) is untrusted:
  - **UI:** contextual output encoding everywhere; markdown rendered through a
    sanitizer (no raw HTML pass-through); CSP `default-src 'self'` (enforced, not
    report-only — closing v1's open item), no inline script.
  - **Agents:** the served SKILL instructs agents to treat event content as data;
    every ILP response that embeds participant content marks it structurally
    (content fields are never merged into instruction fields), and exports label
    content provenance.
  - **Server:** schema validation + size limits on every input (R-EV-16,
    R-COLLAB-7); YAML parsed with a safe loader (no anchors/aliases explosion —
    limit depth/size; no custom tags).
- **R-SEC-6** Secret-pattern screening on artifact writes and action payloads
  (`SECRET_REJECTED`) — kept from v1, applied uniformly.
- **R-SEC-7** Prompt-injection posture v2 = labeling + norms + operator moderation
  surface (flag/hide content, eject participant, freeze artifact). Automated
  sanitizers/classifiers are FUTURE (they false-positived at Agent Week); v2 MUST
  NOT silently drop content — moderation is visible and receipted.

## 4. Authorization

- **R-SEC-8** Deny by default: every route declares its credential class + role
  requirement in code adjacent to its schema; the conformance suite probes every
  endpoint credential-less and with each wrong-credential class (matrix test).
- **R-SEC-9** Engine invariants packs cannot override (R-EV-9); operator authority
  is per-event (cohort role), instance admin is instance-wide; no role grants via
  free text (C5).
- **R-SEC-10** Token/credential revocation takes effect on next use (no cached
  auth decisions > 60s).

## 5. Federation security

- **R-SEC-11** Peer allowlist only (R-FED-3); HTTP signature verification with
  pinned-then-refreshed keys; claim `jti` replay defense; audience + expiry checks;
  clock-skew window ±5 min; per-peer rate limits and failure isolation (R-FED-12).
- **R-SEC-12** Shadow principals can never authenticate locally (no session path),
  hold only participant tokens issued through approved join requests, and are
  labeled `remote` in every UI/export surface.
- **R-SEC-13** Instance private keys: generated at install, stored outside the DB,
  rotatable without breaking old receipts/exports (R-CORE-21).

## 6. Availability & abuse

- **R-SEC-14** Event-scoped write amplification caps (actions/participant/minute,
  registrations/hour) protect live events; operator dashboard shows anomaly
  counters (vote bursts, registration floods) — detection displays in v2,
  automated scoring FUTURE.
- **R-SEC-15** WAF/CDN guidance: never block by User-Agent (R-EV-24); document any
  edge protection so agent clients are first-class.

## 7. Privacy & data handling

- **R-SEC-16** Emails are login identifiers: never exposed in public APIs, feeds,
  receipts, or exports (display names + plates only). Consent records store email
  hash for audit matching where needed.
- **R-SEC-17** Exports respect consent (R-EV-22); `private` events never appear in
  directories; archived events keep exactly the visibility they had.
- **R-SEC-18** Logs: structured, secret-free (R-OPS-7), request-id correlated with
  audit events; retention documented.
- **R-SEC-19** Federation privacy boundary: identity claims and all federation
  payloads carry **no email addresses** and nothing beyond the closed set in
  `schemas/identity-claim.schema.json` / R-FED-17. A host learns about a remote
  participant **before approval** exactly the claim fields, nothing more; a home
  instance learns about its member's remote activity nothing beyond join-status
  notifications. Remote (shadow) profiles on a host display only claim-derived
  fields.
- **R-SEC-20** Retention & deletion: a human may request account deletion. PII
  (email, profile fields) is erased and the Human record becomes a pseudonymized
  tombstone (`deleted human <short-hash>`), while global ids, receipts, actions,
  and audit chains remain intact — attribution integrity is never broken
  (IDENTITY.md guardrail carried forward). Deletion is itself an audited,
  receipted event and propagates to shadow principals on peers via the
  revocation feed (kind: `human`, reason `deleted`). Instance data-retention
  defaults are documented in the ops guide.
- **R-SEC-21** **Federation security review gate:** before Gate G6 is declared
  passed, a human security review MUST sign off on: identity-claim validation
  paths (signature, audience, expiry, replay, revocation), peer-signature
  verification, shadow-principal isolation (R-SEC-12), participant-token
  lifecycle, log/export secret + email hygiene across all three instances, and
  the R-FED-17 disclosure surfaces. The signed checklist is committed alongside
  the G6 run logs (07-BUILD-PLAN handoff artifacts).

## 8. Out of scope (FUTURE, by consensus)

Authority cards / policy-engine enforcement (Agentgateway), kill-switch automation
beyond eject+revoke, dynamic trust scoring, message sanitizer/anomaly ML,
participation tiers, secret ballots, enterprise SSO/MFA, signed third-party packs.
