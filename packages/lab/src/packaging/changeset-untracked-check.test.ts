/**
 * #1127: `npx changeset status` reads the changeset directory through git, so a changeset file that has
 * not been `git add`ed does not exist to it -- and prints the message for having written NONE at all.
 * `untrackedChangesetReason` is the fix's whole decision, tested here against fixture `git status
 * --porcelain` text with no git process involved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { untrackedChangesetReason } from "../../../../scripts/changeset-untracked-check.mjs";

test("an untracked changeset produces a message naming the real state", () => {
  const porcelain = "M  packages/evidence/package.json\n?? .changeset/zz-probe.md\n";
  const reason = untrackedChangesetReason(porcelain);
  assert.ok(reason, "expected a reason, got null");
  assert.match(reason, /untracked changeset/i);
  assert.match(reason, /\.changeset\/zz-probe\.md/);
  assert.match(reason, /git add/);
  // The defect this row exists for: the message must not read as "no changesets were found" -- that is
  // the message for the state this is NOT.
  assert.ok(!/no changesets were found/i.test(reason));
});

test("the tracked case is unchanged: nothing untracked means fall through, unaffected", () => {
  // A modified, already-tracked changeset (staged or not) is not this defect's shape.
  assert.equal(untrackedChangesetReason("M  packages/evidence/package.json\nM  .changeset/zz-probe.md\n"), null);
  // No changeset at all -- genuine absence, the state `changeset status`'s own message is correct for.
  assert.equal(untrackedChangesetReason("M  packages/evidence/package.json\n"), null);
  // Nothing changed in the working tree.
  assert.equal(untrackedChangesetReason(""), null);
});

test("README.md is never read as a changeset entry", () => {
  assert.equal(untrackedChangesetReason("?? .changeset/README.md\n"), null);
});

test("multiple untracked changesets are all named", () => {
  const reason = untrackedChangesetReason("?? .changeset/a.md\n?? .changeset/b.md\n");
  assert.match(reason ?? "", /a\.md/);
  assert.match(reason ?? "", /b\.md/);
});
