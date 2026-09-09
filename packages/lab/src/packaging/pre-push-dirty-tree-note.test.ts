/**
 * #721: the pre-push gate reads the WORKING TREE, not the commits being pushed -- and in a shared
 * checkout those are different things. Measured 2026-09-06: a push from the primary was refused with
 * `1391 problems (2 errors)`, and `npm run lint` re-run immediately afterwards exited 0 with none. The
 * errors were another agent's in-flight edit, present when the gate ran and gone by the time anyone
 * looked -- a state the pusher had not created and could not reproduce.
 *
 * The remedy does not try to make the gate correct -- it makes the refusal ATTRIBUTABLE: when the tree is
 * dirty at check time, the failure message names the dirty files and says the gate reads the tree rather
 * than the commits, so "this is not about your commits" is a readable state instead of an inference.
 *
 * Re-derived from the stranded branch `lead/scored-criteria-v19` (ae5d2c03, 2026-09-06) via
 * `npm run rescue:hunk` -- which correctly REFUSED to apply that branch's hunk verbatim, because its own
 * copy of the trailing `echo "Fix them, or push anyway with: ..."` line predates #706's
 * `A11Y_SKIP_VERIFY_REASON` requirement. The note block below was hand-applied ahead of main's current
 * (already-fixed) line rather than reverting it.
 *
 * DRIVES THE REAL, UNMODIFIED HOOK LOGIC, extracted between its own BEGIN/END markers -- the same
 * technique `pre-push-stale-base.test.ts` uses and for the identical reason: the full hook cannot be run
 * end to end here (it runs real `npm run lint`/`typecheck`/`test` past this point, which need this
 * checkout's own `node_modules` and take minutes), so this extracts exactly the `#721` block and drives
 * it, verbatim, inside a disposable git sandbox.
 *
 * GIT-SANDBOXED throughout (`scripts/test-support/git-sandbox.ts`) -- never the real checkout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withGitSandbox, sandboxGitEnv } from "../../../../scripts/test-support/git-sandbox.ts";
import type { GitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";

const HOOK_PATH = fileURLToPath(new URL("../../../../scripts/git-hooks/pre-push", import.meta.url));

/** The exact `#721` block, extracted between its own markers -- never retyped. */
function dirtyTreeNoteBlock(): string {
  const source = readFileSync(HOOK_PATH, "utf8");
  const match = /# BEGIN #721 DIRTY-TREE NOTE.*\n([\s\S]*?)# END #721 DIRTY-TREE NOTE/.exec(source);
  assert.ok(match, "expected to find the #721 dirty-tree-note block, bounded by its own markers, in the pre-push hook");
  return match[1];
}

type Verdict = { stdout: string; stderr: string };

/**
 * Runs ONLY the extracted block inside a disposable sandbox, with the sandbox's own working directory as
 * cwd -- `git status --porcelain` inside the block reads exactly that sandbox's tree, never the real
 * checkout this test process happens to run from.
 *
 * `spawnSync`, never `execFileSync` -- the block never exits non-zero on its own (unlike the `#348` block
 * it borrows the pattern from), so this is really about capturing BOTH streams uniformly rather than the
 * thrown-error trap those other files name; kept for consistency with the sibling extraction drivers.
 */
function runDirtyTreeNote(sandbox: GitSandbox): Verdict {
  const script = `set -euo pipefail\n${dirtyTreeNoteBlock()}\necho A11Y_REACHED_END`;
  const run = spawnSync("bash", ["-c", script], {
    cwd: sandbox.dir,
    env: sandboxGitEnv(),
    encoding: "utf8",
  });
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  assert.ok(stdout.includes("A11Y_REACHED_END"),
    `sentinel missing -- the block exited early: stdout=${stdout} stderr=${stderr}`);
  return { stdout, stderr };
}

test("#721 ACCEPTANCE 1: a dirty tree names the dirty files and says the gate reads the tree", () => {
  withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "a.txt"), "1\n");
    sandbox.run(["add", "a.txt"]);
    sandbox.commit("add a.txt");
    // Dirty the tree AFTER the commit -- an untracked file is exactly what `git status --porcelain`
    // reports, and exactly the shape of "another agent's in-flight edit" the issue describes.
    writeFileSync(join(sandbox.dir, "someone-elses-edit.txt"), "half-finished\n");

    const result = runDirtyTreeNote(sandbox);
    assert.match(result.stderr, /NOTE: the working tree was NOT CLEAN/);
    assert.match(result.stderr, /gate reads the TREE/);
    assert.match(result.stderr, /someone-elses-edit\.txt/);
  });
});

test("#721 ACCEPTANCE 2: a CLEAN tree says nothing extra -- the note must not become noise on every "
  + "ordinary failure", () => {
  withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "a.txt"), "1\n");
    sandbox.run(["add", "a.txt"]);
    sandbox.commit("add a.txt");
    // No further changes -- `git status --porcelain` reports nothing.

    const result = runDirtyTreeNote(sandbox);
    assert.doesNotMatch(result.stderr, /NOTE:/);
    assert.equal(result.stderr.trim(), "", `expected no extra output on a clean tree, got: ${result.stderr}`);
  });
});

test("#721 ACCEPTANCE 3, MUTATION: without the note, a dirty tree is silently unattributed", () => {
  // Reproduces the block with its NOTE removed, proving the two tests above can actually fail -- the same
  // discipline `pre-push-stale-base.test.ts`'s own MUTATION test applies to the #348 refusal.
  withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "a.txt"), "1\n");
    sandbox.run(["add", "a.txt"]);
    sandbox.commit("add a.txt");
    writeFileSync(join(sandbox.dir, "someone-elses-edit.txt"), "half-finished\n");

    const withoutNote = dirtyTreeNoteBlock()
      .replace(/if \[ -n "\$dirty" \]; then[\s\S]*?fi\n/, "");
    assert.notEqual(withoutNote, dirtyTreeNoteBlock(),
      "the mutation must actually change the block, or this test proves nothing");
    const script = `set -euo pipefail\n${withoutNote}\necho A11Y_REACHED_END`;
    const run = spawnSync("bash", ["-c", script], {
      cwd: sandbox.dir, env: sandboxGitEnv(), encoding: "utf8",
    });
    assert.ok((run.stdout ?? "").includes("A11Y_REACHED_END"));
    assert.doesNotMatch(run.stderr ?? "", /NOTE:/,
      "without the note, a dirty tree at check time must be silently unattributed -- proving the real "
      + "note above is what does the work, not something else in the block");
  });
});
