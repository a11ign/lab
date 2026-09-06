// Every job this repo schedules is claimed in exactly one place: a `.plist` under `docs/board/`, read by
// `scripts/install-board-report.sh` at install time. Nothing outside that install script ever asked
// whether a claimed job is ACTUALLY installed -- so a job that was never installed, or was silently
// removed, produces no output, no log entry and no alarm. "The job ran and found nothing" and "there is
// no job" are the same silence, at the scheduling layer.
//
// This module is the pure half: given how to ask (`isInstalled`) and what to ask on
// (`supportsLaunchd`), it classifies each claimed job without ever shelling out itself, so it can be
// tested with injected answers rather than against this machine's real, unpredictable state.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { platform } from "node:os";

const PLIST_DIR = "docs/board";

/**
 * DISCOVERS claimed jobs from every `.plist` under `docs/board/`, never a hand-written list -- the same
 * shape as every other discovery test in this repo, for the reason CLAUDE.md gives all of them: a
 * hand-maintained "the jobs that matter" list is exactly the kind of list a fourth job slips past.
 */
export function claimedJobs(repoRoot) {
  const dir = join(repoRoot, PLIST_DIR);
  if (!existsSync(dir)) return [];
  const jobs = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".plist")) continue;
    const source = readFileSync(join(dir, file), "utf8");
    const m = source.match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/);
    if (m) jobs.push({ label: m[1], plist: `${PLIST_DIR}/${file}` });
  }
  return jobs.sort((a, b) => a.label.localeCompare(b.label));
}

/** Real answer for `isInstalled`: asks launchd, not a cached belief about what was installed once. */
export function launchctlInstalled(label) {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  try {
    execFileSync("launchctl", ["print", `gui/${uid}/${label}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Real answer for `supportsLaunchd`: this platform, not an assumption about where tests run. */
export function platformSupportsLaunchd() {
  return platform() === "darwin";
}

/** Real answer for `listInstalled`: every `com.a11y-witness.*` label launchd currently knows about. */
export function launchctlListA11yWitnessJobs() {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  let out;
  try {
    out = execFileSync("launchctl", ["print", `gui/${uid}`], { stdio: "pipe", encoding: "utf8" });
  } catch {
    return [];
  }
  return [...out.matchAll(/com\.a11y-witness\.[a-z-]+/g)].map((m) => m[0])
    .filter((label, i, all) => all.indexOf(label) === i)
    .sort();
}

/**
 * THE OTHER DIRECTION: a job launchd knows about that no `.plist` under `docs/board/` claims. Lower
 * stakes than a claimed-and-missing job -- an orphan does not silently fail to report anything, it is
 * already running and visible to `launchctl list` -- so this always REPORTS rather than fails; the
 * point is that it is discovered at all, since nothing else looks.
 */
export function orphanJobs({ repoRoot, supportsLaunchd, listInstalled }) {
  if (!supportsLaunchd) return [];
  const claimed = new Set(claimedJobs(repoRoot).map((j) => j.label));
  return listInstalled().filter((label) => !claimed.has(label));
}

/**
 * Classifies every claimed job's real state, and is the judgement call this check exists to make: a job
 * asserting "not installed" can mean two different things, and they need opposite responses.
 *
 *   - This platform cannot run launchd at all (CI, Linux, a fresh clone anywhere but macOS) -- structural,
 *     never a defect, reported as `not-applicable`.
 *   - This is macOS and the job is missing, but nothing has said THIS machine is meant to be running
 *     it -- reported as `not-installed-here`, never failed. Most Macs that clone this repo are not the
 *     control plane, and a check that fails there is the exact "red gate everyone learns to ignore" shape
 *     this repo has been burned by before (docs/roles/roles-readme.test.ts's missing-role-file split is
 *     the precedent this follows).
 *   - This is macOS, the caller has explicitly asserted control-plane status (`assertControlPlane: true`,
 *     driven by `A11Y_ASSERT_CONTROL_PLANE=1` at the CLI), and the job is STILL missing -- that is a real
 *     defect on the one machine the claim is actually about, reported as `MISSING` and meant to fail.
 */
export function checkScheduledJobs({ repoRoot, supportsLaunchd, isInstalled, assertControlPlane }) {
  return claimedJobs(repoRoot).map((job) => {
    if (!supportsLaunchd) {
      return { ...job, installed: null, status: "not-applicable", reason: "this platform has no launchd" };
    }
    if (isInstalled(job.label)) {
      return { ...job, installed: true, status: "installed", reason: null };
    }
    if (!assertControlPlane) {
      return { ...job, installed: false, status: "not-installed-here",
        reason: "A11Y_ASSERT_CONTROL_PLANE is not set -- absence here is not asserted to be a defect" };
    }
    return { ...job, installed: false, status: "MISSING",
      reason: "A11Y_ASSERT_CONTROL_PLANE=1 and this job is claimed to run here, but launchd does not know it" };
  });
}
