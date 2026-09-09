/**
 * ONE RESOLUTION THAT KEPT ITS OWN SIDE REMOVED FOUR MERGED UNITS AND PASSED EVERY CHECK — B5, from #232.
 *
 * A branch merged `main` in, answered the conflicts with its own side, and took #363, #183, a
 * schema-migration unit and a workspace-scope unit down with it. **Source and tests went together,
 * consistently**, so nothing dangled: every test passed, `gate` was green, and the loss was invisible for
 * hours. A partial revert would have been caught; a complete one is silent.
 *
 * ## WHY THE PATH LIST IS PRINTED AND THE SYMBOL CHECK IS WHAT REFUSES
 *
 * A path list cannot tell a legitimate edit from a wholesale revert — `M check-real-page-findings.ts`
 * reads identically either way, and that file was the centre of #232. And it cannot see a resolution that
 * keeps BOTH sides at all: A5's merge concatenated two hunks sharing a trailing `});` into one
 * unterminated function, with both standing diffs clean, because no path changed. **A syntax error is not
 * a deleted path.** Two failure modes, neither expressible as a list of filenames.
 *
 * ## THE FIXTURE IS REAL, AND IN THE HOOK'S OWN DIRECTION
 *
 * `bb7fa639 → 3d38dbf0` is the actual incident: the main that was merged, and the merge that discarded it.
 * A guard whose failure case is invented is one nobody has seen bite; this one has the commit pair that
 * cost four units attached to it.
 */
// requires: history
//
// #510: the acceptance job's checkout is shallow, and this file's own `shallowHere()` guard used to
// answer that with `t.skip(...)` -- a real, honest skip, and still a silent pass from the OUTSIDE: the
// PR that most needs this row's own guard is the one that should never be allowed to demonstrate it by
// skipping. `acceptance-commands.mjs` now reads this header and REFUSES the whole command, named, before
// running it at all, unless the PR body carries `History: full` (#497) -- at which point the acceptance
// job's checkout is deepened first, so the skip inside this file never actually fires there. The internal
// `t.skip()` guards stay, as a real safety net for any OTHER shallow context (a local machine, a future
// job) this header cannot reach.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";
import { checkoutFixturePair } from "./git-fixture-cache.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const HOOK_PATH = new URL("../../../../scripts/git-hooks/pre-push", import.meta.url);

// #660: THE FIXED PAIR, NAMED ONCE. `bb7fa639`/`3d38dbf0` are the only shas ever passed to `runAgainst`
// twice in this file (tests 1 and 2 both want the real #232 incident) -- everything else (`head, head`, a
// moving target) still takes the original whole-repo `--shared` clone below, since there is nothing fixed
// to key a cache on. Matching on the literal strings, not a general "is this pair cacheable" predicate,
// keeps the fast path exactly as narrow as the thing it was measured against.
const FIXTURE_MAIN_SHA = "bb7fa639";
const FIXTURE_HEAD_SHA = "3d38dbf0";

/** The real block, extracted by its own markers — never a reimplementation of it. */
function resolveBlock(): string {
  const source = readFileSync(HOOK_PATH, "utf8");
  const match = /# BEGIN B5 RESOLVE-TOWARD-MAIN.*\n([\s\S]*?)# END B5 RESOLVE-TOWARD-MAIN/.exec(source);
  assert.ok(match, "expected the B5 block, bounded by its own markers, in the pre-push hook");
  return match[1];
}

/**
 * Drives the block in a REAL repository whose `origin/main` and `HEAD` are the two fixture commits.
 *
 * A `--shared` clone of this repository, with `refs/remotes/origin/main` set to the main that was merged
 * and HEAD detached at the merge that discarded it. **No shimming of `git`.** The first version of this
 * wrapped `git` in a shell function that rewrote `origin/main` in its arguments, and it produced empty
 * output for reasons that were about the shim rather than the block — a driver complicated enough to be
 * wrong is a driver that cannot testify. Setting the refs is what the block would see on a real branch.
 *
 * `--shared` so no objects are copied: this runs against the real object store, read-only, and the clone
 * is deleted afterwards. `sandboxGitEnv` scrubs `GIT_*`, because `cwd` is not isolation for a spawned
 * git — the fault that had a hook-run test answering about another repository on 2026-09-06.
 *
 * #660: `--shared` DOES NOT COPY OBJECTS, BUT IT STILL NEGOTIATES EVERY LOCAL REF -- measured at ~116 s
 * per call against this checkout's 767+ refs, twice, for the one pair (`bb7fa639`/`3d38dbf0`) both callers
 * below actually want. That pair is fixed, so `checkoutFixturePair` fetches from a small cached bundle
 * (built once, reused across runs, keyed on the two shas — see `git-fixture-cache.mjs`) instead of cloning
 * the whole repository. Every other pair (a moving `head, head`) has nothing fixed to cache and keeps the
 * original path.
 */
function runAgainst(mainRef: string, headRef: string): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "b5-resolve-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8", stdio: "pipe" });
    if (mainRef === FIXTURE_MAIN_SHA && headRef === FIXTURE_HEAD_SHA) {
      checkoutFixturePair(dir, mainRef, headRef, { repoRoot: REPO_ROOT, env: sandboxGitEnv() });
    } else {
      execFileSync("git", ["clone", "--shared", "--no-checkout", "-q", REPO_ROOT, dir],
        { env: sandboxGitEnv(), stdio: "pipe" });
      git("update-ref", "refs/remotes/origin/main", mainRef);
      git("checkout", "-q", "--detach", headRef);
    }
    const script = `set -euo pipefail\nskipped=()\n${resolveBlock()}\necho A11Y_REACHED_END`;
    // `spawnSync`, NOT `execFileSync`: the block writes its verdict to STDERR, and `execFileSync` returns
    // stdout alone on success. The first version of this driver therefore threw away the entire output it
    // was written to read, and reported an empty string as the block's answer — a harness discarding the
    // evidence, which reads exactly like a check that said nothing.
    const run = spawnSync("bash", ["-c", script],
      { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
    return { status: run.status ?? 1, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
  } catch (error) {
    return { status: 1, out: `driver failed: ${(error as Error).message}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A SHALLOW CLONE IS AN HONEST REASON TO SKIP, AND I MISSED IT — caught by CI on this row's own PR.
 *
 * `actions/checkout@v4` defaults to `fetch-depth: 1`, so the runner has no history: the fixture commits
 * are not present and every test below fails for a reason that is about the CHECKOUT, not the hook.
 *
 * **`pre-push-stale-base.test.ts` — the file A0 fixed an hour ago — carries exactly this guard**, and I
 * read it, described it in A0's PR body, and did not carry it across. A0's own finding was that
 * *checking for the truncation you thought of does not cover the truncation you did not*: there, a
 * shallow guard was present and an unreachable object slipped past it. Here the reverse. The two failure
 * modes look identical from inside — a commit you cannot see — and each needs its own question.
 *
 * The durability half is asserted rather than skipped, because that one CAN be answered anywhere.
 */
function shallowHere(): boolean {
  return execFileSync("git", ["rev-parse", "--is-shallow-repository"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8" }).trim() === "true";
}

/** Is `commit` reachable for as long as `main` is? The A0 predicate, so a fixture cannot silently vanish. */
function isAncestorOfMain(commit: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, mainRefHere()],
      { cwd: REPO_ROOT, env: sandboxGitEnv(), stdio: "pipe" });
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 1) throw error;   // not "no" -- "could not ask", which must never read as either
    return false;
  }
}

/**
 * What stands for `main` in THIS checkout.
 *
 * `origin/main` is not a ref on a CI runner -- `actions/checkout` fetches the PR ref, not the branch --
 * so a test that names it fails there for a reason about the checkout. `HEAD` is the honest substitute on
 * a PR branch that has already merged `main`, which the hook's own precondition requires anyway.
 */
function mainRefHere(): string {
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"],
      { cwd: REPO_ROOT, env: sandboxGitEnv(), stdio: "pipe" });
    return "origin/main";
  } catch {
    return "HEAD";
  }
}

test("THE REAL INCIDENT: the #232 resolution is REFUSED, and every lost symbol is named", (t) => {
  if (shallowHere()) {
    t.skip("shallow clone -- the fixture commits are not present, and that is a fact about the checkout "
      + "rather than about the hook. `fetch-depth: 0` would make this runnable in CI; it is not worth "
      + "slowing every job for, and the mutation is run locally and recorded in the PR.");
    return;
  }
  const result = runAgainst("bb7fa639", "3d38dbf0");
  assert.equal(result.status, 1, `expected a refusal, got ${result.status}:\n${result.out}`);
  // The two files whose exports the resolution discarded. Named individually rather than counted: a
  // refusal that says "6 missing" sends the author looking, where naming them says what to restore.
  assert.match(result.out, /check-real-page-findings\.ts :: reachedOnlyFurnitureHeadings/);
  assert.match(result.out, /check-real-page-findings\.ts :: partitionByExaminability/);
  assert.match(result.out, /prune-stale-workspace-scope\.mjs :: pruneStaleWorkspaceScopes/);
  assert.match(result.out, /#232/, "the refusal must name the incident, or it reads as a mystery");
});

test("IT PRINTS THE SIZE OF THE SET IT EXAMINED, so a clean answer over nothing is visible", (t) => {
  if (shallowHere()) {
    t.skip("shallow clone -- the fixture commits are not present, and that is a fact about the checkout "
      + "rather than about the hook. `fetch-depth: 0` would make this runnable in CI; it is not worth "
      + "slowing every job for, and the mutation is run locally and recorded in the PR.");
    return;
  }
  const result = runAgainst("bb7fa639", "3d38dbf0");
  // A guard reporting "nothing lost" over an empty population is worse than no guard, because #232 proved
  // the failure is silent. The count is the difference between "I looked and found nothing" and "I did
  // not look" — and my own sweep two hours earlier reported "none" for twelve PRs having examined one
  // path, caught only because it printed its set size.
  const checked = /resolve-toward-main — (\d+) exported symbol\(s\) checked/.exec(result.out);
  assert.ok(checked, `the block must state how many symbols it checked:\n${result.out}`);
  assert.ok(Number(checked[1]) > 100,
    `only ${checked?.[1]} symbols checked across 46 changed files — the extraction is examining almost `
    + "nothing, which is how a guard passes while blind");
});

/**
 * A REPOSITORY BUILT HERE, because the fault below is about a file's SIZE and this repo's fixtures cannot
 * vary it. Two commits, one `.mjs` file, and the second commit only ADDS a line — the shape of an
 * ordinary push, which is what makes the refusal it once produced a false one.
 *
 * `core.hooksPath=a11y-no-hooks` is a deliberately non-existent path: an EMPTY value resolves relative to
 * the working directory, which is this repo's own recorded gotcha, and a fixture repo must not run the
 * hooks of the checkout that spawned it.
 */
function runInSyntheticRepo(fillerBytes: number): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "b5-pipe-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "core.hooksPath=a11y-no-hooks", "-c", "user.name=fixture",
        "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
        { cwd: dir, env: sandboxGitEnv(), encoding: "utf8", stdio: "pipe" });
    git("init", "-q", "-b", "main");
    // POSITION IS THE WHOLE POINT: `earlySymbol` is at byte 0 and `lateSymbol` past the end of the pipe
    // buffer. Only a match the reader reaches EARLY can kill the writer, so a fixture whose exports sit
    // at the bottom of the file would pass against the defect and prove nothing.
    const filler = `// ${"x".repeat(96)}\n`.repeat(Math.ceil(fillerBytes / 100));
    const onMain = `export function earlySymbol() { return 1; }\n${filler}export const lateSymbol = 2;\n`;
    writeFileSync(join(dir, "big.mjs"), onMain);
    git("add", "big.mjs");
    git("commit", "-qm", "the file as main has it");
    git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD").trim());
    writeFileSync(join(dir, "big.mjs"), `${onMain}export const addedByThisBranch = 3;\n`);
    git("commit", "-qam", "one line added, nothing removed");
    const script = `set -euo pipefail\nskipped=()\n${resolveBlock()}\necho A11Y_REACHED_END`;
    const run = spawnSync("bash", ["-c", script],
      { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
    return { status: run.status ?? 1, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("A CLEAN MERGE PASSES — without this the check is a blanket refusal wearing a predicate's clothes", (t) => {
  if (shallowHere()) {
    t.skip("shallow clone -- the fixture commits are not present, and that is a fact about the checkout "
      + "rather than about the hook. `fetch-depth: 0` would make this runnable in CI; it is not worth "
      + "slowing every job for, and the mutation is run locally and recorded in the PR.");
    return;
  }
  // `main` against itself: every symbol resolves, nothing is lost, and the block must return control
  // rather than exit. The first thing anyone does with a guard that refuses everything is route around it.
  //
  // **AND IT EXAMINES AN EMPTY POPULATION, WHICH IS WHY IT MISSED A REAL FALSE REFUSAL.** A commit against
  // itself makes `git diff --name-only origin/main..HEAD` empty BY CONSTRUCTION, so `0 missing` here is
  // asserted over zero symbols — the exact "clean answer over nothing" the block's own header warns about,
  // in the block's own test. It still proves the block returns control rather than exiting, which is worth
  // keeping. The test below is the positive control that actually looks at something.
  // A CONCRETE SHA, NOT THE STRING "origin/main". The `ts` job's checkout has no `refs/remotes/origin/main`
  // at all -- `actions/checkout` fetches the PR ref, not the branch -- so passing that name to
  // `update-ref` inside the fixture clone died with `fatal: origin/main: not a valid SHA1`, and the
  // positive control failed for a reason about the CHECKOUT rather than about the hook. A no-op merge is
  // any commit against itself, and HEAD always resolves.
  const head = execFileSync("git", ["rev-parse", "HEAD"],
    { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8" }).trim();
  const result = runAgainst(head, head);
  assert.equal(result.status, 0, `a no-op merge must pass:\n${result.out}`);
  assert.match(result.out, /A11Y_REACHED_END/, "the block must return control, not exit 0 early");
  assert.match(result.out, /0 missing/);
});

test("the extraction found the real block, not an empty string", () => {
  // Guard the guard: a marker rename would make every test above run an empty script and pass.
  const block = resolveBlock();
  assert.ok(block.includes("merge-base --is-ancestor"),
    "the block must carry its own precondition — on a branch that has not merged main, every symbol main "
    + "gained since would read as LOST, which is the false-positive flood this check must never produce");
  assert.ok(block.includes("A11Y_RESOLVE_REASON"), "the block must offer a stated override");
  assert.ok(block.length > 500, `the extracted block is only ${block.length} chars; markers moved`);
});

test("THE FIXTURES ARE DURABLE, and this is answerable even on a shallow clone", () => {
  // A0's lesson, carried across deliberately this time: a pinned commit is a derived artefact, true in the
  // clone that has it. Both fixtures are MERGE commits on `main`, so they are reachable for exactly as
  // long as `main` is -- unlike `c7b1a0a0`, which lived on a deleted branch and held the trunk red.
  if (shallowHere()) return;   // nothing to assert about history that is not here
  for (const commit of ["bb7fa639", "3d38dbf0"]) {
    assert.ok(isAncestorOfMain(commit),
      `${commit} is not an ancestor of origin/main, so nothing guarantees it stays reachable -- that is `
      + "how the stale-base test pinned a commit on a deleted branch and turned the trunk red on every run");
  }
});

test("A FILE LARGER THAN THE PIPE BUFFER PASSES — the false refusal, and it was nondeterministic", () => {
  // MEASURED 2026-09-09, and it refused a real push. The check was
  // `printf '%s' "$after" | grep -q "\\b$symbol\\b"`, and `grep -q` exits at its first match — so on a
  // file bigger than the 64 KB pipe buffer `printf` is killed by SIGPIPE, exits 141, and `set -o pipefail`
  // hands 141 to the `||` as the pipeline's status. Indistinguishable there from "not found".
  //
  // `packages/lab/src/training/real-page-corpus.mjs` is 73 KB and exports `assertDisjoint`, first
  // occurring at byte 1878: the hook refused the push naming `assertDisjoint` and `REAL_PAGES` as
  // "exported by origin/main and not resolving after your merge", with both sitting in the pushed file.
  // Three consecutive runs of the same loop over the same file named three different sets, because
  // whether printf finishes before grep exits is a race — so this could not have been read off the code
  // by anyone who had not seen it bite.
  //
  // The direction matters: it can only refuse wrongly, never pass wrongly (a genuinely absent symbol makes
  // grep read to EOF, so printf completes). A guard that refuses correct work is the one that gets
  // overridden by habit, which this repo has already paid for once with `A11Y_SKIP_VERIFY=1`.
  const result = runInSyntheticRepo(100_000);
  // The count first, and asserted as a NUMBER rather than as `0 missing` alone: the positive control
  // above passes over an empty set, and this test exists precisely because that is not proof of anything.
  assert.match(result.out, /resolve-toward-main — 2 exported symbol\(s\) checked/,
    `expected both of main's exports to be examined:\n${result.out}`);
  assert.match(result.out, /0 missing/,
    `both symbols are present in the pushed file; a refusal here is the SIGPIPE fault:\n${result.out}`);
  assert.equal(result.status, 0, `an additive one-line change must pass:\n${result.out}`);
  assert.match(result.out, /A11Y_REACHED_END/, "the block must return control, not exit");
});
