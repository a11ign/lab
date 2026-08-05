import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFitness, persistentFalsePositives, thresholdsFromEnv } from "./fitness.js";

const T = { minRecall: 0.8, maxConformantFP: 0 };

test("passes when recall clears the floor and no conformant false positives", () => {
  assert.deepEqual(evaluateFitness({ recall: 1, conformantFP: 0 }, T), { pass: true, reasons: [] });
});

test("fails when recall is below the floor", () => {
  const r = evaluateFitness({ recall: 0.7, conformantFP: 0 }, T);
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /recall/);
});

test("fails on any false positive on a conformant page", () => {
  const r = evaluateFitness({ recall: 1, conformantFP: 1 }, T);
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /false positive/);
});

test("recall exactly at the floor passes (>= boundary)", () => {
  assert.equal(evaluateFitness({ recall: 0.8, conformantFP: 0 }, T).pass, true);
});

test("reports both failures at once", () => {
  const r = evaluateFitness({ recall: 0.5, conformantFP: 3 }, T);
  assert.equal(r.pass, false);
  assert.equal(r.reasons.length, 2);
});

test("thresholdsFromEnv reads overrides and applies defaults", () => {
  assert.deepEqual(thresholdsFromEnv({ EVAL_MIN_RECALL: "0.9", EVAL_MAX_CONFORMANT_FP: "2" }), {
    minRecall: 0.9,
    maxConformantFP: 2,
  });
  assert.deepEqual(thresholdsFromEnv({}), { minRecall: 0.8, maxConformantFP: 0 });
});

/**
 * A nondeterministic judge cannot be gated on a single sample.
 *
 * `codex exec` has no temperature or seed field (0.145.0 rejects `temperature`, `model_temperature`
 * and `model_sampling_temperature` as unknown config), so identical runs legitimately differ. Two gate
 * runs here differed only by a 1.1.1 image rule that provably cannot affect the fixture involved, and
 * went 0 false positives / PASS -> 1 false positive / FAIL. A zero-tolerance gate sampled once is a
 * coin toss, and a flaky gate gets re-run until green.
 */
test("a single run is unchanged: the one sample is the verdict", () => {
  assert.deepEqual(persistentFalsePositives([["2.4.4"]]), ["2.4.4"]);
  assert.deepEqual(persistentFalsePositives([[]]), []);
});

test("a false positive in a MINORITY of runs is noise and is not gated", () => {
  // The measured case: one appearance in three runs of the same unchanged fixture.
  assert.deepEqual(persistentFalsePositives([["2.4.4"], [], []]), []);
  assert.deepEqual(persistentFalsePositives([[], ["2.4.6"], []]), []);
});

test("a false positive a MAJORITY of runs agree on is a real defect", () => {
  assert.deepEqual(persistentFalsePositives([["2.4.4"], ["2.4.4"], []]), ["2.4.4"]);
  assert.deepEqual(persistentFalsePositives([["2.4.4"], ["2.4.4"], ["2.4.4"]]), ["2.4.4"]);
});

test("two runs need both to agree, so a 1-of-2 split cannot fail the gate", () => {
  // Majority of 2 is 2. Treating 1 of 2 as persistent would keep exactly the flakiness this replaces.
  assert.deepEqual(persistentFalsePositives([["2.4.4"], []]), []);
  assert.deepEqual(persistentFalsePositives([["2.4.4"], ["2.4.4"]]), ["2.4.4"]);
});

test("repeats WITHIN one run do not manufacture persistence", () => {
  // Persistence is about how many runs agree, not how many findings one run emitted; counting raw
  // occurrences would let a single chatty run clear the majority on its own.
  assert.deepEqual(persistentFalsePositives([["2.4.4", "2.4.4", "2.4.4"], [], []]), []);
});

test("each criterion is judged on its own persistence", () => {
  assert.deepEqual(
    persistentFalsePositives([["1.1.1", "2.4.4"], ["1.1.1"], ["1.1.1", "2.4.6"]]),
    ["1.1.1"],
  );
});

test("no runs means nothing to gate on", () => {
  assert.deepEqual(persistentFalsePositives([]), []);
});
