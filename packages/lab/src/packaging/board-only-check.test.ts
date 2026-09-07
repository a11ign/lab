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

test("#296: false when a board file is mixed with a file OUTSIDE docs/ entirely", () => {
  // The bug: `isBoardOnlyDiff` used to filter to doc-touching files BEFORE asking `boardOnly`, so a
  // script mixed into the diff was filtered away before it could count against the answer -- the diff
  // reduced to just the board file(s), which passed on their own. #287 shipped with a lint error and its
  // own push reported `ok` because of exactly this: reported.json + summaries + two scripts read as
  // board-only and skipped lint/typecheck entirely.
  assert.equal(isBoardOnlyDiff(["docs/board/reported.json", "scripts/board-document.mjs"]), false,
    "a Node script in the diff must NOT be filtered away before the board-only decision");
  assert.equal(isBoardOnlyDiff(["docs/board/summaries/2026-09-07.md", "packages/lab/src/index.ts"]), false);
});

test("#296: reproduces #287's real diff -- board files plus two scripts must NOT take the fast path", () => {
  // The exact file list #287 shipped (measured via `git diff --name-only origin/main...pm/board-counts-
  // derived`), hardcoded rather than shelled out to a branch that will not exist forever.
  assert.equal(isBoardOnlyDiff([
    "docs/board/reported.json",
    "docs/board/summaries/2026-09-07.md",
    "scripts/board-data.mjs",
    "scripts/board-document.mjs",
  ]), false, "this is the diff that shipped with a lint error while its own push reported ok");
});

test("isBoardOnlyDiff: false for a non-board file elsewhere under docs/board/", () => {
  // Only summaries/*.md and reported.json itself are board files -- a sibling file under docs/board/ that
  // is neither must fall back to the wider docs job, not be silently swept into the narrow one.
  assert.equal(isBoardOnlyDiff(["docs/board/README.md"]), false);
});

test("isBoardOnlyDiff agrees with ci-changed.mjs's classify() on identical DOCS-ONLY diffs", () => {
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

test("#296: isBoardOnlyDiff and classify().board DELIBERATELY diverge on a diff mixing in a non-doc file", () => {
  // Not a regression of the test above -- a different question, answered differently on purpose.
  // `classify().board` is one of several INDEPENDENT categories computed over the same diff (a script
  // also sets `ts: true` in the same call), so scoping it to doc-touching files alone is correct: `ts`
  // catches what `board` deliberately ignores. `isBoardOnlyDiff` has no sibling category to catch
  // anything -- it is pre-push's ONE fast/slow decision -- so it must see the whole diff or a script
  // slips through with nothing left to catch it, which is exactly what happened in #287.
  const files = ["docs/board/reported.json", "scripts/board-document.mjs"];
  assert.equal(isBoardOnlyDiff(files), false);
  assert.equal(classify(files, []).board, true, "classify() is still right to say true here: `ts` fires "
    + "for the script in the same call, so CI still checks it -- see ci-changed.mjs's own comment on why "
    + "boardOnly's two callers take different-shaped input");
});
