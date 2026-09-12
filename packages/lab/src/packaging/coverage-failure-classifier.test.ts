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
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { classifyCoverageFailure, commentBody, KIND, testFailuresIn } from "../../../../scripts/coverage-failure-classifier.mjs";

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

// --- #1089: the reporter's REAL bytes, generated here, not a fixture typed from a terminal ---

/**
 * Run one deliberately failing test and return exactly what it printed.
 *
 * `reporter: null` IS THE PRODUCTION SPELLING and it is not a convenience. The coverage step runs
 * `scripts/assert-glob-not-empty.mjs ... --run`, whose `refuseUnknownFlags` takes only
 * `--min`/`--run`/`--test-concurrency` -- **production cannot be told which reporter to use, and exits
 * on being asked.** So a generator that always passes `--test-reporter` exercises a path production
 * cannot take, which is the `NODE_TEST_CONTEXT` defect one step out: the harness shaping the fixture it
 * is being used to generate. Both named reporters are still driven, because the point of the row is that
 * BOTH are read; the flagless case is what CI actually produces.
 */
function reporterOutput(reporter: "tap" | "spec" | null): string {
  const dir = mkdtempSync(join(tmpdir(), "a11y-1089-"));
  try {
    const file = join(dir, "t.test.mjs");
    writeFileSync(file, 'import { test } from "node:test";\n'
      + 'import assert from "node:assert/strict";\n'
      + 'test("passes", () => assert.ok(true));\n'
      + 'test("fails on purpose", () => assert.equal(1, 2));\n');
    // NODE_TEST_CONTEXT MUST GO. The test runner sets it for its own children, and a child that sees it
    // emits the v8 serialiser regardless of `--test-reporter` -- so this helper returned bytes in neither
    // format and `testFailuresIn` correctly said null. **The harness was shaping the fixture it was being
    // used to generate**, which is the same defect as a hand-typed one wearing a different hat.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    void NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath,
      ["--test", ...(reporter === null ? [] : [`--test-reporter=${reporter}`]), file],
      { encoding: "utf8", env });
    return `${run.stdout}${run.stderr}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("#1089: BOTH reporters are read, and the bytes come from the reporters", () => {
  // THE FIXTURE IS GENERATED, because the defect was a fixture typed from what the author's terminal
  // showed. `/ℹ fail (\d+)/` is the SPEC reporter's glyph; CI runs node 22 with no TTY, where the default
  // is TAP. So `testsFailed` was 0 for every CI run there has ever been, and run 34677157881's single
  // named failure classified as CANNOT TELL.
  //
  // A hand-typed fixture cannot catch this, by construction: it can only contain the format its author
  // saw. Generating it means the test fails the day node changes either reporter, which is the day it
  // should.
  for (const reporter of ["tap", "spec"] as const) {
    const failures = testFailuresIn(reporterOutput(reporter));
    assert.ok(failures !== null, `${reporter}'s summary line must be read at all`);
    assert.equal(failures.count, 1, `${reporter}: one test failed`);
    // THE EXACT LIST, not `includes`. `includes` was satisfied by a names array that ALSO carried
    // `failing tests:` -- the spec reporter's section heading, which `specCase` matches because it is a
    // line starting `✖ `. Deleting the filter that removes it was 0 red under the membership check, and
    // the #169 comment would have read `1 test(s) failed: fails on purpose, failing tests:` -- a count
    // and a name list that disagree, naming something that is not a test, in the one field this row adds.
    assert.deepEqual(failures.names, ["fails on purpose"],
      `${reporter}: the failing test must be NAMED and nothing else -- got ${JSON.stringify(failures.names)}`);
  }
});

test("#1089: an unreadable log is null, never zero failures", () => {
  // The conflation the old code shipped: `failMatch ? Number(failMatch[1]) : 0`. A log it could not parse
  // and a log with nothing wrong produced the same 0, and the verdict then read CANNOT TELL for the wrong
  // reason -- which is indistinguishable from the right one to a reader.
  assert.equal(testFailuresIn("c8 ran and said nothing about tests"), null,
    "no summary line at all is 'could not read', not 'nothing failed'");
  const clean = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success",
    coverageLog: "c8 ran and said nothing about tests" });
  assert.match(clean.detail, /carries NEITHER reporter's test summary/,
    "and the verdict must SAY which kind of CANNOT TELL it is");
});

test("#1089: the FLAGLESS invocation — what production actually produces — reaches TEST_FAILURE", () => {
  // The coverage step cannot choose a reporter: `assert-glob-not-empty.mjs`'s `refuseUnknownFlags` takes
  // `--min`/`--run`/`--test-concurrency` and exits on `--test-reporter`. So "read both formats" is not
  // the cautious choice over "CI is node 22 today" -- it is the only correct one, because the format is
  // whatever node defaults to on the runner, and that has already changed once between node 22 and 24.
  //
  // Driven with NO reporter flag, which is the one spelling the other tests here cannot reach.
  const log = reporterOutput(null);
  const failures = testFailuresIn(log);
  assert.ok(failures !== null,
    `the default reporter's summary must be readable -- got null for:\n${log.slice(0, 400)}`);
  assert.equal(failures.count, 1, "one test failed");
  assert.deepEqual(failures.names, ["fails on purpose"],
    `and exactly one name, with no section heading among them -- got ${JSON.stringify(failures.names)}`);

  const verdict = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success",
    coverageLog: log });
  assert.equal(verdict.kind, "TEST_FAILURE", "end to end, on the path CI takes");
  assert.match(verdict.detail, /fails on purpose/, "with the name, not just the count");
});

test("#1089: a real TAP log reaches the TEST_FAILURE verdict with the name in it", () => {
  const verdict = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success",
    coverageLog: reporterOutput("tap") });
  assert.equal(verdict.kind, "TEST_FAILURE",
    "CI's own reporter must produce the test-failure verdict, which is the whole row");
  assert.match(verdict.detail, /fails on purpose/,
    "and name the test, because a count sends a reader to the run and a name sends them to the test");
});
