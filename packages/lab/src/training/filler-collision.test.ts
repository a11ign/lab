/**
 * The generated page furniture must not satisfy any case's own badSignal.
 *
 * Realistic page furniture is added to every case so the scorer sees real-world structure (see `filler()`
 * in case-matrix). Its TEXT is the hazard: a signal is a pattern over what NVDA announced, so a filler
 * phrase that happens to match one makes the signal fire on BOTH variants — the page's labelled failure and
 * the furniture become indistinguishable, and `check-signals` reports CONTAMINATED.
 *
 * That happened. The furniture said "Reference section 01", NVDA announced "heading, level 2, Reference
 * section 01", and `heading-vague-market`'s signal is `heading.*\bsection\b`. One word in one phrase
 * contaminated a case, and it was found only after spending capture time on it — whereas this check runs in
 * milliseconds against all 382 regex signals and needs no worker at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CASES } from "./case-matrix.mjs";

/**
 * What NVDA announces for the furniture, in the shape the signals match against.
 *
 * Hand-written rather than captured on purpose: this test must run in CI with no Windows guest. Keep it in
 * step with `filler()` — if the furniture's wording changes, change these lines too, or the check silently
 * stops covering what it claims to.
 */
const FURNITURE_SPEECH = [
  "heading, level 2, Reference note 01",
  "Background detail for reference note 01, retained for records and reviewed each year by the site team.",
  "bullet, same page, link, Opening times for the north entrance 01",
  "link, Annual review 2019 02",
  "list, with 40 items",
];

test("no page furniture phrase satisfies any case's badSignal", () => {
  const collisions: string[] = [];
  for (const testCase of CASES as { id: string; badSignal?: { type?: string; pattern?: string } }[]) {
    const signal = testCase.badSignal;
    if (signal?.type !== "regex" || !signal.pattern) continue;
    let pattern: RegExp;
    try {
      pattern = new RegExp(signal.pattern, "i");
    } catch {
      continue; // an unparseable pattern is a different test's problem
    }
    const hit = FURNITURE_SPEECH.find((line) => pattern.test(line));
    if (hit) collisions.push(`${testCase.id}: /${signal.pattern}/ matches ${JSON.stringify(hit)}`);
  }
  assert.deepEqual(collisions, [],
    "furniture text satisfies a case's own badSignal, so the signal will fire on the GOOD variant too and "
    + "the case becomes CONTAMINATED. Reword the furniture, not the signal.");
});
