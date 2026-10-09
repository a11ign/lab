/**
 * A PAGE THAT MOVES LEAVES TWO CAPTURES AND ONE DECLARATION — #365.
 *
 * `rules:real-pages` reported 24 captures as `NO DECLARED PAGE CLAIMS`, one flat list, and three different
 * things were in it: a page whose publisher restructured its URLs (the older capture is history), a page
 * retired on purpose, and a capture nobody has got to yet. They need opposite work, and a list of 24 is
 * where an investigation stops.
 *
 * **THE ROW'S STATED MECHANISM IS NOT THE ONE THAT HAPPENS, and that changed the fix.** #365 says *"the
 * capture follows the redirect and is written under the new URL"*. It is not: `capture-real-pages.mjs`
 * writes `slug(page.url)` — the DECLARED address — and has done in every commit that file has ever had.
 * The pair appears when the DECLARATION is edited, so the successor relation is not in the captures at
 * all. Nothing in a capture records where it was requested from; `capture.url` is the only address it
 * carries. The link exists solely in this file's git history, which is why it has to be DECLARED.
 *
 * Seven of them came from one commit — b7dff539, *"the 14% wrong-page rate was seven stale URLs, not a
 * capture fault"* — so this is a recurring event, not an oddity.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { REAL_PAGES, supersededBy, movedFromProblems } from "./real-page-corpus.mjs";

test("the declared moves are real: every movedFrom entry names a live successor", () => {
  const declared = REAL_PAGES.filter((page) => (page.movedFrom ?? []).length > 0);
  // Vacuity guard. If the declarations were dropped, every assertion below would pass over an empty set —
  // the failure this repo meets most often, and the one a guard about corpus bookkeeping is most exposed
  // to, since "nothing has moved" is a perfectly plausible-looking state.
  assert.ok(declared.length >= 7,
    `only ${declared.length} entries declare a movedFrom; b7dff539 alone corrected seven stale URLs, so `
    + "this is the discovery being broken rather than the corpus having settled");
});

test("a superseded address resolves to the entry that now claims it", () => {
  const found = supersededBy("https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings");
  assert.ok(found, "the Met Office warnings page moved to weather.metoffice.gov.uk and is declared as such");
  assert.equal(found.page.url, "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings");
  assert.equal(found.moved.when, "2026-08-26");
  assert.match(found.moved.why, /b7dff539/,
    "the reason must cite where the move is recorded, or a reader cannot check it");
});

test("an address nobody declares having moved from is NOT superseded", () => {
  assert.equal(supersededBy("https://example.test/never-existed"), undefined,
    "this predicate must stay narrow: calling an unclaimed capture 'superseded' would excuse exactly the "
    + "case the undeclared report exists to surface");
});

test("a LIVE address can never also be a superseded one, and no two entries claim the same old address", () => {
  // Both would make the gate excuse a real undeclared capture, which is the opposite of the point: the
  // first means the capture under that slug is being scored right now AND reported as history.
  assert.deepEqual(movedFromProblems(), []);
});

test("MUTATION: the guard catches a movedFrom that names a live entry", () => {
  const live = REAL_PAGES.find((page) => (page.movedFrom ?? []).length > 0);
  assert.ok(live, "no entry declares a move, so this mutation has nothing to act on");
  const original = live.movedFrom;
  live.movedFrom = [{ url: REAL_PAGES[0].url, when: "2026-09-08", why: "a deliberate fault" }];
  try {
    const problems = movedFromProblems();
    assert.ok(problems.some((line) => /LIVE entry/.test(line)),
      `expected a LIVE-entry problem, got ${JSON.stringify(problems)}`);
  } finally {
    live.movedFrom = original;
  }
  assert.deepEqual(movedFromProblems(), [], "the fixture must be restored, or every later test lies");
});

test("MUTATION: a move with no reason is refused — 'it moved' is not a record", () => {
  const live = REAL_PAGES.find((page) => (page.movedFrom ?? []).length > 0);
  assert.ok(live);
  const original = live.movedFrom;
  live.movedFrom = [{ url: "https://example.test/old", when: "2026-09-08", why: "" }];
  try {
    assert.ok(movedFromProblems().some((line) => /needs both a `when` and a `why`/.test(line)));
  } finally {
    live.movedFrom = original;
  }
});
