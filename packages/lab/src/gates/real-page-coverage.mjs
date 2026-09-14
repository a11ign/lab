// @ts-check
/**
 * WHICH UNUSABLE CAPTURES COUNT AGAINST THE REAL-PAGE GATE'S COVERAGE -- #1524.
 *
 * `rules:real-pages` subtracted every unusable capture (furniture, unrendered shell, suspect census) from
 * `examined`, while its denominator is the SCORED set: the declared pages `currentFindings` keyed. Nothing
 * intersected the two. An undeclared capture still goes through the capture-quality check (#428), under the URL
 * it was fetched at, so a SUPERSEDED history capture -- a page's pre-move URL, kept in the corpus by `movedFrom`
 * -- could land in the furniture bucket and be subtracted from a set it was never in. On 2026-09-14 metoffice's
 * pre-move capture did exactly that, and stage 11 read "85 of 91" when the sixth unusable capture was not one
 * of the 91 (worker-judge's measurement on #1523).
 *
 * So coverage counts only the unusable captures that ARE scored pages. The rest are still printed by the gate,
 * named as not in the scored set, never dropped: a capture that read furniture is still a capture to fix.
 *
 * WHAT STAYS IN THE SCRIPT: which of these pages are DECLARED unexaminable, and the denominator that follows
 * (`of: pages - declaredHere.length`). `unexaminable-declaration.test.ts` pins both there, and they take this
 * module's `unusablePages` as their input, so a declared page can only leave the denominator if it is a scored
 * page this run could not use.
 *
 * PURE, AND IT HAS TO BE: the gate script's import closure reaches the corpus (`corpus-settled.mjs` ->
 * `dataset-paths.mjs`), so a test importing it is refused in CI. The script calls this, and keeps its own
 * `gateVerdict` and `exitCodeFor` calls, which the verdict-adopter scans read.
 */

/**
 * @param {{ scored: readonly string[], unusable: Iterable<string> }} input
 *   `scored`: the declared page URLs this run scored (`Object.keys(current)`). `unusable`: the URL of every
 *   capture the run could not use, keyed as `noteEvidence` keyed it, duplicates allowed.
 * @returns {{ examined: number, unusablePages: string[], notScored: string[] }}
 *   `examined`: the scored pages less the unusable ones among them. `unusablePages`: those unusable scored pages,
 *   in input order. `notScored`: every other unusable URL, in input order.
 */
export function scoredCoverage({ scored, unusable }) {
  const scoredSet = new Set(scored);
  const distinct = [...new Set(unusable)];
  const unusablePages = distinct.filter((url) => scoredSet.has(url));
  return {
    examined: scoredSet.size - unusablePages.length,
    unusablePages,
    notScored: distinct.filter((url) => !scoredSet.has(url)),
  };
}
