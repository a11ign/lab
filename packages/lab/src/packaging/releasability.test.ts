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

/** An acceptance report, which is the only figure two models can be compared on — the same 35 cases. */
const accepted = (criteria: Record<string, unknown>) => ({ passed: true, criteria });
const crit = (precision: number, recall: number) => ({ modelEvaluated: true, precision, recall });

test("losing ground on the FIXED held-out set blocks; new coverage does not", () => {
  // Compared on acceptance, never on development. A development split describes the corpus a model was
  // trained on: the shipped model's has no multi-defect pages and the candidate's has 237, so the same
  // head measured on a harder population read as a regression. Thirteen of sixteen blockers on the first
  // real candidate were that artefact.
  const v = releasability({
    training: CLEAN,
    acceptance: accepted({ "3.3.2": crit(1, 0.8), "2.4.9": crit(0.5, 0.5) }),
    shipped: CLEAN,
    shippedAcceptance: accepted({ "3.3.2": crit(1, 1) }),
  });
  assert.equal(v.blockers.length, 1, JSON.stringify(v.blockers));
  assert.match(v.blockers[0], /3\.3\.2 held-out recall 1\.000 -> 0\.800/);
});

test("a development regression is NOT a blocker, because the splits are not comparable", () => {
  // The corrected behaviour, asserted so it cannot quietly return: a candidate whose development figures
  // are worse but whose held-out figures hold is releasable.
  const worseDevelopment = training({
    "3.3.2:unnamed-form-field": head({ precision: 1, recall: 0.55, falsePositive: 0 }),
  });
  const v = releasability({
    training: worseDevelopment,
    acceptance: accepted({ "3.3.2": crit(1, 1) }),
    shipped: CLEAN,
    shippedAcceptance: accepted({ "3.3.2": crit(1, 1) }),
  });
  assert.deepEqual(v.blockers, []);
});

test("no stored acceptance baseline is SAID, not silently skipped", () => {
  // A promotion that compares against nothing while looking like it compared is how a worse model ships.
  const v = releasability({
    training: CLEAN, acceptance: { passed: true }, shipped: CLEAN, shippedAcceptance: null,
  });
  assert.match(v.notes.join(" "), /no acceptance report stored, so NO regression comparison/);
});

test("noise below the tolerance is not a regression", () => {
  const v = releasability({
    training: CLEAN,
    acceptance: accepted({ "3.3.2": crit(0.999, 1) }),
    shipped: CLEAN,
    shippedAcceptance: accepted({ "3.3.2": crit(1, 1) }),
  });
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
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

test("a head that MISSES findings blocks, not only one that invents them", () => {
  // The asymmetry this closes: checking false positives alone means a head that has gone silent scores a
  // perfect precision and passes. That is the failure ADR 0015 measured — the shipped model trades two
  // missed findings for two false accusations, and only one of those was visible to this function.
  //
  // Preference between the two error types belongs in the THRESHOLD a criterion is calibrated to, not in
  // which errors a gate can see.
  const silent = training({
    "3.3.2:unnamed-form-field": head({ falsePositive: 0, falseNegative: 7, precision: 1, recall: 0.6 }),
  });
  const v = releasability({ training: silent, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, false);
  assert.match(v.blockers.join(" "), /7 missed finding\(s\)/);
});

test("a rule-decided head that misses findings still cannot block", () => {
  // Same exemption as for false positives, and for the same reason: a rule owns that subtype, so the
  // head's output never reaches a report and cannot miss anything a consumer would notice.
  const owned = training({
    "4.1.2:unnamed-control": { ...head({ falseNegative: 9, recall: 0.5 }),
      decisionOwner: "deterministic-rules" },
  });
  assert.deepEqual(
    releasability({ training: owned, acceptance: { passed: true }, shipped: null }).blockers, []);
});

test("a blocked head names what pins its threshold, so ONE record cannot read as a regression", () => {
  // The situation this was written for, measured on 2026-08-24. Removing a link-text feature moved
  // `3.3.1:validation-error-silent` from 15 missed findings at 0.90 to 24 at 0.95. Every head reads the
  // same shared feature vector so it WAS re-fitted, but it reads validation messages and the dropped
  // feature described link text. The trainer picks the LOWEST threshold with zero false
  // positives, so one borderline conformant record pushes the cut a whole step and takes recall with it.
  //
  // From the report alone that is indistinguishable from the head getting worse, and the two need opposite
  // responses: look at the one record, versus retrain. So the blocker states the next cut down and what
  // rules it out.
  const sweep = [
    { threshold: 0.9, falsePositive: 1, falseNegative: 15 },
    { threshold: 0.95, falsePositive: 0, falseNegative: 24 },
  ];
  const pinned = training({
    "3.3.2:unnamed-form-field": {
      ...head({ falsePositive: 0, falseNegative: 24, precision: 1, recall: 0.802 }),
      threshold: 0.95,
      thresholdSweep: sweep,
    },
  });
  const v = releasability({ training: pinned, acceptance: { passed: true }, shipped: null });
  const blocker = v.blockers.join(" ");
  assert.match(blocker, /9 of them are reachable at 0\.9/);
  assert.match(blocker, /1 false positive\(s\) rule out/);
});

test("a report with NO sweep still blocks, and says nothing it cannot support", () => {
  // Every model trained before the sweep existed. A blocker that invented a cause for those would be worse
  // than one that omits it — this repo's own rule that unexamined must never read as clean.
  const noSweep = training({
    "3.3.2:unnamed-form-field": head({ falsePositive: 0, falseNegative: 7, precision: 1, recall: 0.6 }),
  });
  const v = releasability({ training: noSweep, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, false);
  assert.match(v.blockers.join(" "), /7 missed finding\(s\)/);
  assert.doesNotMatch(v.blockers.join(" "), /reachable at/);
});

const guaranteed = (over = {}) => ({
  method: "neyman-pearson-order-statistic", falsePositiveRate: 0.005, confidence: 0.95,
  rank: 1850, negatives: 1860, permittedFalsePositives: 10, exact: false, atTarget: true, ...over,
});

test("false positives WITHIN the calibrated bound are expected, not a defect", () => {
  // Under ADR 0022 the cut is an order statistic calibrated to a stated rate, so some development false
  // positives are the design. Blocking on any of them would refuse every correctly calibrated head —
  // and the old rule could only ever restate its own constraint, since the threshold was chosen to make
  // the count zero.
  const calibrated = training({
    "3.3.2:unnamed-form-field": {
      ...head({ falsePositive: 7, falseNegative: 0, precision: 0.95, recall: 1 }),
      guarantee: guaranteed(),
    },
  });
  const v = releasability({ training: calibrated, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
});

test("MORE false positives than the rank permits is a calibration fault, and says so", () => {
  // Distinct from a weak head: the threshold and the scores disagree, which no amount of retraining
  // fixes and which the zero-or-nothing rule could not express.
  const broken = training({
    "3.3.2:unnamed-form-field": {
      ...head({ falsePositive: 11, falseNegative: 0, precision: 0.9, recall: 1 }),
      guarantee: guaranteed({ permittedFalsePositives: 10 }),
    },
  });
  const v = releasability({ training: broken, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, false);
  assert.match(v.blockers.join(" "), /permits 10 — the threshold and the scores disagree/);
});

test("a head with too few negatives to reach the target blocks, and names the real remedy", () => {
  // Previously UNREPORTABLE here. A head that cannot control its false-positive rate scored a perfect
  // precision and sailed through, because precision on the development set was the constraint restated.
  const starved = training({
    "3.3.2:unnamed-form-field": {
      ...head({ falsePositive: 0, falseNegative: 0, precision: 1, recall: 1 }),
      guarantee: guaranteed({ atTarget: false, negatives: 120, falsePositiveRate: 0.0248 }),
    },
  });
  const v = releasability({ training: starved, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, false);
  assert.match(v.blockers.join(" "), /NOT calibrated to the target/);
  assert.match(v.blockers.join(" "), /needs more conformant records/);
});

test("a report predating the bound falls back to the old rule, rather than passing vacuously", () => {
  const legacy = training({
    "3.3.2:unnamed-form-field": head({ falsePositive: 3, falseNegative: 0, precision: 0.9, recall: 1 }),
  });
  const v = releasability({ training: legacy, acceptance: { passed: true }, shipped: null });
  assert.equal(v.releasable, false);
  assert.match(v.blockers.join(" "), /states no bound/);
});
