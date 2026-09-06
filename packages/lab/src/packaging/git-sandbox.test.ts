/**
 * `scripts/test-support/git-sandbox.ts` is the shared helper that ended the GIT_DIR-leak incident
 * (docs/backlog.md, `pre-commit-hook.test.ts:42`'s `git config user.name` writing into the real repo
 * through an inherited `GIT_DIR`). This proves the helper itself, at the two claims that matter:
 *
 * - `withGitSandbox` never touches the target repo under NORMAL conditions.
 * - `withGitSandbox`'s fingerprint check actually FIRES when a sandboxed test bypasses it and mutates the
 *   target -- run under a SIMULATED HOOK ENVIRONMENT (`GIT_DIR` set), because a test proving isolation
 *   with `GIT_DIR` unset proves nothing: that is this defect in the guard meant to catch it.
 *
 * Every scenario here targets a DECOY repository, never this checkout -- `withGitSandbox`'s `root`
 * parameter exists for exactly this, so proving the guard fires costs nothing real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sandboxGitEnv, withGitSandbox, repoFingerprint, RepoIdentityMovedError, KNOWN_GIT_REDIRECT_VARS,
} from "../../../../scripts/test-support/git-sandbox.ts";

/** A throwaway "real repo" stand-in, with one commit already on it -- never this checkout. */
function decoyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "a11y-git-sandbox-decoy-"));
  const env = sandboxGitEnv();
  execFileSync("git", ["init", "--quiet"], { cwd: dir, env });
  execFileSync("git", ["-c", "user.name=Decoy", "-c", "user.email=decoy@example.invalid",
    "commit", "--allow-empty", "-q", "-m", "decoy base"], { cwd: dir, env });
  return dir;
}

test("sandboxGitEnv strips every GIT_* variable, known ones included, by prefix not by list", () => {
  const dirty = { ...process.env, GIT_DIR: "/somewhere/.git", GIT_A_FUTURE_VAR_NOBODY_NAMED_YET: "x" };
  const originalEnv = process.env;
  try {
    Object.assign(process.env, dirty);
    const scrubbed = sandboxGitEnv();
    for (const key of Object.keys(scrubbed)) assert.ok(!key.startsWith("GIT_"), `leaked ${key}`);
    for (const known of KNOWN_GIT_REDIRECT_VARS) assert.ok(!(known in scrubbed));
  } finally {
    process.env = originalEnv;
  }
});

test("withGitSandbox does not touch the target repo under normal conditions", () => {
  const decoy = decoyRepo();
  try {
    const before = repoFingerprint(decoy);
    const result = withGitSandbox((sandbox) => {
      sandbox.commit("inside the sandbox, not the decoy", ["--allow-empty"]);
      return "ok";
    }, decoy);
    assert.equal(result, "ok");
    assert.deepEqual(repoFingerprint(decoy), before, "the decoy must be byte-identical after a sandboxed run");
  } finally { rmSync(decoy, { recursive: true, force: true }); }
});

test("GitSandbox.commit never writes config -- identity is per-command, so it cannot forge author elsewhere", () => {
  const decoy = decoyRepo();
  try {
    withGitSandbox((sandbox) => {
      sandbox.commit("check no config file appears", ["--allow-empty"]);
      assert.throws(() => sandbox.run(["config", "--local", "user.name"]),
        "the sandbox repo itself must have no LOCAL user.name -- commit attached identity without writing it");
    }, decoy);
  } finally { rmSync(decoy, { recursive: true, force: true }); }
});

// --- The guard must be shown to fail, under the exact condition that caused the incident ---

test("the fingerprint guard FIRES when a test bypasses sandboxing and mutates the target -- GIT_DIR SET", () => {
  const decoy = decoyRepo();
  const originalGitDir = process.env.GIT_DIR;
  try {
    // Simulate the pre-push hook environment: GIT_DIR pointed at the decoy, exactly as git exports it
    // into every hook. A mutation check that passes with GIT_DIR unset would prove nothing.
    process.env.GIT_DIR = join(decoy, ".git");
    assert.throws(
      () => withGitSandbox(() => {
        // The ORIGINAL bug, reproduced deliberately: spawn git with the inherited (unscrubbed) env and
        // an unrelated cwd, exactly as pre-commit-hook.test.ts:42 did. GIT_DIR wins over cwd, so this
        // writes into the decoy even though `cwd` points nowhere near it.
        const scratchCwd = mkdtempSync(join(tmpdir(), "a11y-git-sandbox-unrelated-cwd-"));
        try {
          execFileSync("git", ["config", "user.name", "Leaked Identity"],
            { cwd: scratchCwd, env: process.env });
        } finally { rmSync(scratchCwd, { recursive: true, force: true }); }
      }, decoy),
      RepoIdentityMovedError,
      "the guard must throw when the decoy's identity moved during a sandboxed run",
    );
    // And the corruption is real, not merely detected -- otherwise this test could pass by coincidence.
    const configPath = join(decoy, ".git", "config");
    assert.match(readFileSync(configPath, "utf8"), /Leaked Identity/,
      "the reproduction must actually have written into the decoy, or the guard proved nothing");
  } finally {
    if (originalGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = originalGitDir;
    rmSync(decoy, { recursive: true, force: true });
  }
});

test("the fingerprint guard does NOT fire on an untouched decoy, even with GIT_DIR set -- the control", () => {
  // Without this, the test above could pass because the guard fires on EVERYTHING, which would be a
  // guard nobody could ship: every sandboxed test would fail, not only the ones that leak.
  const decoy = decoyRepo();
  const originalGitDir = process.env.GIT_DIR;
  try {
    process.env.GIT_DIR = join(decoy, ".git");
    const result = withGitSandbox((sandbox) => {
      sandbox.commit("properly isolated even with GIT_DIR set in the environment", ["--allow-empty"]);
      return "ok";
    }, decoy);
    assert.equal(result, "ok");
  } finally {
    if (originalGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = originalGitDir;
    rmSync(decoy, { recursive: true, force: true });
  }
});
