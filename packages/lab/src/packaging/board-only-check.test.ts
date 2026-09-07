/**
 * `scripts/board-only-check.mjs`'s `isBoardOnlyDiff` is what the pre-push hook's board-only fast path
 * calls, and it must ask the IDENTICAL question `ci.yml`'s `board` job asks (via `ci-changed.mjs`'s
 * `boardOnly` and `DOC_ROOT_FILES`, reused rather than re-derived) -- a second, drifted copy of "is this a
 * board file" between the local hook and CI is exactly the "fact stated twice" shape this repo names as
 * its most expensive recurring defect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBoardOnlyDiff } from "../../../../scripts/board-only-check.mjs";
import { classify } from "../../../../scripts/ci-changed.mjs";

test("isBoardOnlyDiff: true when every doc-touching file is a board file", () => {
  assert.equal(isBoardOnlyDiff(["docs/board/summaries/2026-09-07.md"]), true);
  assert.equal(isBoardOnlyDiff(["docs/board/reported.json"]), true);
  assert.equal(isBoardOnlyDiff(["docs/board/summaries/2026-09-07.md", "docs/board/reported.json"]), true);
});

test("isBoardOnlyDiff: false when mixed with any other doc file", () => {
  assert.equal(isBoardOnlyDiff(["docs/board/summaries/2026-09-07.md", "docs/known-gaps.md"]), false);
  assert.equal(isBoardOnlyDiff(["docs/board/summaries/2026-09-07.md", "README.md"]), false);
});

test("isBoardOnlyDiff: false when no doc file changed at all -- empty is not board-only", () => {
  assert.equal(isBoardOnlyDiff([]), false);
  assert.equal(isBoardOnlyDiff(["packages/lab/src/training/case-matrix.mjs"]), false);
});

test("isBoardOnlyDiff: false for a non-board file elsewhere under docs/board/", () => {
  // Only summaries/*.md and reported.json itself are board files -- a sibling file under docs/board/ that
  // is neither must fall back to the wider docs job, not be silently swept into the narrow one.
  assert.equal(isBoardOnlyDiff(["docs/board/README.md"]), false);
});

test("isBoardOnlyDiff agrees with ci-changed.mjs's classify() on identical diffs -- not just similarly named", () => {
  for (const files of [
    ["docs/board/summaries/2026-09-07.md"],
    ["docs/board/reported.json"],
    ["docs/board/summaries/2026-09-07.md", "docs/known-gaps.md"],
    ["docs/board/README.md"],
    ["packages/lab/src/training/case-matrix.mjs"],
  ]) {
    assert.equal(isBoardOnlyDiff(files), classify(files, []).board,
      `isBoardOnlyDiff and classify().board disagreed on ${JSON.stringify(files)} -- the pre-push hook's `
      + "fast path and ci.yml's board job would run different populations for the same commit");
  }
});
