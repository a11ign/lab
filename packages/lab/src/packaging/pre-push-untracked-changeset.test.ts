/**
 * #1127: the pre-push hook's own bash wiring for the untracked-changeset guard -- the override env var,
 * the message, and the exit code -- driven against a STUBBED `node scripts/changeset-untracked-check.mjs`
 * rather than a real dirty tree, the same technique `pre-push-armed-pr.test.ts` uses for the #386 guard
 * and for the identical reason: reproducing the real untracked-file precondition inside a test run would
 * make the test's OWN fixture files the very state under test.
 *
 * `changeset-untracked-check.test.ts` already pins the pure decision (`untrackedChangesetReason`); this
 * file pins only that the bash AROUND it wires exit codes, the override and the message correctly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HOOK_PATH = fileURLToPath(new URL("../../../../scripts/git-hooks/pre-push", import.meta.url));

/** The exact `#1127` block, extracted between its own markers -- never retyped. */
function untrackedChangesetGuardBlock(): string {
  const source = readFileSync(HOOK_PATH, "utf8");
  const match = /# BEGIN #1127 UNTRACKED-CHANGESET GUARD.*\n([\s\S]*?)# END #1127 UNTRACKED-CHANGESET GUARD/
    .exec(source);
  assert.ok(match, "expected to find the #1127 untracked-changeset-guard block, bounded by its own markers");
  return match[1];
}

type Verdict = { status: number; stdout: string; stderr: string };

/**
 * Runs ONLY the extracted block, with a shell FUNCTION named `node` shadowing the real binary -- the
 * only way to drive the bash-side wiring deterministically without a real untracked `.changeset/*.md`
 * file sitting in this checkout while the test runs.
 */
function runUntrackedChangesetGuardBlock(stubExitCode: number, stubOut: string,
  env: Record<string, string> = {}): Verdict {
  const script = `set -euo pipefail\n`
    + `node() { echo '${stubOut.replace(/'/g, "'\\''")}' >&2; exit ${stubExitCode}; }\n`
    + `${untrackedChangesetGuardBlock()}\necho A11Y_REACHED_END`;
  const result = spawnSync("bash", ["-c", script],
    { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("WIRING: the CLI refusing (non-zero) makes the hook exit non-zero, printing the CLI's own message", () => {
  const result = runUntrackedChangesetGuardBlock(1,
    "An untracked changeset exists and is invisible to `changeset status`: .changeset/zz-probe.md");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invisible to `changeset status`/);
  assert.match(result.stderr, /A11Y_ALLOW_UNTRACKED_CHANGESET/, "the override must be named in the refusal");
});

test("WIRING: the CLI allowing (exit 0) lets the hook continue past the guard", () => {
  const result = runUntrackedChangesetGuardBlock(0, "");
  assert.equal(result.status, 0, `expected the block to fall through, got: ${result.stderr}`);
  assert.match(result.stdout, /A11Y_REACHED_END/);
});

test("WIRING: A11Y_ALLOW_UNTRACKED_CHANGESET skips the check entirely and prints the reason", () => {
  // The stub would exit 1 if called -- proving the override short-circuits BEFORE the CLI ever runs,
  // not merely that its refusal is ignored afterward.
  const result = runUntrackedChangesetGuardBlock(1, "would refuse",
    { A11Y_ALLOW_UNTRACKED_CHANGESET: "drafting for tomorrow's PR, not this push" });
  assert.equal(result.status, 0, `expected the override to skip the check entirely, got: ${result.stderr}`);
  assert.match(result.stderr, /untracked-changeset-guard overridden: drafting for tomorrow's PR, not this push/);
  assert.match(result.stdout, /A11Y_REACHED_END/);
});
