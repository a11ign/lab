/**
 * `scripts/git-hooks/pre-commit` refuses a commit that probably is not the committer's own — too many
 * staged files at once, or files nobody has touched recently — and it had no test at all.
 *
 * It is what stands between a shared checkout and one agent committing another's half-finished work,
 * after one such commit swept up 19 files, 16 of them somebody else's in-flight dataset work (see the
 * script's own header). Found 2026-09-05 by an external architecture audit, alongside `install-git-hooks`
 * having no test that it gets INSTALLED (`git-hooks-installed.test.ts`, this file's sibling) — this closes
 * the other half: whether the hook itself, once installed, makes the right call.
 *
 * DRIVES THE REAL, UNMODIFIED SCRIPT rather than a reimplementation of its logic in TypeScript. Two
 * reasons, not one: first, this repo's own repeated lesson is that a second copy of a decision drifts from
 * the first ("A FACT STATED TWICE, and the copies drifted" — CLAUDE.md), and a reimplementation here could
 * disagree with the shipped bash without either side ever being wrong about itself. Second, this hook is
 * genuinely still governing every commit made by every agent sharing this checkout while these tests run —
 * rewriting it into an injectable pure function (the `install-git-hooks.mjs` shape) was considered and
 * rejected for exactly that reason: the blast radius of getting a live rewrite subtly wrong here is a
 * shared checkout where one agent's guard silently stops working, which is worse than the gap this file
 * closes. So the decision logic under test is the actual file every commit runs, exercised through a
 * disposable, throwaway git repository this file creates and destroys — never the real shared checkout.
 *
 * The two thresholds are read from `A11Y_STALE_MIN` / `A11Y_MAX_FILES` environment variables (the script's
 * own header documents this), which is what makes both branches reachable without waiting real minutes or
 * staging a dozen real files: `A11Y_STALE_MIN=0` makes ANY staged file's age (which is always >= 0)
 * immediately stale, and `A11Y_MAX_FILES` is lowered instead of staging thirteen throwaway files.
 *
 * GIT-SANDBOXED: this is precisely the shape that forged 15 commits into the real repo on 2026-09-06 —
 * a throwaway repo, `cwd` alone, and (in the pre-fix version of this file) `git config user.name` plus an
 * inherited `env`. `withGitSandbox` (`scripts/test-support/git-sandbox.ts`) replaces all of it: no identity
 * is configured at all (the hook only ever reads `git diff --cached`, never commits, so none was ever
 * needed — the two `git config` calls this file used to make were pure incidental risk), and every spawn
 * scrubs GIT_*.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withGitSandbox, sandboxGitEnv } from "../../../../scripts/test-support/git-sandbox.ts";
import type { GitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";

const HOOK = fileURLToPath(new URL("../../../../scripts/git-hooks/pre-commit", import.meta.url));
const GUARD_SCRIPT = fileURLToPath(new URL("../../../../scripts/piped-exit-status-guard.mjs", import.meta.url));
const IS_PRIMARY_CHECKOUT_LIB =
  fileURLToPath(new URL("../../../../scripts/git-hooks/lib/is-primary-checkout.sh", import.meta.url));

function stage(sandbox: GitSandbox, names: string[]): void {
  for (const name of names) writeFileSync(join(sandbox.dir, name), "content\n");
  sandbox.run(["add", ...names]);
}

type Verdict = { status: number; stderr: string };

/**
 * Runs the REAL hook script, unmodified — see this file's header for why.
 *
 * `A11Y_PRIMARY_COMMIT_REASON` is always set: issue #126 added a check ahead of everything this file
 * tests, refusing any commit where `.git` is a real directory (never a branch name or a path) — which a
 * fresh `withGitSandbox` repository always is, by construction, whether or not it is standing in for the
 * real project's primary checkout. That guard has its OWN file, `primary-checkout-guard.test.ts`; without
 * bypassing it here, every test below would fail on the new check before ever reaching the staleness or
 * file-count logic this file exists to prove.
 */
function runHook(sandbox: GitSandbox, env: Record<string, string> = {}): Verdict {
  try {
    execFileSync("bash", [HOOK], {
      cwd: sandbox.dir,
      env: sandboxGitEnv({ A11Y_PRIMARY_COMMIT_REASON: "pre-commit-hook.test.ts — not the real primary", ...env }),
      encoding: "utf8",
    });
    return { status: 0, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
}

test("nothing staged at all is allowed, silently", () => {
  withGitSandbox((sandbox) => {
    const result = runHook(sandbox);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
  });
});

test("a small, freshly-staged commit is allowed", () => {
  withGitSandbox((sandbox) => {
    stage(sandbox, ["a.txt", "b.txt"]);
    const result = runHook(sandbox);
    assert.equal(result.status, 0, `expected success, got status ${result.status}: ${result.stderr}`);
  });
});

test("more files than the limit is REFUSED, and the count is named", () => {
  withGitSandbox((sandbox) => {
    const names = Array.from({ length: 13 }, (_, i) => `f${i}.txt`);
    stage(sandbox, names);
    const result = runHook(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing.*13 files staged/i);
  });
});

test("the file-count limit is the ENV VAR, not a hardcoded 12", () => {
  withGitSandbox((sandbox) => {
    stage(sandbox, ["a.txt", "b.txt"]);
    const result = runHook(sandbox, { A11Y_MAX_FILES: "1" });
    assert.equal(result.status, 1, "two files must be refused once the limit is lowered to one");
    assert.match(result.stderr, /refusing.*2 files staged \(limit 1\)/i);
  });
});

test("a staged file older than the stale threshold is REFUSED, named by path", () => {
  withGitSandbox((sandbox) => {
    stage(sandbox, ["old.txt", "also-old.txt"]);
    // A11Y_STALE_MIN=0: any elapsed time at all counts as stale, which is always true the instant after
    // `git add` returns — deterministic, and needs neither a real wait nor a forged mtime.
    const result = runHook(sandbox, { A11Y_STALE_MIN: "0" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /nobody has touched/i);
    assert.match(result.stderr, /old\.txt/);
    assert.match(result.stderr, /also-old\.txt/);
  });
});

test("the stale check fires BEFORE the file-count check — the message names the actual reason", () => {
  // Both conditions are true at once here (13 files, all "stale" under STALE_MIN=0), and the two refusals
  // give a committer opposite instructions (name explicit paths vs. accept the breadth deliberately) — so
  // which one fires first is a real behavioural fact, not an implementation detail.
  withGitSandbox((sandbox) => {
    const names = Array.from({ length: 13 }, (_, i) => `f${i}.txt`);
    stage(sandbox, names);
    const result = runHook(sandbox, { A11Y_STALE_MIN: "0" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /nobody has touched/i,
      "expected the STALE message to fire first when both conditions hold");
  });
});

test("A11Y_COMMIT_ALL=1 bypasses both checks entirely", () => {
  withGitSandbox((sandbox) => {
    const names = Array.from({ length: 13 }, (_, i) => `f${i}.txt`);
    stage(sandbox, names);
    const result = runHook(sandbox, { A11Y_COMMIT_ALL: "1", A11Y_STALE_MIN: "0" });
    assert.equal(result.status, 0, `expected the override to allow everything, got: ${result.stderr}`);
  });
});

// --- issue #180: a newly staged line piping into head/tail/grep and then reading $? ---

test("a new .sh line piping into head then reading $? is REFUSED, and #180 is named", () => {
  withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "deploy.sh"),
      "node scripts/merge-guard.mjs 148 | head -4; echo EXIT=$?\n");
    sandbox.run(["add", "deploy.sh"]);
    const result = runHook(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /#180/);
    assert.match(result.stderr, /deploy\.sh/);
  });
});

test("a legitimate `| head` with nothing reading $? is allowed", () => {
  withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "deploy.sh"), "cat README.md | head -5\n");
    sandbox.run(["add", "deploy.sh"]);
    const result = runHook(sandbox);
    assert.equal(result.status, 0, `expected success, got status ${result.status}: ${result.stderr}`);
  });
});

test("the same hazardous line in a .md file is NOT flagged -- it is usually the rule being documented", () => {
  withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "NOTES.md"),
      "Don't do this: `node scripts/merge-guard.mjs 148 | head -4; echo EXIT=$?`\n");
    sandbox.run(["add", "NOTES.md"]);
    const result = runHook(sandbox);
    assert.equal(result.status, 0, `expected success (docs are exempt), got: ${result.stderr}`);
  });
});

test("A11Y_ALLOW_PIPED_EXIT_STATUS=1 overrides the piped-exit-status refusal specifically", () => {
  withGitSandbox((sandbox) => {
    writeFileSync(join(sandbox.dir, "deploy.sh"),
      "node scripts/merge-guard.mjs 148 | head -4; echo EXIT=$?\n");
    sandbox.run(["add", "deploy.sh"]);
    const result = runHook(sandbox, { A11Y_ALLOW_PIPED_EXIT_STATUS: "1" });
    assert.equal(result.status, 0, `expected the override to allow it, got: ${result.stderr}`);
  });
});

// --- #535: a guard that CANNOT RUN must never be read as a hazard finding ---
//
// Every worker session works in a fresh worktree, and `piped-exit-status-guard.mjs` used to import
// `@a11ign/worker-fleet/cli-flags` -- a workspace package unresolvable before `node_modules` exists there.
// The import throw was swallowed by `>/dev/null 2>&1` and every staged line was reported as a #180 hazard.
// This section runs the REAL, unmodified `pre-commit` from an isolated copy with genuinely NO
// `node_modules` anywhere in its ancestor chain (mirroring `migration-gate-refuses.test.ts`'s own
// technique for the identical bind on `check-schema-migration.mjs`) -- proving the fix holds in the exact
// checkout shape that broke it, not merely in this fully-installed repo.

/**
 * A throwaway directory shaped like a fresh worktree with no `node_modules`: `scripts/git-hooks/pre-commit`
 * (real, unmodified), its `lib/is-primary-checkout.sh` dependency, and a guard script -- normally the real,
 * fixed `piped-exit-status-guard.mjs`, or a caller-supplied stand-in to simulate a guard that genuinely
 * cannot run for some OTHER reason. `realpathSync`, for the identical `/var` symlink trap
 * `migration-gate-refuses.test.ts`'s own header documents.
 */
function isolatedHookTree(guardScriptContent?: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "a11y-pre-commit-no-modules-")));
  mkdirSync(join(root, "scripts/git-hooks/lib"), { recursive: true });
  copyFileSync(HOOK, join(root, "scripts/git-hooks/pre-commit"));
  copyFileSync(IS_PRIMARY_CHECKOUT_LIB, join(root, "scripts/git-hooks/lib/is-primary-checkout.sh"));
  if (guardScriptContent === undefined) {
    copyFileSync(GUARD_SCRIPT, join(root, "scripts/piped-exit-status-guard.mjs"));
  } else {
    writeFileSync(join(root, "scripts/piped-exit-status-guard.mjs"), guardScriptContent);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: root, env: sandboxGitEnv() });
  return root;
}

/** Runs the isolated tree's OWN copy of `pre-commit`. `isolatedHookTree` already `git init`s the root. */
function runIsolatedHook(root: string, env: Record<string, string> = {}): Verdict {
  try {
    execFileSync("bash", [join(root, "scripts/git-hooks/pre-commit")], {
      cwd: root,
      env: sandboxGitEnv({ A11Y_PRIMARY_COMMIT_REASON: "pre-commit-hook.test.ts — not the real primary", ...env }),
      encoding: "utf8",
    });
    return { status: 0, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
}

test("#535 ACCEPTANCE: pre-commit run from a tree with NO node_modules does not report a benign .yml "
  + "as a hazard", () => {
  const root = isolatedHookTree();
  try {
    writeFileSync(join(root, "deploy.yml"), "steps:\n  - run: echo hi\n");
    execFileSync("git", ["add", "deploy.yml"], { cwd: root, env: sandboxGitEnv() });
    const result = runIsolatedHook(root);
    assert.equal(result.status, 0, `expected success with no node_modules, got: ${result.stderr}`);
    assert.doesNotMatch(result.stderr, /180/, "a benign file must never be reported as the #180 hazard");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#535 ACCEPTANCE: the REAL #180 hazard is still caught from a tree with no node_modules -- the fix "
  + "removes a false positive, not the guard's actual job", () => {
  const root = isolatedHookTree();
  try {
    writeFileSync(join(root, "deploy.sh"), "node scripts/merge-guard.mjs 148 | head -4; echo EXIT=$?\n");
    execFileSync("git", ["add", "deploy.sh"], { cwd: root, env: sandboxGitEnv() });
    const result = runIsolatedHook(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /180/);
    assert.doesNotMatch(result.stderr, /GUARD FAILURE/, "a real hazard must never be reported as a guard error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#535 MUTATION TARGET: a guard that genuinely cannot run (an unresolvable import, the pre-fix shape) "
  + "is reported as a GUARD FAILURE, never as a hazard on an unrelated line", () => {
  // Reproduces the ORIGINAL defect directly: a guard script whose entry point throws on import, the exact
  // shape `@a11ign/worker-fleet/cli-flags` produced in a fresh worktree before this fix.
  const brokenGuard = `
    import { thisPackageDoesNotExistAnywhere } from "@a11ign/this-package-does-not-exist/cli-flags";
    console.log(thisPackageDoesNotExistAnywhere);
  `;
  const root = isolatedHookTree(brokenGuard);
  try {
    writeFileSync(join(root, "deploy.yml"), "steps:\n  - run: echo hi\n");
    execFileSync("git", ["add", "deploy.yml"], { cwd: root, env: sandboxGitEnv() });
    const result = runIsolatedHook(root);
    assert.equal(result.status, 1, "a broken guard must still refuse the commit -- failing closed");
    assert.match(result.stderr, /GUARD FAILURE/,
      "must be reported as a guard failure, not folded into the #180 hazard message");
    assert.doesNotMatch(result.stderr, /pipes into a status tool/,
      "the #180 hazard wording must never appear for a line the guard never actually examined");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#535: the guard's own exit codes are distinct -- ALLOW=0, HAZARD=1, ERROR=2, so a guard that "
  + "cannot run can never be confused with node's default uncaught-exception exit code colliding with "
  + "HAZARD", () => {
  const allow = execFileSync("node", [GUARD_SCRIPT, "echo hi"], { encoding: "utf8" });
  assert.match(allow, /^ALLOW:/);

  let hazardStatus = 0;
  try {
    execFileSync("node", [GUARD_SCRIPT, "cmd | head; echo $?"], { encoding: "utf8" });
  } catch (error) {
    hazardStatus = (error as { status?: number }).status ?? 0;
  }
  assert.equal(hazardStatus, 1);

  let errorStatus = 0;
  let errorOutput = "";
  try {
    execFileSync("node", [GUARD_SCRIPT], { encoding: "utf8" }); // no command argument at all
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    errorStatus = e.status ?? 0;
    errorOutput = String(e.stderr ?? "");
  }
  assert.equal(errorStatus, 2, "a usage error must exit with a code distinct from a real HAZARD (1)");
  assert.match(errorOutput, /usage:/);
});
