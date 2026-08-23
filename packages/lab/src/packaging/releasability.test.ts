/**
 * The verdict, tested against situations the lab has never produced — which is where the deadlock lived.
 *
 * The old design had the TRAINER write a `releaseEligible` boolean, one of whose inputs (did held-out
 * acceptance pass?) only exists after training. It could only ever be false, so every consumer worked
 * around it, and the workarounds were the bugs: a gate that refused to run on the models it existed to
 * qualify, a flag whose help called the normal path a diagnostic, and an evaluator that reached back and
 * rewrote the trainer's report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { releasability } from "./releasability.mjs";

const head = (over = {}) => ({
  threshold: 0.9,
  development: { positive: 100, precision: 1, recall: 1, falsePositive: 0, ...over },
});
const training = (subtypes: Record<string, unknown>) => ({ criteria: { "3.3.2": { subtypes } } });
const CLEAN = training({ "3.3.2:unnamed-form-field": head() });

test("a clean candidate with passing acceptance is releasable", () => {
  const v = releasability({ training: CLEAN, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
});

test("acceptance NOT RUN and acceptance FAILED are different blockers", () => {
  const missing = releasability({ training: CLEAN, acceptance: null, shipped: null });
  const failed = releasability({
    training: CLEAN, acceptance: { passed: false, failureReasons: ["3.3.2: acceptance false positives"] },
    shipped: null,
  });
  assert.match(missing.blockers[0], /has not been run/);
  assert.match(failed.blockers[0], /failed: 3\.3\.2/);
  assert.notDeepEqual(missing.blockers, failed.blockers,
    "'nobody measured this' and 'it was measured and failed' must never read the same");
});

test("THE DEADLOCK CANNOT RECUR: nothing here asks the candidate whether it is eligible", () => {
  // The old shape: the trainer stamped `releaseEligible: false` because acceptance had not run, and the
  // evaluator refused any model that was not eligible. This function takes the acceptance report as an
  // INPUT rather than reading a verdict off the candidate, so there is no state in which running the gate
  // requires having already passed it.
  const stamped = { ...CLEAN, releaseEligible: false, releaseBlockedBy: ["anything at all"] };
  const v = releasability({ training: stamped, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, true,
    "a self-declared verdict on the candidate must not affect the computed one");
});

test("a head a deterministic RULE decides cannot block a release", () => {
  // Measured on the multi-defect candidate: it was blocked by `4.1.2:unnamed-control` failing to
  // calibrate — a head that never reaches a report, because the rule owns that subtype and the judge
  // suppresses the model for it. A release refused over output nobody receives measures the wrong thing.
  const ruleOwned = training({
    "4.1.2:unnamed-control": { ...head({ falsePositive: 5, precision: 0.965 }),
      decisionOwner: "deterministic-rules" },
  });
  const v = releasability({ training: ruleOwned, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
  assert.match(v.notes.join(" "), /decided by deterministic rules/);
});

test("a head the MODEL decides, with false positives, does block", () => {
  const broken = training({
    "3.3.2:placeholder-only": head({ falsePositive: 36, precision: 0.368 }),
  });
  const v = releasability({ training: broken, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, false);
  assert.match(v.blockers.join(" "), /placeholder-only: 36 false positive/);
});

test("a head with no positive development records blocks, rather than passing vacuously", () => {
  const starved = training({ "3.3.2:placeholder-only": head({ positive: 0 }) });
  const v = releasability({ training: starved, acceptance: { passed: true }, shipped: null });
  assert.match(v.blockers.join(" "), /no positive development records/);
});

test("losing ground against the shipped model blocks; new coverage does not", () => {
  const shipped = training({ "3.3.2:unnamed-form-field": head() });
  const worse = training({
    "3.3.2:unnamed-form-field": head({ recall: 0.8 }),
    "3.3.2:brand-new": head(),
  });
  const v = releasability({ training: worse, acceptance: { passed: true }, shipped });
  assert.equal(v.blockers.length, 1, JSON.stringify(v.blockers));
  assert.match(v.blockers[0], /unnamed-form-field recall 1\.000 -> 0\.800/);
});

test("noise below the tolerance is not a regression", () => {
  const shipped = training({ "3.3.2:unnamed-form-field": head() });
  const jitter = training({ "3.3.2:unnamed-form-field": head({ precision: 0.999 }) });
  assert.equal(releasability({ training: jitter, acceptance: { passed: true }, shipped }).releasable, true);
});

test("no shipped model is a NOTE, not a blocker — the first release must be possible", () => {
  const v = releasability({ training: CLEAN, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, true);
  assert.match(v.notes.join(" "), /no model is shipped yet/);
});

test("a rule-decided head cannot block as a REGRESSION either, not just on calibration", () => {
  // The first version skipped rule-decided heads in the calibration check and not in the regression check,
  // so the same output listed `4.1.2:unnamed-control` as a blocker AND as a head that cannot block. Caught
  // on the first real candidate, which is late — the two checks share a reason and must share the rule.
  const owned = { ...head({ precision: 0.9 }), decisionOwner: "deterministic-rules" };
  const shipped = training({ "4.1.2:unnamed-control": { ...head(), decisionOwner: "deterministic-rules" } });
  const v = releasability({
    training: training({ "4.1.2:unnamed-control": owned }),
    acceptance: { passed: true }, shipped,
  });
  assert.deepEqual(v.blockers, []);
});
