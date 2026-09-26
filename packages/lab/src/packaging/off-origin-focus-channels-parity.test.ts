/**
 * #1575 PARITY: THE WORKER'S SKIPPED-FOCUS CHANNELS ARE EXACTLY `@a11ign/evidence`'s `FOCUS_STEP` CHANNELS.
 *
 * Split out of `packages/nvda-worker/src/off-origin-activation.test.ts` (#2612, child 1 of #69): the other half of this
 * parity is evidence's `left-site.ts`, read as text by a `../../evidence/` path, and a layer that is to leave for its own
 * repository cannot lean on a sibling's file by path. THE ASSERTION MOVED and was not deleted: two halves of a parity
 * check must stay checked by something.
 *
 * It lives in `lab` and not in `evidence` because `evidence` is Apache-2.0 and may not import the AGPL worker
 * (`licence-boundary.test.ts`), which is also why the worker's test read evidence and not the reverse. `lab` already
 * declares `@a11ign/nvda-worker`, read here BY NAME.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { stripComments } from "@a11ign/evidence/source-text";
import { notRunAfterLeaving, sweepObservation } from "@a11ign/nvda-worker/capture-pure";

type Observation = { asked: boolean; complete?: boolean; why?: string; stop?: { prev: string; next: string } };
const SWEEPS = ["headings", "landmarks", "formFields", "graphics", "links", "lists", "frames", "tableCells"];

const EVERY_SWEEP = (): Record<string, Observation> =>
  Object.fromEntries(SWEEPS.map((sweep) => [sweep, sweepObservation({ stop: "exhausted" }, { stop: "exhausted" })]));

/**
 * `@a11ign/evidence`'s focus step, READ AS TEXT (#1575): the worker cannot import `left-site.ts`'s `FOCUS_STEP`, and
 * `@a11ign/evidence` cannot import the worker. Comments are stripped first, so a channel named in prose is not read.
 */
function evidenceFocusStepChannels(): string[] {
  const leftSite = stripComments(readFileSync(resolve(import.meta.dirname, "../../../evidence/src/left-site.ts"), "utf8"));
  const step = /const FOCUS_STEP: Step = \{[\s\S]*?interaction: \[([\s\S]*?)\]/.exec(leftSite)?.[1];
  assert.ok(step, "left-site.ts no longer declares FOCUS_STEP's interaction list -- this parity reads nothing");
  return [...step.matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]);
}

test("#1575 PARITY: the worker's skipped-focus channels are exactly @a11ign/evidence's FOCUS_STEP channels", () => {
  const evidence = evidenceFocusStepChannels();
  // THE POSITIVE CONTROL on the text read: it found the step's channels, including one each side names.
  assert.ok(evidence.includes("focusOrder") && evidence.includes("typedFeedback"), `read ${JSON.stringify(evidence)}`);
  const worker = notRunAfterLeaving({ observed: EVERY_SWEEP(), skipped: ["focus"] });
  assert.deepEqual([...worker].sort(), [...evidence].sort(),
    "a channel added to one focus list and not the other: the worker records what never ran from its list, and "
    + "evidence names what was not examined from FOCUS_STEP -- the two must be the same step");
});
