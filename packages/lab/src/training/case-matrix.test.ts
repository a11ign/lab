import assert from "node:assert/strict";
import test from "node:test";
import { CASES, evidenceUnits, signalMatches } from "./case-matrix.mjs";

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
  badSignal: { type: string; control?: string; expected?: string };
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
