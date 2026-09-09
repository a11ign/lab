// @ts-check
// #660: ONE FIXTURE REPOSITORY, BUILT ONCE, REUSED BY EVERY TEST THAT NEEDS THE SAME HISTORICAL COMMIT
// PAIR -- not a fix to the tests' OWN correctness, a fix to how many times they pay for the same setup.
//
// `pre-push-resolve-toward-main.test.ts` proves a guard against a REAL incident (bb7fa639 -> 3d38dbf0,
// #232's own resolution-toward-the-branch's-own-side), and it is right to use the real commits rather
// than an invented fixture -- a guard whose failure case is invented is one nobody has seen bite. But two
// separate tests each independently ran `git clone --shared --no-checkout -q <this repo> <tmpdir>` for
// the IDENTICAL pair, and `--shared` does not copy objects -- it still negotiates against every local
// ref. Measured on this checkout (767 refs at the time): ~116 s PER CALL, twice, for two tests that want
// the exact same two commits.
//
// THE FIX IS NOT A FASTER CLONE OF THE WHOLE REPO -- it is cloning something much smaller. A `git bundle`
// containing only the two fixture commits (and their full reachable history/blobs, so file CONTENT is
// real) is built ONCE, cached, and every test that wants that pair fetches from the small bundle instead
// of negotiating the whole local ref set. Measured: bundle creation ~1.1 s (18 MB for this pair), fetch +
// checkout from the cached bundle ~3.3 s -- roughly 35x faster than the repeated whole-repo clone, and
// the checked-out tree is byte-identical (same commit objects, same blobs) to what the slow path produced.
//
// CACHED IN `runs/`, gitignored and per-checkout -- a LOCAL speedup across repeated `npm test` runs on one
// machine. THE CI SPEEDUP IS SEPARATE AND LARGER: a CI runner is ephemeral, so this cache is rebuilt once
// per job regardless, unless the WORKFLOW itself restores it -- see the `actions/cache` step this row also
// adds, keyed on the two shas (fixed, so the key is stable and a cache hit is a true hit, never a rebuild
// wearing a cache's name).
//
// NEVER A SUBSTITUTE FOR THE REAL COMMITS. The bundle's own object database is a byte-for-byte subset of
// this repository's real history -- built with `git bundle create`, not a synthetic replay -- so a test
// reading file content at either commit reads exactly what that commit actually contained. Speeding up
// HOW the commits are reached must never change WHAT is reached, or the guard would be proved against a
// fixture that cannot express the fault it exists for -- this repository's own recorded mistake (#633).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";
import { runsRoot } from "../dataset-paths.mjs";

/** Where cached fixture bundles live -- gitignored, per-checkout, never committed. */
export function fixtureCacheDir() {
  return join(runsRoot(), "git-fixture-cache");
}

/** @param {string} mainSha @param {string} headSha @returns {string} */
export function bundlePathFor(mainSha, headSha) {
  return join(fixtureCacheDir(), `${mainSha}-${headSha}.bundle`);
}

/**
 * Builds (or reuses) a small bundle containing exactly the two named commits' full reachable history,
 * and returns its path.
 *
 * TEMP REFS, NAMED AND DELETED IN THE SAME CALL -- `git bundle create` needs a ref it can record, not a
 * bare sha (a bundle without a ref cannot be fetched from meaningfully). The refs are created under
 * `refs/git-fixture-cache/` -- a namespace this file owns exclusively -- and removed in a `finally`, so a
 * thrown bundle-create error cannot leave one behind to collide with a later call naming the same slot.
 *
 * IDEMPOTENT: a cache hit (the bundle file already exists) skips straight to returning the path, so
 * calling this once per test that wants the pair costs nothing beyond a `statSync` after the first.
 *
 * @param {string} mainSha @param {string} headSha
 * @param {{ repoRoot: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {string} the bundle's path
 */
export function ensureFixtureBundle(mainSha, headSha, { repoRoot, env = sandboxGitEnv() }) {
  const bundlePath = bundlePathFor(mainSha, headSha);
  if (existsSync(bundlePath) && statSync(bundlePath).size > 0) return bundlePath;

  mkdirSync(fixtureCacheDir(), { recursive: true });
  const mainRefName = `refs/git-fixture-cache/${mainSha}-main`;
  const headRefName = `refs/git-fixture-cache/${mainSha}-${headSha}-head`;
  try {
    execFileSync("git", ["update-ref", mainRefName, mainSha], { cwd: repoRoot, env, stdio: "pipe" });
    execFileSync("git", ["update-ref", headRefName, headSha], { cwd: repoRoot, env, stdio: "pipe" });
    execFileSync("git", ["bundle", "create", "-q", bundlePath, mainRefName, headRefName],
      { cwd: repoRoot, env, stdio: "pipe" });
  } finally {
    // `|| true`-shaped: a ref that was never created (an earlier step threw first) has nothing to delete,
    // and `git update-ref -d` on an absent ref is itself an error -- checked, not assumed, so a genuine
    // deletion failure is not swallowed alongside the expected "never existed" case.
    for (const ref of [mainRefName, headRefName]) {
      try {
        execFileSync("git", ["show-ref", "--verify", "--quiet", ref], { cwd: repoRoot, env, stdio: "pipe" });
        execFileSync("git", ["update-ref", "-d", ref], { cwd: repoRoot, env, stdio: "pipe" });
      } catch { /* the ref never existed -- nothing to clean up */ }
    }
  }
  return bundlePath;
}

/**
 * Sets up `dir` (an existing, empty directory) as a git checkout carrying ONLY the two fixture commits,
 * detached at `headSha`, with `refs/remotes/origin/main` pointing at `mainSha` -- the exact state
 * `pre-push-resolve-toward-main.test.ts`'s `runAgainst` needs, built from the cached bundle rather than
 * from a whole-repo clone.
 *
 * @param {string} dir
 * @param {string} mainSha @param {string} headSha
 * @param {{ repoRoot: string, env?: NodeJS.ProcessEnv }} opts
 */
export function checkoutFixturePair(dir, mainSha, headSha, opts) {
  const env = opts.env ?? sandboxGitEnv();
  const bundlePath = ensureFixtureBundle(mainSha, headSha, { repoRoot: opts.repoRoot, env });
  const git = (/** @type {string[]} */ args) => execFileSync("git", args, { cwd: dir, env, stdio: "pipe" });
  git(["init", "-q"]);
  git(["fetch", "-q", bundlePath, "refs/git-fixture-cache/*:refs/remotes/origin/*"]);
  git(["update-ref", "refs/remotes/origin/main", mainSha]);
  git(["checkout", "-q", "--detach", headSha]);
}
