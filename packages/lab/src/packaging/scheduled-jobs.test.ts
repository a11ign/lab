// "THE JOB THAT DOES NOT EXIST REPORTS NOTHING" -- every existing signal for a broken schedule is the
// job itself telling you something went wrong, and nothing has ever asked launchd directly whether a
// claimed job is actually there. This is the enforcement half of `scripts/check-scheduled-jobs.mjs`,
// against the pure logic in `scheduled-jobs.mjs` -- real launchd state is asked by the CLI, never here,
// because a unit test's pass/fail must not depend on which machine happened to run it.
//
// DISCOVERED from every `.plist` under `docs/board/`, never a hand-written list, for the same reason
// every other discovery test in this repo gives one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimedJobs, checkScheduledJobs, orphanJobs } from "./scheduled-jobs.mjs";

test("the real repo claims at least the two known jobs, discovered rather than hand-listed", () => {
  const jobs = claimedJobs(process.cwd());
  // A floor DERIVED from what actually exists today (2: board-report, board-summary-check), not a
  // number handed down -- the brief for this unit originally said "three", and grepping the real repo
  // found two. A hardcoded 3 would have failed forever against a count that was never true; deriving the
  // floor from the real discovery and setting it at the current count (rather than >=1, which could not
  // tell "the discovery broke" from "one job was quietly deleted") is the guard that actually matches
  // this repo's premise: something real is claimed here, and it is not nothing.
  assert.ok(jobs.length >= 2,
    `expected at least 2 claimed jobs under docs/board/*.plist, found ${jobs.length} -- either the `
    + "plist-discovery regex broke, or a claimed job was removed without this floor being lowered "
    + "deliberately");
  const labels = jobs.map((j) => j.label);
  assert.ok(labels.includes("com.a11y-witness.board-report"), "the 08:00 publish job must be discovered");
  assert.ok(labels.includes("com.a11y-witness.board-summary-check"),
    "the 21:00 summary-check job must be discovered");
});

test("a platform with no launchd reports every job as not-applicable, and nothing fails", () => {
  const report = checkScheduledJobs({
    repoRoot: process.cwd(),
    supportsLaunchd: false,
    isInstalled: () => { throw new Error("must never be called when launchd is unsupported"); },
    assertControlPlane: true, // even asserted, a platform with no launchd cannot be a defect
  });
  assert.ok(report.length >= 2);
  for (const job of report) assert.equal(job.status, "not-applicable");
});

test("macOS with a job missing and no assertion: reported, never failed", () => {
  const report = checkScheduledJobs({
    repoRoot: process.cwd(),
    supportsLaunchd: true,
    isInstalled: () => false,
    assertControlPlane: false,
  });
  for (const job of report) {
    assert.equal(job.status, "not-installed-here");
    assert.equal(job.installed, false);
    assert.ok(job.reason);
    assert.match(job.reason, /A11Y_ASSERT_CONTROL_PLANE is not set/);
  }
});

test("macOS with a job missing AND control-plane asserted: MISSING by name", () => {
  const report = checkScheduledJobs({
    repoRoot: process.cwd(),
    supportsLaunchd: true,
    isInstalled: (label: string) => label !== "com.a11y-witness.board-report", // one present, one missing
    assertControlPlane: true,
  });
  const missing = report.filter((j) => j.status === "MISSING");
  assert.deepEqual(missing.map((j) => j.label), ["com.a11y-witness.board-report"]);
  const installed = report.filter((j) => j.status === "installed");
  assert.ok(installed.some((j) => j.label === "com.a11y-witness.board-summary-check"));
});

test("orphanJobs never fires on a platform with no launchd, and reports an unclaimed label otherwise", () => {
  assert.deepEqual(
    orphanJobs({ repoRoot: process.cwd(), supportsLaunchd: false, listInstalled: () => { throw new Error("must not be called"); } }),
    []);

  const found = orphanJobs({
    repoRoot: process.cwd(),
    supportsLaunchd: true,
    listInstalled: () => ["com.a11y-witness.board-report", "com.a11y-witness.some-forgotten-job"],
  });
  assert.deepEqual(found, ["com.a11y-witness.some-forgotten-job"],
    "a claimed job must not be reported as an orphan, and an unclaimed one must be");
});

/**
 * MUTATION HALF, against a synthetic `docs/board/` tree under `os.tmpdir()` -- never the real one, for
 * the same reason every other mutation test in this session gives: a shared, git-hooked checkout should
 * not risk a real claimed job's plist even temporarily.
 */
test("MUTATION: zero claimed jobs is caught by the vacuity guard, and a malformed plist is skipped not crashed", () => {
  const dir = mkdtempSync(join(tmpdir(), "scheduled-jobs-mutation-"));
  mkdirSync(join(dir, "docs", "board"), { recursive: true });

  // Baseline: one well-formed plist is discovered.
  writeFileSync(join(dir, "docs", "board", "com.example.job.plist"),
    "<plist><dict><key>Label</key><string>com.example.job</string></dict></plist>\n");
  const baseline = claimedJobs(dir);
  assert.equal(baseline.length, 1, "the parser did not find the one well-formed plist -- broken baseline");
  assert.equal(baseline[0].label, "com.example.job");

  // Mutation 1: a malformed plist (no Label key at all) must be skipped, not crash the discovery.
  rmSync(join(dir, "docs", "board", "com.example.job.plist"));
  writeFileSync(join(dir, "docs", "board", "broken.plist"), "<plist><dict></dict></plist>\n");
  assert.deepEqual(claimedJobs(dir), [], "a plist with no Label key must be skipped, not throw");

  // Mutation 2: no docs/board directory at all -- the real "zero claimed jobs" case this guard exists for.
  rmSync(join(dir, "docs", "board"), { recursive: true, force: true });
  assert.deepEqual(claimedJobs(dir), [],
    "a missing docs/board directory must report zero claimed jobs, not throw");

  rmSync(dir, { recursive: true, force: true });
});
