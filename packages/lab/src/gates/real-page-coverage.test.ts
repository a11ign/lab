/**
 * #1524: AN UNUSABLE CAPTURE THAT IS NOT A SCORED PAGE DOES NOT REDUCE THE REAL-PAGE GATE'S COVERAGE.
 *
 * Stage 11 read "85 of 91" on 2026-09-14 because a superseded history capture -- metoffice's pre-move URL, noted
 * under the URL it was fetched at -- was furniture, and every furniture capture came off `examined` whether or
 * not it was one of the scored pages. These drive the decision the gate script now calls.
 *
 * THIS FILE IMPORTS ONLY `real-page-coverage.mjs`. The gate script's import closure reaches the corpus, so
 * importing it here would make this Acceptance unrunnable in CI. The declared-unexaminable half of the
 * denominator stays in the script, where `unexaminable-declaration.test.ts` pins it.
 *
 * Fixture pages are `.example` hosts, shaped like a page that moved and unable to be a real corpus page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoredCoverage } from "./real-page-coverage.mjs";

const MOVED_TO = "https://weather.fixture-office.example/warnings-and-advice/uk-warnings";
const MOVED_FROM = "https://www.fixture-office.example/weather/warnings-and-advice/uk-warnings";
const SCORED = [MOVED_TO, "https://conformant-b.example/", "https://conformant-c.example/modes/"];

test("#1524: a superseded furniture capture at a movedFrom URL leaves `examined` where it was", () => {
  const coverage = scoredCoverage({ scored: SCORED, unusable: [MOVED_FROM] });
  assert.equal(coverage.examined, SCORED.length,
    "the pre-move capture is not one of the scored pages, so it cannot reduce them");
  assert.deepEqual(coverage.unusablePages, []);
  assert.deepEqual(coverage.notScored, [MOVED_FROM], "named as not in the scored set, never dropped");
});

test("#1524: an unusable capture that IS a scored page still moves `examined` by one", () => {
  // ceo's second case: an intersection that returned nothing would pass the case above and fail this one.
  const coverage = scoredCoverage({ scored: SCORED, unusable: [MOVED_FROM, MOVED_TO] });
  assert.equal(coverage.examined, SCORED.length - 1);
  assert.deepEqual(coverage.unusablePages, [MOVED_TO],
    "the scored unusable page is what the script's declared-page intersection reads");
  assert.deepEqual(coverage.notScored, [MOVED_FROM]);
});

test("#1524: a page unusable for two reasons counts once", () => {
  // The same URL can be furniture AND a suspect census (tfl.gov.uk on 2026-09-06); counting it twice read 82 of 85.
  const coverage = scoredCoverage({ scored: SCORED, unusable: [MOVED_TO, MOVED_TO] });
  assert.equal(coverage.examined, SCORED.length - 1);
  assert.deepEqual(coverage.unusablePages, [MOVED_TO]);
});
