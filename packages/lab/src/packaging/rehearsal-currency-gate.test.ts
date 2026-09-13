/**
 * `release:rehearsal-check` must REFUSE a release whose commit is not the one `RELEASE.md`'s own rehearsal
 * marker names -- #813's own mutation, made real. Tier 2 of `docs/proving-a-gate.md`'s recipe:
 * `rehearsal-currency.test.ts` proves the decision over injected inputs; this proves the COMMAND -- the
 * paths it composes, the exit code it returns, the sentence it prints.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPT = join(REPO, "packages/lab/scripts/check-rehearsal-currency.mjs");

const SHA = "8849f92df9903660315d0cdc9037e7e04276eece";
const OTHER_SHA = "f47339e2c1d4a5b6e7f8091a2b3c4d5e6f7a8b9c";

/** A minimal tree with the one file this gate reads. */
function planted(releaseMd: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "a11y-rehearsal-"));
  if (releaseMd !== null) writeFileSync(join(root, "RELEASE.md"), releaseMd);
  return root;
}

/**
 * #1265: A REAL REPOSITORY, because the rule is now about ANCESTRY and a DIFF.
 *
 * The old harness planted files in a bare tmpdir, which was enough when the rule compared two strings.
 * It is not enough now: `git merge-base --is-ancestor` and `git diff` need real commits, and a tmpdir
 * that is not a repo makes both reads FAIL -- which the gate correctly treats as a refusal, so every
 * test would pass for the wrong reason. Driving the real commands is the only way the pass case means
 * anything.
 *
 * Returns the two shas: the marker's commit, and HEAD.
 */
function repoWith({ touchAfter = [] as string[] } = {}): { root: string; marker: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "a11y-rehearsal-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", env: sandboxGitEnv() }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  for (const f of ["README.md", "docs/try-it.md", "docs/github-action.md", "action.yml", "RELEASE.md"]) {
    mkdirSync(join(root, dirname(f)), { recursive: true });
    writeFileSync(join(root, f), `${f}\n`);
  }
  git("add", "-A");
  git("commit", "-qm", "the rehearsal's commit");
  const marker = git("rev-parse", "HEAD");
  // The marker goes into RELEASE.md as a LATER commit, which is the whole point: recording a rehearsal
  // is itself a commit, so the marker can never equal the commit being released.
  writeFileSync(join(root, "RELEASE.md"), `<!-- REHEARSAL:COMMIT ${marker} -->\n`);
  for (const f of touchAfter) writeFileSync(join(root, f), `${f} changed\n`);
  git("add", "-A");
  git("commit", "-qm", "record the rehearsal");
  return { root, marker, head: git("rev-parse", "HEAD") };
}

/** @returns the command's exit code and its combined output. */
function runGate(root: string, releaseSha: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, A11Y_REHEARSAL_ROOT: root, A11Y_REHEARSAL_RELEASE_SHA: releaseSha },
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

test("#813's own mutation, made real: a rehearsal that predates the release commit REFUSES, printing both", () => {
  const root = planted(`Prose.\n\n<!-- REHEARSAL:COMMIT ${SHA} -->\n\nMore prose.`);
  try {
    const { code, out } = runGate(root, OTHER_SHA);
    assert.equal(code, 1, "a release commit the rehearsal never ran against must not pass");
    assert.match(out, new RegExp(SHA), "the marked (stale) sha must be printed");
    assert.match(out, new RegExp(OTHER_SHA), "the actual release sha must be printed");
    assert.match(out, /FAIL/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// #1265: THE MARKER-EQUALS-RELEASE CONTROL IS RETIRED, and the reason stands in its place.
//
// It asserted that a release commit EQUAL to the marker passes. That could never happen in a committed
// tree: a rehearsal runs against X, recording it moves the marker in RELEASE.md which IS commit Y, and a
// release at Y reads marker X. The test passed only because its fixture handed the gate two equal shas
// that no history could produce -- a fixture describing a state the system cannot reach. #558 part 1's
// defect, and its part 2's shape (ancestor + unchanged exercised paths) is what replaces it below.

test("#1265: an ancestor marker with NOTHING exercised changed PASSES -- the real control", () => {
  const { root, head } = repoWith();
  try {
    const { code, out } = runGate(root, head);
    assert.equal(code, 0, `an ancestor with no exercised change must pass; the gate said: ${out}`);
    assert.match(out, /PASS/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1265: an exercised path changed since the marker REFUSES, naming the path", () => {
  const { root, head } = repoWith({ touchAfter: ["README.md"] });
  try {
    const { code, out } = runGate(root, head);
    assert.equal(code, 1);
    assert.match(out, /README\.md/, "the gate prints WHICH path, or the operator cannot act on it");
    assert.match(out, /EXERCISES/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1265: a marker that is NOT an ancestor REFUSES, and says so differently", () => {
  // A REAL non-ancestor, on an orphan branch: the sha EXISTS, so `merge-base --is-ancestor` answers
  // "no" (exit 1) rather than "could not tell" (exit >1). My first version passed `OTHER_SHA`, which no
  // repository contains -- so it hit the could-not-tell branch while its assertion read
  // `/not an ancestor|could not tell/`, an OR that is true either way. A mutation ignoring ancestry
  // entirely still passed 7/0. The two branches are different answers and need different fixtures.
  const { root } = repoWith();
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8", env: sandboxGitEnv() }).trim();
    git("checkout", "-q", "--orphan", "elsewhere");
    writeFileSync(join(root, "unrelated.txt"), "elsewhere\n");
    git("add", "-A");
    git("commit", "-qm", "a history the marker is not in");
    const orphan = git("rev-parse", "HEAD");

    const { code, out } = runGate(root, orphan);
    assert.equal(code, 1);
    assert.match(out, /NOT an ancestor/, "and not the could-not-tell refusal, which is a different fact");
    assert.doesNotMatch(out, /could not tell/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a RELEASE.md with no marker at all is a REFUSAL, never a quiet pass", () => {
  const root = planted("RELEASE.md with no rehearsal marker at all.");
  try {
    const { code, out } = runGate(root, SHA);
    assert.equal(code, 1);
    assert.match(out, /no rehearsal is on record/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing RELEASE.md entirely is a REFUSAL, never a crash", () => {
  const root = planted(null);
  try {
    const { code, out } = runGate(root, SHA);
    assert.equal(code, 1);
    assert.match(out, /no rehearsal is on record/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("INCONCLUSIVE is unreachable from this gate, by construction -- one marker, one question", () => {
  const scenarios = [
    { label: "matching commit", root: planted(`<!-- REHEARSAL:COMMIT ${SHA} -->`), sha: SHA },
    { label: "stale commit", root: planted(`<!-- REHEARSAL:COMMIT ${SHA} -->`), sha: OTHER_SHA },
    { label: "no marker", root: planted("nothing here"), sha: SHA },
  ];
  try {
    for (const { label, root, sha } of scenarios) {
      const { code, out } = runGate(root, sha);
      assert.ok(code === 0 || code === 1, `${label}: exit code was ${code}, expected 0 or 1 -- never 2`);
      assert.doesNotMatch(out, /INCONCLUSIVE/, `${label}: printed INCONCLUSIVE, which this gate must never reach`);
    }
  } finally {
    for (const { root } of scenarios) rmSync(root, { recursive: true, force: true });
  }
});
