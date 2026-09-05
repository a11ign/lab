/**
 * A capture taken during a TEST run is a production capture. Nothing is thrown away.
 *
 * Test grade exists so a question can be answered without a full recapture, and the obvious worry is that
 * it creates second-class evidence — captures that later have to be taken again. It does not, and this
 * asserts the two properties that make that true:
 *
 *   1. **The grade never reaches the capture writer.** A capture records the page it actually read, so a
 *      capture taken under test grade is byte-identical to one taken without it. The grade changes which
 *      captures an EXPORT will accept, not what a capture IS.
 *   2. **Resume never accepts stale pages.** `previouslyCaptured` decides what `--resume` may SKIP, and it
 *      calls the same usability check the export does. Reading the grade ambiently made a test-grade
 *      capture run treat a stale capture as already done — refusing to recapture the very cases the test
 *      run existed to refresh. The grade is a PARAMETER now, and only the export passes it.
 *
 * Together those mean a test run and a production run share one pool of captures: the test run's fresh
 * captures are directly reusable, and a later release-grade export uses them without recapturing. Measured
 * 2026-08-26: after a 25-case test run, the release-grade corpus run found those cases cached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11y-witness/evidence/source-text";

// Comments stripped for every caller: every test below checks presence or absence of a specific token
// against raw or sliced source, and a comment mentioning that token in prose would satisfy or defeat the
// check exactly as it did for `mapping-parity.test.ts` and `cli.test.ts`. See
// `@a11y-witness/evidence/source-text`.
const read = (name: string) =>
  stripComments(readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8"));

test("the dataset grade never reaches the capture writer", () => {
  // A capture must record the page it actually read, whatever question is being asked of it later. If the
  // writer ever consults the grade, a test run starts producing evidence a release cannot use — which is
  // the thing this whole mechanism is designed not to do.
  const writer = read("capture-screenreader-dataset.mjs");
  assert.ok(!/A11Y_DATASET_GRADE|TEST_GRADE/.test(writer),
    "the capture writer must not know about the dataset grade — a capture is a capture, and a test run's "
    + "captures must be reusable by a release-grade export without being taken again");
});

test("RESUME never accepts a stale page, however the export is graded", () => {
  // `previouslyCaptured` decides what --resume may SKIP. Accepting stale pages there would skip exactly
  // the cases a test run exists to refresh, so the grade must not reach it.
  const resume = read("capture-resume.mjs");
  const previously = resume.slice(resume.indexOf("export function previouslyCaptured"));
  assert.ok(!/acceptStalePages/.test(previously),
    "previouslyCaptured must not pass acceptStalePages — resume decides what to skip, and skipping a "
    + "stale capture is refusing to recapture the case that moved");
});

test("only the EXPORT passes the grade, and it does so explicitly", () => {
  const exporter = read("export-screenreader-dataset.mjs");
  assert.match(exporter, /acceptStalePages: TEST_GRADE/,
    "the export is the one caller that may accept stale pages, and it must say so at the call site "
    + "rather than inheriting it from the environment");
});

test("the usability check defaults to REFUSING stale pages", () => {
  // A default that accepted them would make every caller that forgot the parameter silently permissive —
  // the failure mode this repo names as a check that cannot discriminate.
  const resume = read("capture-resume.mjs");
  assert.match(resume, /acceptStalePages = false/,
    "the safe answer must be the default; a caller opts IN to accepting stale evidence");
});
