/**
 * DOES THE LAB-SIDE PREDICATE AGREE WITH THE SHIPPED RULE ON A REVERSED PAIR? — issue #385.
 *
 * `focus-event-order.test.ts` settled this against `packages/judge/src/rules.ts`'s `focusLossVerdict`: a
 * `focusout(X)` immediately followed by `focusin(X)` — the shape UI Events produces when a `focus` handler
 * calls `blur()` synchronously, before the browser's own `focusin` for that receipt completes — is F55,
 * and no timing window is involved in deciding it.
 *
 * `focusRemovedOnReceipt` (`signal-predicates.mjs`) is a SEPARATE, duplicated reading of the identical raw
 * `interaction.focusEvents.log`, kept apart because `packages/lab` cannot import `packages/judge`. Until
 * #385 it recognised only the completed-pair-under-a-window mechanism, so `focus-script-blur-window`'s
 * `badSignal` — pointed at exactly this predicate — read the case's real captures as BLIND: the mechanism
 * its own `bad` page demonstrates (`onfocus="...this.blur()"`) is the reversed shape, which the predicate
 * did not yet recognise. Run against the fixtures below rather than reasoned about, the same discipline
 * `focus-event-order.test.ts` used and for the identical reason: the question is pure and settleable
 * without a capture.
 *
 * Fixtures are copied from `focus-event-order.test.ts` verbatim rather than imported, so the two files
 * agreeing is a fact about the source, not an accident of one importing the other's opinion — and because
 * the two live in different packages with no dependency edge between them (the reason this predicate is
 * duplicated at all).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signalMatches } from "./case-matrix.mjs";
import { ruleFindings } from "@a11ign/judge/rules";

type FocusEvent = { type: string; id: number; name: string; atMs: number };

function fires(log: FocusEvent[]): boolean {
  return signalMatches(
    { interaction: { focusEvents: { asked: true, checked: true, events: log.length, log } } },
    { type: "focus-removed-on-receipt" },
  );
}

/** The ordered pair the predicate was originally written for: focus received, removed 5ms later. */
const ORDERED: FocusEvent[] = [
  { type: "focusin", id: 1, name: "Coupon", atMs: 100 },
  { type: "focusout", id: 1, name: "Coupon", atMs: 105 },
];

/** The shape `focus-script-blur-window`'s real captures actually carry. */
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

/** A plain orphan at index 0, nothing reversed about it — the ambiguous case that must NOT fire. */
const ORPHAN_AT_START: FocusEvent[] = [
  { type: "focusout", id: 1, name: "Coupon", atMs: 0 },
  { type: "focusin", id: 2, name: "Next field", atMs: 50 },
];

test("the ORDERED pair still fires -- the pre-#385 mechanism must not regress", () => {
  assert.equal(fires(ORDERED), true);
});

test("the REVERSED pair fires -- issue #385, the whole point of this file", () => {
  assert.equal(fires(REVERSED), true,
    "a focus-handler blur that reaches the log reversed must be recognised, or focus-script-blur-window's "
    + "five real captures read BLIND again");
});

test("an ORDINARY tab-away stays silent, so 'it fires' does not mean 'it fires indiscriminately'", () => {
  assert.equal(fires(ORDINARY), false);
});

test("a reversed pair followed by a REAL next control still fires -- a redirect cannot clear an orphan", () => {
  assert.equal(fires(REVERSED_THEN_ELSEWHERE), true);
});

test("a plain orphan at index 0 does NOT fire -- ambiguous with focus the listener never saw arrive", () => {
  assert.equal(fires(ORPHAN_AT_START), false,
    "this is the shape `known-gaps.md` §42 excludes at capture-listener boundary, not a script-blur finding");
});

function judgeFires(log: FocusEvent[]): boolean {
  return ruleFindings({
    transcript: [], structure: {},
    interaction: { focusEvents: { asked: true, checked: true, events: log.length, log } },
  } as never).some((f) => String(f.wcag).startsWith("2.4.7"));
}

test("the LAB predicate and the SHIPPED rule agree on every fixture above", () => {
  // The two copies exist because packages/lab cannot import packages/judge in the OTHER direction -- so
  // the only thing that can keep them equal is a test reading both, on the same inputs. `packages/lab`
  // depends on `@a11ign/judge`, the legal direction; this test imports it purely to compare, never to
  // re-export.
  for (const [name, log] of Object.entries({
    ORDERED, REVERSED, ORDINARY, REVERSED_THEN_ELSEWHERE, ORPHAN_AT_START,
  })) {
    assert.equal(fires(log), judgeFires(log), `${name}: the lab predicate and the judge rule disagree`);
  }
});
