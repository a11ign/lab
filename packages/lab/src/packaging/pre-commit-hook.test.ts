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
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withGitSandbox, sandboxGitEnv } from "../../../../scripts/test-support/git-sandbox.ts";
import type { GitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";

const HOOK = fileURLToPath(new URL("../../../../scripts/git-hooks/pre-commit", import.meta.url));

function stage(sandbox: GitSandbox, names: string[]): void {
  for (const name of names) writeFileSync(join(sandbox.dir, name), "content\n");
  sandbox.run(["add", ...names]);
}

type Verdict = { status: number; stderr: string };

/** Runs the REAL hook script, unmodified — see this file's header for why. */
function runHook(sandbox: GitSandbox, env: Record<string, string> = {}): Verdict {
  try {
    execFileSync("bash", [HOOK], { cwd: sandbox.dir, env: sandboxGitEnv(env), encoding: "utf8" });
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
