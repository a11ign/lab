/**
 * A `§N` citation into `not-working.md`, `known-gaps.md` or `architecture-audit.md` is a claim that
 * section N still exists there. Nothing checked that claim before this test, and this file's own audit
 * work (channel-tables, backlog-truth, not-working-index) fixed three documents' worth of stale
 * cross-references by hand — one of them, `screenreader-settings-audit.md` quoting a superseded
 * `not-working.md` §18, was found only because a session happened to be reading that file anyway.
 *
 * ## Scope, and why it stops where it stops
 *
 * Checked here: a citation that NAMES its target document right next to the `§`, in either form --
 *
 *   "not-working §18", "known-gaps.md §35", "architecture-audit.md §14.4"        (prose)
 *   "[not-working §18](./not-working.md)"                                        (a markdown link,
 *                                                                                  resolved against the
 *                                                                                  HREF, not the label)
 *
 * NOT checked: a bare `§N` with no document named in the same breath, relying on an earlier sentence
 * having established which document is meant. Tried first, as an exploratory script over the same
 * corpus: it produced three "broken" citations, all false positives -- `architecture-audit.md` discusses
 * OTHER documents' numbering (`known-gaps §21`, `§25-28`, `§27`) across a paragraph without repeating the
 * document name at every mention, and a naive same-file heuristic attributed them to its own numbering
 * instead. Getting that right needs paragraph-level context a regex cannot reliably reconstruct -- exactly
 * the "esoteric language" trap this repo's own conventions warn against building for a Markdown-adjacent
 * problem. So self-references are OUT OF SCOPE here, on the same reasoning `not-working.md`'s numbering
 * fix used to exclude a general prose parser: pin what is cheap and unambiguous, leave judgement to a
 * reader.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
// #905: the citation reader lives in the doc cross-reference check the nightly report also runs -- one copy.
import { allDocs as allDocsIn, findCitations as findCitationsIn } from "../../../../scripts/doc-checks/doc-citation-integrity.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const allDocs = () => allDocsIn(REPO);
const findCitations = () => findCitationsIn(REPO);

const CITATIONS = findCitations();

test("citations were actually found -- the pattern has not silently stopped matching", () => {
  // Vacuity guard. 34 at the time this test was written, across doc-name-prefixed prose and markdown
  // links combined; sized well under that so ordinary doc edits do not make this brittle, but far enough
  // above zero that a regex broken by a Markdown formatting change cannot pass by finding nothing.
  assert.ok(CITATIONS.length >= 20,
    `found only ${CITATIONS.length} §-citations across docs/**.md and CLAUDE.md -- either most citations `
    + "were removed, or the citation format changed and this pattern needs updating, not the count relaxed.");
});

test("every cited section exists in the document it names", () => {
  const brokenHref = CITATIONS.filter((c) => c.ok === null)
    .map((c) => `  ${c.file}:${c.line} links to "${c.target}", which could not be read at all\n      ${c.context}`);
  assert.deepEqual(brokenHref, [],
    `citation(s) whose LINK TARGET does not resolve to a readable file:\n${brokenHref.join("\n")}`);

  const broken = CITATIONS.filter((c) => c.ok === false)
    .map((c) => `  ${c.file}:${c.line} -> ${c.target} §${c.cited}\n      ${c.context}`);
  assert.deepEqual(broken, [],
    `citation(s) naming a section that does not exist in the target document:\n${broken.join("\n")}\n\n`
    + "Either the section was renumbered/removed and this citation needs updating, or the citation was "
    + "always wrong. Do not fix by adding the missing number to the target -- read the history first.");
});

test("REPORT: citations checked, per target document", () => {
  const byTarget = new Map<string, number>();
  for (const c of CITATIONS) byTarget.set(c.target, (byTarget.get(c.target) ?? 0) + 1);
  const lines = [`${CITATIONS.length} §-citation(s) checked across ${allDocs().length} document(s).`];
  for (const [target, count] of [...byTarget.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  -> ${target}: ${count}`);
  }
  console.log(lines.join("\n"));
  assert.ok(true);
});
