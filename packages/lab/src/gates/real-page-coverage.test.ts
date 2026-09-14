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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scoredCoverage, scoredFurniture } from "./real-page-coverage.mjs";

// READ AS TEXT, NEVER IMPORTED -- the gate script's closure reaches the corpus (see the header). The wiring test
// below asks what the headline is fed, which only the script's source can answer.
const GATE = readFileSync(
  fileURLToPath(new URL("../../scripts/check-real-page-findings.ts", import.meta.url)), "utf8");

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

// #1529: the furniture headline. On 2026-09-14 stage 11 printed metoffice's pre-move capture as "1 on an unrendered
// SHELL" under the headline and as "not in the scored set" beneath it (#915 5659154711, lines 66, 82 and 120-121).
const CONSENT_SCORED = SCORED[1];

test("#1529: the furniture headline counts a scored overlay and not a superseded shell, which it names as not scored", () => {
  const shown = scoredFurniture({ scored: SCORED, consent: [CONSENT_SCORED], shell: [MOVED_FROM] });
  assert.deepEqual(shown.consent, [CONSENT_SCORED], "positive control: a scored furniture capture is still counted");
  assert.deepEqual(shown.shell, [],
    "the pre-move shell is not one of the scored pages, so the headline must not count it as one");
  assert.deepEqual(shown.notScored, [MOVED_FROM], "named, never dropped: it prints with its evidence as not scored");
});

test("#1529: the headline's furniture count equals what coverage subtracts for the same captures", () => {
  // The two copies this row is about. They agree by construction only while both intersect with the scored set.
  const consent = [CONSENT_SCORED, CONSENT_SCORED];
  const shell = [MOVED_FROM, MOVED_TO];
  const shown = scoredFurniture({ scored: SCORED, consent, shell });
  const coverage = scoredCoverage({ scored: SCORED, unusable: [...consent, ...shell] });
  assert.equal(shown.consent.length + shown.shell.length, coverage.unusablePages.length);
  assert.equal(shown.consent.length + shown.shell.length, 2, "one scored overlay and one scored shell, each once");
});

test("#1529: single-use iterables are read once, so a generator loses no unscored furniture", () => {
  // reviewer-2's should-fix on #1546: the contract is `Iterable<string>`, and the first version read each bucket twice.
  function* once(urls: string[]) { yield* urls; }
  const shown = scoredFurniture({ scored: SCORED, consent: once([CONSENT_SCORED]), shell: once([MOVED_FROM]) });
  assert.deepEqual(shown.consent, [CONSENT_SCORED]);
  assert.deepEqual(shown.shell, []);
  assert.deepEqual(shown.notScored, [MOVED_FROM],
    "a second read of a spent generator is empty, and the unscored capture would vanish from the report");
});

test("#1529: the gate's furniture headline is fed scoredFurniture's result, not furnitureCaptures() as it is", () => {
  assert.match(GATE, /const shown = scoredFurniture\(\{ scored, consent: furniture\.consent, shell: furniture\.shell \}\)/,
    "the headline must be computed through the pure module, the only half a test can drive");
  assert.match(GATE, /\$\{shown\.consent\.length\} capture\(s\) opened on a COOKIE\/CONSENT overlay/,
    "the headline must count the scored consent captures");
  assert.match(GATE, /\$\{shown\.shell\.length\} on an unrendered SHELL/, "and the scored shells");
  assert.doesNotMatch(GATE, /\$\{furniture\.(consent|shell)\.length\}/,
    "a headline counting furnitureCaptures() unintersected states an unscored capture as furniture again");
});
