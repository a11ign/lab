/**
 * `scripts/tree-wide-guards.mjs`'s population -- the guards whose own green run on a PR's diff is not a
 * prediction, because their population is the whole tree rather than one file (#704). #716 built this
 * discovery so the pre-push hook could run all of them with no name-keyed exclusion list -- naming a
 * guard by how it is written, not what it costs, is the exact defect removed from `prune-worktrees.mjs`
 * the same day (#671: worktrees exempt by branch PREFIX when the question was their STATE).
 *
 * IMPORT-BASED, never a grep -- ceo's ruling 2026-09-09. This file's own first version derived the
 * population from a comment-stripped text search for "ls-files", which correctly dodged the mention-vs-use
 * trap (a file DESCRIBING a tree walk in a comment no longer counted) but was still, in ceo's own words,
 * "a test deriving its expectations from source TEXT" -- this repo's own most-repeated defect shape. A
 * guard whose own source happened to spell a different tree-walk idiom would have been silently invisible
 * to that pattern.
 *
 * So a tree-wide guard now DECLARES its own membership: it imports `tree-wide-guard.mjs`'s
 * `declareTreeWideGuard` and calls it, and the population is derived from that real import -- the same
 * discipline `local-import-closure.mjs` (#621, B8) already uses to derive a test's requirements from its
 * import closure rather than scanning it for a keyword. `ci-changed.test.ts` is still the file that proves
 * the distinction matters: its only "ls-files" mention was always inside a comment, so it was never a real
 * tree-wide guard under either scheme, and it correctly does not import the marker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { treeWideGuardFiles, MARKER_MODULE } from "../../../../scripts/tree-wide-guards.mjs";
import { declareTreeWideGuard } from "../../../../scripts/tree-wide-guard.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file -- declared here rather
// than inferred from its source, per ceo's ruling (2026-09-09) that the tree-wide-guard population must
// be derived from a real import, never from scanning source text.
declareTreeWideGuard();

test("finds a realistic, non-trivial population -- vacuity guard for the walk itself", () => {
  const files = treeWideGuardFiles();
  assert.ok(files.length >= 15, `only ${files.length} tree-wide guard(s) found; the walk looks broken`);
});

test("every entry is a real tracked *.test.ts path, sorted, deduplicated", () => {
  const files = treeWideGuardFiles();
  assert.deepEqual(files, [...new Set(files)].sort(), "must be sorted and free of duplicates");
  assert.ok(files.every((f) => f.endsWith(".test.ts")), "every entry must be a *.test.ts path");
});

test("names the known five #716 measured as the most expensive", () => {
  const files = new Set(treeWideGuardFiles());
  for (const known of [
    "packages/lab/src/packaging/carry-branch.test.ts",
    "packages/lab/src/referenced-scripts.test.ts",
    "packages/lab/src/packaging/select-changed-tests.test.ts",
    "packages/lab/src/packaging/generated-paths.test.ts",
  ]) assert.ok(files.has(known), `${known} was one of #716's own five and must still be discovered`);
});

test("REAL EXAMPLE: ci-changed.test.ts never imports the marker -- its only \"ls-files\" mention was "
  + "always inside a comment describing another file's internals, so it was never a real tree-wide guard "
  + "under either derivation", () => {
  const files = treeWideGuardFiles();
  assert.ok(!files.includes("packages/lab/src/packaging/ci-changed.test.ts"),
    "if this now fires, either the file changed shape (read it before touching this assertion) or the "
    + "import-based discovery regressed");
});

// --- MUTATION TARGETS: import-based, and IMPORT ALONE must not be enough ---

test("MUTATION TARGET: a file that imports the marker but never CALLS it is NOT discovered -- 'imported' "
  + "is not 'used', the same distinction git-spawn-classification.test.ts's own usesCanonicalHelper draws", () => {
  const files = treeWideGuardFiles({
    lsFiles: () => "fake/import-only.test.ts\nfake/import-and-call.test.ts\n",
    imports: (path) => (path === "fake/import-only.test.ts" || path === "fake/import-and-call.test.ts"
      ? [MARKER_MODULE] : []),
    readFile: (path) => (path === "fake/import-and-call.test.ts"
      ? 'import { declareTreeWideGuard } from "../scripts/tree-wide-guard.mjs";\ndeclareTreeWideGuard();\n'
      : 'import { declareTreeWideGuard } from "../scripts/tree-wide-guard.mjs";\n// never called\n'),
  });
  assert.deepEqual(files, ["fake/import-and-call.test.ts"],
    "an import with no call must never be classified as a real declaration");
});

test("MUTATION TARGET: a file that imports AND calls the marker IS discovered, however it spells its own "
  + "tree walk -- the population no longer depends on any particular git idiom", () => {
  const files = treeWideGuardFiles({
    lsFiles: () => "fake/real-guard.test.ts\n",
    imports: () => [MARKER_MODULE],
    readFile: () => "declareTreeWideGuard();\n// this guard could walk the tree any way it likes now\n",
  });
  assert.deepEqual(files, ["fake/real-guard.test.ts"]);
});

test("CONTROL: a file that neither imports nor calls the marker is simply absent, not an error", () => {
  const files = treeWideGuardFiles({
    lsFiles: () => "fake/unrelated.test.ts\n",
    imports: () => [],
    readFile: () => 'test("x", () => { assert.equal(1, 1); });\n',
  });
  assert.deepEqual(files, []);
});

test("CONTROL: a file that CALLS something with the same name but never imported it from the marker "
  + "module is not discovered -- the import target must actually resolve to tree-wide-guard.mjs", () => {
  const files = treeWideGuardFiles({
    lsFiles: () => "fake/false-friend.test.ts\n",
    imports: () => ["/some/other/module.mjs"],
    readFile: () => 'import { declareTreeWideGuard } from "./some/other/module.mjs";\ndeclareTreeWideGuard();\n',
  });
  assert.deepEqual(files, [], "a same-named function from a DIFFERENT module must not satisfy membership");
});
