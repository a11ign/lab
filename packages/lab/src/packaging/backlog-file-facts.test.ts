/**
 * `docs/backlog.md` states file line counts as facts, and nothing checked whether they stayed facts.
 *
 * Found 2026-09-06 auditing the backlog for staleness (a peer's own audit, done in about ten minutes,
 * found the same class of drift without trying): `rules.ts` was recorded at 1,993 lines and marked
 * "in flight" long after `9b13696` had split it to 1,381; `capture-core.mjs` was recorded at "4,856" after
 * it had already been split three ways down to 334. A tracker whose own numbers drift is the shape
 * CLAUDE.md already warns about for worker VMs and the page server, applied to its own text.
 *
 * ## Why a handful of hard checks rather than a markdown parser
 *
 * The backlog is free-form prose by design — "the file whose entire purpose is honesty about coverage"
 * elsewhere in this repo reads worse as a rigid schema. Parsing every row generally would be the "esoteric
 * language" trap the SRE Workbook names for YAML+Jinja, applied to Markdown. So this pins a SMALL, NAMED
 * set of claims that are cheap, unambiguous, and were actually found stale — not a general prose grammar.
 * Each pin fails LOUDLY if the exact phrase it looks for has moved, rather than silently matching nothing:
 * a regex that finds zero matches is a vacuity bug in this test, not a fact about the codebase, so every
 * check asserts it found the phrase before comparing the number inside it.
 *
 * Extending this file: add a new file-fact pin only for a claim that is genuinely a single number tied to
 * one file's current size. Leave everything else — "is this cycle actually closed", "does this test still
 * pass" — to reading the code, which is what this same audit pass did for the majority of its findings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const BACKLOG = readFileSync(`${REPO}docs/backlog.md`, "utf8");

/** Non-blank-agnostic: matches what `wc -l` reports, which is what every claim in the backlog was checked against. */
function lineCount(relativePath: string): number {
  const text = readFileSync(`${REPO}${relativePath}`, "utf8");
  // `wc -l` counts newlines, not array-split length -- a file ending without a trailing newline would
  // otherwise be over-counted by one, and this repo's own files are newline-terminated.
  return (text.match(/\n/g) ?? []).length;
}

interface FileFactPin {
  /** What the backlog claims, and where — quoted verbatim, not summarised, so a diff of this file shows the English too. */
  claim: string;
  /** A regex over `docs/backlog.md`'s text, capturing the claimed line count as its one group. */
  pattern: RegExp;
  /** The real file the claim is about. */
  file: string;
}

const PINS: FileFactPin[] = [
  {
    claim: "case-matrix.mjs is 4,074 lines after the two-cuts split",
    pattern: /`case-matrix\.mjs` \| 5,699 \| almost entirely DATA[^|]*\| \*\*([\d,]+)\*\*/,
    file: "packages/lab/src/training/case-matrix.mjs",
  },
  {
    claim: "capture-core.mjs is 334 lines after the three-way split",
    pattern: /the three-way split below: `capture-core\.mjs` ([\d,]+),/,
    file: "packages/nvda-worker/src/capture-core.mjs",
  },
  {
    claim: "capture-setup.mjs is 1,575 lines after the three-way split",
    pattern: /`capture-setup\.mjs` ([\d,]+), `capture-probes\.mjs`/,
    file: "packages/nvda-worker/src/capture-setup.mjs",
  },
  {
    claim: "capture-probes.mjs is 3,082 lines after the three-way split",
    pattern: /`capture-probes\.mjs` ([\d,]+) \(checked `wc -l`/,
    file: "packages/nvda-worker/src/capture-probes.mjs",
  },
  {
    claim: "rules.ts is 1,381 lines after 9b13696 split out channel-comparison.ts",
    pattern: /Checked `wc -l`: `rules\.ts` ([\d,]+), `channel-comparison\.ts`/,
    file: "packages/judge/src/rules.ts",
  },
  {
    claim: "channel-comparison.ts is 729 lines after 9b13696",
    pattern: /`channel-comparison\.ts` ([\d,]+)\.\s*\|/,
    file: "packages/judge/src/channel-comparison.ts",
  },
];

for (const { claim, pattern, file } of PINS) {
  test(`backlog.md's claim survives: ${claim}`, () => {
    const match = BACKLOG.match(pattern);
    // The vacuity guard this file's header promises: a pattern matching nothing means the WORDING moved,
    // which is a reason to fix the pattern, not a reason to skip the check silently.
    assert.ok(match, `could not find the phrase this pin looks for in docs/backlog.md -- the row's `
      + `wording changed and this pattern needs updating, not removing: ${pattern}`);
    const claimed = Number(match![1].replace(/,/g, ""));
    const actual = lineCount(file);
    assert.equal(claimed, actual,
      `docs/backlog.md claims ${file} is ${claimed} lines (\`wc -l\`), and it is actually ${actual} -- `
      + "update the row rather than this test, unless the file itself is what should have stayed put.");
  });
}
