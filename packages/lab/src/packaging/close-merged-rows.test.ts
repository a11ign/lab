/**
 * THE ISSUE REFERENCES A MERGE RANGE MAKES, and why this file exists at all.
 *
 * `close-merged-rows.mjs` shipped with top-level code and no entry-point guard, so importing it RAN the
 * check and exited -- which made it untestable, which left it at 0% coverage, which is part of why `main`
 * failed its coverage threshold at 77.04% against 78%. A coverage threshold is a SHARED BUDGET: one
 * untestable file spends everyone's, and the cost lands on whoever pushes next.
 *
 * `issuesReferenced` is the whole of the parsing, kept pure so it can be driven here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { issuesReferenced } from "../../../../scripts/close-merged-rows.mjs";

test("a bare reference, a Closes, and a scoped subject are all found", () => {
  assert.deepEqual(
    issuesReferenced("fix(#30): a thing\n\nCloses #52. See #12 for the history."),
    ["30", "52", "12"]);
});

test("the same issue twice is one issue — a range repeats them constantly", () => {
  assert.deepEqual(issuesReferenced("#7 and again #7\nand #7"), ["7"]);
});

test("nothing referenced is an EMPTY list, never a guess", () => {
  // The caller turns this into exit 2 -- "could not tell" -- rather than into a pass. An empty range
  // reported as clean is a check that passes having examined nothing.
  assert.deepEqual(issuesReferenced("docs: tidy a comment"), []);
});

test("a bare # is not a reference, and neither is a colour", () => {
  assert.deepEqual(issuesReferenced("# heading\ncolour #fff and # 12"), []);
});

test("a number longer than six digits is not an issue", () => {
  // Guards against sweeping up a sha-like or timestamp-like token that happens to follow a hash.
  assert.deepEqual(issuesReferenced("#1234567 and #123456"), ["123456"]);
});

test("importing this module does NOT run the check — the defect that caused the red main", () => {
  // If the entry-point guard regresses, importing would exit the test process and this file would report
  // pass having run nothing. Reaching this assertion at all is the proof.
  assert.equal(typeof issuesReferenced, "function");
});
