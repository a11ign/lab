// TWO NORMALISERS, ONE MEANING, AND THEY DRIFTED WITHIN THE HOUR.
//
// `namesOf` (case-matrix.mjs, dataset signals) and `comparableNames` (rules.ts, findings) both reduce an
// NVDA announcement to an accessible name so that the structural sweep and the focus probe can be compared.
// They exist separately because one is `.mjs` read by the corpus tooling and the other is TypeScript
// compiled to `dist` — and making the dataset generator depend on a build is exactly how a stale `dist`
// scored the wrong rules earlier the same day.
//
// The cost showed up immediately: the leading-container fix went into the rule and not the signal, and
// `check-signals` reported the 2.1.1 case CONTAMINATED — its signal firing on the conformant page while the
// rule stayed silent on it. The two disagreeing means a case can be labelled a failure that the shipped
// judge will never report, which is worse than either being wrong alone.
//
// Secure by Design 12.5 names this: DRY is about duplicated KNOWLEDGE, not duplicated text, and two
// encodings of one rule "evolve inconsistently". This test is the thing that makes the duplication safe.
import { test } from "node:test";
import assert from "node:assert/strict";

import { namesOf } from "./case-matrix.mjs";
// The SOURCE, by relative path, not `@a11y-witness/judge/rules` — that specifier resolves to `dist`, and a
// test whose job is to catch drift between two files must not be reading a compiled snapshot of one of them.
// Earlier today a stale `dist` made `rules:gate` score a rule it did not contain.
import { comparableNamesForTest } from "../../../judge/src/rules.js";

/** Real announcements, taken from captures rather than invented — including the ones that caused defects. */
const ANNOUNCEMENTS = [
  "Full name, edit",
  "Full name, edit, focused, blank",
  "form, Full name, edit",
  "Delete draft, button",
  "navigation landmark, list, with 2 items, Bookings, same page, link",
  "Skip to main content, link, focused, visited, linked, same page",
  "Postcode, edit, focused, blank",
  "list, with 6 items, Opening times for the north entrance 01, link",
  "Search the archive, edit, focused, blank",
  "Bookings, heading, level 1",
];

test("the dataset signal and the shipped rule reduce an announcement to the same name", () => {
  for (const announcement of ANNOUNCEMENTS) {
    const signalName = namesOf([announcement])[0] ?? "";
    const ruleName = comparableNamesForTest([announcement])[0] ?? "";
    assert.equal(signalName, ruleName,
      `"${announcement}" reduces to "${signalName}" for the signal and "${ruleName}" for the rule — a case `
      + "can then be labelled a failure the shipped judge will never report");
  }
});

test("the container a sweep names before its first control is not part of the name", () => {
  // The specific divergence that caused the contamination. Both channels must agree that this is "Full name".
  assert.equal(namesOf(["form, Full name, edit"])[0], namesOf(["Full name, edit, focused, blank"])[0]);
});
