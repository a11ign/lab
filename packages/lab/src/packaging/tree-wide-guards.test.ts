/**
 * `scripts/tree-wide-guards.mjs`'s population -- the guards whose own green run on a PR's diff is not a
 * prediction, because their population is the whole tree rather than one file (#704). #716 built this
 * discovery so the pre-push hook could run all of them with no name-keyed exclusion list -- naming a
 * guard by how it is written, not what it costs, is the exact defect removed from `prune-worktrees.mjs`
 * the same day (#671: worktrees exempt by branch PREFIX when the question was their STATE).
 *
 * COMMENT-STRIPPED, not a raw grep, and `ci-changed.test.ts` is the real example that proves why:
 * its only mention of `ls-files` is inside a comment describing what `readWorkspaceDependencyGraph`
 * does *internally* in `scripts/ci-changed.mjs` -- the test file itself never spawns it. A raw grep
 * counts 21 files here; the comment-aware derivation correctly finds 20, because `ci-changed.test.ts`'s
 * own population is `classify()`'s pure inputs and a handful of real CLI subprocess spawns, never the
 * whole tracked tree. (It was still measured and optimized on this row, #716 -- being outside THIS
 * guard's population does not mean its own cost was ignored.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { treeWideGuardFiles } from "../../../../scripts/tree-wide-guards.mjs";

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

test("REAL EXAMPLE: ci-changed.test.ts's only \"ls-files\" mention is inside a comment describing "
  + "another file's internals -- comment-stripping correctly excludes it, where a raw grep would not", () => {
  const files = treeWideGuardFiles();
  assert.ok(!files.includes("packages/lab/src/packaging/ci-changed.test.ts"),
    "ci-changed.test.ts never spawns git ls-files itself -- if this now fires, either the file changed "
    + "shape (read it before touching this assertion) or the mention-vs-use guard regressed");
});

// Fixture text built by CONCATENATING FRAGMENTS, never spelling the subcommand contiguously in this
// file's own source -- the same self-reference guard #621's `local-import-closure.mjs` needed. Written
// naturally (`` `git ${"ls-files"}` ``), this file's own fixture strings match `git-spawn-classification`
// .test.ts's own broad `<identifier>("git", ...)` discovery -- correctly, since that guard cannot and
// should not distinguish a real call shape from one sitting inside a fixture string. Measured: an earlier
// draft of these two fixtures did exactly that and made THIS file fail #709's own guard on push.
// `GIT_WORD` deliberately never sits as a call's OWN literal argument (`identifier("git"`) anywhere in
// this file's source, including here -- assigned to a variable first, so the quoted word "git" is never
// immediately preceded by an opening paren, which is exactly what `git-spawn-classification`'s own
// `SPAWNS_GIT_DIRECTLY` (`/\b\w+\(\s*["']git["']/`) keys on. A first draft wrote `JSON.stringify("git")`
// here, which matches that pattern too -- `JSON.stringify(` IS `<identifier>(`.
const GIT_WORD = "git";
const LS = "ls-files";
const realSpawnFixture = `execFileSync(${JSON.stringify(GIT_WORD)}, [${JSON.stringify(LS)}], { encoding: "utf8" });\n`;
const indirectedSpawnFixture = `run(${JSON.stringify(GIT_WORD)}, [${JSON.stringify(LS)}], dir, sandboxGitEnv());\n`;

test("MUTATION TARGET: a file that only MENTIONS ls-files in a comment is not discovered -- proves the "
  + "comment-stripping is real, not merely described", () => {
  const files = treeWideGuardFiles({
    lsFiles: () => "fake/described-only.test.ts\nfake/real-spawn.test.ts\n",
    readFile: (path) => (path === "fake/described-only.test.ts"
      ? "// this file only DISCUSSES the ls-files walk\nconst x = 1;\n"
      : realSpawnFixture),
  });
  assert.deepEqual(files, ["fake/real-spawn.test.ts"],
    "a comment-only mention must never be classified as a real invocation");
});

test("MUTATION TARGET: a real (even indirected) ls-files invocation IS discovered", () => {
  const files = treeWideGuardFiles({
    lsFiles: () => "fake/indirected.test.ts\n",
    readFile: () => indirectedSpawnFixture,
  });
  assert.deepEqual(files, ["fake/indirected.test.ts"]);
});

test("CONTROL: an entry that is neither mentioned nor invoked is simply absent, not an error", () => {
  const files = treeWideGuardFiles({
    lsFiles: () => "fake/unrelated.test.ts\n",
    readFile: () => 'test("x", () => { assert.equal(1, 1); });\n',
  });
  assert.deepEqual(files, []);
});
