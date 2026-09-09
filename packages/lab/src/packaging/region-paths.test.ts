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
  regionPathsFromBody, extractRegionSection, declaredRegionFiles,
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

test("a Region section naming only bare directories (no file extension) returns [], not null -- a real, " +
  "comparable, empty answer", () => {
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
