/**
 * DOES A REVERSED `focusout, focusin` PAIR STILL REPORT F55? — settled here, so nobody has to re-derive it
 * from a hypothesis.
 *
 * `case-matrix.mjs` carried this as THE LEADING HYPOTHESIS, unverified, for the withdrawn 2.4.7 cases: the
 * UI Events order on gaining focus is `focus` then `focusin`, so a handler bound to `focus` that calls
 * `blur()` synchronously runs BEFORE `focusin` is dispatched, and the pair may reach the log reversed —
 * `focusout(X), focusin(X)` — "which matches nothing". The comment said it could not be settled from the
 * captures taken, and at the hour it was written that was true.
 *
 * It is settleable without a capture at all, because the question is about a PURE function over a log. So
 * this runs the SHIPPED rule against synthetic logs rather than reasoning about the source — which is what
 * turned an opinion into a result, and found the hypothesis wrong.
 *
 * **A REVERSED PAIR FIRES.** The `focusout` is left ORPHANED, and since `known-gaps.md` §42 deleted
 * `focusLossEvidence`'s `i === 0` exception, an orphaned focusout IS the F55 signature — so it reports,
 * with `"focus was never fully received before it was removed"`, which is arguably the truer sentence for
 * a `focus`-handler blur than the ordered path's `"focus held Nms"`.
 *
 * **AND THE THRESHOLD IS NEVER CONSULTED ON THAT PATH.** `heldMs` is null without a completed receipt and
 * the `FOCUS_SCRIPT_WINDOW_MS` comparison is gated behind `completedReceipt`, so no corpus case of this
 * shape could measure the threshold's positive side. Board issue #14 asked for exactly such a case.
 *
 * WHY THE FIXTURES ARE SYNTHETIC. The real evidence would be a capture of a page whose script blurs on
 * focus, and `case-matrix.mjs` records a deliberate decision NOT to build one: `this.blur()` sends focus to
 * the document body, so the next Tab restarts from the top and the probe walks the same prefix forever.
 * That decision stands. A synthetic log asks the same question of the same function without reproducing a
 * shape somebody already measured and reverted.
 *
 * WHY IT LIVES IN `packages/lab` rather than beside `rules.ts`: it is the settlement of a claim made in
 * `case-matrix.mjs`, and it belongs next to the record it corrects. `packages/lab` depends on
 * `@a11y-witness/judge`, so importing the shipped rule from here is the legal direction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ruleFindings } from "@a11y-witness/judge/rules";

type FocusEvent = { type: string; id: number; name: string; atMs: number };

/** A capture carrying nothing but a focus-event log — the only channel these assertions are about. */
function captureWith(log: FocusEvent[]): Record<string, unknown> {
  return {
    transcript: [],
    structure: {},
    interaction: { focusEvents: { asked: true, checked: true, events: log.length, log } },
  };
}

function focusFindings(log: FocusEvent[]): string[] {
  return ruleFindings(captureWith(log) as never)
    .filter((f) => String(f.wcag).startsWith("2.4.7"))
    .map((f) => String(f.evidence));
}

/** The ordered pair the rule was written for: focus received, then removed by script 5ms later. */
const ORDERED: FocusEvent[] = [
  { type: "focusin", id: 1, name: "Coupon", atMs: 100 },
  { type: "focusout", id: 1, name: "Coupon", atMs: 105 },
];

/** THE HYPOTHESIS: the same event pair, arriving reversed. */
const REVERSED: FocusEvent[] = [
  { type: "focusout", id: 1, name: "Coupon", atMs: 100 },
  { type: "focusin", id: 1, name: "Coupon", atMs: 105 },
];

/** An ordinary Tab away, five seconds later. Must stay silent, or "it fires" means "it fires always". */
const ORDINARY: FocusEvent[] = [
  { type: "focusin", id: 1, name: "Search", atMs: 0 },
  { type: "focusout", id: 1, name: "Search", atMs: 5_000 },
];

/** Reversed, then focus genuinely landing somewhere else — a redirect must not clear an ORPHAN. */
const REVERSED_THEN_ELSEWHERE: FocusEvent[] = [
  ...REVERSED,
  { type: "focusin", id: 2, name: "Next field", atMs: 200 },
];

test("the ORDERED pair fires, and names how long focus was held", () => {
  const found = focusFindings(ORDERED);
  assert.equal(found.length, 1, "the shape the rule was written for must still report");
  assert.match(found[0], /focus held 5ms/);
});

test("the REVERSED pair FIRES TOO — the hypothesis that it 'matches nothing' is wrong", () => {
  // The correction this file exists for. The focusout is orphaned, and an orphaned focusout is F55.
  const found = focusFindings(REVERSED);
  assert.equal(found.length, 1,
    "a focus-handler blur that reaches the log reversed must still be reported -- if this goes to 0, the "
    + "`i === 0` exception has come back or the orphan path has changed, and known-gaps.md §42 is affected");
  assert.match(found[0], /never fully received/,
    "it reports through the ORPHAN path, not the held-for-Nms path -- which is why the threshold is "
    + "irrelevant to it");
});

test("an ORDINARY tab-away stays silent, so 'it fires' does not mean 'it fires indiscriminately'", () => {
  // The anti-vacuity half. Without it, a rule that reported every log would satisfy both tests above.
  assert.deepEqual(focusFindings(ORDINARY), [],
    "focus held for 5 seconds is a user tabbing away, not a script removing it");
});

test("a reversed pair followed by a REAL next control still fires — a redirect cannot clear an orphan", () => {
  // `focusLandedOnADifferentControl` deliberately clears only a COMPLETED receipt. An orphaned loss
  // followed by an unrelated focusin is routinely what a genuine script strip looks like.
  assert.equal(focusFindings(REVERSED_THEN_ELSEWHERE).length, 1);
});

test("the threshold is not consulted on the reversed path, so no case of that shape can measure it", () => {
  // Board issue #14 asked for a corpus case whose script blurs on focus, to measure
  // FOCUS_SCRIPT_WINDOW_MS's positive side. It could not have: `heldMs` is null without a completed
  // receipt, and the comparison is gated behind it. Proven by TIME, not by reading: the reversed pair
  // reports identically whether its two events are 5ms or five minutes apart, which a threshold-sensitive
  // path could not do.
  const near = focusFindings(REVERSED);
  const far = focusFindings([
    { type: "focusout", id: 1, name: "Coupon", atMs: 0 },
    { type: "focusin", id: 1, name: "Coupon", atMs: 300_000 },
  ]);
  assert.deepEqual(near, far,
    "the reversed path must be insensitive to the gap between the two events; if these ever differ, the "
    + "threshold HAS become reachable here and issue #14's acceptance is worth revisiting");
});
