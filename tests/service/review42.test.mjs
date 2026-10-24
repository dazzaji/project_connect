// review36 R2/R3 discriminators (service runner): per-target identity and control routing, explicit derived-verdict mapping.
// Fake harness control APIs on ephemeral loopback ports (port 0); no targets, no database. R1 is shown by the author run.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";
import { keyDrillPerTarget, profileScenarioFor, targetAdapters } from "../../runner/service-run.mjs";
import { adapter } from "../../runner/setup.mjs";
import { SG3_TESTS } from "../../runner/tests-sg3.mjs";

const PROFILE = JSON.parse(readFileSync(join(ROOT, "profile", "pc-0.1-s1.json"), "utf8"));

/** A fake harness control API: records every request; local node names map to this harness's own credential values. */
async function fakeHarness(label, names) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const path = new URL(req.url, "http://x").pathname;
    seen.push({ path, node: body.node ?? null });
    const out = path === "/nodes" ? Object.fromEntries(names.map((n) => [n, { base_url: `http://${n}.localhost:1`, admin_human: `${label}-admin` }]))
      : path === "/setup/credential" ? { credential: `${label}:${body.node}:${body.kind}` }
      : path === "/ops/key-drill" ? { refused: true, dev_with_key_unchanged: true }
      : null;
    res.writeHead(out ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(out ?? { error: "no route" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}
const harnessDesc = (id, url, node) => ({ id, implementation: "interlateral-platform-beta", version: "t", base_url: `http://${id}.localhost:1`, roles: ["home", "host"], setup: { kind: "harness-control-v1", control_url: url, node }, capabilities: ["key-drill"] });

test("R3: equal harness-local names on two harnesses stay two targets; credentials and the key drill go to each target's own harness", async (t) => {
  const h1 = await fakeHarness("h1", ["beta-one"]), h2 = await fakeHarness("h2", ["beta-one"]);
  t.after(() => Promise.all([h1.close(), h2.close()]));
  const nodes = await targetAdapters([harnessDesc("x", h1.url, "beta-one"), harnessDesc("y", h2.url, "beta-one")], {});
  assert.deepEqual([nodes.x.name, nodes.y.name], ["x", "y"], "identity is the descriptor id, not the local name");
  assert.equal(await nodes.x.credential("provisioning"), "h1:beta-one:provisioning");
  assert.equal(await nodes.y.credential("provisioning"), "h2:beta-one:provisioning", "the second harness's credential does not overwrite the first");
  const out = await keyDrillPerTarget({ home: nodes.x, host: nodes.y }, SG3_TESTS["PC-DISC-5"]);
  const drills = (h) => h.seen.filter((s) => s.path === "/ops/key-drill").map((s) => s.node);
  assert.deepEqual(drills(h1), ["beta-one"], "home drilled through its own harness");
  assert.deepEqual(drills(h2), ["beta-one"], "host drilled through its own harness (not deduplicated by local name)");
  assert.deepEqual(Object.keys(out), ["home:x", "host:y"]);
});

test("R3: distinct names and distinct control URLs: every operation reaches the declared harness with that harness's node name", async (t) => {
  const h1 = await fakeHarness("h1", ["beta-one"]), h2 = await fakeHarness("h2", ["beta-two"]);
  t.after(() => Promise.all([h1.close(), h2.close()]));
  const nodes = await targetAdapters([harnessDesc("a", h1.url, "beta-one"), harnessDesc("b", h2.url, "beta-two")], {});
  await nodes.a.credential("peering");
  await nodes.b.credential("peering");
  await keyDrillPerTarget({ home: nodes.a, host: nodes.b }, SG3_TESTS["PC-DISC-5"]);
  const ops = (h) => h.seen.filter((s) => s.path !== "/nodes").map((s) => `${s.path} ${s.node}`);
  assert.deepEqual(ops(h1), ["/setup/credential beta-one", "/ops/key-drill beta-one"]);
  assert.deepEqual(ops(h2), ["/setup/credential beta-two", "/ops/key-drill beta-two"], "the host's harness is used, never the home's");
});

test("R3: two descriptors naming the same harness node are refused before any test; an unknown node is refused", async (t) => {
  const h1 = await fakeHarness("h1", ["beta-one"]);
  t.after(() => h1.close());
  await assert.rejects(targetAdapters([harnessDesc("x", h1.url, "beta-one"), harnessDesc("y", h1.url, "beta-one")], {}), /same harness node/);
  await assert.rejects(targetAdapters([harnessDesc("z", h1.url, "beta-nine")], {}), /has no node beta-nine/);
});

test("historical adapter unchanged: without harnessNode, control calls name node.name (run.mjs path)", async (t) => {
  const h = await fakeHarness("h", ["beta-one"]);
  t.after(() => h.close());
  assert.equal(await adapter({ name: "beta-one", kind: "beta", base: "http://beta-one.localhost:1" }, { harness: h.url }).credential("peering"), "h:beta-one:peering");
});

test("R2: derived interop verdicts map only to the profile's own scenarios, with the profile's implementations", () => {
  const byId = (impl) => new Map(["beta-one", "beta-two", "ref-a", "ref-b"].map((id) => [id, { id, implementation: id.startsWith("beta") ? impl : "project-connect-reference-node" }]));
  const beta = byId("interlateral-platform-beta");
  assert.equal(profileScenarioFor(PROFILE, "beta-one", "beta-two", beta), "SC-1");
  assert.equal(profileScenarioFor(PROFILE, "beta-two", "beta-one", beta), "SC-2");
  assert.equal(SG3_TESTS["PC-INTEROP-AB"].applies({ scenario: { id: "SC-1" } }), true);
  assert.equal(profileScenarioFor(PROFILE, "ref-a", "ref-b", beta), null, "an arbitrary pair is no profile scenario");
  assert.equal(profileScenarioFor(PROFILE, "beta-one", "beta-two", byId("project-connect-reference-node")), null, "same ids, other implementation: no mapping");
});
