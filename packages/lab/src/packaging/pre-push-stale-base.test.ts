/**
 * #348: a failed `git checkout` in an `&&` chain leaves you on a branch that LOOKS right.
 * `git checkout -q main && git reset --hard origin/main` silently no-ops past the `&&` when the checkout
 * fails (e.g. `main` is already checked out in another worktree) -- the reset never runs, and a branch
 * built off that stale HEAD is a valid commit on a plausibly-named branch. Measured cost of the real
 * incident: 65 files, 3,281 deletions, caught only by hand -- `c7b1a0a0` was the surviving artefact.
 * **It is no longer reachable from any ref**: it lived only on the branch that carried it, and that
 * branch was deleted when its PR resolved. This header claimed it was "still on disk in this very
 * repository" and that stopped being true without anyone touching this file -- see the real-artefact test
 * below, which pinned it and turned the trunk red permanently (A0). Twice in one day, by two independent
 * sessions, and `ceo` hit the identical trap with `git checkout -B`.
 *
 * DRIVES THE REAL, UNMODIFIED HOOK LOGIC, not a reimplementation -- the same reason
 * `pre-commit-hook.test.ts` and `pre-push-git-scrub.test.ts` give: a second copy of a decision drifts
 * from the first. The pre-push hook cannot be run END TO END here (it runs real `npm run lint`/
 * `typecheck`/`test` past this check, which need this checkout's own `node_modules` and take minutes,
 * the same reason `pre-push-fast-gate.test.ts` extracts bounded pieces rather than executing the whole
 * script) -- so this extracts exactly the `#348` block between its own BEGIN/END markers and drives it,
 * verbatim, inside a disposable git sandbox with a synthetic `origin/main`.
 *
 * GIT-SANDBOXED throughout (`scripts/test-support/git-sandbox.ts`) -- never the real checkout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withGitSandbox, sandboxGitEnv } from "../../../../scripts/test-support/git-sandbox.ts";
import type { GitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";

const HOOK_PATH = fileURLToPath(new URL("../../../../scripts/git-hooks/pre-push", import.meta.url));
const REAL_REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The exact `#348` block, extracted between its own markers -- never retyped. */
function staleBaseCheckBlock(): string {
  const source = readFileSync(HOOK_PATH, "utf8");
  const match = /# BEGIN #348 STALE-BASE CHECK.*\n([\s\S]*?)# END #348 STALE-BASE CHECK/.exec(source);
  assert.ok(match, "expected to find the #348 stale-base-check block, bounded by its own markers, in the pre-push hook");
  return match[1];
}

type Verdict = { status: number; stderr: string };

/**
 * Runs ONLY the extracted block, wrapped in the same `set -euo pipefail` and `failed=()`/`skipped=()`
 * preamble it runs under in the real hook, followed by a sentinel echo that proves the block returned
 * control rather than the script having `exit 1`'d out of it.
 *
 * `spawnSync`, never `execFileSync` -- the latter's success return is stdout ALONE, with stderr only ever
 * populated in the thrown error on a non-zero exit (the identical trap `pre-push-armed-pr.test.ts` and
 * `pre-push-resolve-toward-main.test.ts` both name in their own drivers). This block's skip/refuse
 * messages are written to `>&2`, and the #583 "skipped, and says why" assertion needs stderr on the
 * exit-0 path too -- caught here by a real test failing on an empty string, not by reading the other
 * two files' comments first.
 *
 * `stdin`, when given, is git's own pre-push ref-update protocol text -- see `deletionStdin`/
 * `updateStdin` below. Omitted (the default, and every pre-#583 test here), `spawnSync` sends the child
 * an immediately-closed pipe (verified directly: a `cat` reading it returns at once rather than hanging),
 * which is indistinguishable from a caller this check has always had to tolerate -- so every existing
 * test below, none of which ever provided stdin, keeps exercising the ORIGINAL ancestry logic unchanged.
 */
function runStaleBaseCheck(sandbox: GitSandbox, env: Record<string, string> = {}, stdin?: string): Verdict {
  // The real hook only ECHOES `skipped[]`'s contents in its own final summary, well past where the
  // extracted block ends -- this line mirrors that exactly (`scripts/git-hooks/pre-push`'s own
  // `for s in ${skipped+"${skipped[@]}"}; do echo "  SKIPPED $s"; done`), so a skip added inside the
  // block is actually OBSERVABLE here, the same way it is in a real push. Wrapper code, not extracted --
  // this file's own header already treats the preamble/sentinel the identical way.
  const script = `set -euo pipefail\nfailed=()\nskipped=()\n${staleBaseCheckBlock()}\n`
    + `for s in \${skipped+"\${skipped[@]}"}; do echo "  SKIPPED $s" >&2; done\necho A11Y_REACHED_END`;
  const run = spawnSync("bash", ["-c", script], {
    cwd: sandbox.dir,
    env: sandboxGitEnv(env),
    encoding: "utf8",
    ...(stdin === undefined ? {} : { input: stdin }),
  });
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const status = run.status ?? 1;
  // The sentinel proves the block returned control rather than the script having `exit 1`'d out of it
  // partway through -- on a genuine success (status 0) it must always be present; its absence there means
  // the block exited early some OTHER way this driver has not accounted for, which is itself worth failing
  // loudly on rather than reporting a clean status for.
  if (status === 0 && !stdout.includes("A11Y_REACHED_END")) {
    return { status: 1, stderr: `sentinel missing on a reported-clean run: stdout=${stdout} stderr=${stderr}` };
  }
  return { status, stderr };
}

/**
 * git's REAL pre-push protocol text for deleting `refName` -- githooks(5): one line per ref update,
 * `<local ref> SP <local sha1> SP <remote ref> SP <remote sha1> LF`. A deletion's LOCAL sha1 is the
 * all-zeros object name; `remoteSha` is whatever the ref currently points to on the far side (its exact
 * value is irrelevant to the check, so a plausible-looking one is used rather than a second real commit).
 */
function deletionStdin(refName: string, remoteSha = "abc123def456abc123def456abc123def456abcd"): string {
  return `(delete) 0000000000000000000000000000000000000000 ${refName} ${remoteSha}\n`;
}

/** git's real protocol text for an ORDINARY (non-deletion) push of `localSha` to `refName`. */
function updateStdin(localSha: string, refName: string, remoteSha: string): string {
  return `${refName} ${localSha} ${refName} ${remoteSha}\n`;
}

/**
 * Forces the sandbox's initial branch to be named `main`, regardless of the host's
 * `init.defaultBranch` -- a real difference measured between this machine (`main`) and a GitHub Actions
 * runner (`master`), which made `git checkout -q main` fail with "pathspec 'main' did not match any
 * file(s)" in CI while passing everywhere this was written and run. `symbolic-ref` works on the UNBORN
 * HEAD a fresh `git init` leaves, before any commit exists to rename.
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

test("origin/main not resolvable at all is SKIPPED, not refused -- a fresh clone must not be blocked by this", () => {
  withGitSandbox((sandbox) => {
    commitFile(sandbox, "a.txt", "1\n");
    const result = runStaleBaseCheck(sandbox);
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
  });
});

test("HEAD containing origin/main's tip (the normal case) pushes without the override, silently", () => {
  withGitSandbox((sandbox) => {
    commitFile(sandbox, "a.txt", "1\n");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    commitFile(sandbox, "b.txt", "2\n"); // HEAD now a descendant of origin/main -- the healthy shape
    const result = runStaleBaseCheck(sandbox);
    assert.equal(result.status, 0, `a normal branch must push without needing the override: ${result.stderr}`);
  });
});

test("the exact incident shape -- a branch built off a point origin/main has moved PAST -- is REFUSED", () => {
  withGitSandbox((sandbox) => {
    useMainAsInitialBranch(sandbox);
    const staleTip = commitFile(sandbox, "a.txt", "1\n");
    // origin/main moves on; the local branch is a child of the OLD tip, never rebased or merged forward --
    // exactly what a no-op `&&` chain produces: a commit landed on a branch that never picked up the reset.
    sandbox.run(["checkout", "-q", "-b", "side", staleTip]);
    commitFile(sandbox, "side-only.txt", "3\n");
    sandbox.run(["checkout", "-q", "main"]);
    commitFile(sandbox, "main-moved-on.txt", "4\n");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "main"]);
    sandbox.run(["checkout", "-q", "side"]);

    const result = runStaleBaseCheck(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /#348/);
    assert.match(result.stderr, /does not contain origin\/main's tip/);
  });
});

test("A11Y_STALE_BASE_REASON overrides the refusal, and prints the reason rather than staying silent", () => {
  withGitSandbox((sandbox) => {
    useMainAsInitialBranch(sandbox);
    const staleTip = commitFile(sandbox, "a.txt", "1\n");
    sandbox.run(["checkout", "-q", "-b", "side", staleTip]);
    commitFile(sandbox, "side-only.txt", "3\n");
    sandbox.run(["checkout", "-q", "main"]);
    commitFile(sandbox, "main-moved-on.txt", "4\n");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "main"]);
    sandbox.run(["checkout", "-q", "side"]);

    const result = runStaleBaseCheck(sandbox, { A11Y_STALE_BASE_REASON: "deliberate historical branch" });
    assert.equal(result.status, 0, `expected the override to allow it, got: ${result.stderr}`);
  });
});

test("a large deletion against origin/main is PRINTED, never refused, when ancestry still holds", () => {
  withGitSandbox((sandbox) => {
    const big = "line\n".repeat(400);
    writeFileSync(join(sandbox.dir, "big.txt"), big);
    sandbox.run(["add", "big.txt"]);
    sandbox.commit("add big.txt");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    // HEAD stays a descendant of origin/main (ancestry holds) while deleting almost all of the file.
    writeFileSync(join(sandbox.dir, "big.txt"), "line\n");
    sandbox.run(["add", "big.txt"]);
    sandbox.commit("gut big.txt");

    const result = runStaleBaseCheck(sandbox);
    assert.equal(result.status, 0, "a legitimate large deletion with intact ancestry must not be refused");
  });
});

/**
 * Does `maybeAncestor` lead to `descendant`? — `git merge-base --is-ancestor`, with its exit codes read
 * rather than its output.
 *
 * Exit 0 is yes and exit 1 is no; **anything else is a real git failure and must not be read as "no"**,
 * which is why this rethrows rather than returning false. A predicate that answers "no" when it means "I
 * could not ask" is the shape this repository names most often, and here it would report a durable pin as
 * unreachable, or an unreachable one as fine.
 *
 * @param maybeAncestor @param descendant
 */
function isAncestorOf(maybeAncestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", maybeAncestor, descendant],
      { cwd: REAL_REPO_ROOT, stdio: "pipe" });
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 1) throw error;
    return false;
  }
}

/**
 * Proves the reproduction is REAL, not synthetic, against the actual repository this test lives in --
 * read-only throughout (`merge-base --is-ancestor` and `cat-file -e` never write anything).
 *
 * ## THIS PINNED A COMMIT REACHABLE FROM NO REF, AND TURNED THE TRUNK RED PERMANENTLY — A0, 2026-09-08
 *
 * It used to name `c7b1a0a0`, the commit issue #348's own body records as the surviving artefact of the
 * incident. That commit lived only on the branch that carried it, the branch was deleted after its PR
 * resolved, and **a commit reachable from no ref does not travel**. A clone fetches refs; CI's checkout is
 * full-depth and still never receives the object. So `cat-file -e` failed and this test's `assert.fail`
 * fired on `trunk-guard`'s first two runs of the night, on `main` itself, with nothing wrong on `main`.
 *
 * **The old comment named the wrong cause**, which is why nobody expected it: it said that branch was
 * *"reachable only if history is ever rewritten and this object is pruned"*. Nothing was rewritten.
 * Deleting a branch after its PR merges is routine here and does exactly this, permanently — and a stated
 * cause that is false is worse than no comment, because the next reader stops looking where the fault is.
 *
 * **A pinned commit is a derived artefact**: true in the clone that has it, false in every fresh one. The
 * shallow-clone branch below is a real and separate concern, and it did NOT catch this — CI reports
 * `--is-shallow-repository` false while still being unable to see an object no ref reaches. Two causes,
 * one symptom, and only one of them was guarded.
 *
 * ## What is pinned now, and why it is not the incident commit
 *
 * `5ebe02e0` — the merge commit of PR #359, which is #348's own fix. It is an ANCESTOR of `main`, so it is
 * reachable for as long as `main` is, and it satisfies the property under test: it does not contain
 * `main`'s current tip. It is honestly a different artefact from `c7b1a0a0`: that commit is unrecoverable
 * and no pin can bring it back. What survives is what the test was for — a REAL commit from this
 * repository's history standing in the relation the guard refuses, rather than a synthetic shape.
 *
 * The durability requirement is now ASSERTED rather than hoped for, so the next commit pinned here cannot
 * quietly become unreachable the way this one did.
 */

/** The commit this test stands on: a real, permanently reachable commit that does not contain main's tip. */
const PINNED_STALE_BASE = "5ebe02e0";

test("REAL ARTEFACT: a permanently reachable commit that does not contain the current origin/main's tip",
  (t) => {
  // A SHALLOW CLONE IS AN HONEST REASON TO SKIP, NOT A FAILURE. `actions/checkout`'s default
  // `fetch-depth: 1` gives CI a checkout with no history at all beyond the tested commit, so a truncated
  // clone and a rewritten one produce the IDENTICAL symptom -- `cat-file -e` failing -- for completely
  // different reasons. Only the second is this test's business; asking `--is-shallow-repository` tells
  // them apart before treating either as a finding.
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"],
    { cwd: REAL_REPO_ROOT, encoding: "utf8" }).trim() === "true";
  if (shallow) {
    t.skip("shallow clone (no full history here) -- cannot prove anything about a specific historical "
      + "commit; run this locally or in a full-history checkout");
    return;
  }

  // THE DURABILITY ASSERTION, and it is the whole of A0. A pin is only as good as its reachability, and
  // reachability is not a property of the commit -- it is a property of whether some REF still leads to
  // it. An ancestor of `main` is reachable exactly as long as `main` is, which is the strongest guarantee
  // this repository can offer. Asserted here rather than assumed, so a future pin that does not have it
  // fails on the pin rather than months later on an unrelated trunk run.
  assert.ok(isAncestorOf(PINNED_STALE_BASE, "origin/main"),
    `${PINNED_STALE_BASE} is not an ancestor of origin/main, so nothing guarantees it stays reachable -- `
    + "that is how this test pinned `c7b1a0a0`, a commit on a deleted branch, and turned the trunk red on "
    + "every run. Pin a commit that IS an ancestor of `main` (a merge commit is the obvious choice).");

  assert.equal(isAncestorOf("origin/main", PINNED_STALE_BASE), false,
    `${PINNED_STALE_BASE} should NOT contain origin/main's current tip -- that gap is exactly what this `
    + "check refuses a push for, and this proves the reproduction is a real, still-present artefact rather "
    + "than a synthetic shape");
});

test("MUTATION: without the ancestry refusal, the incident shape is silently allowed through", () => {
  // Reproduces the block with its refusal REMOVED, proving the test above can actually fail -- the same
  // discipline `pre-push-git-scrub.test.ts`'s MUTATION tests apply to the scrub line.
  withGitSandbox((sandbox) => {
    useMainAsInitialBranch(sandbox);
    const staleTip = commitFile(sandbox, "a.txt", "1\n");
    sandbox.run(["checkout", "-q", "-b", "side", staleTip]);
    commitFile(sandbox, "side-only.txt", "3\n");
    sandbox.run(["checkout", "-q", "main"]);
    commitFile(sandbox, "main-moved-on.txt", "4\n");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "main"]);
    sandbox.run(["checkout", "-q", "side"]);

    const withoutRefusal = staleBaseCheckBlock()
      .replace(/if ! git merge-base --is-ancestor origin\/main HEAD; then[\s\S]*?exit 1\n\s*fi\n\s*fi/,
        "true # ancestry check removed for this mutation test");
    assert.notEqual(withoutRefusal, staleBaseCheckBlock(),
      "the mutation must actually change the block, or this test proves nothing");
    const script = `set -euo pipefail\nfailed=()\nskipped=()\n${withoutRefusal}\necho A11Y_REACHED_END`;
    const out = execFileSync("bash", ["-c", script], {
      cwd: sandbox.dir, env: sandboxGitEnv(), encoding: "utf8",
    });
    assert.match(out, /A11Y_REACHED_END/,
      "without the refusal, the exact incident shape must be silently allowed through -- proving the real "
      + "refusal above is what does the work, not something else in the block");
  });
});

// --- #583: a deletion has no base to be stale against ---

test("#583 ACCEPTANCE: a pure branch deletion is allowed and names why it skipped, even on a branch "
  + "that IS the #348 incident shape (would otherwise refuse)", () => {
  withGitSandbox((sandbox) => {
    useMainAsInitialBranch(sandbox);
    const staleTip = commitFile(sandbox, "a.txt", "1\n");
    // The exact refused shape from the test above -- HEAD does not contain origin/main's tip -- but this
    // time the push being made is a DELETE of some OTHER ref, unrelated to this checkout's own HEAD.
    sandbox.run(["checkout", "-q", "-b", "side", staleTip]);
    commitFile(sandbox, "side-only.txt", "3\n");
    sandbox.run(["checkout", "-q", "main"]);
    commitFile(sandbox, "main-moved-on.txt", "4\n");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "main"]);
    sandbox.run(["checkout", "-q", "side"]); // HEAD is now the stale branch -- the check would refuse it

    const result = runStaleBaseCheck(sandbox, {}, deletionStdin("refs/heads/some-other-branch"));
    assert.equal(result.status, 0, `a pure deletion must never be refused: ${result.stderr}`);
    assert.match(result.stderr, /stale-base-check.*no base to be stale against/);
  });
});

test("#583 MUTATION direction 2: a REAL update from a stale base still refuses, even with realistic "
  + "protocol stdin present -- the deletion path must not accidentally swallow a normal push", () => {
  withGitSandbox((sandbox) => {
    useMainAsInitialBranch(sandbox);
    const staleTip = commitFile(sandbox, "a.txt", "1\n");
    sandbox.run(["checkout", "-q", "-b", "side", staleTip]);
    commitFile(sandbox, "side-only.txt", "3\n");
    sandbox.run(["checkout", "-q", "main"]);
    commitFile(sandbox, "main-moved-on.txt", "4\n");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "main"]);
    sandbox.run(["checkout", "-q", "side"]);

    const localSha = sandbox.run(["rev-parse", "side"]).trim();
    const stdin = updateStdin(localSha, "refs/heads/side", "0000000000000000000000000000000000000000");
    const result = runStaleBaseCheck(sandbox, {}, stdin);
    assert.equal(result.status, 1, "a real, non-deletion update from a stale base must still be refused");
    assert.match(result.stderr, /#348/);
  });
});

test("#583: a MIXED push (one real update, one deletion) still refuses on the real update -- only a "
  + "push where EVERY line is a deletion may skip", () => {
  withGitSandbox((sandbox) => {
    useMainAsInitialBranch(sandbox);
    const staleTip = commitFile(sandbox, "a.txt", "1\n");
    sandbox.run(["checkout", "-q", "-b", "side", staleTip]);
    commitFile(sandbox, "side-only.txt", "3\n");
    sandbox.run(["checkout", "-q", "main"]);
    commitFile(sandbox, "main-moved-on.txt", "4\n");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "main"]);
    sandbox.run(["checkout", "-q", "side"]);

    const localSha = sandbox.run(["rev-parse", "side"]).trim();
    const stdin = updateStdin(localSha, "refs/heads/side", "0000000000000000000000000000000000000000")
      + deletionStdin("refs/heads/some-other-branch");
    const result = runStaleBaseCheck(sandbox, {}, stdin);
    assert.equal(result.status, 1, "one real update line means this is not an all-deletions push");
  });
});

test("#583: empty stdin (no lines at all) is NOT treated as a deletion -- it keeps the check fully "
  + "active, the same as every pre-#583 caller that never provided any stdin", () => {
  withGitSandbox((sandbox) => {
    useMainAsInitialBranch(sandbox);
    const staleTip = commitFile(sandbox, "a.txt", "1\n");
    sandbox.run(["checkout", "-q", "-b", "side", staleTip]);
    commitFile(sandbox, "side-only.txt", "3\n");
    sandbox.run(["checkout", "-q", "main"]);
    commitFile(sandbox, "main-moved-on.txt", "4\n");
    sandbox.run(["update-ref", "refs/remotes/origin/main", "main"]);
    sandbox.run(["checkout", "-q", "side"]);

    const result = runStaleBaseCheck(sandbox, {}, "");
    assert.equal(result.status, 1, "empty stdin must behave exactly like no stdin -- the check stays on");
  });
});

test("#583 MUTATION direction 1, the issue's own instruction: delete a remote branch with no override "
  + "set -- it must succeed and name the skip", () => {
  withGitSandbox((sandbox) => {
    commitFile(sandbox, "a.txt", "1\n"); // no origin/main at all -- the simplest real deletion shape
    const result = runStaleBaseCheck(sandbox, {}, deletionStdin("refs/heads/pm/fix-body-budget"));
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
  });
});
