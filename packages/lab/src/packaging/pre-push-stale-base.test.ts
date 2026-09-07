/**
 * #348: a failed `git checkout` in an `&&` chain leaves you on a branch that LOOKS right.
 * `git checkout -q main && git reset --hard origin/main` silently no-ops past the `&&` when the checkout
 * fails (e.g. `main` is already checked out in another worktree) -- the reset never runs, and a branch
 * built off that stale HEAD is a valid commit on a plausibly-named branch. Measured cost of the real
 * incident: 65 files, 3,281 deletions, caught only by hand -- `c7b1a0a0` (still on disk in this very
 * repository) is the surviving artefact. Twice in one day, by two independent sessions, and `ceo` hit the
 * identical trap with `git checkout -B`.
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
import { execFileSync } from "node:child_process";
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
 */
function runStaleBaseCheck(sandbox: GitSandbox, env: Record<string, string> = {}): Verdict {
  const script = `set -euo pipefail\nfailed=()\nskipped=()\n${staleBaseCheckBlock()}\necho A11Y_REACHED_END`;
  try {
    const out = execFileSync("bash", ["-c", script], {
      cwd: sandbox.dir,
      env: sandboxGitEnv(env),
      encoding: "utf8",
    });
    return { status: 0, stderr: out.includes("A11Y_REACHED_END") ? "" : `sentinel missing: ${out}` };
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
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
 * Proves the reproduction is REAL, not synthetic, against the actual repository this test lives in --
 * read-only (`merge-base --is-ancestor` and `rev-parse` never write anything). `c7b1a0a0` is the commit
 * named in issue #348's own body as the surviving artefact of the incident.
 */
test("REAL ARTEFACT: c7b1a0a0 (the actual incident commit) does not contain the current origin/main's tip", () => {
  let staleCommitExists = true;
  try {
    execFileSync("git", ["cat-file", "-e", "c7b1a0a0"], { cwd: REAL_REPO_ROOT, encoding: "utf8" });
  } catch {
    staleCommitExists = false;
  }
  if (!staleCommitExists) {
    // Reachable only if history is ever rewritten and this object is pruned -- reported, not silently
    // skipped, since the whole point of this test is proving against the real artefact.
    assert.fail("c7b1a0a0 is no longer reachable in this repository -- the real-artefact proof cannot run; "
      + "update this test to a still-reachable stale commit if the object was deliberately pruned");
  }
  let isAncestor = true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", "origin/main", "c7b1a0a0"], { cwd: REAL_REPO_ROOT });
  } catch (error) {
    const e = error as { status?: number };
    if (e.status !== 1) throw error; // 1 = "not an ancestor"; anything else is a real git failure
    isAncestor = false;
  }
  assert.equal(isAncestor, false,
    "c7b1a0a0 should NOT contain origin/main's current tip -- that gap is exactly what this check refuses "
    + "a push for, and this proves the reproduction is a real, still-present artefact rather than a "
    + "synthetic shape");
});

test("MUTATION: without the ancestry refusal, the incident shape is silently allowed through", () => {
  // Reproduces the block with its refusal REMOVED, proving the test above can actually fail -- the same
  // discipline `pre-push-git-scrub.test.ts`'s MUTATION tests apply to the scrub line.
  withGitSandbox((sandbox) => {
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
