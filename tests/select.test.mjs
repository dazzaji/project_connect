import test from "node:test";
import assert from "node:assert/strict";
import { selectProbes } from "../runner/select.mjs";

const catalog = ["A", "B", "ASTRA-R2-02"];

test("regressions --only: default is the complete catalog in order", () => {
  assert.deepEqual(selectProbes(catalog, undefined), catalog);
});

test("regressions --only: a known selection runs exactly those probes in catalog order", () => {
  assert.deepEqual(selectProbes(catalog, "ASTRA-R2-02,A"), ["A", "ASTRA-R2-02"]);
});

test("regressions --only: unknown, partially unknown, empty and valueless selections fail", () => {
  assert.throws(() => selectProbes(catalog, "BOGUS"), /unknown probe IDs: BOGUS/);
  assert.throws(() => selectProbes(catalog, "A,BOGUS"), /unknown probe IDs: BOGUS/);
  assert.throws(() => selectProbes(catalog, ""), /selected no probes/);
  assert.throws(() => selectProbes(catalog, " , "), /selected no probes/);
  assert.throws(() => selectProbes(catalog, true), /comma-separated list/);
});
