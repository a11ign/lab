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
  for (const { criterion, name, subtype } of heads(training)) {
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
    if (development.falsePositive > 0) {
      failures.push(`${name}: ${development.falsePositive} false positive(s) at threshold `
        + `${subtype.threshold} (precision ${Number(development.precision).toFixed(3)})`);
    }
  }
  return failures;
}

/** Heads that lost ground against the model already shipped. New heads are coverage, not regression. */
function regressions(training, shipped, tolerance) {
  if (!shipped) return [];
  const before = new Map();
  for (const { name, subtype } of heads(shipped)) before.set(name, subtype?.development ?? {});
  const worse = [];
  for (const { name, subtype } of heads(training)) {
    // Skipped for the SAME reason calibration failures are: a rule owns this subtype, so the head's
    // output never reaches a report and cannot get better or worse from a consumer's point of view.
    // Blocking here while the notes say the head cannot block was an inconsistency in this file's first
    // version, and it fired on the very first real candidate — `4.1.2:unnamed-control` and
    // `1.1.1:filename-alt` appeared as blockers and as "cannot block" in the same output.
    if (isRuleDecided(subtype)) continue;
    const was = before.get(name);
    const now = subtype?.development;
    if (!was || was.precision === undefined || !now || now.precision === undefined) continue;
    for (const metric of ["precision", "recall"]) {
      if (now[metric] < was[metric] - tolerance) {
        worse.push(`${name} ${metric} ${was[metric].toFixed(3)} -> ${now[metric].toFixed(3)}`);
      }
    }
  }
  return worse;
}

/**
 * @param {object} input
 * @param {object} input.training    the candidate's training report
 * @param {object|null} input.acceptance  its acceptance report, or null if never evaluated
 * @param {object|null} input.shipped     the currently shipped model's training report, or null
 * @returns {{releasable: boolean, blockers: string[], notes: string[]}}
 */
export function releasability({ training, acceptance, shipped, tolerance = REGRESSION_TOLERANCE }) {
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
  blockers.push(...regressions(training, shipped, tolerance));

  const ruleOwned = [...heads(training)].filter(({ subtype }) => isRuleDecided(subtype)).map((h) => h.name);
  if (ruleOwned.length > 0) {
    notes.push(`${ruleOwned.length} head(s) are decided by deterministic rules and cannot block a `
      + `release: ${ruleOwned.join(", ")}`);
  }
  if (!shipped) notes.push("no model is shipped yet, so nothing was compared against");

  return { releasable: blockers.length === 0, blockers, notes };
}
