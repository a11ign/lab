/**
 * EVERY REPO-RELATIVE PATH NAMED IN A ROW'S PROSE -- a LEAF module (#462, B4), extracted out of
 * `row-reachability.mjs` so `row-claim/file-overlap-rule.mjs` can read the SAME extraction without
 * dragging in that file's own `@a11ign/worker-fleet/cli-flags` import (fine for ITS `main()`, fatal
 * before `npm ci`/`npm run build` if reached from a pre-install entry -- `pre-install-import-graph.test.ts`
 * caught exactly this the first time sharing the regex was tried by importing the whole file).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { regionPathsFromBody } from "../../../../scripts/region-paths.mjs";

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
