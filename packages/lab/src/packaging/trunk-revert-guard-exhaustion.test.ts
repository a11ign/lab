/**
 * #2154: THE CONTROL FOR `trunk-revert-guard.test.ts`'S CLONE -- a full `/tmp` must read as a full `/tmp`
 * where that file's `git clone` dies, and nothing else may be reclassified as one.
 *
 * Measured 2026-09-23T14:15Z on `wt-2122`: two tests red, the message
 * `Command failed: git clone --local --no-hardlinks --quiet <repo> /tmp/a11y-revert-guard-UsmVKC` /
 * `error: copy-fd: write returned: Disk quota exceeded`. The same suite at the same commit was green in CI
 * and green again once `/tmp` had room, and two review rounds on #2136 were spent on it by hand.
 * `sandbox-exhaustion.mjs` (#2158) already turns that into one line naming the HOST; this file proves the
 * guard's clone goes through it, in both directions, because a test that only ever sees one is not a control.
 *
 * ## What is driven, and what cannot be
 *
 * The guard builds its clone with `buildSandbox`, and this file drives that SAME function. The spawn is a
 * REAL child (`execFileSync`, `stdio: "pipe"`), so the error carries what Node sets on a failed spawn --
 * `status`, `stderr`, and a message that starts `Command failed:` -- rather than a hand-built object. The
 * child is `node -e` writing git's measured stderr, not a `git clone` that has filled a disk: the row
 * forbids filling `/tmp` to prove a point already measured, because the host is shared by every session.
 * The NON-space direction IS a real `git clone`, of a path that does not exist.
 *
 * ## The mutations
 *
 * 1. Remove the classification in `buildSandbox` (`?? error` only): the simulated `EDQUOT` surfaces bare, and
 *    the first test goes red.
 * 2. Classify everything (`sandboxExhaustionError` returning an error whatever it is given): the real
 *    `git clone` failure is labelled a full disk, and the second test goes red.
 * 3. Put a bare `mkdtempSync` + `git clone` back in `trunk-revert-guard.test.ts`: the source test goes red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXHAUSTION_MARKER, buildSandbox } from "../../../guards/src/sandbox-exhaustion.mjs";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";

/** git's exit status for a `fatal:` -- what the measured clone died with, and what a missing repository gives. */
const GIT_FATAL = 128;
const PREFIX = "a11y-revert-guard-exhaustion-test-";
const GUARD_TEST = fileURLToPath(new URL("./trunk-revert-guard.test.ts", import.meta.url));

/** git's own words, exactly as measured on 2026-09-23 -- the two lines a full tmpfs printed. */
const MEASURED_STDERR = [
  "error: copy-fd: write returned: Disk quota exceeded",
  "fatal: failed to copy file to '/tmp/a11y-revert-guard-UsmVKC/.git/objects/pack/pack-994886e4.pack': "
  + "Disk quota exceeded",
].join("\n");

const HOST_LEFTOVERS = () => new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(PREFIX)));

/** A real child that dies the way the measured `git clone` did: non-zero, the phrase on stderr only. */
function cloneDyingOfAFullDisk(): void {
  execFileSync(process.execPath, ["-e", `process.stderr.write(${JSON.stringify(MEASURED_STDERR)}); process.exit(${GIT_FATAL})`],
    { stdio: "pipe" });
}

/** A real `git clone` that fails for a reason that has nothing to do with space. */
function cloneOfAMissingRepository(root: string): void {
  execFileSync("git", ["clone", "--local", "--no-hardlinks", "--quiet", join(root, "no-such-repository"), root],
    { stdio: "pipe", env: sandboxGitEnv() });
}

function thrownBy(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  return assert.fail("expected the sandbox build to throw, and it returned");
}

test("#2154: a clone that dies of `Disk quota exceeded` reports the marker, the root and the free space", () => {
  const before = HOST_LEFTOVERS();
  const error = thrownBy(() => buildSandbox({ prefix: PREFIX }, cloneDyingOfAFullDisk));

  assert.equal(error.name, "SandboxExhaustionError");
  assert.ok(error.message.includes(EXHAUSTION_MARKER), `no marker in: ${error.message}`);
  assert.match(error.message, /EDQUOT/, "the errno the phrase stands for");
  assert.ok(error.message.includes(join(tmpdir(), PREFIX)), "the sandbox ROOT it was building");
  assert.match(error.message, /free of .* on the filesystem holding/, "and that root's free space");
  assert.ok(!error.message.includes("\n"), "ONE line, so a grep over the runner's output reaches all of it");
  assert.match(String((error.cause as { stderr?: unknown }).stderr), /Disk quota exceeded/,
    "the original spawn error stays reachable as `cause`");
  assert.deepEqual(HOST_LEFTOVERS(), before, "and the half-built directory is not left to fill the disk further");
});

test("#2154: the same builder, given a failure that is NOT about space, is rethrown untouched", () => {
  const before = HOST_LEFTOVERS();
  const error = thrownBy(() => buildSandbox({ prefix: PREFIX }, cloneOfAMissingRepository));

  assert.ok(!error.message.includes(EXHAUSTION_MARKER), `a missing repository read as a full disk: ${error.message}`);
  assert.notEqual(error.name, "SandboxExhaustionError");
  assert.match(error.message, /Command failed: git clone/, "it is still the spawn's own error");
  assert.equal((error as { status?: number }).status, GIT_FATAL, "with the child's real exit status intact");
  assert.deepEqual(HOST_LEFTOVERS(), before, "cleanup does not depend on the failure being a space one");
});

test("#2154: a build that succeeds returns the populated directory and leaves it for the caller", () => {
  const root = buildSandbox({ prefix: PREFIX }, (dir) => { writeFileSync(join(dir, "marker"), "populated\n"); });
  try {
    assert.equal(readFileSync(join(root, "marker"), "utf8"), "populated\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.ok(!existsSync(root), "and it is the caller's to remove");
});

test("#2154: the guard's clone IS built through buildSandbox, and no bare mkdtemp is left in that file", () => {
  // A text proxy and NOT the proof: the tests above are what show the builder classifies. This shows the
  // guard USES it -- a file that imported the helper and never called it would read differently.
  const source = readFileSync(GUARD_TEST, "utf8");
  assert.match(source, /const CLONE = buildSandbox\(\{ prefix: "a11y-revert-guard-" \}/,
    "the clone is the value of a buildSandbox call");
  assert.doesNotMatch(source, /mkdtempSync\(/, "a bare mkdtempSync is a sandbox the helper never sees");
  assert.match(source, /git", \["clone", "--local", "--no-hardlinks"/,
    "AND the clone is still there -- a source test that passes because the clone was deleted proves nothing");
});
