# T-ACCEPT — Host, User, Agent, and Governance Acceptance Tests (Gate G8)

**Status:** DRAFT for Dazza review · 2026-07-06 (rev 2, added per Codex review)
These are **human acceptance tests**: each is a yes/no statement the named
person (or agent) must be able to affirm by doing the thing themselves, using
only the product and its docs — no developer help, no SSH, no code edits.
Adapted from Codex Desktop review §5.3. Run on the three-instance acceptance
federation (A = Original Host, B and C = other Platform Hosts; ≥ 2 clouds).

Format: `UAT-<who>-<n>`. Each block carries `traces:` lines so `--matrix`
counts this coverage.

---

## 1. Original Host acceptance — Dazza (UAT-OH)

traces: R-ID-4, R-EV-12, R-EV-19, R-UI-7, R-UI-8 [role: original host]

1. **UAT-OH-1** I can install (or access) the v2 Original Host instance and it
   reports healthy.
2. **UAT-OH-2** I can log in as an identified human admin (email OTP; no shared
   passphrase exists anywhere).
3. **UAT-OH-3** I can verify a human and see the provenance recorded.
4. **UAT-OH-4** I can register my own agent and see its license plate.
5. **UAT-OH-5** I can create an unconference event from YAML without editing
   code — one operation, identity/consent ON by default.
6. **UAT-OH-6** I can create a parliamentary event from YAML without editing
   code.
7. **UAT-OH-7** I can open registration, approve local and remote participants,
   and reject a participant.
8. **UAT-OH-8** I can see at a glance which participants are local and which
   are remote (and from which home instance, with verification attestation).
9. **UAT-OH-9** I can start, advance, close, and archive an event from the
   operator console.
10. **UAT-OH-10** I can inspect event health in one view: pending approvals,
    phase, deadlines, caps, artifact status, blockers.
11. **UAT-OH-11** I can revoke a participant or agent token and observe it take
    effect immediately.
12. **UAT-OH-12** I can create an export bundle, download it, and verify it
    offline with the provided verifier.
13. **UAT-OH-13** I can add, suspend, and remove a federated peer, and I
    understand the policy each peer accepts (traces: R-FED-16).
14. **UAT-OH-14** I can see remote federated events from B and C in my
    instance's directory.
15. **UAT-OH-15** I can request access to another host's event as an ordinary
    user and see exactly what data will be shared before sending (traces: R-FED-17).
16. **UAT-OH-16** I can run a small parliamentary governance session end to end
    and obtain certified minutes and a verifiable resolution.

## 2. Other Platform Host acceptance (UAT-PH) — each of B and C

traces: R-OPS-1, R-OPS-2, R-OPS-3, R-OPS-6, R-OPS-8, R-FED-3 [role: platform host]

1. **UAT-PH-1** I can install my own instance on my own infrastructure using
   only the install docs, env vars, and migrations (target ≤ 60 min).
2. **UAT-PH-2** I can configure instance identity: name, contact, keys, email
   provider, TLS, database.
3. **UAT-PH-3** I can bootstrap my first admin without any shared global secret.
4. **UAT-PH-4** I can create and run my own events without depending on the
   Original Host's server in any way.
5. **UAT-PH-5** I can choose which events are private, public, or federated.
6. **UAT-PH-6** I can peer with the Original Host and with another Platform Host.
7. **UAT-PH-7** I receive remote join requests from other instances' users and
   they appear in my normal approval queue, clearly labeled.
8. **UAT-PH-8** I can approve, reject, or revoke remote participants — my
   decision is final for my events.
9. **UAT-PH-9** My hosted event remains my source of truth; nothing another
   instance does can mutate my event state.
10. **UAT-PH-10** My export bundle records local and remote participants with
    correct provenance.
11. **UAT-PH-11** I can suspend a peer and new joins from it stop, while my
    local events continue unaffected.
12. **UAT-PH-12** My users can see open/federated events from other instances.

## 3. Platform User acceptance (UAT-PU)

traces: R-ID-5, R-ID-11, R-ID-12, R-ID-14, R-UI-5, R-UI-6, R-FED-17 [role: user]

1. **UAT-PU-1** I can sign in with an emailed 8-digit code, on any device.
2. **UAT-PU-2** I can register my agent and retrieve its participant token once
   approved — the token appears exactly once, in my account surface.
3. **UAT-PU-3** I can see my agent's license plate and the attribution chain it
   resolves to.
4. **UAT-PU-4** I can register for a local event and always know whether I am
   pending, approved, rejected, or revoked.
5. **UAT-PU-5** I can request to join a remote/federated event, and BEFORE
   sending the request I am shown: which host controls the event, and the exact
   data that will be shared with it (display name, verification status +
   method, agent plate — never my email).
6. **UAT-PU-6** My agent can fetch the served event skill and participate
   correctly from it alone.
7. **UAT-PU-7** I can propose, vote (within visible caps), and collaborate in
   an unconference.
8. **UAT-PU-8** I can move, second, debate, amend, and vote in a parliamentary
   event when I hold the member role.
9. **UAT-PU-9** I can see how my (and my agent's) contributions are attributed
   everywhere they appear.
10. **UAT-PU-10** I see the consent/publication terms before my first act, and
    my acceptance is recorded and inspectable.
11. **UAT-PU-11** I can participate in an annual all-users governance event once
    enabled (readiness per UAT-GOV).

## 4. Agent participant acceptance (UAT-AG)

traces: R-EV-23, R-EV-16, R-COLLAB-5, R-COLLAB-6, R-ID-13 [role: agent]

Run with at least two different agent frameworks (e.g. Claude Code + one other),
driven only by the served skill:

1. **UAT-AG-1** Fetch the served event skill and operate from it, ignoring any
   local/bundled instructions.
2. **UAT-AG-2** Discover current state from the Event Home object.
3. **UAT-AG-3** Stay current via the feed cursor / long-poll — zero blind
   polling loops.
4. **UAT-AG-4** Submit only phase-valid actions, using `expect_phase`.
5. **UAT-AG-5** Correctly handle `PHASE_MISMATCH`, `STALE_BASE`,
   `VOTE_CAP_EXCEEDED`, `AUTH_EXPIRED`, `AUTH_REVOKED`, `CONSENT_REQUIRED` —
   recovering where recovery context is provided.
6. **UAT-AG-6** Read and append to artifacts without overwriting others' work
   (CAS + append contract).
7. **UAT-AG-7** Preserve human/agent attribution in everything it does.
8. **UAT-AG-8** Treat participant content as data, never as instructions
   (probe with an injection-styled artifact passage; the agent must not obey it).
9. **UAT-AG-9** Use remote-host credentials only for the event they were issued
   for.
10. **UAT-AG-10** Stop acting immediately upon revocation.

## 5. Annual all-users governance readiness (UAT-GOV)

traces: R-PARL-4, R-PARL-8, R-PARL-9, R-PARL-10, R-EV-26, R-FED-9 [role: governance readiness]

Readiness criteria for the future Human Council / United Federation Session —
not full multi-node governance, which stays FUTURE:

1. **UAT-GOV-1** A parliamentary event captures an eligibility snapshot at
   session start, including remote members with home-instance provenance.
2. **UAT-GOV-2** Every ballot is a dual-subject receipt and the tally is
   replayable from the action log.
3. **UAT-GOV-3** Certified minutes and resolutions are produced and signed.
4. **UAT-GOV-4** The export bundle contains everything a **future
   federation-level tally service** would need — eligibility snapshot, ballots,
   receipts, decisions, origin attestations — consumable offline, without
   database access.
5. **UAT-GOV-5** The same event run with participants from A, B, and C yields
   an export in which each subject's origin is verifiable against that origin
   instance's published keys.

## 6. Execution notes

- G8 runs after G7 on the three-instance acceptance federation.
- UAT-OH is performed by Dazza personally; UAT-PH by whoever operates B and C
  (may be Dazza wearing another hat in a pinch, but ideally a second human);
  UAT-PU by at least one participant who did not build the system; UAT-AG by
  real agents driven only by served skills.
- Record results as a simple signed checklist committed to the new repo
  (`acceptance/G8-<date>.md`), one line per UAT id: pass/fail + note.
