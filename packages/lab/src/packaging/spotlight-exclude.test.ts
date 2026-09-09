/**
 * `mds_stores` was the top CPU consumer on this host for most of 2026-09-09 -- 70-94%, for hours, with
 * ZERO git processes running -- and `syspolicyd`, `trustd` and `diagnosticd` filled the rest of the top
 * five. Spotlight indexing and Gatekeeper scanning 119 worktrees, each a full copy of the source tree.
 *
 * The prune took it to 67. THE MARKER DID NOT HELP WITH THE REST, and that is measured rather than
 * assumed: placed on all 68 worktrees at 12:47Z and verified present, `mds_stores` read 54.8% at 12:45Z
 * and 80% at 12:52Z. On current macOS `.metadata_never_index` is honoured at a VOLUME ROOT only.
 *
 * So these tests assert what the script DOES -- enumerate worktrees and report which carry the marker,
 * idempotently, without writing outside them -- and assert nothing about Spotlight's behaviour, which is
 * not ours to test and was the thing the original comment got wrong.
 *
 * THE `.gitignore` LINE COMES FIRST AND THAT ORDERING IS THE POINT. Without it, placing 67 markers puts
 * 67 untracked files across nine sessions' `git status` -- and `git add -A` sweeping another agent's
 * files is the incident the pre-commit hook exists to catch. A remedy that creates the repository's own
 * recorded hazard is not a remedy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreePaths, markerPlan } from "../../../../scripts/spotlight-exclude.mjs";

const GITIGNORE = fileURLToPath(new URL("../../../../.gitignore", import.meta.url));

test("`.metadata_never_index` is gitignored -- 67 untracked files across nine sessions is the hazard", () => {
  const lines = readFileSync(GITIGNORE, "utf8").split("\n").map((l) => l.trim());
  assert.ok(lines.includes(".metadata_never_index"),
    "without this line the markers appear in every session's `git status`, and `git add -A` sweeping "
    + "another agent's files is exactly what the pre-commit hook was written for");
});

test("worktreePaths reads git's own porcelain, and INCLUDES the primary -- it is the largest checkout", () => {
  const porcelain = [
    "worktree /repo", "HEAD abc", "branch refs/heads/main", "",
    "worktree /tmp/wt-a", "HEAD def", "detached", "",
    "worktree /tmp/wt-b", "HEAD 012", "branch refs/heads/agent/x", "",
  ].join("\n");
  assert.deepEqual(worktreePaths({ run: () => porcelain }), ["/repo", "/tmp/wt-a", "/tmp/wt-b"]);
});

test("markerPlan separates what needs a marker from what already has one -- the report and the action agree", () => {
  const root = mkdtempSync(join(tmpdir(), "a11y-spotlight-"));
  try {
    const marked = join(root, "marked");
    const bare = join(root, "bare");
    mkdirSync(marked); mkdirSync(bare);
    writeFileSync(join(marked, ".metadata_never_index"), "");
    const plan = markerPlan([marked, bare]);
    assert.deepEqual(plan.needing, [bare]);
    assert.deepEqual(plan.already, [marked]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("markerPlan is IDEMPOTENT -- a second run marks nothing, so the report never overstates the work", () => {
  const root = mkdtempSync(join(tmpdir(), "a11y-spotlight-idem-"));
  try {
    const dir = join(root, "wt"); mkdirSync(dir);
    assert.deepEqual(markerPlan([dir]).needing, [dir]);
    writeFileSync(join(dir, ".metadata_never_index"), "");
    assert.deepEqual(markerPlan([dir]).needing, [], "already-marked worktrees are never re-reported");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the live tree: every path git reports is absolute, so a marker cannot land in the cwd by accident", () => {
  for (const path of worktreePaths()) {
    assert.ok(path.startsWith("/"), `${path} is not absolute -- a relative path here writes into the cwd`);
  }
});
