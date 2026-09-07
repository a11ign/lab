/**
 * A COMMENT SAYING "coverage failed" IS NOT A FINDING (#169).
 *
 * `coverage.yml`'s failure step used `if: failure()` on the whole job and posted one generic message —
 * identical whether `npm ci` broke, a test asserted wrong, or c8 genuinely found a metric below
 * `.c8rc.json`'s threshold. Those three need three different responses, and only the third is what #169
 * exists to catch: "coverage regression tracking" read literally, a test failure or an infra break is not
 * a coverage regression at all.
 *
 * DRIVEN AGAINST REAL C8 OUTPUT SHAPES, not guessed ones — the threshold-miss regex is checked against
 * `checkCoverage()`'s own source in `node_modules/c8/lib/commands/check-coverage.js` below, so a future
 * c8 upgrade that reworks the message is caught here rather than by a silent misclassification in
 * production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { classifyCoverageFailure, commentBody, KIND } from "../../../../scripts/coverage-failure-classifier.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("npm ci failing is INFRA, and the coverage log is never even consulted", () => {
  const v = classifyCoverageFailure({ ciOutcome: "failure", buildOutcome: "success", coverageLog: "anything" });
  assert.equal(v.kind, KIND.INFRA);
  assert.match(v.detail, /npm ci.*failed/);
  assert.match(v.detail, /not a coverage regression/);
});

test("npm run build failing is INFRA, distinctly from npm ci failing", () => {
  const v = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "failure", coverageLog: "anything" });
  assert.equal(v.kind, KIND.INFRA);
  assert.match(v.detail, /npm run build.*failed/);
});

test("a real c8 threshold miss is REGRESSION, and names the metric, the actual and the threshold", () => {
  const log = "some test output\nERROR: Coverage for lines (76.2%) does not meet global threshold (78%)\n";
  const v = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success", coverageLog: log });
  assert.equal(v.kind, KIND.REGRESSION);
  assert.deepEqual(v.thresholdMisses, [{ metric: "lines", actual: 76.2, threshold: 78 }]);
  assert.match(v.detail, /lines.*76\.2%.*78%/);
});

test("more than one metric missing threshold are all named, not just the first", () => {
  const log = "ERROR: Coverage for lines (76.2%) does not meet global threshold (78%)\n"
    + "ERROR: Coverage for statements (75.9%) does not meet global threshold (78%)\n";
  const v = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success", coverageLog: log });
  assert.equal(v.kind, KIND.REGRESSION);
  assert.ok(v.thresholdMisses);
  assert.equal(v.thresholdMisses.length, 2);
  assert.match(v.detail, /lines/);
  assert.match(v.detail, /statements/);
});

test("a real test failure, no threshold miss, is TEST_FAILURE — not a coverage regression", () => {
  const log = "✖ some assertion in a test\nℹ tests 2810\nℹ pass 2809\nℹ fail 1\n";
  const v = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success", coverageLog: log });
  assert.equal(v.kind, KIND.TEST_FAILURE);
  assert.equal(v.testsFailed, 1);
  assert.match(v.detail, /TEST regression, not a coverage regression/);
});

test("a threshold miss AND failing tests together still classify as REGRESSION, and both are named", () => {
  // c8 propagates the test runner's exit code, but a genuine threshold miss is still the sharper finding
  // -- this is the case where BOTH things are true, and neither should be hidden by the other.
  const log = "ℹ fail 2\nERROR: Coverage for branches (70.0%) does not meet global threshold (78%)\n";
  const v = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success", coverageLog: log });
  assert.equal(v.kind, KIND.REGRESSION);
  assert.equal(v.testsFailed, 2);
  assert.match(v.detail, /also failed/);
});

test("a failed job with a log matching NEITHER pattern is UNKNOWN, never silently a clean pass", () => {
  const v = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success", coverageLog: "some crash, no c8 output at all\n" });
  assert.equal(v.kind, KIND.UNKNOWN);
  assert.match(v.detail, /INCONCLUSIVE/);
});

test("a missing/unreadable log is UNKNOWN, distinct from a log that was read and found unclassifiable", () => {
  const v = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success", coverageLog: null });
  assert.equal(v.kind, KIND.UNKNOWN);
  assert.match(v.detail, /could not be read/);
});

test("commentBody names a different headline for each kind, so a reader does not have to open the log", () => {
  const headlines = Object.values(KIND).map((kind) =>
    commentBody({ verdict: { kind, detail: "x" }, runUrl: "http://example.invalid" }));
  assert.equal(new Set(headlines.map((h) => h.split("\n")[0])).size, Object.values(KIND).length,
    "every KIND must produce a DISTINCT headline, or a reader cannot tell them apart at a glance");
  for (const body of headlines) assert.match(body, /http:\/\/example\.invalid/, "the run link must survive");
});

test("the threshold-miss pattern is checked against c8's OWN source, not a guessed format", () => {
  const src = readFileSync(path.join(REPO_ROOT, "node_modules/c8/lib/commands/check-coverage.js"), "utf8");
  assert.match(src, /'ERROR: Coverage for '/,
    "c8's own error-message construction changed shape -- update classifyCoverageFailure's regex to match "
    + "before trusting its REGRESSION verdict again");
});
