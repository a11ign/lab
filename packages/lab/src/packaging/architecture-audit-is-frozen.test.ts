/**
 * `docs/architecture-audit.md` is a RECORD, not a tracker — pinned here for the same reason
 * `backlog-file-facts.test.ts` pins line counts named in prose: a claim that can silently stop being true
 * is a claim nobody is checking.
 *
 * Decided 2026-09-06, after this document was updated three times in one night trying to stay current
 * (2026-09-02/03, 2026-09-05, a 2026-09-06 re-triage) and went stale within the hour on at least two rows
 * each time — its own §15 called raw-`fetch` and Windows-trimming duplication "still open" at `acbb0be`
 * (2026-09-05 23:40:39), 57 minutes after the commit that had already closed both (`d7c1870`,
 * 2026-09-06 00:37:51). `docs/backlog.md` already solves this for `known-gaps.md`/`not-working.md` by
 * being the one place status lives, re-verified at HEAD immediately before a row is assigned. This test
 * does not (and cannot) check that every "still open" phrase inside the audit is accurate — that is
 * exactly the unbounded, un-mechanisable claim the freeze exists to stop making. What it CAN check,
 * mechanically, is that the freeze itself has not been silently reverted: the audit's own header still
 * says so, and `docs/README.md`'s routing table still tells a reader where status actually lives rather
 * than pointing back at this document as if it were current.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const AUDIT = `${REPO}docs/architecture-audit.md`;
const DOCS_README = `${REPO}docs/README.md`;

test("architecture-audit.md still declares itself FROZEN and names backlog.md as the status authority", () => {
  const text = readFileSync(AUDIT, "utf8");
  assert.match(text, /FROZEN 2026-09-06/,
    "the freeze declaration is gone from architecture-audit.md's own header -- if the document is being "
    + "kept live again, that is a real decision and this test should be deleted as part of making it, not "
    + "left to fail by accident");
  assert.match(text, /\[`docs\/backlog\.md`\]\(\.\/backlog\.md\)/,
    "architecture-audit.md no longer points a reader at docs/backlog.md for status -- the freeze is only "
    + "useful if it says where to look instead");
});

test("docs/README.md's routing table frames architecture-audit.md as a record, not a live tracker", () => {
  const text = readFileSync(DOCS_README, "utf8");
  const row = text.split("\n").find((line) => line.includes("architecture-audit.md"));
  assert.ok(row, "docs/README.md no longer mentions architecture-audit.md at all -- if it was removed from "
    + "the routing table deliberately, delete this test as part of that change");
  assert.match(row!, /FROZEN|record, not a tracker/i,
    "docs/README.md's row for architecture-audit.md no longer signals that it is a frozen record -- a "
    + "reader following this table would be sent to it as if it answered \"what is open\"");
});
