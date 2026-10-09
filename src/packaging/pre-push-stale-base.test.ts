/**
 * #348 / #3046: what the pre-push hook still says about a branch built off the wrong point.
 *
 * #348's incident: a failed `git checkout` in an `&&` chain leaves you on a branch that LOOKS right.
 * `git checkout -q main && git reset --hard origin/main` silently no-ops past the `&&` when the checkout
 * fails (e.g. `main` is already checked out in another worktree) -- the reset never runs, and a branch
 * built off that stale HEAD is a valid commit on a plausibly-named branch. Measured cost of the real
 * incident: 65 files, 3,281 deletions, caught only by hand.
 *
 * **The hook no longer REFUSES a push whose HEAD does not contain `origin/main`'s tip (#3046).** The merge
 * queue builds every PR on top of `main` and runs `ci` on that merge commit, and the refusal's only remedy
 * was to merge `main` in -- 49% of 250 recent commits were that merge. What covers the incident shape now is
 * the 300-deletion WARNING (it reads the gutting, not the ancestry) and the queue's `merge_group` run; the
 * residual risk is stated in the test below that names it. `A11Y_STALE_BASE_REASON` is deleted with the refusal.
 *
 * DRIVES THE REAL, UNMODIFIED HOOK LOGIC, not a reimplementation -- the same reason
 * `pre-commit-hook.test.ts` and `pre-push-git-scrub.test.ts` give: a second copy of a decision drifts
 * from the first. The pre-push hook cannot be run END TO END here (it runs real `npm run lint`/
 * `typecheck`/`test` past this block, which need this checkout's own `node_modules` and take minutes,
 * the same reason `pre-push-fast-gate.test.ts` extracts bounded pieces rather than executing the whole
 * script) -- so this extracts exactly the `#348` block between its own BEGIN/END markers and drives it,
 * verbatim, inside a disposable git sandbox with a synthetic `origin/main`.
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

/** The exact `#348` block, extracted between its own markers -- never retyped. */
function warningBlock(): string {
  const source = readFileSync(HOOK_PATH, "utf8");
  const match = /# BEGIN #348 LARGE-DELETION WARNING.*\n([\s\S]*?)# END #348 LARGE-DELETION WARNING/.exec(source);
  assert.ok(match, "expected to find the #348 large-deletion-warning block, bounded by its own markers, in the pre-push hook");
  return match[1];
}

type Verdict = { status: number; stderr: string };

/**
 * Runs ONLY the given block (the real one by default), wrapped in the same `set -euo pipefail` and
 * `failed=()`/`skipped=()` preamble it runs under in the real hook, followed by a sentinel echo that proves
 * the block returned control rather than the script having `exit 1`'d out of it.
 *
 * `spawnSync`, never `execFileSync` -- the latter's success return is stdout ALONE, with stderr only ever
 * populated in the thrown error on a non-zero exit (the identical trap `pre-push-armed-pr.test.ts` and
 * `pre-push-resolve-toward-main.test.ts` both name in their own drivers). This block's messages are written
 * to `>&2`, and most assertions here read stderr on the exit-0 path.
 *
 * `stdin`, when given, is git's own pre-push ref-update protocol text -- see `deletionStdin`/`updateStdin`.
 * Omitted, `spawnSync` sends the child an immediately-closed pipe, indistinguishable from a caller that
 * supplied none.
 */
function runWarning(sandbox: GitSandbox, stdin?: string, block: string = warningBlock()): Verdict {
  // The real hook only ECHOES `skipped[]`'s contents in its own final summary, well past where the
  // extracted block ends -- this line mirrors that exactly (`scripts/git-hooks/pre-push`'s own
  // `for s in ${skipped+"${skipped[@]}"}; do echo "  SKIPPED $s"; done`), so a skip added inside the
  // block is actually OBSERVABLE here, the same way it is in a real push. Wrapper code, not extracted.
  const script = `set -euo pipefail\nfailed=()\nskipped=()\n${block}\n`
    + `for s in \${skipped+"\${skipped[@]}"}; do echo "  SKIPPED $s" >&2; done\necho A11Y_REACHED_END`;
  const run = spawnSync("bash", ["-c", script], {
    cwd: sandbox.dir,
    env: sandboxGitEnv(),
    encoding: "utf8",
    ...(stdin === undefined ? {} : { input: stdin }),
  });
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const status = run.status ?? 1;
  // On a genuine success the sentinel must be present; its absence means the block exited early some way
  // this driver has not accounted for, which is worth failing loudly on rather than reporting clean.
  if (status === 0 && !stdout.includes("A11Y_REACHED_END")) {
    return { status: 1, stderr: `sentinel missing on a reported-clean run: stdout=${stdout} stderr=${stderr}` };
  }
  return { status, stderr };
}

const ZERO_SHA = "0000000000000000000000000000000000000000";

/**
 * git's REAL pre-push protocol text for deleting `refName` -- githooks(5): one line per ref update,
 * `<local ref> SP <local sha1> SP <remote ref> SP <remote sha1> LF`. A deletion's LOCAL sha1 is the
 * all-zeros object name; `remoteSha` is whatever the ref currently points to on the far side (its exact
 * value is irrelevant to the check, so a plausible-looking one is used rather than a second real commit).
 */
function deletionStdin(refName: string, remoteSha = "abc123def456abc123def456abc123def456abcd"): string {
  return `(delete) ${ZERO_SHA} ${refName} ${remoteSha}\n`;
}

/** git's real protocol text for an ORDINARY (non-deletion) push of `localSha` to `refName`. */
function updateStdin(localSha: string, refName: string, remoteSha: string = ZERO_SHA): string {
  return `${refName} ${localSha} ${refName} ${remoteSha}\n`;
}

/**
 * Forces the sandbox's initial branch to be named `main`, regardless of the host's `init.defaultBranch` --
 * a real difference measured between this machine (`main`) and a GitHub Actions runner (`master`).
 * `symbolic-ref` works on the UNBORN HEAD a fresh `git init` leaves, before any commit exists to rename.
 */
function useMainAsInitialBranch(sandbox: GitSandbox): void {
  sandbox.run(["symbolic-ref", "HEAD", "refs/heads/main"]);
}

/** A commit with one file, so `origin/main` and branch histories are trivially distinguishable. */
function commitFile(sandbox: GitSandbox, name: string, content: string): string {
  writeFileSync(join(sandbox.dir, name), content);
  sandbox.run(["add", name]);
  sandbox.commit(`add ${name}`);
  return sandbox.run(["rev-parse", "HEAD"]).trim();
}

/** HEAD is `side`, a child of an OLD tip `origin/main` has moved past by `mainAdds`. Returns `side`'s sha. */
function checkoutBehindMain(sandbox: GitSandbox, mainAdds = "4\n"): string {
  useMainAsInitialBranch(sandbox);
  const oldTip = commitFile(sandbox, "a.txt", "1\n");
  sandbox.run(["checkout", "-q", "-b", "side", oldTip]);
  commitFile(sandbox, "side-only.txt", "3\n");
  sandbox.run(["checkout", "-q", "main"]);
  commitFile(sandbox, "main-moved-on.txt", mainAdds);
  sandbox.run(["update-ref", "refs/remotes/origin/main", "main"]);
  sandbox.run(["checkout", "-q", "side"]);
  return sandbox.run(["rev-parse", "side"]).trim();
}

/** HEAD descends from `origin/main` and deletes 399 of the 400 lines of `big.txt` -- a GUTTING commit. */
function checkoutGuttingCommit(sandbox: GitSandbox): string {
  commitFile(sandbox, "big.txt", "line\n".repeat(400));
  sandbox.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return commitFile(sandbox, "big.txt", "line\n");
}

const WARNING = /this push deletes \d+ line\(s\) against origin\/main/;
const skipReasonIn = (stderr: string) => stderr.split("\n").find((line) => line.includes("SKIPPED large-deletion-warning")) ?? "";

// --- done-when 2: BEHIND origin/main is not a finding ---

test("#3046 ACCEPTANCE: a push whose HEAD is merely BEHIND origin/main passes with no override and no output at all", () => {
  withGitSandbox((sandbox) => {
    checkoutBehindMain(sandbox);
    const result = runWarning(sandbox);
    assert.equal(result.status, 0, `a behind branch must push: ${result.stderr}`);
    assert.equal(result.stderr, "", "and say nothing about ancestry, a base, or merging origin/main in");
  });
});

test("#3046: the refusal and its override variable are deleted from the hook, not merely unreachable", () => {
  const source = readFileSync(HOOK_PATH, "utf8");
  assert.doesNotMatch(source, /A11Y_STALE_BASE_REASON/, "the override of a refusal that no longer exists");
  // The ancestry test survives ONLY as `resolve-toward-main`'s precondition, outside this block.
  assert.doesNotMatch(warningBlock(), /merge-base --is-ancestor/, "the ancestry test itself");
  assert.doesNotMatch(source, /Merge origin\/main in before pushing/, "the advice that made workers push main into branches");
});

test("origin/main not resolvable at all is SKIPPED and says why -- a fresh clone must not be blocked by this", () => {
  withGitSandbox((sandbox) => {
    commitFile(sandbox, "a.txt", "1\n");
    const result = runWarning(sandbox);
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    assert.match(skipReasonIn(result.stderr), /origin\/main not resolvable here/);
  });
});

test("HEAD containing origin/main's tip (the ordinary case) pushes silently", () => {
  withGitSandbox((sandbox) => {
    commitFile(sandbox, "a.txt", "1\n");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    commitFile(sandbox, "b.txt", "2\n");
    const result = runWarning(sandbox);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
  });
});

// --- done-when 2 controls: the warning still PRINTS ---

test("CONTROL: a gutting commit still PRINTS the 300-deletion warning, and is never refused", () => {
  withGitSandbox((sandbox) => {
    checkoutGuttingCommit(sandbox);
    const result = runWarning(sandbox);
    assert.equal(result.status, 0, "a legitimate large deletion must not be refused");
    assert.match(result.stderr, WARNING);
    assert.match(result.stderr, /worth a second look/);
  });
});

test("a small deletion stays silent, so the warning above is the threshold's doing and not an always-on message", () => {
  withGitSandbox((sandbox) => {
    commitFile(sandbox, "big.txt", "line\n".repeat(50));
    sandbox.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    commitFile(sandbox, "big.txt", "line\n");
    assert.equal(runWarning(sandbox).stderr, "");
  });
});

// --- done-when 3: what now covers the #348 incident shape ---

test("#3046 RESIDUAL RISK, STATED: the #348 incident shape is no longer refused; the warning reads its deletions "
  + "when main has moved by more than 300 lines, and the merge queue's merge_group run is the rest", () => {
  withGitSandbox((sandbox) => {
    // The incident shape: a branch built off a point origin/main has moved PAST, never merged forward.
    checkoutBehindMain(sandbox, "main line\n".repeat(400));
    const result = runWarning(sandbox);
    assert.equal(result.status, 0, "not refused any more");
    assert.match(result.stderr, WARNING,
      "main's 400 added lines read as deletions in the two-dot diff -- the #348 incident's own signature");
  });
  withGitSandbox((sandbox) => {
    // THE HOLE, pinned so nobody reads this as full coverage: the same shape with main having moved by LESS
    // than the threshold passes silently. What catches it is the merge, which applies only the branch's own
    // diff (it cannot delete what main added) and the queue's `ci` run on that merge commit.
    checkoutBehindMain(sandbox, "main line\n".repeat(10));
    assert.equal(runWarning(sandbox).stderr, "", "a small stale gap is invisible to this hook, by design");
  });
});

// --- MUTATION, both directions, each breaking its own test only ---

test("MUTATION direction 1: with the warning's print removed, the gutting commit is silent -- the CONTROL above is what notices", () => {
  withGitSandbox((sandbox) => {
    checkoutGuttingCommit(sandbox);
    const mutated = warningBlock().replace(/echo "pre-push: this push deletes[^\n]*\n/, "true\n");
    assert.notEqual(mutated, warningBlock(), "the mutation must actually change the block, or this test proves nothing");
    assert.doesNotMatch(runWarning(sandbox, undefined, mutated).stderr, WARNING);
  });
});

test("MUTATION direction 2: with the threshold at zero, a small deletion prints -- the SILENT case above is what notices", () => {
  withGitSandbox((sandbox) => {
    commitFile(sandbox, "big.txt", "line\n".repeat(50));
    sandbox.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    commitFile(sandbox, "big.txt", "line\n");
    const mutated = warningBlock().replace('-gt 300 ]', '-gt 0 ]');
    assert.notEqual(mutated, warningBlock(), "the mutation must actually change the block, or this test proves nothing");
    assert.match(runWarning(sandbox, undefined, mutated).stderr, WARNING);
  });
});

// --- #583: a deletion carries no diff to warn about ---

test("#583 ACCEPTANCE: a pure branch deletion is allowed and names why it skipped, from a HEAD that WOULD warn -- "
  + "and a branch push from that same HEAD still warns", () => {
  withGitSandbox((sandbox) => {
    const sha = checkoutGuttingCommit(sandbox);
    const deletion = runWarning(sandbox, deletionStdin("refs/heads/some-other-branch"));
    assert.equal(deletion.status, 0, `a pure deletion must never be refused: ${deletion.stderr}`);
    assert.match(skipReasonIn(deletion.stderr), /only deletes remote ref\(s\)/);
    assert.doesNotMatch(deletion.stderr, WARNING, "HEAD is not what a deletion pushes");
    // POSITIVE CONTROL, same sandbox and HEAD: a check that stopped running passes every assertion above.
    assert.match(runWarning(sandbox, updateStdin(sha, "refs/heads/side")).stderr, WARNING);
  });
});

test("#583: a MIXED push (one real update, one deletion) still warns -- only a push where EVERY line is a deletion may skip", () => {
  withGitSandbox((sandbox) => {
    const sha = checkoutGuttingCommit(sandbox);
    const stdin = updateStdin(sha, "refs/heads/side") + deletionStdin("refs/heads/some-other-branch");
    assert.match(runWarning(sandbox, stdin).stderr, WARNING);
  });
});

test("#583: empty stdin (no lines at all) is NOT treated as a deletion -- the check stays fully active", () => {
  withGitSandbox((sandbox) => {
    checkoutGuttingCommit(sandbox);
    assert.match(runWarning(sandbox, "").stderr, WARNING);
  });
});

test("#583: a deletion with no origin/main at all succeeds and names the skip", () => {
  withGitSandbox((sandbox) => {
    commitFile(sandbox, "a.txt", "1\n");
    const result = runWarning(sandbox, deletionStdin("refs/heads/pm/fix-body-budget"));
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    assert.match(skipReasonIn(result.stderr), /only deletes remote ref\(s\)/);
  });
});

// --- #1292: a tag write advances no branch either ---

test("#1292 ACCEPTANCE: a TAG-only push is skipped and names why -- and a BRANCH push from that same HEAD still warns", () => {
  withGitSandbox((sandbox) => {
    const sha = checkoutGuttingCommit(sandbox);
    // Each line shape measured from a real `git push` on git 2.53.0. `<sha>:refs/tags/<name>`, #1246's own
    // form, reports the SHA as its local ref; a named tag reports the tag's refname.
    const tagPushes: Record<string, string> = {
      "sha to tag (#1246's form)": `${sha} ${sha} refs/tags/stranded/agent-x ${ZERO_SHA}\n`,
      "named tag": `refs/tags/v0.1.0 ${sha} refs/tags/v0.1.0 ${ZERO_SHA}\n`,
      "tag write plus tag deletion": `refs/tags/v0.1.0 ${sha} refs/tags/v0.1.0 ${ZERO_SHA}\n` + deletionStdin("refs/tags/old"),
    };
    for (const [label, stdin] of Object.entries(tagPushes)) {
      const result = runWarning(sandbox, stdin);
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      assert.match(skipReasonIn(result.stderr), /this push only writes tag\(s\)/, label);
      assert.doesNotMatch(result.stderr, WARNING, label);
    }
    // POSITIVE CONTROL, same sandbox and HEAD.
    assert.match(runWarning(sandbox, updateStdin(sha, "refs/heads/side")).stderr, WARNING);
  });
});

test("#1292: a MIXED push (a tag and a branch) still warns -- a tag riding along must not silence the branch", () => {
  withGitSandbox((sandbox) => {
    const sha = checkoutGuttingCommit(sandbox);
    // Measured: a mixed push reports its branch line's LOCAL ref as `HEAD`, so only the remote ref says
    // what is being written -- which is why the hook reads that field.
    const stdin = `HEAD ${sha} refs/heads/side ${ZERO_SHA}\nrefs/tags/v0.1.0 ${sha} refs/tags/v0.1.0 ${ZERO_SHA}\n`;
    assert.match(runWarning(sandbox, stdin).stderr, WARNING);
  });
});

test("#1292: a branch whose NAME contains `refs/tags/` is still a branch -- the skip reads the namespace", () => {
  withGitSandbox((sandbox) => {
    const sha = checkoutGuttingCommit(sandbox);
    assert.match(runWarning(sandbox, updateStdin(sha, "refs/heads/refs/tags/looks-like-a-tag")).stderr, WARNING);
  });
});

// --- #1309: the skip reason names what the push did -- a deletion in a tag push may be a BRANCH's ---

test("#1309 ACCEPTANCE: a tag write plus a BRANCH deletion is allowed, and its reason says it deletes a ref -- "
  + "never 'only writes or deletes tag(s)'", () => {
  withGitSandbox((sandbox) => {
    const sha = checkoutBehindMain(sandbox);
    const stdin = `refs/tags/v0.1.0 ${sha} refs/tags/v0.1.0 ${ZERO_SHA}\n` + deletionStdin("refs/heads/old-branch");
    const result = runWarning(sandbox, stdin);
    assert.equal(result.status, 0, result.stderr);
    const reason = skipReasonIn(result.stderr);
    assert.match(reason, /this push only writes tag\(s\) and deletes ref\(s\)/, "the reason names both kinds this push carried");
    assert.doesNotMatch(reason, /writes or deletes tag\(s\)/, "the old sentence, false for a push that deletes a branch");
  });
});

test("#1309: a tag write with NO deletion says it only writes tag(s), and says nothing about deleting", () => {
  withGitSandbox((sandbox) => {
    const sha = checkoutBehindMain(sandbox);
    const result = runWarning(sandbox, `refs/tags/v0.1.0 ${sha} refs/tags/v0.1.0 ${ZERO_SHA}\n`);
    assert.equal(result.status, 0);
    const reason = skipReasonIn(result.stderr);
    assert.match(reason, /this push only writes tag\(s\), which record an existing commit/);
    assert.doesNotMatch(reason.replace("large-deletion-warning", ""), /delet/, "a push that deleted nothing must not be described as deleting");
  });
});
