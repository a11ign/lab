/**
 * DOES `focusRemovedOnReceipt` AGREE WITH THE JUDGE ON A PROTOCOL-22 `initial` FOCUSIN? -- #2593 (#2587 follow-up).
 *
 * At protocol 22 the install records what ALREADY holds focus as a `focusin` with `initial: true`, its
 * `atMs` the install moment. `focusLossVerdict` (`packages/judge/src/rules.ts`) refuses to read a hold time
 * off it (`initialHoldLossVerdict`: `clear` or `unpairable`, never a finding). This predicate is a
 * DELIBERATE DUPLICATE (this package cannot import `packages/judge`), so it must be told the same.
 *
 * The fixtures name their positive controls: (c) goes red if the `initial` check is applied to every entry,
 * and (b) goes red if it is dropped. (a) cannot go red on either -- a landing inside the window clears the
 * pair whether or not the check exists -- so it pins the branch, not the mutation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signalMatches } from "./case-matrix.mjs";
import { ruleFindings } from "@a11ign/judge/rules";

type FocusEvent = { type: string; id: number; name: string; atMs: number; initial?: boolean };

function fires(log: FocusEvent[]): boolean {
  return signalMatches(
    { interaction: { focusEvents: { asked: true, checked: true, events: log.length, log } } },
    { type: "focus-removed-on-receipt" },
  );
}

const INITIAL: FocusEvent = { type: "focusin", id: 1, name: "Search", atMs: 100, initial: true };

const LANDED_ELSEWHERE: FocusEvent[] = [
  INITIAL,
  { type: "focusout", id: 1, name: "Search", atMs: 105 },
  { type: "focusin", id: 2, name: "Next field", atMs: 105 },
];

const NO_LANDING: FocusEvent[] = [INITIAL, { type: "focusout", id: 1, name: "Search", atMs: 105 }];

const NON_INITIAL_NO_LANDING: FocusEvent[] = [
  { type: "focusin", id: 1, name: "Search", atMs: 100 },
  { type: "focusout", id: 1, name: "Search", atMs: 105 },
];

test("(a) initial focusin, fast focusout, focus lands on a different control: not the signal", () => {
  assert.equal(fires(LANDED_ELSEWHERE), false);
});

test("(b) initial focusin, fast focusout, no landing: not the signal (unpairable, not a hold time)", () => {
  assert.equal(fires(NO_LANDING), false);
});

test("(c) a NON-initial focusin/focusout of one id inside the window with no landing still fires", () => {
  assert.equal(fires(NON_INITIAL_NO_LANDING), true);
});

function judgeFires(log: FocusEvent[]): boolean {
  return ruleFindings({
    transcript: [], structure: {},
    interaction: { focusEvents: { asked: true, checked: true, events: log.length, log } },
  } as never).some((f) => String(f.wcag).startsWith("2.4.7"));
}

test("the LAB predicate and the SHIPPED rule agree on all three fixtures", () => {
  for (const [name, log] of Object.entries({ LANDED_ELSEWHERE, NO_LANDING, NON_INITIAL_NO_LANDING })) {
    assert.equal(fires(log), judgeFires(log), `${name}: the lab predicate and the judge rule disagree`);
  }
});
