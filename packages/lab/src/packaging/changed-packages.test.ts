/**
 * `changedPackages` is the pre-push hook's FAST-gate scope: which `packages/<name>` a branch touched
 * against `origin/main`, so an `agent/*`/`lead/*` push tests only what it changed instead of the whole
 * tree. See `scripts/changed-packages.mjs`'s header for why this is deliberately blunt (not dependency-
 * aware) and why an EMPTY result must be read as "run everything", never as "run nothing".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { changedPackages, changedPackagesAgainstOrigin } from "../../../../scripts/changed-packages.mjs";

test("finds every packages/<name> touched, deduped and sorted", () => {
  const diff = [
    "packages/lab/src/gates/verdict-adoption.test.ts",
    "packages/lab/src/gates/verdict.mjs",
    "packages/judge/src/rules.ts",
    "docs/backlog.md",
  ].join("\n");
  assert.deepEqual(changedPackages(diff), ["judge", "lab"]);
});

test("a diff touching nothing under packages/ returns EMPTY, not a guess", () => {
  // Empty is a real, distinct answer -- "nothing under packages/ changed" -- and the CALLER's job is to
  // treat it as "run everything". This test only proves the function itself does not invent packages.
  const diff = ["docs/backlog.md", "scripts/git-hooks/pre-push", ".github/workflows/lint.yml"].join("\n");
  assert.deepEqual(changedPackages(diff), []);
});

test("a bare 'packages' line with no subpath names no package", () => {
  // `packages/README.md` (a top-level file directly under packages/, no package name after it) must not
  // match — the regex requires a THIRD path segment, or `README` itself would be read as a package name.
  assert.deepEqual(changedPackages("packages/README.md"), []);
});

test("blank lines and surrounding whitespace do not produce phantom packages", () => {
  assert.deepEqual(changedPackages("\n  \npackages/lab/src/x.ts\n\n"), ["lab"]);
});

test("CONTROL: a realistic multi-package diff with duplicates dedupes correctly", () => {
  const diff = [
    "packages/lab/src/a.ts", "packages/lab/src/b.ts", "packages/lab/scripts/c.py",
    "packages/worker-fleet/src/d.mjs",
  ].join("\n");
  assert.deepEqual(changedPackages(diff), ["lab", "worker-fleet"]);
});

test("changedPackagesAgainstOrigin runs against the real repo without throwing", () => {
  // Not asserting a specific result -- this worktree's own diff against origin/main varies by branch and
  // by what has landed since. The contract under test is narrower: it must return an ARRAY (even empty),
  // never throw, on a real git repository with a real origin/main.
  const result = changedPackagesAgainstOrigin();
  assert.ok(Array.isArray(result), "must return an array even when nothing changed or git fails");
});
