// triage248 golden-thread opt-in (test-only): the SG-2 golden-thread claim requests carry consent_accepted ONLY when E1
// declared the host's publication consent through the validated setup projection, and then exactly {kind, text_version,
// text_sha256}; an undeclared E1 leaves the request unchanged. Executes the actual helper bytes from runner/tests.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "runner", "tests.mjs"), "utf8");
const line = src.split("\n").find((l) => l.startsWith("const e1ConsentOptIn = "));
const e1ConsentOptIn = new Function(`${line}; return e1ConsentOptIn;`)();
test("248 golden opt-in: undeclared E1 adds nothing; declared E1 adds exactly the three validated fields", () => {
  assert.ok(line, "helper present");
  assert.deepEqual(e1ConsentOptIn({ events: { E1: { id: "e1" } } }), {});
  assert.deepEqual(e1ConsentOptIn({ events: {} }), {});
  const consent = { kind: "publication", text_version: "event-publication-consent-v1", text_sha256: "b".repeat(64) };
  assert.deepEqual(e1ConsentOptIn({ events: { E1: { consent: { ...consent, declared_by: "fixture setup", extra: 1 } } } }), { consent_accepted: consent });
  assert.equal((src.match(/\.\.\.e1ConsentOptIn\(ctx\)/g) || []).length, 2, "exactly the two golden-thread E1 claim requests opt in");
});
