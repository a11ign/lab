// @ts-check
// Report where a capture run stands, and say how to wait for it without waiting here.
//
//   npm run training:wait
//   npm run training:wait -- --json
//
// IT WAITS ON NOTHING (A11-263). A capture run is a job on the control plane's fleet job service, and a process in an agent's shell that holds a wait over fleet work is the
// failure that put A11-229 to sleep for 11 hours. So this prints the same status `training:status` does, and for a run that is still going it prints the line to DECLARE
// instead of a wait: `waitingOn: [{ fleetJob: <id> }]`, which the board polls and wakes the agent on. It watches no file and sets no timer.
//
// Exit codes match capture-status.mjs, so a caller can branch on them:
//   0  finished with no failures, or still running (nothing to act on yet)
//   1  finished with failures        -> submit the failed cases again
//   2  no run recorded               -> nothing to wait for
//   3  wedged: a run from before the service, whose file stopped being updated
import { pathToFileURL } from "node:url";
import { isStale, readProgress, tally } from "./capture-progress.mjs";
import { refuseUnknownFlags } from "@a11ign/screenreader-fleet/cli-flags";
import { datasetRoot } from "../dataset-paths.ts";

/**
 * its EXIT CODE is the contract — 0 clean, 1 failures, 2 no run, 3 wedged — so a caller reading it has
 * already decided what the output shape is.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--json"], { entry: import.meta.url, command: "npm run training:wait" });

const ROOT = datasetRoot();
const JSON_OUT = process.argv.includes("--json");

const EXIT = { ok: 0, failures: 1, noRun: 2, stale: 3 };

/**
 * The progress fields THIS command reads — not the whole record.
 *
 * Declared here rather than imported because `capture-progress.mjs` is not yet typechecked, and stating
 * what a consumer needs is the more useful half anyway: these fields are the contract between a
 * running capture and whoever follows it, and the exit codes below are derived from nothing else.
 *
 * @typedef {{finishedAt?: unknown, outcome?: unknown, startedAt?: unknown, total?: unknown, cases?: unknown, updatedAt?: unknown,
 *            fleetJobs?: { id: string, kind: string, submittedAt: string }[]}} Progress
 */

/** @param {Progress} progress */
function summarise(progress) {
  const counts = tally(progress);
  return {
    finished: !!progress.finishedAt,
    outcome: progress.outcome ?? null,
    total: progress.total,
    captured: counts.captured,
    failed: counts.failed,
    skipped: counts.skipped,
    failures: Object.entries(progress.cases ?? {})
      .filter(([, c]) => c.status === "failed")
      .map(([id, c]) => ({ id, reason: c.reason })),
    fleet_jobs: progress.fleetJobs ?? [],
    startedAt: progress.startedAt,
    finishedAt: progress.finishedAt ?? null,
  };
}

/**
 * The line to declare so the board wakes the agent when the jobs finish, for a run the service still holds. `until` is the board's own bound (3 hours when it is left
 * out); `fleet job status <id> --json` gives an `estimatedFinish` once a first capture has ended.
 *
 * @param {{ id: string }[]} jobs
 */
function declaration(jobs) {
  return `waitingOn: [${jobs.map(({ id }) => `{ "fleetJob": "${id}" }`).join(", ")}]`;
}

// The point of the whole exercise: say what to do next, so the caller does not have to
// work it out from counts.
/** @param {Partial<ReturnType<typeof summarise>>} summary @param {number} verdict @returns {string} */
function nextCommand(summary, verdict) {
  const jobs = summary.fleet_jobs ?? [];
  if (verdict === EXIT.failures) return jobs.length ? "npm run training:capture -- --only=<the failed cases above> --no-cache --label=<ticket key>" : "npm run training:capture -- --resume --no-cache";
  if (verdict === EXIT.stale) return "npm run doctor && npm run training:capture -- --resume --no-cache";
  if (verdict === EXIT.noRun) return "npm run training:capture";
  if (jobs.length && !summary.finished) return `fleet job status ${jobs[jobs.length - 1]?.id}`;
  return "npm run training:check-signals && npm run training:export";
}

/**
 * PARTIAL, deliberately. The no-run path has no run to summarise and calls this with `{ failures: [] }`
 * alone — so requiring a whole summary here would be a type that the code's own main path violates.
 *
 * @param {Partial<ReturnType<typeof summarise>>} summary
 * @param {number} verdict
 */
function report(summary, verdict) {
  const next = nextCommand(summary, verdict);
  const jobs = summary.fleet_jobs ?? [];
  const stillGoing = !summary.finished && verdict === EXIT.ok && jobs.length > 0;
  if (JSON_OUT) {
    console.log(JSON.stringify({ ...summary, verdict, next_command: next, ...(stillGoing ? { declare: declaration(jobs) } : {}) }, null, 2));
    return;
  }
  if (verdict === EXIT.noRun) console.log("No capture run recorded — nothing to wait for.");
  else if (verdict === EXIT.stale) console.log(`WEDGED: no progress update in too long (${summary.captured}/${summary.total} captured).`);
  else if (stillGoing) console.log(`Run in progress on the fleet job service (${summary.captured}/${summary.total} captured so far). Not waiting here.`);
  else console.log(`Run finished: ${summary.outcome ?? `${summary.captured}/${summary.total}`}`);
  for (const f of summary.failures ?? []) console.log(`  failed: ${f.id}: ${f.reason}`);
  if (stillGoing) console.log(`declare: ${declaration(jobs)}   (then end the turn; the board wakes you when the job ends)`);
  console.log(`next: ${next}`);
}

/**
 * The verdict for this progress state. A run still going is 0: there is nothing to act on yet, and the declared wait is how the caller is woken.
 *
 * @param {Progress} progress
 * @returns {number}
 */
function verdictFor(progress) {
  if (progress.finishedAt) return tally(progress).failed ? EXIT.failures : EXIT.ok;
  if (isStale(progress, Date.now())) return EXIT.stale;
  return EXIT.ok;
}

// Only when RUN, never on import. This script's exit code IS its contract -- 0 clean, 1 finished with
// failures, 2 no run, 3 wedged -- and unguarded, importing it set the exit code of the IMPORTING process.
// So `node -e "import('./wait-for-capture.mjs')"`, which CLAUDE.md makes the only real check that this file still loads, ended with a verdict about a capture run it had nothing to do with.
function main() {
  const progress = readProgress(ROOT);
  if (!progress?.startedAt) {
    report({ failures: [] }, EXIT.noRun);
    process.exitCode = EXIT.noRun;
    return;
  }
  const verdict = verdictFor(progress);
  report(summarise(progress), verdict);
  process.exitCode = verdict;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
