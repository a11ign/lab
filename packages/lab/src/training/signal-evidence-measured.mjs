// @ts-check
/**
 * #1497: WAS THE EVIDENCE A SIGNAL READS ACTUALLY MEASURED?
 *
 * `check-signals` calls a case BLIND when its signal does not fire on the bad capture. That verdict is a claim
 * about the SIGNAL -- "it cannot see this fault" -- and it holds only when the evidence the signal reads was
 * measured. Measured on 2026-09-14 (orchestrator's lab reading on #1497): `skip-link-target-replaced`'s bad
 * capture followed the skip link (`control` the skip link, the probe's mark `found: true`) and recorded
 * `routeChange.nextFocusAfter: null` -- the focus read after the Tab failed -- while all six variants on the
 * same page pair measured "News and updates, link, focused, linked". `skipLinkIsInert` makes no claim on a
 * null, by design, so release-gate stage 8 printed BLIND for a signal that had nothing to read. The case had
 * read OK in 30 of the 31 check-signals runs since 2026-09-01.
 *
 * A capture that holds no reading is a HOLE in the corpus, not a defect in the signal, and the gate already
 * has a verdict for holes: NO CAPTURES, printed "uncaptured", which `--require-complete` still fails. So this
 * module answers one question for `checkCase` -- is the bad capture's evidence for this signal unmeasured,
 * and why -- and the verdict stays `check-signals`'s.
 *
 * PURE, AND ITS OWN FILE: a test that imports `check-signals.mjs` reaches `dataset-paths.mjs` and is
 * corpus-charged, so the decision lives where a test can reach it. This module imports nothing.
 *
 * NOT A SECOND COPY OF `skipLinkIsInert`. That predicate says "no claim" for both "not measured" and "focus
 * went somewhere silent"; this separates the one case where the probe demonstrably did its part -- followed
 * a skip link -- and then recorded no reading at all.
 */

/**
 * Per signal type: why the bad capture's evidence for it was not measured, or null when it was measured, or
 * when the signal does not apply to this capture (which is the signal's own business, not a hole).
 * @type {Readonly<Record<string, (capture: any) => string | null>>}
 */
export const UNMEASURED_EVIDENCE = Object.freeze({
  "skip-link-inert": (/** @type {any} */ capture) => {
    const route = capture?.interaction?.routeChange;
    // The predicate's own applicability gates: no route probe, an error, or no link reached is a different
    // story from "followed the skip link and read nothing". `navigated` is not read (#250: a tautology).
    if (!route || route.error || route.control === null) return null;
    if (!/\b(skip|jump)\b/i.test(String(route.control ?? ""))) return null;
    // A STRING IS A READING, the empty one included: the probe records "" when focus went somewhere silent,
    // and that is an observation. Only a missing or null value means the read itself failed.
    if (typeof route.nextFocusAfter === "string") return null;
    return `the probe followed ${JSON.stringify(String(route.control))} and recorded no nextFocusAfter reading`;
  },
});

/**
 * @param {any} capture
 * @param {{ type?: string } | null | undefined} signal
 * @returns {string | null} the reason the evidence is unmeasured, or null
 */
export function unmeasuredEvidence(capture, signal) {
  const decide = /** @type {Record<string, (capture: any) => string | null>} */ (UNMEASURED_EVIDENCE)[
    String(signal?.type ?? "")];
  return decide ? decide(capture) : null;
}
