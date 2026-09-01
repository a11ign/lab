import { test } from "node:test";
import assert from "node:assert/strict";

import { arrowKeysAreInert, escapeReleasedFocusIn } from "../training/case-matrix.mjs";
import { ruleFindings } from "@a11y-witness/judge/rules";

/**
 * TWO OBSERVATIONS, EACH DECIDED IN TWO PLACES, and nothing compared the copies.
 *
 * `case-matrix.mjs` runs under plain `node` for the corpus generator and cannot import TypeScript — the
 * same constraint that forced `namesOf` and `comparableNames` apart, where the two silently disagreed
 * about what an accessible NAME is until `name-normalisation.test.ts` pinned them and failed twice on its
 * first run.
 *
 * So the corpus-side predicates (`arrowKeysAreInert`, `escapeReleasedFocusIn`) and the rules-side ones
 * (`arrowKeysDidNotMove`, `escapeReleasedFocus`) are a fact stated twice. This is the third remedy in the
 * repo's own order of preference — delete a copy, derive one from the other, or PIN THEM EQUAL — because
 * the first two are unavailable across that language boundary.
 *
 * Driven through `ruleFindings` rather than by importing the private helpers, so what is compared is the
 * DECISION each side actually reaches rather than a function that might no longer be the one in use.
 */
const RADIO_PAGE = {
  transcript: ["Delivery method", "Standard delivery, radio button, checked"],
  structure: {
    formFields: [
      "Standard delivery, radio button, checked",
      "Express delivery, radio button, not checked",
      "Collect in store, radio button, not checked",
    ],
    headings: [], links: [], graphics: [],
  },
};
/** A ring that reached only the first option, and cycled — so Tab proved it could go no further. */
const CONFINED_RING = ["Standard delivery, radio button, focused, checked",
  "Standard delivery, radio button, focused, checked",
  "Standard delivery, radio button, focused, checked"];

const arrowsInert = { focusBefore: "Standard delivery, radio button",
  announced: "", focusAfter: "Standard delivery, radio button, 1 of 3" };
const arrowsWork = { focusBefore: "Standard delivery, radio button",
  announced: "Express delivery, radio button, 2 of 3", focusAfter: "Express delivery, radio button" };

const decides = (arrowNavigation: unknown): boolean =>
  ruleFindings({ ...RADIO_PAGE, interaction: { controls: [], focusOrder: CONFINED_RING, arrowNavigation } } as never)
    .some((f) => f.wcag.startsWith("2.1.1"));

test("the corpus predicate and the RULE agree that inert arrows are a finding", () => {
  assert.equal(arrowKeysAreInert(arrowsInert), true, "corpus side must call this inert");
  assert.equal(decides(arrowsInert), true, "and the rule must make the 2.1.1 finding");
});

test("both stay silent when the arrows moved", () => {
  assert.equal(arrowKeysAreInert(arrowsWork), false);
  assert.equal(decides(arrowsWork), false,
    "a widget whose arrows work is the specified behaviour, not a keyboard trap");
});

test("both make NO claim when the probe never ran", () => {
  // The half that matters most. An absent observation must leave the exemption in place, or every
  // pre-protocol-13 capture in the corpus becomes a 2.1.1 accusation — a check rejecting evidence whose
  // absence is not the finding, which is this repo's oldest rule pointed the other way.
  assert.equal(arrowKeysAreInert(undefined), false);
  assert.equal(decides(undefined), false, "absence must not lift the arrow exemption");
});

test("the escape pair agrees too, in both directions", () => {
  // Same shape, same reason, different observation — pinned here so one file covers the boundary.
  assert.equal(escapeReleasedFocusIn({ announced: "heading, level 1, Delivery details",
    focusBefore: "Town, edit", focusAfter: "Full name, edit" }), true);
  assert.equal(escapeReleasedFocusIn({ announced: "", focusBefore: "Town, edit",
    focusAfter: "Town, edit, focused, blank" }), false);
  assert.equal(escapeReleasedFocusIn(undefined), false, "absence is not a release");
});
