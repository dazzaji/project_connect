# schemas/ — Normative wire-object schemas

**Status:** NORMATIVE for object *shape* (JSON Schema draft 2020-12). The prose
protocol specs in `protocols/` remain normative for *behavior*; where shape and
prose disagree, that is a spec bug — flag it, don't guess (07-BUILD-PLAN rules).

Per **R-CORE-28** every wire-visible ILP object MUST validate against its schema
here, and the implementation's served `openapi.json` MUST reference schemas
equivalent to these (same constraints; ids/anchors may differ).

| File | Object | Prose source |
|---|---|---|
| `event-definition.schema.json` | Event Definition YAML v1 (as parsed JSON) | ILP-EVENT §4 |
| `procedure-pack.schema.json` | Procedure pack bundle | ILP-EVENT §3 |
| `event-home.schema.json` | Event Home object | ILP-EVENT §2 (R-EV-3) |
| `action.schema.json` | Action submission + record | ILP-EVENT §5 (R-EV-16) |
| `receipt.schema.json` | Receipt | ILP-CORE §8 (R-CORE-22) |
| `artifact-change.schema.json` | Artifact meta + revision/change record | ILP-COLLAB |
| `feed-record.schema.json` | Event change-feed record | ILP-CORE §4 (R-CORE-13) |
| `problem.schema.json` | Error problem document | ILP-CORE §3 (R-CORE-9) |
| `discovery.schema.json` | `/.well-known/interlateral.json` | ILP-CORE §7 (R-CORE-20) |
| `identity-claim.schema.json` | Identity Claim JWT payload | ILP-ID §7 (R-ID-17) |
| `export-manifest.schema.json` | Export bundle manifest | ILP-EVENT §9 (R-EV-25) |
| `openapi.skeleton.json` | OpenAPI 3.1 starting skeleton | ILP-CORE R-CORE-3 |

Validation harness hook: `tests/harness/lib/verify.mjs` should load these and
validate every response the suite sees (T-CORE-2 method).
