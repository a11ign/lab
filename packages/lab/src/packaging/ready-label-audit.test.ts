/**
 * `ready` must be mutually exclusive with every label that already means "not actually pickable" (#121).
 * See `scripts/ready-label-audit.mjs`'s own header for the incident: `dispatcher` labelled #13 and #75
 * `ready` to hit a floor, while one was disputed and the other had no Region or Acceptance at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  READY_LABEL, MUTEX_LABELS, mutexViolations, fetchOpenIssues,
} from "../../../../scripts/ready-label-audit.mjs";

// --- mutexViolations: pure, no I/O ---

test("a row carrying ready alone is not a violation", () => {
  const issues = [{ number: 1, title: "fine", labels: ["backlog", READY_LABEL] }];
  assert.deepEqual(mutexViolations(issues), []);
});

test("a row carrying a mutex label WITHOUT ready is not a violation -- the rule is about the PAIR", () => {
  const issues = [{ number: 2, title: "blocked, correctly unlabelled ready", labels: ["backlog", "disputed"] }];
  assert.deepEqual(mutexViolations(issues), []);
});

test("ready + disputed is caught, exactly tonight's #13", () => {
  const issues = [{ number: 13, title: "disputed row", labels: [READY_LABEL, "disputed"] }];
  const violations = mutexViolations(issues);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].number, 13);
  assert.deepEqual(violations[0].conflicting, ["disputed"]);
});

test("every MUTEX_LABELS entry is individually caught, not just the first one tested", () => {
  for (const label of MUTEX_LABELS) {
    const issues = [{ number: 99, title: "t", labels: [READY_LABEL, label] }];
    const violations = mutexViolations(issues);
    assert.equal(violations.length, 1, `ready + ${label} was not caught`);
    assert.deepEqual(violations[0].conflicting, [label]);
  }
});

test("a row carrying MULTIPLE mutex labels alongside ready names all of them", () => {
  const issues = [{ number: 3, title: "doubly wrong", labels: [READY_LABEL, "fleet-gated", "decision"] }];
  const violations = mutexViolations(issues);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].conflicting.sort(), ["decision", "fleet-gated"]);
});

test("only the ready-carrying rows are scanned -- a clean board scans everything and flags nothing", () => {
  const issues = [
    { number: 1, title: "a", labels: [READY_LABEL] },
    { number: 2, title: "b", labels: ["disputed"] },
    { number: 3, title: "c", labels: ["fleet-gated", "epic"] },
  ];
  assert.deepEqual(mutexViolations(issues), []);
});

// --- MUTATION: the rule must not silently stop covering a label ---

test("MUTATION: review-only is genuinely in MUTEX_LABELS, not just described as such", () => {
  // #27's own shape -- a row that solicits review and should never be started as work. If this list ever
  // drops the label the row was filed to add, the rule keeps working for the other five and goes silent
  // for exactly the case that motivated it.
  assert.ok(MUTEX_LABELS.includes("review-only"),
    "review-only must be in MUTEX_LABELS -- it is #27's own shape, the reason this label exists at all");
});

// --- fetchOpenIssues: the vacuity guard, same discipline as row-claim.mjs's fetchLabels ---

function jsonRun(response: string) {
  return () => response;
}

function throwingRun(message: string) {
  return () => { throw new Error(message); };
}

test("fetchOpenIssues parses a well-formed gh response", () => {
  const run = jsonRun(JSON.stringify([
    { number: 1, title: "a row", labels: [{ name: READY_LABEL }] },
  ]));
  const result = fetchOpenIssues({ run });
  assert.deepEqual(result, [{ number: 1, title: "a row", labels: [READY_LABEL] }]);
});

test("MUTATION: gh itself failing is a thrown error, never an empty (= clean-board-reading) list", () => {
  const run = throwingRun("gh: authentication required");
  assert.throws(() => fetchOpenIssues({ run }), /could not list open issues/);
});

test("MUTATION: a non-JSON response is a thrown error, never a silent empty list", () => {
  const run = jsonRun("not json at all");
  assert.throws(() => fetchOpenIssues({ run }), /was not JSON/);
});

test("MUTATION: a response that is not a list is a thrown error", () => {
  const run = jsonRun(JSON.stringify({ number: 1 }));
  assert.throws(() => fetchOpenIssues({ run }), /was not a list/);
});

test("MUTATION: an entry missing labels is a thrown error, never silently skipped", () => {
  const run = jsonRun(JSON.stringify([{ number: 1, title: "a" }]));
  assert.throws(() => fetchOpenIssues({ run }), /missing number\/title\/labels/);
});

test("MUTATION: a label object with no name is a thrown error", () => {
  const run = jsonRun(JSON.stringify([{ number: 1, title: "a", labels: [{}] }]));
  assert.throws(() => fetchOpenIssues({ run }), /has a label with no name/);
});
