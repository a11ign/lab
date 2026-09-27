// @ts-check
/**
 * DID THIS RELEASE CANDIDATE'S NVDA READING OF THE HELD-OUT SET REGRESS AGAINST THE SHIPPED ONE?
 *
 * `releasability.mjs` answers this for the trained SCORER: a candidate's held-out acceptance compared
 * against the shipped model's, same 35-case set, `REGRESSION_TOLERANCE`. Nothing asked the equivalent
 * question of the screen-reader/NVDA LAYER itself -- `ceo`'s #928 ruling point 1, against "if we are not
 * releasing each version better than the last then what are we doing?" `compareCapture`
 * (`../capture/evidence-diff.mjs`) already answers "did the evidence change", field by field, with NVDA's
 * own run-to-run wording variance (DRIFT) already separated from a change a signal reads (CHANGED) --
 * that split IS a tolerance floor, in a different shape from `REGRESSION_TOLERANCE`'s number: a verdict
 * `compareCapture` already computes rather than a threshold this file would have had to invent. This
 * applies that verdict, per held-out case, to gate a release the way `promote:gated` gates the scorer.
 *
 * PURE -- no I/O, no clock, no filesystem, exactly like `releasability()`: the caller reads the captures
 * (from disk, from a cache, from a fixture), this decides. `compareCapture` is itself pure, so calling it
 * here does not cross that line.
 */
import { compareCapture, isUsableCapture, unusableReason } from "../capture/evidence-diff.mjs";

/**
 * @typedef {Record<string, any>} EvidenceCapture
 * @typedef {{ id: string, variant: string, shipped: EvidenceCapture | null, candidate: EvidenceCapture | null }} HeldOutPair
 *   One held-out case's one variant, and both readings of it -- `shipped` is what the currently-released
 *   NVDA layer said, `candidate` is what this release candidate says. Either may be `null`: a case added
 *   since the last ship has no `shipped` reading, and a case this candidate has not been evaluated
 *   against yet has no `candidate` reading. The caller reads both off disk; nothing here does.
 */

/**
 * One pair's verdict -- worst first, the same ABSENT/FAILED/STALE discipline `releasability.mjs` states
 * for itself: "nobody measured this" and "it was measured and it regressed" must never read the same, and
 * neither may read like a capture that exists but never actually read the page.
 *
 * @param {HeldOutPair} pair
 * @returns {{ blocker: string | null, note: string | null }}
 */
function judgePair({ id, variant, shipped, candidate }) {
  const name = `${id}.${variant}`;

  if (!candidate) {
    return { blocker: `${name}: not captured by this candidate -- a case that has not been read cannot `
      + "be released", note: null };
  }
  if (!isUsableCapture(candidate)) {
    // BROKEN, not ABSENT -- a capture that exists but never read the page (NVDA on a console window, an
    // empty transcript, the wrong screen reader) is worse than "not captured yet": it looks like coverage
    // and is not. `unusableReason` names which of the three.
    return { blocker: `${name}: this candidate's capture is UNUSABLE (${unusableReason(candidate)}) -- `
      + "that is not the same as unmeasured, and cannot be released on", note: null };
  }

  if (!shipped) {
    // NEW COVERAGE, not a regression -- the same shape as releasability's "no shipped model is a NOTE,
    // not a blocker": the first reading of a case must be possible, or no case could ever ship.
    return { blocker: null, note: `${name}: no shipped reading stored yet -- first release of this case` };
  }
  if (!isUsableCapture(shipped)) {
    // The SHIPPED side being broken is not the CANDIDATE's fault, so it is a note rather than a blocker --
    // but said aloud, never silently treated as "nothing to compare", which is how a broken baseline comes
    // to look like a clean one.
    return { blocker: null, note: `${name}: the shipped reading is UNUSABLE (${unusableReason(shipped)}), `
      + "so no regression comparison was possible for it" };
  }

  const result = compareCapture(shipped, candidate);
  if (result.verdict === "DIFFERENT_DOCUMENT") {
    return { blocker: `${name}: shipped and candidate were served DIFFERENT DOCUMENTS -- no field-level `
      + "comparison between them means anything; settle which document this case means to capture before "
      + "trusting either reading", note: null };
  }
  if (result.verdict === "CHANGED") {
    const fields = result.changes.map((c) => c.field).join(", ");
    return { blocker: `${name}: evidence CHANGED against the shipped reading (${fields}) -- a field a `
      + "rule or the scorer reads moved. `evidence-diff.mjs` restricts cache invalidation to exactly this "
      + "verdict; the same restriction applied to a release means only CHANGED blocks it", note: null };
  }
  if (result.verdict === "DRIFT") {
    return { blocker: null,
      note: `${name}: transcript DRIFT only (${result.phrases?.lost.length ?? 0} lost, `
        + `${result.phrases?.gained.length ?? 0} gained phrase(s)) -- NVDA's own run-to-run wording `
        + "variance, not a regression" };
  }
  return { blocker: null, note: null };
}

/**
 * @param {object} input
 * @param {HeldOutPair[]} input.pairs every case/variant this release's held-out set names, each carrying
 *   the shipped and candidate readings of it (either may be `null` -- see `HeldOutPair`)
 * @returns {{ releasable: boolean, blockers: string[], notes: string[] }}
 */
export function nvdaReleaseRegression({ pairs }) {
  /** @type {string[]} */
  const blockers = [];
  /** @type {string[]} */
  const notes = [];
  if (pairs.length === 0) {
    // ABSENT is not a pass. Nothing evaluated is not "nothing regressed" -- the same principle
    // `evidence-diff.mjs`'s own `summarise()` states for a zero-comparison run: a check that passes when
    // it could not measure launders unknown into fine.
    blockers.push("no held-out pair was supplied -- nothing was compared, which is not the same as "
      + "nothing regressed");
    return { releasable: false, blockers, notes };
  }
  for (const pair of pairs) {
    const { blocker, note } = judgePair(pair);
    if (blocker) blockers.push(blocker);
    if (note) notes.push(note);
  }
  return { releasable: blockers.length === 0, blockers, notes };
}
