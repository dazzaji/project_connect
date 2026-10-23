# Service examples

- `service.json`, `targets.json` (in `CONFIG_DIR`, with `tokens.json`): operator configuration. `credentials_ref` names a file in
  `secrets_dir`; for `reference-admin-v1` it holds `{ "admin_token": "<the node's admin token>" }` (owner-only, never served).
  `harness-control-v1` needs a credential file only when that target's control API requires a control token (as the Alpha
  harness does): `{ "control_token": "ilph_…" }`, read only from that file for that target and never logged; see
  [docs/harness-control-auth.md](../../docs/harness-control-auth.md).
- `request.json`: a job request body for `POST /v1/jobs` (registered target ids only).
