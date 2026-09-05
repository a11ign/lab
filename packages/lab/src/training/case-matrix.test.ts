import assert from "node:assert/strict";
import test from "node:test";
import { CASES, evidenceUnits, signalMatches, arrowKeysAreInert } from "./case-matrix.mjs";

/**
 * The fields of a generated case that these tests read.
 *
 * `case-matrix.mjs` is JavaScript, so `CASES` arrives untyped and every destructure below was an implicit
 * `any` — five type errors that kept the repo's `typecheck` red, and with it the pre-push hook, from
 * 2 August. Naming the shape once fixes all five without weakening anything: an added field still
 * type-checks, a renamed one still fails here.
 */
interface GeneratedCase {
  id: string;
  good: string;
  bad: string;
  badSignal: { type: string; control?: string; expected?: string; language?: string };
  probeTables?: boolean;
}

const cases = CASES as unknown as GeneratedCase[];

const tableSignal = { type: "table-unassociated" };

test("table-unassociated reads the dedicated cell announcement", () => {
  assert.equal(signalMatches({
    structure: { tableCells: ["Departs, column 2, 09:15"] },
  }, tableSignal), false);
  assert.equal(signalMatches({
    structure: { tableCells: ["column 2, 09:15"] },
  }, tableSignal), true);
});

test("table cells are included in the model evidence stream", () => {
  assert.deepEqual(evidenceUnits({
    transcript: [],
    structure: { headings: [], landmarks: [], formFields: [], tableCells: ["Departs, column 2, 09:15"] },
  }), [{ channel: "table-cell-navigation", text: "Departs, column 2, 09:15" }]);
});

test("table-unassociated does not infer from the general transcript or cell count", () => {
  assert.equal(signalMatches({
    transcript: ["row 2, column 2, 09:15"],
    structure: { tableCells: [] },
  }, tableSignal), false);
  assert.equal(signalMatches({
    structure: { tableCells: ["Departs, column 2, 09:15", "Platform, column 3, 3"] },
  }, tableSignal), false);
});

test("unnamed controls tolerate NVDA's object replacement character", () => {
  const signal = { type: "unnamed-form-field" };
  assert.equal(signalMatches({ structure: { formFields: ["￼, button"] } }, signal), true);
  assert.equal(signalMatches({ structure: { formFields: ["Open account search, button"] } }, signal), false);
});

test("every table case explicitly requests the table probe", () => {
  const tableCases = cases.filter(({ badSignal }) => badSignal.type === "table-unassociated");
  assert.ok(tableCases.length > 0);
  assert.ok(tableCases.every(({ probeTables }) => probeTables === true));
});

test("status-message pairs expose an explicit live region only on the good page", () => {
  const statusCases = cases.filter(({ badSignal }) => badSignal.type === "form-activation-silent");
  assert.ok(statusCases.length > 0);
  for (const testCase of statusCases) {
    assert.match(testCase.good, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.doesNotMatch(testCase.bad, /role="status"|aria-live=/);
  }
});

test("error fixtures prevent submit navigation before the probe can fire", () => {
  for (const id of ["form-error-calibration-bus-depot-013", "form-error-silent-bulk-health-pavilion-042"]) {
    const testCase = cases.find((candidate) => candidate.id === id);
    assert.ok(testCase, id + " should exist");
    assert.match(testCase.good, /<form[^>]+onsubmit=/);
    assert.match(testCase.bad, /<form[^>]+onsubmit=/);
    assert.doesNotMatch(testCase.good + testCase.bad, /addEventListener\(['"]submit/);
  }
});

test("the seed validation fixture changes only error announcement, not field naming", () => {
  const testCase = cases.find((candidate) => candidate.id === "form-error-silent");
  assert.ok(testCase, "form-error-silent should exist");
  assert.match(testCase.good, /<label for="reference">Reference number<\/label>/);
  assert.match(testCase.bad, /<label for="reference">Reference number<\/label>/);
  assert.doesNotMatch(testCase.bad, /<span>Reference number<\/span>/);
});

test("arrow-keys-inert fires only when the page said nothing AND focus did not move", () => {
  // The observation 2.1.1 abstains without. `SHARES_ONE_TAB_STOP` refuses to decide on a radio group
  // because a native one and a broken one both present ONE tab stop — the tab ring cannot separate them,
  // and that refusal is correct. Pressing the arrow is the only thing that can.
  const inert = { focusBefore: "Standard delivery, radio button", announced: "",
    focusAfter: "Standard delivery, radio button, 1 of 3" };
  assert.equal(arrowKeysAreInert(inert), true);
  // EITHER signal of movement clears it, never both required. NVDA re-announces the same option
  // differently depending on how the caret arrived, so demanding both would call a working group broken.
  assert.equal(arrowKeysAreInert({ ...inert, announced: "Express delivery, radio button, 2 of 3" }), false);
  assert.equal(arrowKeysAreInert({ ...inert, focusAfter: "Express delivery, radio button" }), false);
});

test("no language-unmarked case names its own language in the page text", () => {
  // `languageIsUnannounced` fires when the language NAME (not the ISO code) is absent from everything
  // NVDA said -- and NVDA reads the page's own visible text too, so a lead or passage that happens to
  // contain the word ("reproduced in the original French") puts it in spokenText() on BOTH variants
  // regardless of whether a language change was actually announced. That made three real cases BLIND at
  // the gate on 2026-09-05 (case-matrix.mjs, the comment above `language-marked-silent-museum`), fixed by
  // hand-rewriting their lead text -- an unwritten convention until then. This is the guard that convention
  // never had: it is cheap (no capture, no fleet), runs on every push, and the next case that violates it
  // fails here instead of surviving until a real capture run reports it blind.
  const languageCases = cases.filter((c) => c.badSignal.type === "language-unmarked" && c.badSignal.language);
  assert.ok(languageCases.length >= 5, "the language-of-parts family has shrunk; re-read this test");
  const violators = languageCases.filter((c) => {
    const name = c.badSignal.language as string;
    const pattern = new RegExp(`\\b${name}\\b`, "i");
    return pattern.test(c.good) || pattern.test(c.bad);
  });
  assert.deepEqual(violators.map((c) => c.id), [],
    "these cases name their own declared language somewhere in the page text, which makes " +
    "language-unmarked unable to discriminate the pair");
});

test("an unprobed or unreadable capture makes NO arrow claim", () => {
  // A capture that never pressed an arrow cannot say whether one works, and reading that absence as
  // inertness is this corpus's oldest defect wearing a new criterion. An unreadable focus on either side
  // means the probe could not observe, which is equally not evidence of inertness.
  assert.equal(arrowKeysAreInert(null), false);
  assert.equal(arrowKeysAreInert(undefined), false);
  assert.equal(arrowKeysAreInert({ focusBefore: "", announced: "", focusAfter: "" }), false);
  assert.equal(arrowKeysAreInert({ focusBefore: "Standard, radio button", announced: "", focusAfter: "" }),
    false);
});
