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
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const HOOK_PATH = new URL("../../../../scripts/git-hooks/pre-push", import.meta.url);

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
 */
function runAgainst(mainRef: string, headRef: string): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "b5-resolve-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8", stdio: "pipe" });
    execFileSync("git", ["clone", "--shared", "--no-checkout", "-q", REPO_ROOT, dir],
      { env: sandboxGitEnv(), stdio: "pipe" });
    git("update-ref", "refs/remotes/origin/main", mainRef);
    git("checkout", "-q", "--detach", headRef);
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

test("THE REAL INCIDENT: the #232 resolution is REFUSED, and every lost symbol is named", () => {
  const result = runAgainst("bb7fa639", "3d38dbf0");
  assert.equal(result.status, 1, `expected a refusal, got ${result.status}:\n${result.out}`);
  // The two files whose exports the resolution discarded. Named individually rather than counted: a
  // refusal that says "6 missing" sends the author looking, where naming them says what to restore.
  assert.match(result.out, /check-real-page-findings\.ts :: reachedOnlyFurnitureHeadings/);
  assert.match(result.out, /check-real-page-findings\.ts :: partitionByExaminability/);
  assert.match(result.out, /prune-stale-workspace-scope\.mjs :: pruneStaleWorkspaceScopes/);
  assert.match(result.out, /#232/, "the refusal must name the incident, or it reads as a mystery");
});

test("IT PRINTS THE SIZE OF THE SET IT EXAMINED, so a clean answer over nothing is visible", () => {
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

test("A CLEAN MERGE PASSES — without this the check is a blanket refusal wearing a predicate's clothes", () => {
  // `main` against itself: every symbol resolves, nothing is lost, and the block must return control
  // rather than exit. The first thing anyone does with a guard that refuses everything is route around it.
  const result = runAgainst("origin/main", "origin/main");
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
