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

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLAUDE_MD = "CLAUDE.md";

/** The load-truncation limit this split exists to stay well under (#155/#458). */
const MAX_CLAUDE_MD_CHARS = 40_000;

const claudeMd = () => readFileSync(`${ROOT}${CLAUDE_MD}`, "utf8");

/**
 * Approximates GitHub's heading-anchor algorithm — the same approach `scripts/known-gaps-index.mjs`
 * uses for the identical reason: good enough for a reader to click through, not a reimplementation of
 * GitHub's renderer, so it is not asserted against GitHub's own output anywhere.
 */
export function slugify(raw: string): string {
  const stripped = raw
    .replace(/~~/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  return stripped
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Every heading in a markdown file, GitHub-anchor-disambiguated in document order. */
export function headingAnchors(text: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const line of text.split("\n")) {
    const match = /^#{1,6} (.*)$/.exec(line);
    if (!match) continue;
    const slug = slugify(match[1]);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

/** Every `(relative/path.md#anchor)` link CLAUDE.md makes to another file in this repo. */
export function localAnchorLinks(text: string): Array<{ file: string; anchor: string }> {
  const links: Array<{ file: string; anchor: string }> = [];
  for (const m of text.matchAll(/\(((?:docs|packages)\/[^)#\s]+\.md)#([a-z0-9-]+)\)/g)) {
    links.push({ file: m[1], anchor: m[2] });
  }
  return links;
}

test("CLAUDE.md is under the load-truncation limit this split exists to fix (#155/#458)", () => {
  const size = claudeMd().length;
  assert.ok(size < MAX_CLAUDE_MD_CHARS,
    `CLAUDE.md is ${size} characters, at or over the ${MAX_CLAUDE_MD_CHARS} target — ` +
    "move more narrative to docs/, do not just trim prose in place");
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
  const links = localAnchorLinks(claudeMd());
  const byFile = new Map<string, Set<string>>();
  const broken: string[] = [];
  for (const { file, anchor } of links) {
    if (!byFile.has(file)) {
      byFile.set(file, headingAnchors(readFileSync(`${ROOT}${file}`, "utf8")));
    }
    const anchors = byFile.get(file)!;
    if (!anchors.has(anchor)) broken.push(`${file}#${anchor}`);
  }
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
