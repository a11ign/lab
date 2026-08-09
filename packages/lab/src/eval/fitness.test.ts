import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFitness, persistentFalsePositives, thresholdsFromEnv } from "./fitness.js";

const T = { minRecall: 0.8, maxConformantFP: 0, maxAbstentionRate: 0.9 };

/**
 * Metrics with the abstention fields defaulted to "nothing was declined".
 *
 * A helper rather than repeating them, so the tests below still read as being ABOUT recall and false
 * positives — and so the abstention tests, which set them deliberately, stand out as the ones about
 * abstention.
 */
const m = (recall: number, conformantFP: number, abstained = 0, failureCases = 10) =>
  ({ recall, conformantFP, abstained, failureCases });

test("passes when recall clears the floor and no conformant false positives", () => {
  assert.deepEqual(evaluateFitness(m(1, 0), T), { pass: true, reasons: [] });
});

test("fails when recall is below the floor", () => {
  const r = evaluateFitness(m(0.7, 0), T);
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /recall/);
});

test("fails on any false positive on a conformant page", () => {
  const r = evaluateFitness(m(1, 1), T);
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /false positive/);
});

test("recall exactly at the floor passes (>= boundary)", () => {
  assert.equal(evaluateFitness(m(0.8, 0), T).pass, true);
});

test("reports both failures at once", () => {
  const r = evaluateFitness(m(0.5, 3), T);
  assert.equal(r.pass, false);
  assert.equal(r.reasons.length, 2);
});

test("thresholdsFromEnv reads overrides and applies defaults", () => {
  assert.deepEqual(thresholdsFromEnv({
    EVAL_MIN_RECALL: "0.9", EVAL_MAX_CONFORMANT_FP: "2", EVAL_MAX_ABSTENTION_RATE: "0.25",
  }), { minRecall: 0.9, maxConformantFP: 2, maxAbstentionRate: 0.25 });
  // The shipped defaults, pinned. `maxConformantFP: 0` is the one that must never move: a false positive
  // on a conformant page is an accusation. The abstention cap is deliberately loose because 28 of 32 real
  // fixtures sit below the scorer's support floor — tightening it is what ADR 0010's calibration corpus is
  // for, and loosening it to make a run pass would be fitting the threshold to the answer.
  assert.deepEqual(thresholdsFromEnv({}), {
    minRecall: 0.55, maxConformantFP: 0, maxAbstentionRate: 0.9,
  });
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


/**
 * Abstention, bounded.
 *
 * Recall is now measured over cases the judge ANSWERED, which is the honest number — an abstention means
 * the model declined, not that it was wrong. But that alone is gameable in the worst possible direction:
 * abstain on everything difficult and recall over the remainder goes to 100%. The two have to be bounded
 * together.
 */
test("declining too many cases FAILS, however good the recall on the rest", () => {
  const r = evaluateFitness(m(1, 0, 9, 10), { ...T, maxAbstentionRate: 0.5 });
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /declined 9 of 10/);
  assert.match(r.reasons[0], /recall above is over the rest/,
    "the message must say what the recall number was computed on");
});

test("abstention within the cap passes", () => {
  assert.equal(evaluateFitness(m(1, 0, 5, 10), { ...T, maxAbstentionRate: 0.5 }).pass, true);
});

test("abstaining on EVERYTHING cannot post a perfect score", () => {
  // The degenerate case the cap exists for: nothing answered, so recall is vacuously 1.
  const r = evaluateFitness(m(1, 0, 10, 10), T);
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /declined 10 of 10/);
});

test("no failure cases at all does not divide by zero", () => {
  // An empty run should fail on having measured nothing, which is the caller's business — this function
  // must not throw or report a NaN rate.
  const r = evaluateFitness(m(1, 0, 0, 0), T);
  assert.equal(r.pass, true);
});
