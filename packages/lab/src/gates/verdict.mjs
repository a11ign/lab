// @ts-check
/**
 * A GATE VERDICT THAT CANNOT BE BUILT WITHOUT SAYING WHAT IT EXAMINED — determinism-plan D6.
 *
 * Every "examined the wrong thing" defect in this repo has one shape: a result crosses a boundary as a bare
 * verdict and its SCOPE does not travel with it. Collected in a single session:
 *
 *   pre-push hook       `ok check-signals`                 left behind "226 of 1461 examined"
 *   worker:code         "nothing to compare"               left behind "…of the LOCAL pool; inventory has 5"
 *   capture preflight   "Fleet runs this checkout"         left behind "0 worker(s) checked"
 *   rules:gate          "2.1.2:focus-trapped 12/12 EXACT"  left behind which 12 records
 *   gate:probe-order    would have said PASS               left behind "never reached a real page"
 *   evidence:check      read as a verdict on my change     left behind "this disk's captures, last synced"
 *
 * MORE PACKAGES WOULD MAKE THIS WORSE, not better: every boundary is one more place for scope to be
 * dropped. The package boundaries here already work, and they work because DISCOVERY TESTS enforce them.
 * What was missing is not separation, it is a type.
 *
 * AND PRINTING THE NUMBER IS NOT ENOUGH. `evidence-check` printed its coverage and still passed on 2 of 48,
 * because the guard tested `compared === 0` rather than `compared < expected` — the extreme case, not the
 * middle. Its own comment named the general rule and then covered only the extreme. So here the verdict is
 * DERIVED from coverage rather than accompanied by it: a PASS with `examined < of` is unconstructible.
 */

/**
 * @typedef {{ verdict: "PASS" | "FAIL" | "INCONCLUSIVE", examined: number, of: number, source: string,
 *             failures: number, why: string }} GateVerdict
 */

/**
 * @param {{ examined: number, of: number, source: string, failures?: number }} coverage
 *   `of` is what the gate SET OUT to examine; `examined` is what it actually compared. `source` names where
 *   the population came from — "inventory.yml", "this disk's captures", "86 conformant real pages" — because
 *   a count means nothing until you know what it counted over.
 * @returns {GateVerdict}
 */
export function gateVerdict({ examined, of, source, failures = 0 }) {
  const base = { examined, of, source, failures };
  if (failures > 0) {
    // "N problem(s) across M examined", never "N of M failed". Failures are NOT a subset of the units
    // examined: `release:provenance` reads ONE artefact and can find two problems with it, and the first
    // wording rendered that as "FAIL — 2 of 1 examined failed". Found by the second gate to adopt this,
    // which is the argument for a shared shape — a bespoke message would have been wrong in one place and
    // right in six, and nobody would have compared them.
    return { ...base, verdict: "FAIL",
      why: `${failures} problem(s) across ${examined} of ${of} from ${source}` };
  }
  // COVERAGE FIRST, and this ordering is the whole point. A gate that fell short did not pass; it did not
  // finish. Reversing these two lines reproduces the 2-of-48 defect exactly.
  if (examined < of) {
    return { ...base, verdict: "INCONCLUSIVE",
      why: `only ${examined} of ${of} from ${source} were examined, so this says nothing about the rest` };
  }
  return { ...base, verdict: "PASS", why: `all ${examined} of ${of} from ${source} examined and clean` };
}

/** One line, so every gate reads the same way in a log. */
export function renderVerdict(/** @type {GateVerdict} */ v) {
  return `${v.verdict} — ${v.why}`;
}

/** The process exit code this repo's gates use: 0 clean, 1 a real failure, 2 could not tell. */
export function exitCodeFor(/** @type {GateVerdict} */ v) {
  return v.verdict === "PASS" ? 0 : v.verdict === "FAIL" ? 1 : 2;
}
