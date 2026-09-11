/**
 * `docs/known-gaps.md`'s index (#104) must be a DERIVED VIEW of the headings, never a second, hand-typed
 * list -- see `scripts/known-gaps-index.mjs`'s own header for why. This is the guard: if a section closes
 * (or opens) without the index being regenerated, this test fails rather than a reader silently missing it.
 */
/**
 * #954: THE CROSS-REFERENCE HALF OF THIS FILE IS OFF THE PULL-REQUEST PATH. `known-gaps-index`'s rule now runs
 * once a night, in `scripts/doc-cross-reference-report.mjs`, which imports the same module this file
 * does -- so nothing about the rule changed, only when it runs and what a disagreement costs. See #905
 * for the argument and #954 for the retirement, which waited until the first nightly report had posted.
 *
 * WHAT STAYS HERE is what that report does not assert: slugify against GitHub's own algorithm, the index builder's stability on a fixture, and the two mutations that prove it catches a stale index.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KNOWN_GAPS_FILE,
  applyIndexBlock,
  buildIndexBlock,
  currentIndexBlock,
  isClosed,
  parseHeadings,
  slugify,
} from "../../../../scripts/known-gaps-index.mjs";

const text = () => readFileSync(new URL(`../../../../${KNOWN_GAPS_FILE}`, import.meta.url), "utf8");

test("slugify approximates GitHub's anchor algorithm on real headings", () => {
  assert.equal(slugify("2. ~~The real-page corpus rots, and nothing watches it~~ — DONE"),
    "2-the-real-page-corpus-rots-and-nothing-watches-it-done");
  assert.equal(slugify("35. §11's design has a name"), "35-11s-design-has-a-name");
});

// --- The guard must be shown to fail, or it proves nothing ---

test("MUTATION: closing an open section without regenerating the index is caught", () => {
  const current = text();
  const openHeading = parseHeadings(current).find((h) => h.number !== null && !isClosed(h));
  assert.ok(openHeading, "no open section to mutate -- fixture assumption broke");
  const mutated = current.replace(`## ${openHeading!.raw}`, `## ${openHeading!.raw} -- DONE`);
  assert.notEqual(mutated, current, "the mutation did not change the file -- the replace target is stale");
  assert.notEqual(applyIndexBlock(mutated), mutated,
    "closing a section changed nothing about the required index -- the guard does not bite");
});

test("MUTATION: an index block hand-edited to add a stale entry is caught", () => {
  const current = text();
  const block = currentIndexBlock(current);
  assert.ok(block);
  const tampered = current.replace(block!, block!.replace("<!-- known-gaps-index:end -->",
    "- [§999](#nope) a section that does not exist\n<!-- known-gaps-index:end -->"));
  assert.notEqual(applyIndexBlock(tampered), tampered, "a hand-added stale entry was not caught");
});

test("CONTROL: a small fixture's freshly built index is stable under re-application", () => {
  const fixture = [
    "# Title",
    "",
    "intro",
    "",
    "## 1. an open one",
    "",
    "## 2. a closed one -- DONE",
    "",
    "## a meta section",
    "",
  ].join("\n");
  const once = applyIndexBlock(fixture);
  assert.ok(once.includes("[§1]"), "the open section must be indexed");
  assert.ok(!once.includes("[§2]"), "the closed section must not be indexed");
  assert.equal(applyIndexBlock(once), once, "applying to an already-current fixture must be a no-op");
});

test("CONTROL: buildIndexBlock lines start '- [§', matching the acceptance grep", () => {
  const lines = buildIndexBlock(text()).split("\n").filter((l) => l.startsWith("- "));
  assert.ok(lines.length > 0);
  for (const line of lines) assert.match(line, /^- \[§\d+\]/);
});
