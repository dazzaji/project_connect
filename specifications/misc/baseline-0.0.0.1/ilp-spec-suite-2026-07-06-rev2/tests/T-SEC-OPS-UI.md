# T-SEC-OPS-UI — Security, Operations, UI

env: single unless noted.

## Security

**T-SEC-1 — Auth matrix sweep** · traces: R-SEC-8
Generated from OpenAPI: call EVERY endpoint with (none, participant token, human
session, operator session, admin session, peer signature) × (right/wrong scope).
Expect: responses match the declared credential class exactly; zero endpoints
accept a weaker credential than declared; zero 5xx.

**T-SEC-2 — XSS/injection corpus** · traces: R-SEC-5
Submit a corpus (`<script>`, `<img onerror>`, markdown HTML passthrough, event
YAML description payloads, display names with control chars, federation directory
entry with hostile strings) via every text input; crawl rendered pages (headless)
→ no script execution, CSP header present + enforced (violation on injected
inline), content displayed escaped. YAML bombs (deep alias/anchor, 10MB doc) →
rejected by limits, no hang.

**T-SEC-3 — Secrets never leak** · traces: R-CORE-18, R-OPS-7, R-SEC-16
Grep full API response corpus + export bundles + (CI) log output for: OTP codes,
`ilpt_` tokens, session ids, key material, raw emails in public surfaces →
zero hits (emails allowed only in the owner's own /auth/me + admin surfaces).

**T-SEC-4 — Rate limits** · traces: R-SEC-1, R-SEC-3, R-SEC-14
OTP brute-force blocked per T-ID-2; burst 100 writes on one token → 429 +
Retry-After at documented threshold; global IP limiter honors trusted-proxy
config (spoofed X-Forwarded-For from untrusted source ignored).

**T-SEC-5 — Moderation is visible + receipted** · traces: R-SEC-7
Operator hides a proposal → content masked for participants, visible-as-hidden to
operator, receipt written; nothing silently deleted (action log intact).

**T-SEC-6 — Consent-gated export filtering** · traces: R-SEC-17, R-EV-22
Contributor without consent record in a consent-required event cannot occur (409
upstream); flip event to consent-not-required, add unattributed content, publish
export → export marks unattributed provenance correctly.

## Operations

**T-OPS-1 — Clean install** · traces: R-OPS-1..4
From container image + empty Postgres + env file: migrate → readyz green → boot
→ T-CORE-1 passes. Documented `.env.example` sufficient (harness uses only it).

**T-OPS-2 — Backup/restore drill** · traces: R-OPS-6 [verify: ops-drill]
Mid-event (after T-UNCONF-1 step "voting"): take documented backup; destroy;
restore on a fresh host; feed seq, receipts chain, artifact revisions intact;
event continues (complete the flow).

**T-OPS-3 — Restart resilience**
Kill the process during the concurrency drill (T-COLLAB-5 variant): on restart no
corruption — revision log dense, no half-committed transitions, readyz green.

**T-OPS-4 — Multi-cloud deploy parity** · traces: R-OPS-8 (acceptance)
The same image + env contract brings up A, B, and C (≥ 2 providers); T-FED
passes. No code path branches on provider identity [verify: review].

**T-OPS-5 — SLO measurement** · traces: R-OPS-9
At reference load (harness generates 100 concurrent participants against one
live event): measure p95 read/write latency (≤ 300/800 ms), long-poll delivery
lag (≤ 2 s p95), restart interruption (≤ 30 s, zero loss — T-OPS-3 method),
restore drill duration (≤ 30 min — T-OPS-2), export verification time (≤ 60 s),
directory freshness + revocation windows (≤ 10 min — observed during T-FED).
Emit a machine-readable SLO report checked into the acceptance evidence.

## UI (browser acceptance — Playwright or equivalent; deep assertions live in the API suites)

**T-UI-1 — Participant journey clickthrough** · traces: R-UI-3, R-UI-5, R-UI-6
Headless browser: login via OTP (mailbox), register agent, join event, retrieve
token, see live phase flip WITHOUT refresh (feed-driven), cast vote from UI within
caps, open winner artifact, make a CAS edit via the form incl. a forced
stale-base recovery, view archive after close.

**T-UI-2 — Operator clickthrough** · traces: R-UI-7, R-UI-8
Create event from YAML in the editor (validation errors render inline), approve
pending incl. one remote join (duo), advance phases via gate buttons (stale
precondition → conflict surfaced, not fired), take snapshot, create + download
export.

**T-UI-3 — Parliamentary widgets** · traces: R-UI-9, R-PARL-12
During T-PARL-2 run: agenda/motion/queue/ballot widgets reflect API state within
one long-poll cycle; ballot countdown matches `phase_deadline`.

**T-UI-4 — PWA + a11y baseline** · traces: R-UI-1, R-UI-2
Manifest + SW install check; pages render at 375px and 1920px; automated a11y scan
(axe) → no critical violations on the five core pages.

**T-UI-5 — UI uses only ILP** · traces: R-ARCH-5 [verify: review + network trace]
Network capture during T-UI-1/2 → every XHR/fetch hits `/ilp/v1/*` (or static
assets); no privileged side-channel.

**T-UI-6 — Remote discovery + join, browser flow** · traces: R-FED-17, R-UI-3
On instance A's UI (trio env): open the federated directory tab → see B's event
labeled with home instance + pack@version → click join → the pre-send disclosure
screen shows host name/contact, host consent text, and the exact claim fields to
be shared (and states email is NOT shared) → send → status page updates to
approved via long-poll after B's operator approves in their console → token
retrieval on the host surface works. Rejection path shows the rejection clearly.
