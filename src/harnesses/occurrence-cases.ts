/**
 * The job `verdict:stability` submits (A11-263, step 4): six captures of the controlled pair, as the cases of ONE group, good three times and then bad three times.
 *
 * Its own module because it is pure: the harness itself reads NVDA's vocabulary out of the layer checkout, and a test of the job has no business needing one.
 */
import type { FleetCase } from "../fleet/fleet-job.ts";

export const RUNS = 3;
export const TASK = "Submit the request without entering a reference number and understand what needs fixing.";

/** What each capture of the pair is, in the order they run: good, then bad, three times each. */
export const ORDER = ["good", "bad"].flatMap((variant) => Array.from({ length: RUNS }, (_, index) => ({ variant, run: index + 1 })));

const BODY = { task: TASK, probeForms: true, steps: 25 };

/** The group of six: ONE box holds all of them, in order. A difference between runs and a difference between machines would otherwise be indistinguishable. */
export function occurrenceCases(base: string): FleetCase[] {
  return ORDER.map(({ variant, run }) => ({ id: `${variant}.${run}`, url: `${base}/form-error-silent/${variant}.html`, body: { ...BODY }, group: "form-error-silent" }));
}

