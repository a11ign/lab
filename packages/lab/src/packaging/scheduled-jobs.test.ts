// "THE JOB THAT DOES NOT EXIST REPORTS NOTHING" -- every existing signal for a broken schedule is the
// job itself telling you something went wrong, and nothing has ever asked launchd directly whether a
// claimed job is actually there. This is the enforcement half of `scripts/check-scheduled-jobs.mjs`,
// against the pure logic in `scheduled-jobs.mjs` -- real launchd state is asked by the CLI, never here,
// because a unit test's pass/fail must not depend on which machine happened to run it.
//
// DISCOVERED from every `.plist` under `docs/board/`, never a hand-written list, for the same reason
// every other discovery test in this repo gives one.
//
// THE POPULATION IS NOW EMPTY BY DECISION, 2026-09-06, AND THAT IS NOT THE SAME AS THE DISCOVERY BREAKING.
// The chairman ruled that everything is pushed and the board report runs from GitHub Actions rather than
// from one Mac, so both plists were deleted and the launchd path retired -- see `docs/board/README.md`,
// which keeps the reason the local job existed. This file's machinery is kept intact and its floor is
// inverted: it now asserts the population is EMPTY and that the replacement is guarded elsewhere, so
// "the schedule moved" and "the discovery regex broke" remain different states.
//
// The question this file was built for did not go away with the plists -- "the job that does not exist
// reports nothing" is still true of a GitHub workflow -- and `board-schedule.test.ts` is where it is now
// asked: that the crons exist, that both halves of the London-hour pair are scheduled, and that every
// working step is gated. If launchd jobs ever return, restore the floor below and delete this note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claimedJobs, checkScheduledJobs, orphanJobs } from "./scheduled-jobs.mjs";

const CLI = resolve(process.cwd(), "scripts/check-scheduled-jobs.mjs");

/** A throwaway repo with two claimed jobs, for the tests that exercise the REPORTING logic.
 *
 * They used `process.cwd()` and so depended on this repository having plists -- which it did until the
 * schedule moved to GitHub Actions on 2026-09-06, at which point three of them began iterating over an
 * empty population and one asserted a floor that could no longer be met. This file's own header already
 * asks for exactly this: *"a unit test's pass/fail must not depend on which machine happened to run
 * it"*. A fixture is the same rule applied to the repository's own contents.
 */
function repoWithTwoJobs(): string {
  const dir = mkdtempSync(join(tmpdir(), "scheduled-jobs-fixture-"));
  mkdirSync(join(dir, "docs", "board"), { recursive: true });
  for (const label of ["com.a11y-witness.board-report", "com.a11y-witness.board-summary-check"]) {
    writeFileSync(join(dir, "docs", "board", `${label}.plist`),
      `<plist><dict><key>Label</key><string>${label}</string></dict></plist>\n`);
  }
  return dir;
}

test("no launchd job is claimed, because the schedule moved to GitHub Actions", () => {
  const jobs = claimedJobs(process.cwd());
  // A floor DERIVED from what actually exists today (2: board-report, board-summary-check), not a
  // number handed down -- the brief for this unit originally said "three", and grepping the real repo
  // found two. A hardcoded 3 would have failed forever against a count that was never true; deriving the
  // floor from the real discovery and setting it at the current count (rather than >=1, which could not
  // tell "the discovery broke" from "one job was quietly deleted") is the guard that actually matches
  // this repo's premise: something real is claimed here, and it is not nothing.
  assert.deepEqual(jobs.map((j) => j.label), [],
    `${jobs.length} launchd job(s) are claimed under docs/board/*.plist. The launchd path was RETIRED on `
    + "2026-09-06 when the schedule moved to GitHub Actions, so a claimed job here is either a plist that "
    + "should have gone with it, or launchd being reintroduced -- in which case restore the floor this "
    + "assertion replaced, and the note at the top of this file.");
});

test("a platform with no launchd reports every job as not-applicable, and nothing fails", () => {
  const report = checkScheduledJobs({
    repoRoot: repoWithTwoJobs(),
    supportsLaunchd: false,
    isInstalled: () => { throw new Error("must never be called when launchd is unsupported"); },
    assertControlPlane: true, // even asserted, a platform with no launchd cannot be a defect
  });
  assert.ok(report.length >= 2);
  for (const job of report) assert.equal(job.status, "not-applicable");
});

test("macOS with a job missing and no assertion: reported, never failed", () => {
  const report = checkScheduledJobs({
    repoRoot: repoWithTwoJobs(),
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
    repoRoot: repoWithTwoJobs(),
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
    orphanJobs({ repoRoot: repoWithTwoJobs(), supportsLaunchd: false, listInstalled: () => { throw new Error("must not be called"); } }),
    []);

  const found = orphanJobs({
    repoRoot: repoWithTwoJobs(),
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

/**
 * THE CLI ITSELF, run as a real process against a REAL zero-job checkout (this repository, since the
 * plists were retired 2026-09-06) -- not the pure module. The zero-population case in `checkScheduledJobs`
 * changed from a "not applicable" style report to the module's happy path when the launchd retirement
 * landed, but `scripts/check-scheduled-jobs.mjs` had its OWN separate zero-check (`REFUSING: found zero
 * claimed jobs ... the discovery itself is broken`, exit 2) that nobody updated -- the fix reaching one
 * call site and not the other, this repo's own most-recorded defect shape. Caught by running the actual
 * CLI, which no test here had done before.
 */
test("the CLI itself exits 0 on zero claimed jobs, rather than refusing", () => {
  const out = execFileSync("node", [CLI], { encoding: "utf8", cwd: process.cwd() });
  assert.match(out, /No jobs are claimed/,
    "the CLI must report the empty population as expected, not as a broken discovery");
});
