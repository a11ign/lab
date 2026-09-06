/**
 * AN AUTHORED CLAIM IS TRUE WHEN WRITTEN AND NOTHING EVER ASKS AGAIN.
 *
 * Section 3 of the board document — what the product can now DO — is authored on purpose: no API derives
 * a capability claim. The cost is that it is the one section no gate computes, and therefore the one
 * nothing re-checks. Measured 2026-09-06 (#90): an entry read *"a rule that had never been demonstrated
 * on a real page now has a page to demonstrate it on — written, not yet captured"*. Every clause was true
 * when written; by the time it would have reached the board three were false, including a citation of an
 * issue closed as superseded. **A person happened to re-read it. Nothing in the pipeline could have.**
 *
 * THE CHEAP TELL WAS ALREADY IN THE DATA: every entry carries `at` and `issue`. A machine can ask whether
 * that issue is still open without understanding a word of the claim.
 *
 * SCOPE, and it is the row's own: this does NOT judge whether a claim is true, which is unanswerable. It
 * detects that **the world moved under the sentence** and nobody has looked since.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { achievementsWhoseWorldMoved } from "../../../../scripts/board-data.mjs";

const NOW = Date.parse("2026-09-06T18:00:00Z");
const FRESH = "2026-09-06T12:00:00Z";
const entry = (over: Record<string, unknown> = {}) =>
  ({ at: FRESH, issue: 21, claim: "a capability that is still true", ...over });

test("an OPEN issue, recently reported, renders — the guard must not refuse every edition", () => {
  // The half that keeps this usable. A guard that fires on the normal case is one somebody switches off
  // within a week, and the row says so explicitly.
  const moved = achievementsWhoseWorldMoved({
    achievements: [entry()], issueState: { "21": "OPEN" }, now: NOW,
  });
  assert.deepEqual(moved, []);
});

test("a CLOSED issue is reported, naming the entry, the claim and the issue", () => {
  const moved = achievementsWhoseWorldMoved({
    achievements: [entry({ issue: 2 })], issueState: { "2": "CLOSED" }, now: NOW,
  });
  assert.equal(moved.length, 1);
  assert.equal(moved[0].index, 0, "the INDEX is what makes re-affirming a ten-second act");
  assert.match(moved[0].why, /#2, which is now CLOSED/);
  assert.match(moved[0].why, /does not judge that/,
    "it must say it is not calling the claim false -- that is the row's stated scope and the difference "
    + "between a check somebody acts on and one they argue with");
});

test("`affirmed` clears it, and only a REASON counts as affirming", () => {
  const why = "the fixture landed and the capture confirmed it; the closure was the row, not the claim";
  assert.deepEqual(achievementsWhoseWorldMoved({
    achievements: [entry({ issue: 2, affirmed: why })], issueState: { "2": "CLOSED" }, now: NOW,
  }), []);

  // A BARE TRUE MUST NOT CLEAR IT. A boolean is a keystroke with no thought behind it, which is how a
  // refusal becomes a formality -- the reason every EXEMPT table in this repo demands a reason.
  const bool = achievementsWhoseWorldMoved({
    achievements: [entry({ issue: 2, affirmed: true })], issueState: { "2": "CLOSED" }, now: NOW,
  });
  assert.equal(bool.length, 1, "`affirmed: true` must not silence the guard");

  const thin = achievementsWhoseWorldMoved({
    achievements: [entry({ issue: 2, affirmed: "still true" })], issueState: { "2": "CLOSED" }, now: NOW,
  });
  assert.equal(thin.length, 1, "nor must a two-word placeholder");
});

test("AN ISSUE THE LISTING DID NOT CARRY is its own finding, never silence", () => {
  // "Unchecked is not clean." An issue absent from the listing is a question that COULD NOT BE ASKED --
  // a paging limit, a transfer, a typo. Reporting it as fine hides it; reporting it as CLOSED would
  // refuse an edition over a listing bound. It gets its own sentence.
  const moved = achievementsWhoseWorldMoved({
    achievements: [entry({ issue: 9999 })], issueState: { "21": "OPEN" }, now: NOW,
  });
  assert.equal(moved.length, 1);
  assert.match(moved[0].why, /COULD NOT BE ASKED/);
  assert.doesNotMatch(moved[0].why, /CLOSED/, "cannot-ask must not be reported as closed");
});

test("AGE alone is a finding, on the freshness this file already declares for a gate", () => {
  const old = achievementsWhoseWorldMoved({
    achievements: [entry({ at: "2026-09-01T12:00:00Z" })], issueState: { "21": "OPEN" },
    now: NOW, staleAfterHours: 24,
  });
  assert.equal(old.length, 1);
  assert.match(old[0].why, /past the 24h freshness/);
});

test("an entry with NO issue is not invented into one", () => {
  // Older entries predate the convention. Absent is absent: a guard that manufactured a finding from a
  // missing field would refuse the edition over the file's own history.
  const moved = achievementsWhoseWorldMoved({
    achievements: [{ at: FRESH, claim: "no issue cited" }], issueState: {}, now: NOW,
  });
  assert.deepEqual(moved, []);
});

test("PROOF: it reports EVERY stale entry, not the first — with its index", () => {
  // A guard that stops at the first finding turns one re-affirmation into a queue of renders, each
  // discovering the next problem. Indexes are what make the fix a single pass.
  const moved = achievementsWhoseWorldMoved({
    achievements: [entry({ issue: 1 }), entry({ issue: 21 }), entry({ issue: 3 })],
    issueState: { "1": "CLOSED", "21": "OPEN", "3": "CLOSED" }, now: NOW,
  });
  assert.deepEqual(moved.map((m) => m.index), [0, 2]);
});
