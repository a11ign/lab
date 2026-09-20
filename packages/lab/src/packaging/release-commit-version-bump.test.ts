/**
 * #1824: `release:version` runs INSIDE the release job and nothing commits its result back to `main` --
 * measured on run 35544379475, the first real dispatch since 0.1.0: every package's `package.json` stayed
 * at `0.0.0`, so a second dispatch recomputed the identical already-published target version and
 * `changeset publish` silently no-op'd every already-shipped package.
 *
 * `release.yml` now runs `scripts/release-commit-version-bump.mjs` right after `Publish`, gated on the
 * identical `if:`. This file pins two different things: the pure path-selection logic
 * (`versionBumpPaths`), which is what avoids the glob-pathspec trap `git add` falls into (see that
 * function's own header), and the workflow wiring itself, the same way `release-safety.test.ts` pins its
 * neighbouring guards. It does not spawn a real `git push` -- that would either push to this repository's
 * real `main` or need a full sandboxed remote for no return over reading the script's own logic directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { versionBumpPaths } from "../../../../scripts/release-commit-version-bump.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW = readFileSync(join(REPO, ".github/workflows/release.yml"), "utf8");

test("#1824 POSITIVE CONTROL: a package with a CHANGELOG.md contributes both files; one with none contributes only package.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "a11y-version-bump-paths-"));
  try {
    mkdirSync(join(dir, "packages/has-changelog"), { recursive: true });
    writeFileSync(join(dir, "packages/has-changelog/package.json"), "{}");
    writeFileSync(join(dir, "packages/has-changelog/CHANGELOG.md"), "# has-changelog");
    mkdirSync(join(dir, "packages/no-changelog"), { recursive: true });
    writeFileSync(join(dir, "packages/no-changelog/package.json"), "{}");
    mkdirSync(join(dir, ".changeset"), { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "package-lock.json"), "{}");

    assert.deepEqual(versionBumpPaths(dir), [
      "packages/has-changelog/package.json",
      "packages/has-changelog/CHANGELOG.md",
      "packages/no-changelog/package.json",
      "package.json",
      "package-lock.json",
      ".changeset",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#1824 NEGATIVE CONTROL: a path that does not exist is never returned -- no root package.json, no package-lock.json, no .changeset", () => {
  const dir = mkdtempSync(join(tmpdir(), "a11y-version-bump-paths-empty-"));
  try {
    mkdirSync(join(dir, "packages"), { recursive: true });
    assert.deepEqual(versionBumpPaths(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#1824 on the real repository: every package directory contributes package.json; no CHANGELOG.md exists yet", () => {
  // THE POSITIVE CONTROL FOR THE GLOB-PATHSPEC BUG THIS FUNCTION EXISTS TO AVOID: `git add -A --
  // 'packages/*/CHANGELOG.md'` refuses the WHOLE call with "did not match any files" today, because no
  // package here has ever had a changeset applied. If a future release changes that, this assertion is
  // meant to start failing -- the day it does, the fixture test above is what still proves the function
  // itself handles a mix of the two shapes correctly.
  const paths = versionBumpPaths(REPO);
  assert.ok(paths.includes("packages/scorer/package.json"), "packages/scorer/package.json must be tracked");
  assert.ok(paths.includes("package.json") && paths.includes("package-lock.json") && paths.includes(".changeset"),
    "the root package.json, package-lock.json and .changeset must all be tracked -- they all exist");
  assert.deepEqual(paths.filter((p) => p.endsWith("CHANGELOG.md")), [],
    "no package here has a CHANGELOG.md yet -- if this fails, `changeset version` has run for real and the "
    + "glob-pathspec trap this function avoids is worth re-testing against the real tree it describes");
});

test("#1824 THE WORKFLOW CALLS IT: right after Publish, gated on the identical if:", () => {
  const publish = WORKFLOW.indexOf("- name: Publish\n");
  const commitStep = WORKFLOW.indexOf("- name: Commit the version bump back to main");
  const sayWhatHappened = WORKFLOW.indexOf("- name: Say plainly what happened");
  assert.ok(publish !== -1 && commitStep !== -1 && sayWhatHappened !== -1,
    "release.yml's Publish, commit-back or closing step moved; re-read this test");
  assert.ok(publish < commitStep && commitStep < sayWhatHappened,
    "the commit-back step must run after Publish and before the closing summary step");

  const nearby = WORKFLOW.slice(commitStep, sayWhatHappened);
  assert.match(nearby, /if:\s*inputs\.dry-run == false && inputs\.confirm == 'publish-for-real'/,
    "the commit-back step must carry the identical guard Publish itself carries -- a dry run never touched "
    + "the registry, so committing a version nothing actually shipped would make main claim a version that "
    + "does not exist");
  assert.match(nearby, /run:\s*node scripts\/release-commit-version-bump\.mjs/,
    "the commit-back step must actually run the script, or the guard above is decorative");
});

test("#1824: the release job already grants contents: write, which pushing the version bump needs", () => {
  // Granted since the first publish (#63) for the git tag `changeset publish` creates -- this step reuses
  // that same permission rather than widening it further.
  const releaseJob = WORKFLOW.indexOf("\n  release:\n");
  assert.notEqual(releaseJob, -1, "the release job must exist");
  const permissionsBlock = WORKFLOW.slice(releaseJob, WORKFLOW.indexOf("steps:", releaseJob));
  assert.match(permissionsBlock, /contents:\s*write/,
    "the release job must grant contents: write, or pushing the version bump back to main fails");
});
