/**
 * AN UNDECLARED CAPTURE HAS THREE POSSIBLE ANSWERS, AND THEY NEED OPPOSITE WORK — #428, on top of #365.
 *
 * A capture no `REAL_PAGES` entry claims used to print as one flat list of 24. #365 split the page that
 * MOVED out of it; #428 splits out the capture that never reached the page at all, whose quality is the
 * finding rather than its declaration. Only what remains belongs under "no declared page claims".
 *
 * **This test exists because #428 shipped without one, and the reason is worth stating.** Its real
 * verification was an end-to-end run against a fabricated corpus — genuine, and reproducible by nobody:
 * it cannot be an `Acceptance:` line, and CI cannot run it. The arithmetic underneath it can be, once the
 * three-way split is a pure function instead of a predicate written out twice.
 *
 * That duplication was itself the defect waiting to happen: the headline count and the list beneath it
 * each computed "not superseded and not furniture" separately, so the two could disagree inside a single
 * output — this repository's most expensive shape, and the exact thing #365's own comment warns about one
 * function above.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { classifyUndeclared } from "../../scripts/check-real-page-findings.ts";

/** A real declared move, so `supersededBy` resolves it rather than the fixture asserting over nothing. */
const MOVED = "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings";
const FURNITURE = "https://www.ofgem.gov.uk/energy-price-cap-fixture";
const UNKNOWN = "https://example.test/nobody-has-accounted-for-this";

const entry = (url: string) => ({ file: `${url.replace(/[^a-z0-9]+/gi, "-")}.json`, url });

test("the three answers are separated, and every capture lands in exactly one", () => {
  const undeclared = [entry(MOVED), entry(FURNITURE), entry(UNKNOWN)];
  const { superseded, furniture, unclaimed } = classifyUndeclared(undeclared, new Set([FURNITURE]));

  assert.equal(superseded.length, 1, "the Met Office page moved and is declared as having moved");
  assert.equal(superseded[0].entry.url, MOVED);
  assert.deepEqual(furniture.map((e) => e.url), [FURNITURE]);
  assert.deepEqual(unclaimed.map((e) => e.url), [UNKNOWN]);

  // The property that matters more than any individual bucket: the three partition the input. A capture
  // counted twice inflates the work remaining; one counted zero times disappears, and `runs/` is not
  // reproducible, so a capture that disappears from the report is evidence nobody will ever go back for.
  assert.equal(superseded.length + furniture.length + unclaimed.length, undeclared.length);
});

test("SUPERSEDED WINS over furniture, and the order is a decision rather than an accident", () => {
  // A capture can be both: the page moved AND the older capture read only a cookie wall — which is
  // exactly the historicenvironment pair in #365 and #363. The move is the actionable fact, because the
  // successor capture exists and is being scored; "it read a cookie wall" describes a file that is
  // already history and that nobody should be sent to fix.
  const both = [entry(MOVED)];
  const { superseded, furniture, unclaimed } = classifyUndeclared(both, new Set([MOVED]));
  assert.equal(superseded.length, 1);
  assert.equal(furniture.length, 0, "reporting it under both headings is the double-count #428 removes");
  assert.equal(unclaimed.length, 0);
});

test("an empty input yields three empty answers, never a throw", () => {
  const { superseded, furniture, unclaimed } = classifyUndeclared([], new Set());
  assert.deepEqual([superseded.length, furniture.length, unclaimed.length], [0, 0, 0]);
});

test("with NO furniture known, every non-superseded capture stays unclaimed", () => {
  // The pre-#428 behaviour, pinned: `furnitureCaptures()` could not see undeclared captures at all, so
  // the furniture set reaching this function was empty for them and they all read as "no idea what this
  // is". If the new `noteEvidence` call is ever removed, this is the state the report returns to.
  const { furniture, unclaimed } = classifyUndeclared([entry(FURNITURE), entry(UNKNOWN)], new Set());
  assert.equal(furniture.length, 0);
  assert.deepEqual(unclaimed.map((e) => e.url).sort(), [FURNITURE, UNKNOWN].sort());
});
