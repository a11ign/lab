import { test } from "node:test";
import assert from "node:assert/strict";
import { tabStopEvidenceLines } from "../../scripts/score-rules.js";

/**
 * A green gate must not be able to mean two opposite things.
 *
 * 2.1.2's cycling branch needs a capture that walked the focus ring. A corpus with none scores
 * `2.1.2:focus-trapped EXACT` on the STALLED records alone — and a branch that was never reached scores
 * exactly like a branch that is right. Those need opposite responses: ship, versus capture the case.
 *
 * The reporter said `dom.tabbable` until 2026-08-28, for a tab-stop denominator built and withdrawn the
 * same day. It went on describing that branch after the branch was gone — a stale diagnostic in the file
 * whose whole job is to say what was examined, which is the defect this test exists for.
 */
const walked = (stops: number) =>
  ({ input: { interaction: { focusOrder: Array.from({ length: stops }, (_, i) => `stop ${i}`) } } });

test("a corpus that walked no focus ring SAYS the cycling branch is unexercised", () => {
  const lines = tabStopEvidenceLines([{}, { input: {} }, { input: { interaction: {} } }]).join(" ");
  assert.match(lines, /UNEXERCISED/);
  assert.match(lines, /STALLED records alone/);
});

test("an EMPTY focus order is not a walk — the probe did not run, so nothing was exercised", () => {
  // `focusOrder: []` is what a capture carries when `probeFocus` was off. Counting it as a walk would let
  // a corpus that never ran the probe report the branch as exercised, which is the failure inverted.
  const lines = tabStopEvidenceLines([{ input: { interaction: { focusOrder: [] } } }]).join(" ");
  assert.match(lines, /UNEXERCISED/);
});

test("a corpus that walked reports HOW MANY, because a word cannot tell you 2 from 200", () => {
  const lines = tabStopEvidenceLines([walked(14), walked(16), {}]).join(" ");
  assert.match(lines, /2 of 3 record\(s\)/);
  assert.doesNotMatch(lines, /UNEXERCISED/);
});
