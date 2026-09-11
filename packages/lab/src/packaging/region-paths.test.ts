/**
 * EVERY REPO-RELATIVE PATH NAMED IN A ROW'S PROSE -- a LEAF module (#462, B4), extracted out of
 * `row-reachability.mjs` so `row-claim/file-overlap-rule.mjs` can read the SAME extraction without
 * dragging in that file's own `@a11ign/worker-fleet/cli-flags` import (fine for ITS `main()`, fatal
 * before `npm ci`/`npm run build` if reached from a pre-install entry -- `pre-install-import-graph.test.ts`
 * caught exactly this the first time sharing the regex was tried by importing the whole file).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  regionPathsFromBody, extractRegionSection, declaredRegionFiles, regionCovers,
  extractLabeledSection, hasTemplateField,
} from "../../../../scripts/region-paths.mjs";

test("extracts a backticked path from a Region section", () => {
  assert.deepEqual(regionPathsFromBody("Region: `scripts/row-claim.mjs`."), ["scripts/row-claim.mjs"]);
});

test("extracts more than one path, deduplicated", () => {
  const body = "Region: `scripts/row-claim.mjs` and `scripts/row-claim.mjs` again, plus "
    + "`packages/lab/src/packaging/row-claim.test.ts`.";
  assert.deepEqual(regionPathsFromBody(body),
    ["scripts/row-claim.mjs", "packages/lab/src/packaging/row-claim.test.ts"]);
});

test("prose with no path returns [], not a crash or a guess", () => {
  assert.deepEqual(regionPathsFromBody("This row is about the ready lane in general."), []);
});

test("only recognises the four real top-level roots -- a path-shaped word elsewhere is not swept in", () => {
  assert.deepEqual(regionPathsFromBody("See node_modules/foo/bar.mjs for reference."), []);
});

test("a docs path (.md) is extracted too -- the caller decides whether to treat it as code", () => {
  assert.deepEqual(regionPathsFromBody("Region: `docs/getting-started.md`."), ["docs/getting-started.md"]);
});

// --- extractRegionSection / declaredRegionFiles: #710, scoping "what will this row change" to the
// declared Region section rather than every path the whole body mentions ---

test("#710 ACCEPTANCE: a body with no Region section at all returns null -- CANNOT_ASK, not an empty list", () => {
  const body = "Just some prose about the ready lane, with no Region heading or line anywhere.";
  assert.equal(extractRegionSection(body), null);
  assert.equal(declaredRegionFiles(body), null);
});

test("a '## Region' heading section runs until the next heading", () => {
  const body = "## What\n\nSome text mentioning `scripts/unrelated.mjs` as a worked example.\n\n"
    + "## Region\n\n`scripts/acceptance-commands.mjs`, `packages/lab/src/packaging/acceptance-commands.test.ts`.\n\n"
    + "## Acceptance\n\nnpx tsx --test whatever\n";
  assert.deepEqual(declaredRegionFiles(body),
    ["scripts/acceptance-commands.mjs", "packages/lab/src/packaging/acceptance-commands.test.ts"]);
});

test("a '## Region' heading section at the END of the body runs to the end, not forever", () => {
  const body = "## What\n\ntext\n\n## Region\n\n`scripts/foo.mjs` for the fix.\n";
  assert.deepEqual(declaredRegionFiles(body), ["scripts/foo.mjs"]);
});

test("a bare inline 'Region:' line -- this issue's own shape -- is read as a single-line section", () => {
  const body = "Some prose above.\n\nRegion: `scripts/row-claim/file-overlap-rule.mjs`, `scripts/row-claim.mjs`.";
  assert.deepEqual(declaredRegionFiles(body),
    ["scripts/row-claim/file-overlap-rule.mjs", "scripts/row-claim.mjs"]);
});

test("a Region section that mentions directories only inside a SENTENCE returns [], not null -- a real, " +
  "comparable, empty answer (#941: a STANDALONE directory line declares a prefix; see below)", () => {
  const body = "## Region\n\n`scripts/` for the helper, `packages/lab/src/packaging/` for its test, and "
    + "`docs/` wherever the procedure ends up being written down.\n";
  assert.deepEqual(declaredRegionFiles(body), []);
});

test("#710 REGRESSION FIXTURE: #705's real body, boiled down -- a file cited in prose as a worked " +
  "example must not appear in declaredRegionFiles when the Region section never names it", () => {
  const body = "## The fixture: what it would actually have taken\n\n"
    + "Rescuing `packages/lab/scripts/audit-rule-coverage.ts` from `lead/inventory-bootstrap` "
    + "(2026-09-06):\n\n"
    + "## Region\n\n`scripts/` for the helper, `packages/lab/src/packaging/` for its test, and `docs/` "
    + "wherever the stranded-branch procedure ends up being written down.\n";
  // regionPathsFromBody (the whole-body scan) DOES pick up the fixture mention -- this is what #710
  // measured as the actual cause of the false collision.
  assert.deepEqual(regionPathsFromBody(body), ["packages/lab/scripts/audit-rule-coverage.ts"]);
  // declaredRegionFiles must not: the Region section itself names only bare directories.
  assert.deepEqual(declaredRegionFiles(body), []);
});

test("a genuine Region-declared file with an extension is still extracted -- the fix must not become " +
  "\"never find anything\"", () => {
  const body = "## Region\n\n`scripts/row-claim.mjs` and `packages/lab/src/packaging/row-claim.test.ts`.\n";
  assert.deepEqual(declaredRegionFiles(body),
    ["scripts/row-claim.mjs", "packages/lab/src/packaging/row-claim.test.ts"]);
});

// --- #941: a STANDALONE directory line in a Region declares a PREFIX, never nothing ---

/** #941's own three-line block: one file and two directories, fenced the way rows are filed. */
const THREE_LINE_REGION = "## Region\n\n```\nscripts/select-changed-tests.mjs\npackages/lab/src/packaging/\ndocs/\n```\n\n"
  + "## Not in scope\n\nnothing\n";

test("#941 REPRODUCED: the file grammar alone reads only the file out of this block -- the defect's own output", () => {
  // What `declaredRegionFiles` returned for this block before #941: the two directory lines vanished.
  assert.deepEqual(regionPathsFromBody(extractRegionSection(THREE_LINE_REGION) ?? ""), ["scripts/select-changed-tests.mjs"]);
});

test("#941: a standalone directory line declares a prefix, beside the files the block names", () => {
  assert.deepEqual(declaredRegionFiles(THREE_LINE_REGION),
    ["scripts/select-changed-tests.mjs", "packages/lab/src/packaging/", "docs/"]);
});

test("#941: a Region of ONLY directories no longer declares the empty set -- the five zero-declaration rows' shapes", () => {
  const region = (...lines: string[]) => `## Region\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`;
  assert.deepEqual(declaredRegionFiles(region("docs/", "packages/lab/src/packaging/")), ["docs/", "packages/lab/src/packaging/"]);
  assert.deepEqual(declaredRegionFiles(region("packages/lab/src/packaging/")), ["packages/lab/src/packaging/"]);
  assert.deepEqual(declaredRegionFiles(region("scripts/")), ["scripts/"]);
  assert.deepEqual(declaredRegionFiles(region("packages/control/ansible/")), ["packages/control/ansible/"]);
});

test("#941: a bulleted or backticked directory line is still a standalone line", () => {
  const body = "## Region\n\n- `packages/control/ansible/`\n* docs/board/\n";
  assert.deepEqual(declaredRegionFiles(body), ["packages/control/ansible/", "docs/board/"]);
});

test("#941: regionCovers -- a directory covers everything under it, and nothing that merely shares its spelling", () => {
  assert.ok(regionCovers("docs/", "docs/board/summaries/x.md"));
  assert.ok(!regionCovers("docs/", "docsite/x.md"), "a prefix is a directory, not a string");
  assert.ok(regionCovers("scripts/a.mjs", "scripts/a.mjs"));
  assert.ok(!regionCovers("scripts/a.mjs", "scripts/a.mjs.bak"), "a file entry covers only itself");
});

test("#941: a one-line LIST of directories declares each item -- 7 older rows were written this way", () => {
  assert.deepEqual(declaredRegionFiles("## Region\n\n`packages/`, `.github/workflows/`, `docs/adr/`\n"),
    ["packages/", ".github/workflows/", "docs/adr/"], "#69's shape");
  assert.deepEqual(declaredRegionFiles("## Region\n\n`packages/scorer/python/`; `packages/judge/src/`\n"),
    ["packages/scorer/python/", "packages/judge/src/"]);
  assert.deepEqual(declaredRegionFiles("## Region\n\ndocs/board/ and scripts/\n"), ["docs/board/", "scripts/"]);
  // #43's shape: one item is a path and one is not a repository path at all. The path is still declared.
  assert.deepEqual(declaredRegionFiles("## Region\n\n`packages/lab/scripts/`, the lab machine\n"), ["packages/lab/scripts/"]);
});

test("#941: a sentence that MENTIONS a directory declares nothing -- only a standalone path line does", () => {
  // Region prose was read as a declaration twice on 2026-09-11 (#848, #920), and a prefix rule must not
  // reopen that. The #710 fixture above is the same rule on a real body: its directories sit in a sentence.
  const body = "## Region\n\nWhatever it needs under `docs/`, and `scripts/` for the helper.\n";
  assert.deepEqual(declaredRegionFiles(body), []);
});

// --- extractLabeledSection / hasTemplateField: #707's generalisation, any field name ---

test("extractLabeledSection: a heading section's content runs to the next heading, for a field other "
  + "than Region", () => {
  const body = "## Acceptance\n\n```\nnpx tsx --test x\n```\n\n## Next\n\nirrelevant\n";
  assert.equal(extractLabeledSection(body, "Acceptance"), "```\nnpx tsx --test x\n```");
});

test("extractLabeledSection: a hyphenated, multi-word field (\"Open-check\") matches the real template's "
  + "own longer heading text (\"Open-check -- the command that shows this row is still open\")", () => {
  const body = "## Open-check -- the command that shows this row is still open\n\n"
    + "```\ngh issue view 707 --json state\n```\n";
  assert.equal(extractLabeledSection(body, "Open-check"), "```\ngh issue view 707 --json state\n```");
});

test("extractLabeledSection: an inline `Field:` line works exactly like Region's", () => {
  assert.equal(extractLabeledSection("Acceptance: npm test", "Acceptance"), "npm test");
});

test("extractLabeledSection: absent entirely returns null", () => {
  assert.equal(extractLabeledSection("no headings here", "Acceptance"), null);
});

test("extractLabeledSection: one field's heading does not match a DIFFERENT field's name -- word-bounded, "
  + "not a bare substring (\"Region\" must not match inside some other word)", () => {
  const body = "## Regional notes\n\nsomething unrelated\n";
  assert.equal(extractLabeledSection(body, "Region"), null);
});

test("hasTemplateField: false for a heading with nothing under it before the next one", () => {
  const body = "## Region\n\n## Acceptance\n\nreal content\n";
  assert.equal(hasTemplateField(body, "Region"), false);
  assert.equal(hasTemplateField(body, "Acceptance"), true);
});
