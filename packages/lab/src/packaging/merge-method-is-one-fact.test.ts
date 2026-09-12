/**
 * THIS REPOSITORY ALLOWS MERGE COMMITS ONLY, AND NOTHING IN THE CODE SAID SO.
 *
 *     gh api repos/DanBeckDev/a11y-witness -q '.allow_squash_merge, .allow_merge_commit, .allow_rebase_merge'
 *     false   true   false
 *
 * Measured 2026-09-09, when `gh pr merge 706 --auto --squash` returned:
 *
 *     GraphQL: Merge method squash merging is not allowed on this repository (enablePullRequestAutoMerge)
 *
 * IT DID EMIT AN ERROR. What made it dangerous is that the caller was `gh pr merge ... >/dev/null 2>&1 &&
 * echo armed`, which swallows it, and the exit status was the only remaining signal. The PR sat UNARMED
 * with nothing in the log -- and an unarmed PR is indistinguishable from an armed one until the queue
 * fails to take it. #698 was found in exactly that state by `ceo` earlier the same day.
 *
 * WHAT ACTUALLY CAUGHT IT was reading `autoMergeRequest` back from the API. That is already this
 * repository's rule for the mirror case -- `pr-hold-state.mjs`: "DISARM IS VERIFIED FROM THE STATE, NEVER
 * THE EXIT CODE, because `gh pr merge --disable-auto` returns success on a PR that is already merging,
 * having changed nothing." Arming has the same asymmetry in the other direction, and the same remedy.
 *
 * AND `grep '"--merge"' packages/lab/**\/*.test.ts` LOOKS LIKE COVERAGE AND IS NOT. Every hit is in
 * `merge-queue.test.ts` and every one is about `merge-queue.mjs`'s OWN `--merge=<n>` PR-selector flag
 * (#178) -- the same six characters naming an unrelated thing. A count of the adjacent thing, in the
 * search you would run to check whether this guard was needed.
 *
 * So: the four call sites are swept out of the source rather than listed here, because a fifth added next
 * month is the case a hand-written list cannot cover -- and a fifth is exactly what happened to
 * `newestPerName` (#634 found the fifth call site of a fix applied four times).
 */
// FIRST, so it observes every read below it -- #929. See `scripts/walk-scope.mjs`.
import { declareWalkScope } from "../../../../scripts/walk-scope.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * WHAT THIS GUARD READS, declared so a product diff does not run it -- #929. It walks `scripts/` for the
 * merge-method call sites and nothing else; its own run checks that, and fails if it ever reads wider.
 */
export const WALK_SCOPE = ["scripts"];
await declareWalkScope(import.meta.url);

const SCRIPTS_DIR = fileURLToPath(new URL("../../../../scripts/", import.meta.url));

/** `gh(["pr", "merge", ...])` invocations, with the argument list as written. */
const GH_PR_MERGE = /gh\(\s*\[\s*"pr"\s*,\s*"merge"\s*,([^\]]*)\]/g;

/** Every `gh pr merge` call site under `scripts/`, swept -- never a hand-written list. */
function mergeCallSites(): { file: string; args: string }[] {
  const found: { file: string; args: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith(".mjs")) continue;
      const source = readFileSync(path, "utf8");
      for (const m of source.matchAll(GH_PR_MERGE)) {
        found.push({ file: path.slice(SCRIPTS_DIR.length), args: m[1] });
      }
    }
  };
  walk(SCRIPTS_DIR);
  return found;
}

test("the sweep FINDS the call sites -- a floor, because an empty population passes every assertion below", () => {
  const sites = mergeCallSites();
  assert.ok(sites.length >= 4,
    `expected at least the four known gh pr merge call sites, found ${sites.length}. If the call shape `
    + "changed, this regex now sweeps an empty population and every assertion below passes vacuously.");
  const files = new Set(sites.map((s) => s.file));
  for (const expected of ["arm-pr.mjs", "auto-arm-sweep.mjs", "merge-queue.mjs", "pr-hold.mjs"]) {
    assert.ok(files.has(expected), `${expected} carries a gh pr merge call and the sweep must reach it`);
  }
});

test("no call site passes --squash or --rebase: this repository allows merge commits only", () => {
  const offenders = mergeCallSites()
    .filter((s) => /"--squash"|"--rebase"/.test(s.args))
    .map((s) => `${s.file}: ${s.args.trim()}`);
  assert.deepEqual(offenders, [],
    "allow_squash_merge and allow_rebase_merge are BOTH false on this repository, so these calls fail at "
    + "the API with `Merge method squash merging is not allowed`. A caller that redirects stderr sees "
    + "only a non-zero exit, and the PR is left UNARMED with nothing in the log.");
});

test("every call site that ARMS or MERGES names --merge explicitly, rather than relying on the default", () => {
  const unnamed = mergeCallSites()
    .filter((s) => !/"--disable-auto"/.test(s.args))
    .filter((s) => !/"--merge"/.test(s.args))
    .map((s) => `${s.file}: ${s.args.trim()}`);
  assert.deepEqual(unnamed, [],
    "the method is stated at the call site, never inherited from whatever the repository's default is "
    + "today -- a settings change elsewhere must not silently change what these scripts do.");
});

test("--disable-auto is exempt, and deliberately so -- it names no method because it removes one", () => {
  const disarms = mergeCallSites().filter((s) => /"--disable-auto"/.test(s.args));
  assert.equal(disarms.length, 1, "pr-hold.mjs holds the only disarm");
  assert.ok(!/"--merge"|"--squash"/.test(disarms[0].args),
    "a disarm takes no merge method; requiring one here would be the guard firing on the honest use");
});

test("MUTATION TARGET: a fifth call site added with --squash is caught, and the message names the file", () => {
  // Written out rather than described, so the failure this guard exists for is reproducible. This is the
  // exact shape of the command that left #706 unarmed, transcribed into the call form our scripts use.
  const sites = [
    { file: "arm-pr.mjs", args: '"--auto", "--merge", number, "--repo", repo' },
    { file: "some-new-script.mjs", args: '"--auto", "--squash", number' },
  ];
  const offenders = sites.filter((s) => /"--squash"|"--rebase"/.test(s.args)).map((s) => s.file);
  assert.deepEqual(offenders, ["some-new-script.mjs"],
    "the predicate must name the offending file, not merely fail -- a refusal you cannot act on is one "
    + "you route around");
});
