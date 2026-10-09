// @ts-check
// evidence-check's exit codes, in a module of their own so a test can read them without importing the script
// (which resolves the corpus paths at import time) — #2197.

/**
 * THE EXIT CODES, named, because a crash used to share one with the verdict (#2197).
 *
 * `1` was both "the evidence CHANGED" and what Node exits with for an uncaught throw, so a run that died
 * on a stale manifest read to the operator as the answer to the question, and the job's message told them
 * to bump CAPTURE_PROTOCOL_VERSION and recapture the fleet (872 captures, about 71 minutes, and every
 * stored capture invalidated) to fix a manifest that `-e job=generate` regenerates in seconds. `THREW`
 * takes a code of its own so the two are separable from outside the process. It is `3` and not `2`
 * because `2` is already three things in this file (`exit-code-contract.test.ts`).
 */
export const EXIT = /** @type {const} */ ({ SAFE: 0, CHANGED: 1, INCONCLUSIVE: 2, THREW: 3 });

/**
 * The verdict's code. `inconclusive` wins over `evidenceChanged`: a partial read that saw some change has
 * not answered "did the evidence change", and reporting CHANGED off it would send someone to recapture.
 *
 * @param {{ inconclusive?: boolean, evidenceChanged?: boolean }} summary
 */
export function exitCodeFor(summary) {
  if (summary.inconclusive) return EXIT.INCONCLUSIVE;
  return summary.evidenceChanged ? EXIT.CHANGED : EXIT.SAFE;
}

/**
 * Run the script's `main` and turn a throw into `EXIT.THREW`.
 *
 * The error is printed in full first, stack included: the exit code says THAT it could not answer, and
 * the stack is what says why. Without this Node exits `1` for the rejection, which is the CHANGED code.
 * A failure before this runs (a module that will not load, an unknown flag) is still Node's own `1`;
 * `lab-job.yml` says so rather than claiming the code is unambiguous.
 *
 * @param {() => Promise<unknown>} run
 */
export async function runToExit(run) {
  try {
    await run();
  } catch (error) {
    console.error(error);
    process.exit(EXIT.THREW);
  }
}
