/**
 * #1181: A DECLARED PAGE WITH NO CAPTURE IS INVISIBLE TO EVERY LINE THIS MODULE PRINTS.
 *
 * Every reader reports on the captures it FOUND. A page in `REAL_PAGES` that was never captured
 * contributes no age, no role count and no spread — so the report says the corpus is fresh because
 * everything it can see is fresh, and what it cannot see is the thing that went wrong.
 *
 * The comparison has to run from the DECLARED list, which is the only place that knows a page should
 * exist. Pure, so it is driven here without a corpus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { captureAgeLines, missingCaptures } from "./real-page-freshness.mjs";
import { REAL_PAGES } from "./real-page-corpus.mjs";

const AT = "2026-09-12T10:00:00Z";
const declaredUrls = REAL_PAGES.map((p) => p.url);

test("#1181: missingCaptures names what was declared and not found", () => {
  assert.deepEqual(missingCaptures(["a", "b", "c"], ["b"]), ["a", "c"]);
  assert.deepEqual(missingCaptures(["a"], ["a"]), []);
  assert.deepEqual(missingCaptures([], ["a"]), [], "found-but-undeclared is a different row's question");
  assert.deepEqual(missingCaptures(["b", "a", "b"], []), ["a", "b"], "deduped and sorted");
});

test("#1181 THE POSITIVE CONTROL: a declared page with no capture is NAMED in the output", () => {
  // The row's own mutation, as a test: hand the reporter every page but one and assert the missing one
  // is named. Without this the assertion below is satisfied by a reporter that says nothing at all.
  const absent = declaredUrls[0];
  const ages = declaredUrls.slice(1).map((url) => ({ at: AT, role: "training", url }));
  const out = captureAgeLines(ages).join("\n");
  assert.match(out, /1 of \d+ DECLARED page\(s\) have NO capture/);
  assert.ok(out.includes(absent), `the missing page must be named, not just counted: ${absent}`);
});

test("#1181: a complete corpus says nothing about missing pages", () => {
  // The control for the control. A reporter that always warned would pass the test above.
  const ages = declaredUrls.map((url) => ({ at: AT, role: "training", url }));
  assert.doesNotMatch(captureAgeLines(ages).join("\n"), /DECLARED page\(s\) have NO capture/);
});

test("#1181: a caller that supplies no urls gets SILENCE, not `0 missing`", () => {
  // "Could not ask" and "the answer is none" are different facts. Printing the second for the first is
  // how this module came to report a half-captured corpus as fresh, and a reconciliation that assumed
  // every caller passes urls would reinstate it for the callers that do not.
  const out = captureAgeLines([{ at: AT, role: "training" }]).join("\n");
  assert.doesNotMatch(out, /DECLARED page\(s\) have NO capture/);
});

test("#1181: the COUNT is never truncated even when the names are", () => {
  // The largest number is the one that matters most, and it is the one a wall of names would bury.
  const out = captureAgeLines([{ at: AT, role: "training", url: "https://nope.example/x" }]).join("\n");
  assert.match(out, new RegExp(`${REAL_PAGES.length} of ${REAL_PAGES.length} DECLARED`));
  assert.match(out, /\.\.\. and \d+ more/);
});
