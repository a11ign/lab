/**
 * #1824: `release:version` runs INSIDE the release job and nothing commits its result back to `main` --
 * measured on run 35544379475, the first real dispatch since 0.1.0: every package's `package.json` stayed
 * at `0.0.0`, so a second dispatch recomputed the identical already-published target version and
 * `changeset publish` silently no-op'd every already-shipped package.
 *
 * `release.yml` now runs `scripts/release-commit-version-bump.mjs` right after `Publish`, gated on the
 * identical `if:`. This file pins three things: the pure path-selection logic (`versionBumpPaths`), which
 * is what avoids the glob-pathspec trap `git add` falls into (see that function's own header); the script
 * run for real, in a sandbox, on both of its branches; and the workflow wiring itself, the same way
 * `release-safety.test.ts` pins its neighbouring guards.
 *
 * ## #2057 -- THE REAL SPAWN MOVED INTO A SANDBOX, AND ITS SAFETY IS NO LONGER SOMEBODY'S TREE
 *
 * The run used to happen with `cwd: REPO` -- THIS checkout. Its comment argued that was safe because
 * "this worktree's own tracked-path diff (see the previous test) is empty", and **the previous test does
 * not prove that**: it asserts those paths are TRACKED, never that the diff in them is empty. Nothing
 * asserted the precondition the whole argument rested on, so the run was safe only for a reader whose tree
 * happened to be clean -- and an engineer mid-edit under `.changeset/`, `package.json` or
 * `pnpm-lock.yaml` is the ordinary case, not the exotic one.
 *
 * Measured 2026-09-23 on `agent/release-header-currency-2052`: an uncommitted `.changeset/README.md` edit
 * was committed as `e7f0b4d11 release: apply version bump published at e33c2a62d`, authored
 * `github-actions[bot]`, under a message describing a release its diff did not contain. Reproduced the same
 * day on `agent/evidence-check-run-scoped-2122` from an UNTRACKED file -- the new changeset every product
 * PR adds -- so writing the changeset is itself the step that arms it.
 *
 * **AND IT DISGUISES ITSELF.** The run that commits fails `statusAfter === statusBefore` -- correctly, the
 * tree just moved -- and the next run passes BECAUSE the commit made the tree clean. Two runs read as one
 * flaky test while a commit nobody wrote rides along on the branch. That second run is asserted below, on
 * purpose: the disguise is the reason this outlived being seen.
 *
 * So the script now runs against a throwaway repository holding a byte-identical COPY of it and of every
 * file it imports (derived by `localImports`, never hand-listed), with a bare remote of its own. **Nothing
 * skips**: the nothing-pending case below always RUNS, which a precondition-and-skip fix could not promise
 * -- such a check goes quiet exactly when somebody is mid-edit, which is most of the time. And the dirty
 * branch, which no test could reach against a live checkout without doing this to it, is now the positive
 * control: `config`/`add`/`commit`/`push` -- untested until now -- runs end to end against a remote that is
 * a temporary directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { withGitSandbox, sandboxGitEnv } from "../../../../scripts/test-support/git-sandbox.ts";
import type { GitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";
import { localImports } from "../../../guards/src/local-import-closure.mjs";
import { versionBumpPaths } from "../../../../scripts/release-commit-version-bump.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW = readFileSync(join(REPO, ".github/workflows/release.yml"), "utf8");
const SCRIPT = "scripts/release-commit-version-bump.mjs";

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
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    assert.deepEqual(versionBumpPaths(dir), [
      "packages/has-changelog/package.json",
      "packages/has-changelog/CHANGELOG.md",
      "packages/no-changelog/package.json",
      "package.json",
      "pnpm-lock.yaml",
      ".changeset",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#1824 NEGATIVE CONTROL: a path that does not exist is never returned -- no root package.json, no pnpm-lock.yaml, no .changeset", () => {
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
  //
  // READ-ONLY against this checkout, which is why it stays pointed at it while the script's own run below
  // does not: `versionBumpPaths` calls `existsSync` and nothing else.
  const paths = versionBumpPaths(REPO);
  assert.ok(paths.includes("packages/scorer/package.json"), "packages/scorer/package.json must be tracked");
  assert.ok(paths.includes("package.json") && paths.includes("pnpm-lock.yaml") && paths.includes(".changeset"),
    "the root package.json, pnpm-lock.yaml and .changeset must all be tracked -- they all exist");
  assert.deepEqual(paths.filter((p) => p.endsWith("CHANGELOG.md")), [],
    "no package here has a CHANGELOG.md yet -- if this fails, `changeset version` has run for real and the "
    + "glob-pathspec trap this function avoids is worth re-testing against the real tree it describes");
});

/**
 * The script plus every file it imports, transitively, as repo-relative paths. DERIVED through
 * `localImports`, never hand-listed: the copy below is only faithful while it carries what the script
 * actually imports TODAY, and a hand-kept list of two files is precisely the shape that goes stale the day
 * a third import is added -- with the failure landing as an opaque `ERR_MODULE_NOT_FOUND` from a child
 * process rather than as anything a reader would connect to this list.
 */
function scriptClosure(): string[] {
  const seen = new Set<string>();
  const queue = [join(REPO, SCRIPT)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...localImports(file));
  }
  return [...seen].map((absolute) => relative(REPO, absolute));
}

/**
 * A throwaway repository the script can be run against FOR REAL: a byte-identical copy of it and its
 * import closure, the tracked paths `versionBumpPaths` looks for, one base commit, and a bare remote of
 * its own so `git push origin HEAD:main` lands somewhere that is not this repository.
 *
 * A COPY and not a symlink, because `import.meta.url` is what the script derives its repo root from and
 * Node resolves an entry point through symlinks before setting it -- a symlinked script would compute the
 * REAL checkout as its root and do to it exactly what this test exists to stop.
 *
 * `packages/guards` and `packages/worker-fleet` exist in the sandbox only because the closure copy puts
 * files under them; neither carries a `package.json`, so `versionBumpPaths` contributes nothing for either
 * and `packages/fixture/package.json` is what stands in for a real package's manifest bump.
 */
function plantScript(sandbox: GitSandbox, remote: string): void {
  for (const rel of scriptClosure()) {
    mkdirSync(dirname(join(sandbox.dir, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(sandbox.dir, rel));
  }
  mkdirSync(join(sandbox.dir, "packages/fixture"), { recursive: true });
  writeFileSync(join(sandbox.dir, "packages/fixture/package.json"), '{ "name": "fixture", "version": "0.0.0" }\n');
  writeFileSync(join(sandbox.dir, "package.json"), '{ "name": "sandbox-root", "version": "0.0.0" }\n');
  writeFileSync(join(sandbox.dir, "pnpm-lock.yaml"), "{}\n");
  mkdirSync(join(sandbox.dir, ".changeset"), { recursive: true });
  writeFileSync(join(sandbox.dir, ".changeset/README.md"), "# Changesets\n");
  sandbox.run(["add", "-A"]);
  sandbox.commit("base");
  execFileSync("git", ["init", "--bare", "--quiet", remote], { encoding: "utf8", env: sandboxGitEnv() });
  sandbox.run(["remote", "add", "origin", remote]);
}

/**
 * `withGitSandbox` is doing more here than tidying up. It fingerprints THIS repository's HEAD, `user.name`,
 * `user.email` and `core.bare` before and after and throws if any moved -- and the script under test calls
 * `git config user.name`/`user.email` and `git commit` unconditionally once it finds a diff. That guard is
 * what turns "the sandbox is where those landed" from a claim into a checked one.
 */
function withScriptSandbox<T>(fn: (sandbox: GitSandbox, remote: string) => T): T {
  const remote = realpathSync(mkdtempSync(join(tmpdir(), "a11y-release-remote-")));
  try {
    return withGitSandbox((sandbox) => {
      plantScript(sandbox, remote);
      return fn(sandbox, remote);
    });
  } finally {
    rmSync(remote, { recursive: true, force: true });
  }
}

/** The script's own stdout, or a failure that says which of its two branches it died on. */
function runScript(sandbox: GitSandbox): string {
  try {
    return execFileSync("node", [join(sandbox.dir, SCRIPT)],
      { cwd: sandbox.dir, encoding: "utf8", env: sandboxGitEnv() });
  } catch (error) {
    // NAMED, not rethrown bare: #1824's failure mode if the early return goes is precisely a non-zero exit
    // -- `git commit` with nothing staged refuses with "nothing to commit" -- and the raw
    // `Command failed: node /tmp/...` says nothing a reader could act on.
    const output = error as { stdout?: string; stderr?: string };
    throw new Error(
      `${SCRIPT} exited non-zero in the sandbox. With nothing pending it must early-return and exit 0; `
      + "reaching `git commit` with an empty index is what #1824's idempotence done-when forbids.\n"
      + `stdout: ${output.stdout ?? ""}\nstderr: ${output.stderr ?? ""}`,
      { cause: error });
  }
}

test("#1824/#2057 THE SCRIPT ITSELF, run for real against a SANDBOX repository: nothing pending, nothing touched", () => {
  withScriptSandbox((sandbox) => {
    const statusBefore = sandbox.run(["status", "--porcelain"]);
    const headBefore = sandbox.run(["rev-parse", "HEAD"]);

    const result = runScript(sandbox);

    assert.match(result, /nothing pending/, "with nothing to bump the script must say so and stop, not proceed");
    assert.equal(sandbox.run(["status", "--porcelain"]), statusBefore,
      "the script touched the working tree despite finding nothing pending");
    assert.equal(sandbox.run(["rev-parse", "HEAD"]), headBefore,
      "the script committed despite finding nothing pending -- a run with every changeset already consumed "
      + "is the no-op #1824's own done-when names");
  });
});

test("#2057 POSITIVE CONTROL: with an uncommitted `.changeset/` edit the script COMMITS and PUSHES it -- the defect, where it can do no harm", () => {
  withScriptSandbox((sandbox, remote) => {
    writeFileSync(join(sandbox.dir, ".changeset/README.md"), "# Changesets\n\nan engineer's in-flight edit\n");
    const publishedAt = sandbox.run(["rev-parse", "--short", "HEAD"]).trim();

    const result = runScript(sandbox);

    assert.match(result, /committing this version bump back to main/,
      "the script must announce the commit it is about to write");
    assert.equal(sandbox.run(["log", "-1", "--format=%s"]).trim(),
      `release: apply version bump published at ${publishedAt}`,
      "the message describes a release -- which is why finding this on your own branch reads as somebody else's work");
    assert.match(sandbox.run(["show", "--stat", "--format=", "HEAD"]), /\.changeset\/README\.md/,
      "the in-flight edit planted above is what the release commit swept up");
    assert.equal(
      execFileSync("git", ["--git-dir", remote, "rev-parse", "main"], { encoding: "utf8", env: sandboxGitEnv() }).trim(),
      sandbox.run(["rev-parse", "HEAD"]).trim(),
      "and it pushed: `main` in the throwaway remote names the commit just written, so the whole "
      + "config/add/commit/push path ran rather than stopping at the commit");

    // THE DISGUISE, asserted because it is what let this survive being seen: the assertion that catches the
    // commit can only fire AFTER the damage, and the re-run somebody does next reads clean.
    assert.equal(sandbox.run(["status", "--porcelain"]), "",
      "committing the edit is what leaves the tree clean");
    assert.match(runScript(sandbox), /nothing pending/,
      "a second run reports nothing pending BECAUSE the first one committed -- which is how one honest red "
      + "becomes a green on re-run, with the stray commit still on the branch");
  });
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
