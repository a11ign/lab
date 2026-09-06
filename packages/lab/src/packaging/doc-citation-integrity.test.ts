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
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (relPath: string) => readFileSync(`${REPO}${relPath}`, "utf8");

/** Documents this repo cites BY SECTION NUMBER from elsewhere. Extend this, never a generic Markdown walk. */
const NUMBERED_DOCS: Record<string, string> = {
  "not-working": "docs/not-working.md",
  "known-gaps": "docs/known-gaps.md",
  "architecture-audit": "docs/architecture-audit.md",
};

/** Which section identifiers actually exist in one of the three numbered documents, format-aware. */
function sectionsIn(relPath: string): Set<string> {
  const text = read(relPath);
  const ids = new Set<string>();
  if (relPath.endsWith("not-working.md")) {
    // `18`, `18a` -- the lettered-supersession scheme `not-working-numbering.test.ts` enforces. A bare
    // citation ("§18") is satisfied by EITHER form existing, since that test already guarantees a base
    // number with any heading also has exactly one bare (current) one.
    for (const m of text.matchAll(/^#{2,4} (\d+)[a-z]?\./gm)) ids.add(m[1]);
  } else if (relPath.endsWith("known-gaps.md") || relPath.endsWith("architecture-audit.md")) {
    for (const m of text.matchAll(/^## (\d+)\./gm)) ids.add(m[1]);
    // architecture-audit.md ALSO has dotted subsections ("### 14.4"), which is its own citable unit --
    // "§14" and "§14.4" are different claims and must not be conflated.
    for (const m of text.matchAll(/^### (\d+)\.(\d+)/gm)) ids.add(`${m[1]}.${m[2]}`);
  }
  return ids;
}

const sectionCache = new Map<string, Set<string>>();
function sectionsFor(relPath: string): Set<string> {
  if (!sectionCache.has(relPath)) sectionCache.set(relPath, sectionsIn(relPath));
  return sectionCache.get(relPath)!;
}

function allDocs(): string[] {
  const files = readdirSync(`${REPO}docs`).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`);
  files.push("CLAUDE.md");
  return files;
}

interface Citation {
  file: string;
  line: number;
  target: string;
  cited: string;
  ok: boolean | null; // null = the link's own target path could not be read at all
  context: string;
}

function findCitations(): Citation[] {
  const found: Citation[] = [];
  for (const file of allDocs()) {
    const text = read(file);
    const lines = text.split("\n");

    for (const [alias, target] of Object.entries(NUMBERED_DOCS)) {
      const re = new RegExp(`${alias}(?:\\.md)?[\`'"\\]]{0,3}\\s*§(\\d+(?:\\.\\d+)?)`, "g");
      for (const m of text.matchAll(re)) {
        const line = text.slice(0, m.index).split("\n").length;
        const cited = m[1];
        found.push({
          file, line, target, cited, ok: sectionsFor(target).has(cited),
          context: (lines[line - 1] ?? "").trim().slice(0, 160),
        });
      }
    }

    for (const m of text.matchAll(/\[([^\]]*§(\d+(?:\.\d+)?)[^\]]*)\]\(([^)]+)\)/g)) {
      const [, , cited, href] = m;
      const hrefPath = href.split("#")[0];
      if (!hrefPath.endsWith(".md")) continue;
      const line = text.slice(0, m.index).split("\n").length;
      const resolved = resolve(dirname(`${REPO}${file}`), hrefPath).replace(REPO, "");
      let sections: Set<string> | null;
      try { sections = sectionsFor(resolved); } catch { sections = null; }
      found.push({
        file, line, target: resolved, cited, ok: sections ? sections.has(cited) : null,
        context: (lines[line - 1] ?? "").trim().slice(0, 160),
      });
    }
  }
  return found;
}

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
