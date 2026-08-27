/**
 * `rules:real-pages --update` must never erase a page it was not shown.
 *
 * ## The incident this proves against
 *
 * Measured 2026-08-27. `capture-real-pages` DEFAULTS to `--role=training`, so a run that captured the
 * calibration role alone left the other 39 pages untouched on disk — and `--update` then wrote
 * `currentFindings()` straight over the baseline. It went from **85 pages to 81** and took
 * `www.bl.uk/whats-on/`'s known `2.4.3` with it. Nothing said so.
 *
 * The damage is not the lost line. It is that the next capture of those pages reports their findings as
 * NEW and refuses a promotion, which reads as a regression and is the file rewriting its own memory.
 *
 * ## The distinction that makes the guard usable rather than merely loud
 *
 * A baseline key absent from a fresh scoring is one of two OPPOSITE things:
 *
 *   - the corpus still declares that URL and it simply was not captured — partial coverage, refuse;
 *   - the corpus no longer declares it, because the page was RENAMED or removed on purpose — the old key
 *     IS the stale record, and keeping it is the memory loss.
 *
 * The first version of this guard could not tell them apart, and six of the keys were URLs corrected
 * earlier the same day. It would have forced `--allow-partial` on a complete run, which is how an escape
 * hatch becomes the normal path and stops meaning anything.
 *
 * ## Why this test is the PROOF and not a happy-path exercise
 *
 * Both assertions below fail if the corresponding half of the guard is removed — the refusal half and the
 * rename half. A guard that has only been watched succeed is the `refreshBrowseBuffer` defect, where three
 * green runs vouched for a remedy that never ran at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { REAL_PAGES } from "./real-page-corpus.mjs";
import { pagesTheUpdateWouldDrop, staleBaselineKeys } from "../../scripts/check-real-page-findings.js";

/** A URL the corpus really declares, so the "still declared, not captured" branch is not hypothetical. */
const DECLARED = REAL_PAGES[0].url;

/**
 * A URL the corpus does not declare — the shape a corrected address leaves behind in an old baseline.
 *
 * The BASELINE IS INJECTED rather than read from disk, and that is not tidiness. The first version of this
 * test used the live baseline and hoped a stale key was still in it; one had been corrected the same
 * morning, so the rename assertion could never fire and a mutation that deleted the rename filter passed
 * cleanly. A canary that cannot express the fault, inside the proof written to prevent exactly that.
 */
const RENAMED_AWAY = "https://www.bl.uk/whats-on/";

/** A baseline holding one of each, so both branches are reachable whatever is on disk today. */
const BASELINE = { [DECLARED]: ["4.1.2"], [RENAMED_AWAY]: ["2.4.3"] };

test("a page the corpus STILL declares, absent from this run, is refused", () => {
  const dropped = pagesTheUpdateWouldDrop({}, BASELINE);
  assert.deepEqual(dropped.map((entry) => entry.url), [DECLARED],
    `${DECLARED} is declared by the corpus and was not captured, so writing the baseline now would erase `
    + "what we know about it. The guard must name it, and name ONLY it.");
  assert.deepEqual(dropped[0].findings, ["4.1.2"],
    "the findings travel with the refusal — a count cannot tell you what you are about to lose");
});

test("a page the corpus has STOPPED declaring is dropped, not refused", () => {
  assert.ok(!REAL_PAGES.some((page) => page.url === RENAMED_AWAY),
    "premise: this needs a URL the corpus no longer declares, or it proves nothing");
  const dropped = pagesTheUpdateWouldDrop({}, BASELINE);
  assert.ok(!dropped.some((entry) => entry.url === RENAMED_AWAY),
    `${RENAMED_AWAY} is not in the corpus any more, so refusing over it would block every complete run `
    + "and force --allow-partial to become the normal path");
});

test("the stale keys are REPORTED by name rather than vanishing quietly", () => {
  assert.deepEqual(staleBaselineKeys({}, BASELINE), [RENAMED_AWAY],
    "a deliberate rename and a page that fell out of the corpus by accident look identical unless the "
    + "dropped keys are named");
});

test("a complete run produces no refusal and calls nothing stale", () => {
  // The control. Without it, everything above passes just as happily against a guard that reports
  // EVERYTHING — which would be loud, useless, and switched off within a day.
  const current = { [DECLARED]: [], [RENAMED_AWAY]: [] };
  assert.deepEqual(pagesTheUpdateWouldDrop(current, BASELINE), []);
  assert.deepEqual(staleBaselineKeys(current, BASELINE), []);
});

test("no baseline at all is not a refusal", () => {
  // The first run has nothing to erase. Refusing here would make the guard unbootstrappable.
  assert.deepEqual(pagesTheUpdateWouldDrop({}, null), []);
  assert.deepEqual(staleBaselineKeys({}, null), []);
});
