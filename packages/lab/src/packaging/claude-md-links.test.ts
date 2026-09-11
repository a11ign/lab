/**
 * CLAUDE.md was split 2026-09-08 (#458/A6): 228,496 characters against a 150,000-character load
 * limit, past which the file is TRUNCATED and rules at the end may reach nobody. It now states each
 * rule once, with a link to the incident/measurement behind it, spread across several `docs/*.md`
 * files by topic (`docs/operational-lessons.md`, `docs/fleet-capacity-history.md`,
 * `docs/capture-cache-incidents.md`, `docs/nvda-behavior-incidents.md`, `docs/npm-scripts.md`,
 * `docs/lab-pipeline.md`, plus content appended to pre-existing files). This is the guard that keeps
 * the split honest: a size ceiling so it cannot silently grow back past the limit, and a
 * link-integrity check so a moved section can never go dark — renaming or removing a heading in any
 * target file must fail here, not surface as a reader clicking a link to nowhere.
 *
 * Harvested from #181 (`agent/claude-md-split-155`), an earlier attempt at this same split that was
 * refused on a mechanical acceptance -- it dropped 1,337 substantive lines with nothing checking for
 * it. This file's own `slugify`/`headingAnchors`/`localAnchorLinks` are unchanged from that attempt;
 * what #458 adds is `claude-md-content-preservation.test.ts`, the check #181 was missing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// #905: the anchor-link rule lives in the doc cross-reference check the nightly report also runs -- one copy.
// The size limit below is not a cross-reference and stays here, on the pull-request path.
import {
  brokenAnchorLinks, headingAnchors, localAnchorLinks, slugify,
} from "../../../../scripts/doc-checks/claude-md-links.mjs";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLAUDE_MD = "CLAUDE.md";

/** The load-truncation limit this split exists to stay well under (#155/#458). */
const MAX_CLAUDE_MD_CHARS = 40_000;

const claudeMd = () => readFileSync(`${ROOT}${CLAUDE_MD}`, "utf8");

/**
 * #649: `wc -c` counts BYTES; `text.length` (what the guard actually checks against
 * `MAX_CLAUDE_MD_CHARS`, and what the 40,000 load-truncation limit is itself measured in) counts UTF-16
 * CHARACTERS. Measured 2026-09-09: CLAUDE.md read 40,151 bytes against 39,835 characters -- 316 bytes of
 * em dashes, arrows and typographic quotes, none of them a second character. The obvious hand check
 * (`wc -c`) reports "151 over" on a file the guard correctly reads as 165 UNDER, and nothing in either
 * number says which unit it is in. So the message states BOTH, with their units, so a reader never has
 * a reason to reach for `wc -c` and doubt a passing guard.
 */
export function sizeReport(text: string, limit: number) {
  const characters = text.length;
  const bytes = Buffer.byteLength(text, "utf8");
  const headroom = limit - characters;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const message = `${fmt(characters)} characters (${fmt(bytes)} bytes) against a ${fmt(limit)} `
    + `CHARACTER limit — ${headroom >= 0 ? `${fmt(headroom)} characters of headroom`
      : `${fmt(Math.abs(headroom))} characters OVER`}`;
  return { characters, bytes, limit, headroom, underLimit: characters < limit, message };
}

test("CLAUDE.md is under the load-truncation limit this split exists to fix (#155/#458)", () => {
  // Printed UNCONDITIONALLY, on pass and on refusal (#649's own acceptance) -- an assert message is only
  // ever shown on failure, so a reader watching a clean run never sees the number a passing guard is
  // clearing, and the character-vs-byte gap stays invisible until the day it matters.
  const report = sizeReport(claudeMd(), MAX_CLAUDE_MD_CHARS);
  console.log(`  ${report.message}`);
  assert.ok(report.underLimit,
    `${report.message} -- move more narrative to docs/, do not just trim prose in place`);
});

test("#649 MUTATION: a string OVER the character limit but UNDER in bytes cannot exist -- bytes are never "
  + "fewer than characters for text this encoding produces, so the refusal direction that matters is the "
  + "other one: a string UNDER the character limit but OVER a naive byte-based reading must NOT refuse", () => {
  // 20,000 two-byte characters (U+00E9, é): 20,000 UTF-16 characters, 40,000 UTF-8 bytes -- under
  // MAX_CLAUDE_MD_CHARS on the character count the guard actually uses, and `wc -c` would read exactly at
  // the limit on this fixture's bytes alone, which is the exact confusion #649 exists to end.
  const fixture = "é".repeat(20_000);
  const report = sizeReport(fixture, MAX_CLAUDE_MD_CHARS);
  assert.equal(report.characters, 20_000);
  assert.equal(report.bytes, 40_000, "the fixture's own byte count drifted -- é must stay 2 bytes in UTF-8");
  assert.ok(report.underLimit, "20,000 characters must read as under a 40,000-CHARACTER limit, regardless "
    + "of how many bytes those characters take up");
  assert.match(report.message, /character/i);
});

test("#649 ACCEPTANCE / MUTATION TARGET: a string that crosses the CHARACTER limit refuses and NAMES "
  + "characters, even when it is nowhere near double the limit in bytes", () => {
  const fixture = "x".repeat(MAX_CLAUDE_MD_CHARS + 1);
  const report = sizeReport(fixture, MAX_CLAUDE_MD_CHARS);
  assert.equal(report.characters, MAX_CLAUDE_MD_CHARS + 1);
  assert.ok(!report.underLimit, "one character over the limit must refuse");
  assert.match(report.message, /character/i, "the refusal must name characters, so a reader's next move "
    + "is not `wc -c`");
  assert.match(report.message, /OVER/);
});

test("CONTROL: the message prints both numbers with their units, matching #649's own worked example shape", () => {
  const report = sizeReport("hello", 10);
  assert.equal(report.message, "5 characters (5 bytes) against a 10 CHARACTER limit — 5 characters of headroom");
});

test("CLAUDE.md still makes a substantial number of links into the docs/ files it was split into", () => {
  // A vacuity guard: a broken extraction regex would report zero links and every test below would pass
  // having examined nothing, which is the exact "a check answering correctly about an empty population"
  // shape this repo's own CLAUDE.md names as its most expensive recurring defect.
  const links = localAnchorLinks(claudeMd());
  assert.ok(links.length >= 20,
    `only found ${links.length} local anchor link(s) in CLAUDE.md -- the extraction regex may be broken`);
});

test("every local anchor link in CLAUDE.md resolves to a heading that exists in its target file", () => {
  const broken = brokenAnchorLinks(ROOT);
  assert.deepEqual(broken, [],
    `${broken.length} link(s) in CLAUDE.md point at a heading that does not exist -- a moved or renamed ` +
    `section has gone dark:\n${broken.join("\n")}`);
});

// --- The guard must be shown to fail, or it proves nothing ---

test("MUTATION: deleting a heading a real link points at is caught", () => {
  // Unlike #181 (one destination file), #458 spreads links across several -- pick whichever the FIRST
  // link in CLAUDE.md happens to target, so this stays correct regardless of which files exist.
  const links = localAnchorLinks(claudeMd());
  assert.ok(links.length > 0, "no local anchor links found -- fixture assumption broke");
  const target = links[0];
  const targetPath = `${ROOT}${target.file}`;
  const original = readFileSync(targetPath, "utf8");
  const anchorsBefore = headingAnchors(original);
  assert.ok(anchorsBefore.has(target.anchor),
    `fixture link #${target.anchor} does not resolve today in ${target.file}`);

  // Delete the ONE heading line producing that anchor, simulating a rename/removal in the target file.
  const lines = original.split("\n").filter((line) => {
    const m = /^#{1,6} (.*)$/.exec(line);
    return !(m && slugify(m[1]) === target.anchor.replace(/-\d+$/, ""));
  });
  const mutated = lines.join("\n");
  assert.notEqual(mutated, original, "the deletion did not change the file -- the fixture has drifted");

  const anchorsAfter = headingAnchors(mutated);
  assert.ok(!anchorsAfter.has(target.anchor),
    `deleting the heading did not remove anchor #${target.anchor} -- the mutation missed its target`);
});

test("CONTROL: a link to a heading that genuinely exists is not reported broken", () => {
  const fixture = "# Title\n\n## A real section\n\nbody\n";
  const anchors = headingAnchors(fixture);
  assert.ok(anchors.has("a-real-section"));
});

test("CONTROL: slugify matches known-gaps-index.mjs's own pinned cases, so both stay in sync", () => {
  // Two independent implementations of the identical GitHub-anchor approximation is exactly the
  // fact-stated-twice shape this repo keeps finding -- pinned equal here rather than re-litigated.
  assert.equal(slugify("2. ~~The real-page corpus rots, and nothing watches it~~ — DONE"),
    "2-the-real-page-corpus-rots-and-nothing-watches-it-done");
  assert.equal(slugify("35. §11's design has a name"), "35-11s-design-has-a-name");
});
