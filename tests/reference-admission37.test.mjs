// Reference join admission: the post-await current-peer decision (R-FED-7 step 4.1, R-FED-16, R-AUTHZ-11). Synthetic
// records only; the decision is a pure function used by the join path right after its last await, before any write.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { currentPeerProblem } from "../reference-node/node.mjs";

test("admission37: step 1 is re-applied to the peer's current record after the awaits", () => {
  const original = { host: "home.example", state: "active" };
  // unchanged active record: admission continues
  assert.equal(currentPeerProblem(original, original), null);
  // the same record suspended, removed or set back to proposed while the request awaited (setPeerState mutates in place)
  for (const [state, code] of [["suspended", "PEER_SUSPENDED"], ["removed", "NOT_A_PEER"], ["proposed", "NOT_A_PEER"]]) {
    const same = { ...original };
    const mutated = Object.assign(same, { state });
    assert.equal(currentPeerProblem(mutated, same), code, state);
  }
  // no record registered any more
  assert.equal(currentPeerProblem(undefined, original), "NOT_A_PEER");
  // re-added (replaced) record: answered as before (503 REVOCATION_STATE_UNKNOWN by the caller) ...
  assert.equal(currentPeerProblem({ host: "home.example", state: "active" }, original), "REPLACED");
  // ... unless the replacement itself is not active: the step 1 code takes precedence
  assert.equal(currentPeerProblem({ host: "home.example", state: "suspended" }, original), "PEER_SUSPENDED");
  assert.equal(currentPeerProblem({ host: "home.example", state: "removed" }, original), "NOT_A_PEER");
});
