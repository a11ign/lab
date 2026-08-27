// @ts-check
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
const isRuleDecided = (/** @type {Record<string, any>} */ subtype) => subtype?.decisionOwner === "deterministic-rules";

/** Every (criterion, subtype, report) triple in a training report, flattened. */
/** @param {Record<string, any>} training */
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
/** @param {Record<string, any>} training */
function calibrationFailures(training) {
  const failures = [];
  const notes = [];
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
    // to — which is now a stated Neyman-Pearson bound (ADR 0022) — not in which errors a gate can see.
    failures.push(...typeOneErrorFailures(name, subtype, development));
    const { blocking, note } = silentHeadFailures(name, subtype, development);
    if (blocking) failures.push(blocking);
    if (note) notes.push(note);
  }
  return { failures, notes };
}

/**
 * Was this acceptance report produced by the weights being promoted?
 *
 * `candidate:gate` does not run the acceptance evaluator, so `promote-model` reads whatever
 * `acceptance-report.json` is on disk — and nothing checked that it described the model underneath it.
 * Measured 2026-08-24: a retrain left weights hashed 59620019 beside an acceptance report describing
 * 561427ab and stating `passed: true`. Only a calibration blocker stopped a promotion on another
 * model's results.
 *
 * The information was already in the file. `artifact.modelSha256` has been written by the evaluator all
 * along and nothing read it — the same shape as the 604 `sweepLog` crashes and the `browserVersion`
 * memo: a value recorded correctly, and never compared to the thing it describes.
 *
 * Fail-closed in the direction that matters. A report that names its weights is CHECKED, and one that
 * names them while the caller supplies nothing to compare against is a blocker rather than a pass — the
 * caller could have proved the link and did not. Only a report predating the stamp is a note, because
 * refusing those would refuse every model trained before this existed.
 */
/** @param {Record<string, any>|null} acceptance @param {string|null} candidateModelSha256 */
function acceptanceBelongsToTheseWeights(acceptance, candidateModelSha256) {
  const claimed = acceptance?.artifact?.modelSha256;
  if (!acceptance || !claimed) return [];
  if (!candidateModelSha256) {
    return ["held-out acceptance names the weights it measured, and nothing was supplied to compare "
      + "them against — so it cannot be shown to describe this candidate"];
  }
  if (claimed === candidateModelSha256) return [];
  return [`held-out acceptance was measured on DIFFERENT weights: it describes `
    + `${String(claimed).slice(0, 8)} and the candidate is ${String(candidateModelSha256).slice(0, 8)}. `
    + "Re-run acceptance for these weights. A stale report is worse than a missing one, because it "
    + "arrives already saying it passed"];
}

/**
 * Does this head hold the false-positive bound it claims?
 *
 * "Any false positive blocks" was the right rule while the trainer chose the lowest cut with ZERO of
 * them on the development set. That target is free — the threshold was picked to make it true — so the
 * check could only ever restate the constraint, and it was blind to the thing that actually matters:
 * whether the bound holds on a page nobody has seen.
 *
 * Under ADR 0022 the cut is an order statistic calibrated to a stated rate, so a bounded number of
 * development false positives is EXPECTED and is not a defect. Two things are:
 *
 *   - more of them than the rank permits, which means the threshold and the scores disagree — an
 *     implementation fault, invisible to a rule that only asked whether the count was zero;
 *   - a head that could not be calibrated to the target at all, because it has too few held-out
 *     negatives for any order statistic to control the rate. That one used to be UNREPORTABLE here.
 *
 * A report with no guarantee block predates ADR 0022. It falls back to the old rule rather than passing
 * vacuously — unexamined must never read as clean.
 */
/**
 * EXPORTED so it can be driven by `scripts/fixtures/calibration-verdicts.json`, which the Python trainer's
 * `type_one_error_blocker` is driven by too. The rule exists in two languages because the trainer decides
 * eligibility at train time and this decides the release at promote time, and neither can import the
 * other — so the copies are pinned equal rather than deleted.
 */
/** @param {string} name @param {Record<string, any>} subtype @param {Record<string, any>} development */
export function typeOneErrorFailures(name, subtype, development) {
  const guarantee = subtype.guarantee;
  if (!guarantee) {
    return development.falsePositive > 0
      ? [`${name}: ${development.falsePositive} false positive(s) at threshold ${subtype.threshold} `
        + `(precision ${Number(development.precision).toFixed(3)}), and the report states no bound`]
      : [];
  }
  const failures = [];
  if (guarantee.atTarget === false) {
    failures.push(`${name}: NOT calibrated to the target false-positive rate — `
      + `${guarantee.negatives} held-out negative(s) can only control `
      + `${Number(guarantee.falsePositiveRate).toFixed(4)}. It needs more conformant records, and no `
      + "threshold can substitute for them");
  }
  const permitted = Number(guarantee.permittedFalsePositives ?? 0);
  if (development.falsePositive > permitted) {
    failures.push(`${name}: ${development.falsePositive} false positive(s) where the calibrated rank `
      + `permits ${permitted} — the threshold and the scores disagree, which is a fault in the `
      + "calibration itself rather than a weak head");
  }
  return failures;
}

/**
 * Has this head gone SILENT?
 *
 * This checked `falseNegative > 0`, which demands recall 1.000 on every head — a bar no learned model can
 * clear, and one the shipped model only appears to clear because its development set is smaller and
 * easier. That is the artefact `regressions()` twelve lines below already carries a scar for: *"the
 * shipped model's contains no multi-defect pages and the candidate's contains 237, so
 * `1.3.1:fake-heading recall 1.000 -> 0.553` was the same head measured on a substantially harder
 * population, reported as a regression. Thirteen of sixteen blockers on the first real candidate were
 * that artefact."* The lesson was applied to the regression check and not to this one — the same
 * one-call-site shape this repo names most often.
 *
 * The stated purpose is narrower than the rule was, and the comment above it said so all along: *a head
 * that has gone silent scores perfect precision, so this must be checked separately*. Going silent and
 * missing nine of a hundred are different conditions needing different responses.
 *
 * So the split, by what each figure can actually support:
 *
 *   - **Silent BLOCKS.** "This head found nothing" is an absolute property of one model, true or false
 *     without reference to any other, and a head that reports nothing is broken however it was measured.
 *   - **Missing findings are REPORTED.** Development recall is computed on a corpus particular to that
 *     model, so its absolute value is not comparable between two models and cannot support a gate.
 *   - **Losing ground BLOCKS, in `regressions()`,** against held-out acceptance — the same 35 cases for
 *     every model, and the only figure on which two models can honestly be compared.
 *
 * Nothing is lost by the move: a head that genuinely weakens still fails, on the measurement that can
 * see it. What is gained is that a candidate is no longer refused for being measured on harder data.
 */
/** @param {string} name @param {Record<string, any>} subtype @param {Record<string, any>} development */
function silentHeadFailures(name, subtype, development) {
  if (development.truePositive === 0 && development.positive > 0) {
    return { blocking: `${name}: SILENT — 0 of ${development.positive} positive record(s) found at threshold `
      + `${subtype.threshold}. A head that reports nothing scores perfect precision, which is why this is `
      + "checked apart from the false-positive bound." };
  }
  if (development.falseNegative > 0) {
    return { note: `${name}: NOTE — ${development.falseNegative} missed finding(s) at threshold `
      + `${subtype.threshold} (recall ${Number(development.recall).toFixed(3)})`
      + whatPinnedTheThreshold(subtype, development)
      + ". Not blocking: development recall is measured on a corpus particular to this model and is not "
      + "comparable to another's. Held-out acceptance is where losing ground is caught." };
  }
  return {};
}

/**
 * Why the cut sits where it does, when the report carries a threshold sweep.
 *
 * "24 missed at 0.95" is a consequence, not a diagnosis. The trainer picks the LOWEST threshold with
 * zero false positives, so a single borderline conformant record can push the cut a whole step and take
 * recall with it — and that is indistinguishable from the head itself getting worse, while needing the
 * opposite response: look at the one record, rather than retrain. On 2026-08-24 `3.3.1` moved from
 * 15 missed at 0.90 to 24 at 0.95 when one link-text feature was dropped — every head reads the same
 * shared vector, so it was re-fitted, but it reads validation messages and not link text — and the
 * report gave no way to tell the two apart.
 *
 * So name the next cut down and what rules it out. One false positive there means a record to examine;
 * forty means the head is genuinely weak and the threshold is doing its job.
 */
/** @param {Record<string, any>} subtype @param {Record<string, any>} development */
function whatPinnedTheThreshold(subtype, development) {
  const sweep = Array.isArray(subtype.thresholdSweep) ? subtype.thresholdSweep : [];
  const below = sweep.filter((/** @type {Record<string, any>} */ row) => Number(row.threshold) < Number(subtype.threshold));
  const nextDown = below.sort((/** @type {Record<string, any>} */ a, /** @type {Record<string, any>} */ b) => Number(b.threshold) - Number(a.threshold))[0];
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
/**
 * Is this head one record away from having no valid threshold?
 *
 * Under ADR 0022 the cut is an order statistic of the held-out negatives, and `np_rank` walks DOWN from
 * `r = n` — so a head whose rank sits at the extreme has no conservative direction left to move in. The
 * previous grid search had the same property at 0.95, its top step, and three heads sat there.
 *
 * The failure mode is a cliff rather than a slope: the head is clean today and uncalibratable tomorrow,
 * on one conformant record scoring higher than any before it. `3.3.1`'s own sweep put the fallback at 31
 * false positives. The gate would refuse the next candidate, which is the system working — but "this was
 * fine and is now unusable" arriving with no warning is what makes a release feel arbitrary.
 *
 * A NOTE, never a blocker. Nothing is wrong with a head at the extreme; it is the most conservative cut
 * available and it holds its bound. What is worth knowing is that it has no margin.
 */
/** @param {Record<string, any>} training */
function marginNotes(training) {
  const out = [];
  for (const { name, subtype } of heads(training)) {
    if (isRuleDecided(subtype)) continue;
    const g = subtype?.guarantee;
    if (!g || typeof g.rank !== "number" || typeof g.negatives !== "number") continue;
    if (g.permittedFalsePositives > 0) continue;
    out.push(`${name}: NO MARGIN — its cut is the most conservative order statistic available `
      + `(rank ${g.rank} of ${g.negatives}, 0 false positives permitted). One conformant record scoring `
      + "higher than any so far leaves it with no valid cut at all. Clean today; nothing is wrong.");
  }
  return out;
}

/**
 * Can these two models be compared at all?
 *
 * `regressions()` returns `[]` when either acceptance report is missing, and an empty list of regressions
 * is indistinguishable from "no regressions" — which is how "nobody could measure this" comes to read as
 * "nothing is wrong", the shape this file already refuses for acceptance itself.
 *
 * There is a second way the comparison can be impossible and nothing reported it. The shipped model is
 * `screenreader-structured-v7`; the runtime computes `v15`, so `score.py` refuses the shipped weights
 * outright — *"scorer representation schema does not match the runtime"* — and the shipped acceptance
 * report on disk describes a model that can no longer be run. Measured 2026-08-24, the real-page sweep
 * printed `AGAINST shipped ... REGRESSION` from a months-old 22-page JSON while the candidate was scored
 * on 38 pages, and reported the difference as though it were a change in the model.
 *
 * A schema gap is not a blocker: the FIRST model of any new representation necessarily has no comparable
 * predecessor, and refusing it would make a schema change unshippable forever. It is a NOTE that must be
 * loud, because every regression check downstream is inert while it holds.
 */
/** @param {Record<string, any>} training @param {Record<string, any>|null} shipped */
function comparabilityNotes(training, shipped) {
  const candidateSchema = training?.representation?.schema;
  const shippedSchema = shipped?.representation?.schema;
  if (!shippedSchema || !candidateSchema || shippedSchema === candidateSchema) return [];
  return [`NO BASELINE: the shipped model is ${shippedSchema} and this candidate is ${candidateSchema}. `
    + "The runtime computes only the latter, so the shipped weights cannot be scored and every "
    + "regression check below is inert — not passing, unable to run. A first model of a new schema is "
    + "expected to be in this state; a second one is not."];
}

/** @param {Record<string, any>|null} acceptance @param {Record<string, any>|null} shippedAcceptance @param {number} tolerance */
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
 * @param {Record<string, any>} input.training    the candidate's training report
 * @param {Record<string, any>|null} input.acceptance  its acceptance report, or null if never evaluated
 * @param {Record<string, any>|null} input.shipped     the shipped model's training report, or null
 * @param {Record<string, any>|null} [input.shippedAcceptance] its ACCEPTANCE report — the only fixed-set baseline
 * @param {string|null} [input.candidateModelSha256] hash of the weights actually being promoted
 * @param {number} [input.tolerance] the noise floor below which a difference is not a regression --
 *   DESTRUCTURED here for as long as this function has existed and never documented, so it was invisible
 *   to every reader of the signature and to the compiler alike
 * @returns {{releasable: boolean, blockers: string[], notes: string[]}}
 */
export function releasability({ training, acceptance, shipped, shippedAcceptance,
  candidateModelSha256 = null, tolerance = REGRESSION_TOLERANCE }) {
  const blockers = [];
  const notes = [];

  // ABSENT and FAILED must never look alike — this repo's most expensive recurring shape. "Nobody has
  // measured this" and "it was measured and it failed" call for different actions. STALE is a third,
  // and it is the most dangerous of the three because it arrives reading `passed: true`.
  if (!acceptance) {
    blockers.push("held-out acceptance has not been run against these weights");
  } else if (acceptance.passed !== true) {
    for (const reason of acceptance.failureReasons ?? ["(no reason recorded)"]) {
      blockers.push(`held-out acceptance failed: ${reason}`);
    }
  }
  blockers.push(...acceptanceBelongsToTheseWeights(acceptance, candidateModelSha256));

  const calibration = calibrationFailures(training);
  blockers.push(...calibration.failures);
  notes.push(...calibration.notes);
  blockers.push(...regressions(acceptance, shippedAcceptance ?? null, tolerance));
  notes.push(...comparabilityNotes(training, shipped));
  notes.push(...marginNotes(training));

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
