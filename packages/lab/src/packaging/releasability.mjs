/**
 * MAY THIS MODEL SHIP? One function, computed from the facts, at the moment you ask.
 *
 * It used to be a boolean the TRAINER wrote — and the trainer cannot know. One input is "did held-out
 * acceptance pass?", which happens later, in a different tool. So the trainer stamped a verdict about the
 * future, the verdict was necessarily "no", and everything downstream worked around a "no" that was never
 * an answer. That produced, in one afternoon: a deadlock where the gate that would qualify a candidate
 * refused to run on an unqualified one; a `--allow-ineligible` flag whose help called the normal path a
 * diagnostic; an evaluator that reaches back and rewrites the trainer's report; and FIVE overlapping
 * fields (`releaseEligible`, `modelReleaseEligible`, `calibrationClean`, `generalisationVerified`,
 * `releaseBlockedBy`) that each encode part of one question.
 *
 * So: the trainer records what calibration found. The evaluator records what held-out data showed. Neither
 * renders a verdict. This does, from both, plus the model already shipped.
 *
 * PURE — no I/O, no clock, no filesystem. The caller reads the reports; this decides. That is what makes
 * it testable against situations the lab has never produced, which is where the deadlock lived.
 */

/** Movements this small are calibration noise on a finite development split, not facts about a model. */
const REGRESSION_TOLERANCE = 0.005;

/**
 * Heads whose findings a deterministic rule already supplies, read from the report's own `decisionOwner`.
 *
 * These must NOT block a release, and getting that wrong is not hypothetical: the multi-defect candidate
 * was blocked by `4.1.2:unnamed-control` failing to calibrate — a head that never reaches a report,
 * because the rule owns that subtype and `findingsFromScores` suppresses the model for it. A release
 * refused over output nobody receives is a gate measuring the wrong thing.
 */
const isRuleDecided = (subtype) => subtype?.decisionOwner === "deterministic-rules";

/** Every (criterion, subtype, report) triple in a training report, flattened. */
function* heads(training) {
  for (const [criterion, entry] of Object.entries(training?.criteria ?? {})) {
    for (const [name, subtype] of Object.entries(entry?.subtypes ?? {})) {
      yield { criterion, name, subtype };
    }
  }
}

/**
 * Did calibration actually find a threshold for this head, or fall back?
 *
 * Read from the STRUCTURED development figures, never by matching the trainer's prose. This repo's
 * recovery paths key on fault codes rather than message text for the same reason: reword the message and a
 * text match silently stops working while its tests, which assert on their own copy of the string, keep
 * passing.
 */
function calibrationFailures(training) {
  const failures = [];
  for (const { name, subtype } of heads(training)) {
    if (isRuleDecided(subtype)) continue;
    const development = subtype?.development;
    if (!development || development.precision === undefined) {
      failures.push(`${name}: no development figures — it was never calibrated`);
      continue;
    }
    if (development.positive === 0) {
      failures.push(`${name}: no positive development records, so its threshold means nothing`);
      continue;
    }
    // BOTH directions, and the symmetry is deliberate.
    //
    // This checked false positives only. That is defensible as a PREFERENCE — for an accessibility tool a
    // false accusation is worse than a miss, because somebody may budget against it or be challenged over
    // it — but it is indefensible as a blind spot: a head that has gone silent scores a perfect precision
    // and passes, which is exactly the failure ADR 0015 measured. The shipped model trades TWO missed
    // findings for two false accusations and only one of those was visible here.
    //
    // The acceptance evaluator already fails on both (`evaluate-screenreader-acceptance.py`), so this was
    // the only place the asymmetry lived. Preference belongs in the THRESHOLD a criterion is calibrated
    // to, which the trainer already chooses as the lowest reaching zero false positives — not in which
    // errors a gate is capable of seeing.
    if (development.falsePositive > 0) {
      failures.push(`${name}: ${development.falsePositive} false positive(s) at threshold `
        + `${subtype.threshold} (precision ${Number(development.precision).toFixed(3)})`);
    }
    if (development.falseNegative > 0) {
      failures.push(`${name}: ${development.falseNegative} missed finding(s) at threshold `
        + `${subtype.threshold} (recall ${Number(development.recall).toFixed(3)}) — a head that has gone `
        + "silent scores perfect precision, so this must be checked separately"
        + whatPinnedTheThreshold(subtype, development));
    }
  }
  return failures;
}

/**
 * Why the cut sits where it does, when the report carries a threshold sweep.
 *
 * "24 missed at 0.95" is a consequence, not a diagnosis. The trainer picks the LOWEST threshold with
 * zero false positives, so a single borderline conformant record can push the cut a whole step and take
 * recall with it — and that is indistinguishable from the head itself getting worse, while needing the
 * opposite response: look at the one record, rather than retrain. On 2026-08-24 this head moved
 * 15 missed at 0.90 to 24 at 0.95 in a change that touched only link-text features, and the difference
 * was unreadable from the report.
 *
 * So name the next cut down and what rules it out. One false positive there means a record to examine;
 * forty means the head is genuinely weak and the threshold is doing its job.
 */
function whatPinnedTheThreshold(subtype, development) {
  const sweep = Array.isArray(subtype.thresholdSweep) ? subtype.thresholdSweep : [];
  const below = sweep.filter((row) => Number(row.threshold) < Number(subtype.threshold));
  const nextDown = below.sort((a, b) => Number(b.threshold) - Number(a.threshold))[0];
  if (!nextDown) return "";
  const recovered = development.falseNegative - Number(nextDown.falseNegative);
  if (recovered <= 0) return "";
  return `; ${recovered} of them are reachable at ${nextDown.threshold}, which `
    + `${nextDown.falsePositive} false positive(s) rule out`;
}

/**
 * Heads that lost ground against the model already shipped — measured on the FIXED held-out set.
 *
 * The first version compared each model's own DEVELOPMENT figures, and that is not a like-for-like
 * comparison. A development split describes the corpus a model was trained on: the shipped model's
 * contains no multi-defect pages and the current candidate's contains 237, so `1.3.1:fake-heading recall
 * 1.000 -> 0.553` was the same head measured on a substantially harder population, reported as a
 * regression. Thirteen of sixteen blockers on the first real candidate were that artefact.
 *
 * Acceptance is the same 35 cases for every model, so it is the only figure two models can be compared on.
 * Per CRITERION rather than per subtype, because that is the granularity acceptance reports.
 *
 * A criterion the shipped model was not evaluated on is NOT a regression — it is new coverage.
 */
function regressions(acceptance, shippedAcceptance, tolerance) {
  if (!acceptance || !shippedAcceptance) return [];
  const worse = [];
  for (const [criterion, now] of Object.entries(acceptance.criteria ?? {})) {
    const was = (shippedAcceptance.criteria ?? {})[criterion];
    if (!was?.modelEvaluated || !now?.modelEvaluated) continue;
    for (const metric of ["precision", "recall"]) {
      if (was[metric] === undefined || now[metric] === undefined) continue;
      if (now[metric] < was[metric] - tolerance) {
        worse.push(`${criterion} held-out ${metric} ${was[metric].toFixed(3)} -> ${now[metric].toFixed(3)}`);
      }
    }
  }
  return worse;
}

/**
 * @param {object} input
 * @param {object} input.training    the candidate's training report
 * @param {object|null} input.acceptance  its acceptance report, or null if never evaluated
 * @param {object|null} input.shipped     the shipped model's training report, or null
 * @param {object|null} [input.shippedAcceptance] its ACCEPTANCE report — the only fixed-set baseline
 * @returns {{releasable: boolean, blockers: string[], notes: string[]}}
 */
export function releasability({ training, acceptance, shipped, shippedAcceptance,
  tolerance = REGRESSION_TOLERANCE }) {
  const blockers = [];
  const notes = [];

  // ABSENT and FAILED must never look alike — this repo's most expensive recurring shape. "Nobody has
  // measured this" and "it was measured and it failed" call for different actions.
  if (!acceptance) {
    blockers.push("held-out acceptance has not been run against these weights");
  } else if (acceptance.passed !== true) {
    for (const reason of acceptance.failureReasons ?? ["(no reason recorded)"]) {
      blockers.push(`held-out acceptance failed: ${reason}`);
    }
  }

  blockers.push(...calibrationFailures(training));
  blockers.push(...regressions(acceptance, shippedAcceptance, tolerance));

  const ruleOwned = [...heads(training)].filter(({ subtype }) => isRuleDecided(subtype)).map((h) => h.name);
  if (ruleOwned.length > 0) {
    notes.push(`${ruleOwned.length} head(s) are decided by deterministic rules and cannot block a `
      + `release: ${ruleOwned.join(", ")}`);
  }
  if (!shipped) notes.push("no model is shipped yet, so nothing was compared against");
  else if (!shippedAcceptance) {
    // Said out loud rather than silently skipped. A promotion that compares against nothing, while
    // looking like it compared, is how a worse model ships — and until 2026-08-23 the shipped model
    // carried no acceptance report at all, so there was nothing to compare against.
    notes.push("the shipped model has no acceptance report stored, so NO regression comparison was "
      + "possible — promote:model now keeps one, so the next candidate can be compared");
  }

  return { releasable: blockers.length === 0, blockers, notes };
}
