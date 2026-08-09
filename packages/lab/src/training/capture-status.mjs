/**
 * Report the state of a dataset capture run: npm run training:status
 *
 * The supported way to ask "how is that hour-long capture going, and is it still alive".
 * Reads the progress file the run publishes (capture-progress.mjs) and, if a worker is
 * recorded, asks it directly whether it is still capturing.
 *
 * Exit codes are for scripts and CI, not decoration:
 *   0  finished cleanly, or in progress and healthy
 *   1  finished with failures
 *   2  no run recorded
 *   3  in progress but wedged (no update within one capture timeout plus slack)
 */
import { resolve } from "node:path";
import { inFlight, isStale, readProgress, stalenessMs, tally } from "./capture-progress.mjs";

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const HEALTH_TIMEOUT_MS = 5_000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

const EXIT = { ok: 0, failures: 1, noRun: 2, stale: 3 };
const JSON_OUT = process.argv.includes("--json");

function minutes(ms) {
  return (ms / MS_PER_SECOND / SECONDS_PER_MINUTE).toFixed(1) + " min";
}

// Reported as unreachable rather than thrown: the worker being gone is a finding to print,
// not a reason for the status command itself to fail.
async function workerState(worker) {
  if (!worker) return "not recorded";
  try {
    const response = await fetch(worker + "/health", { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return "HTTP " + response.status;
    const health = await response.json();
    return health.busy ? "capturing now" : "idle";
  } catch (error) {
    return "unreachable (" + error.message + ")";
  }
}

function printFailures(progress) {
  const failed = Object.entries(progress.cases ?? {}).filter(([, c]) => c.status === "failed");
  if (!failed.length) return;
  console.log("\nfailed cases:");
  for (const [id, entry] of failed) console.log("  " + id + ": " + entry.reason);
}

// Remaining time from observed throughput. Deliberately derived from THIS run rather than a
// stored average: capture cost varies with page size and with what else the host is doing.
function etaMinutes(progress, counts, now) {
  const done = counts.captured + counts.failed + counts.skipped;
  if (!done || progress.finishedAt || isStale(progress, now)) return null;
  const perCase = (now - Date.parse(progress.startedAt)) / done;
  return +(((progress.total - done) * perCase) / 60000).toFixed(1);
}

function printProgressLines(progress, counts, now) {
  const done = counts.captured + counts.failed + counts.skipped;
  console.log("run:      started " + progress.startedAt + (progress.finishedAt ? ", finished " + progress.finishedAt : ""));
  console.log("progress: " + done + "/" + progress.total + " cases  (" +
    counts.captured + " captured, " + counts.failed + " failed, " + counts.skipped + " skipped)");
  console.log("worker:   " + progress.worker);
  console.log("pages:    " + progress.baseUrl);
  for (const c of inFlight(progress)) {
    console.log("current:  " + c.id + " (" + c.variant + "), " +
      minutes(now - Date.parse(c.startedAt)) + " so far" + (c.worker ? " on " + c.worker : ""));
  }
  const quiet = stalenessMs(progress, now);
  if (quiet !== null) console.log("last update: " + minutes(quiet) + " ago");
  const eta = etaMinutes(progress, counts, now);
  if (eta !== null) console.log("eta:      ~" + eta + " min at the rate so far");
}

function outcomeExitQuiet(progress, counts, now) {
  if (progress.finishedAt) return counts.failed ? EXIT.failures : EXIT.ok;
  return isStale(progress, now) ? EXIT.stale : EXIT.ok;
}

function outcomeExit(progress, counts, now) {
  if (progress.finishedAt) return counts.failed ? EXIT.failures : EXIT.ok;
  if (isStale(progress, now)) {
    console.log("\nWEDGED: no update within one capture timeout plus slack. Check the worker, then");
    console.log("re-run with --resume --no-cache to pick up from the captures already on disk.");
    return EXIT.stale;
  }
  return EXIT.ok;
}

async function main() {
  const progress = readProgress(ROOT);
  if (!progress) {
    // `--json` must ALWAYS emit JSON, including here. This branch printed two English lines whatever the
    // caller asked for, so `JSON.parse(stdout)` threw precisely when there was no run — the one case an
    // automated caller most needs to handle, and the reason this command was recorded as returning
    // "nothing parseable". The exit code was right the whole time; the payload was not.
    if (JSON_OUT) {
      console.log(JSON.stringify({
        running: false,
        stale: false,
        total: 0,
        captured: 0,
        failed: 0,
        skipped: 0,
        // Null rather than absent: a consumer reading `progress_file` learns WHERE we looked, which is
        // the first thing anyone asks when told there is no run.
        progress_file: ROOT + "/capture-progress.json",
        verdict: EXIT.noRun,
        next_command: "npm run training:capture",
      }, null, 2));
      process.exitCode = EXIT.noRun;
      return;
    }
    console.log("No capture run recorded (" + ROOT + "/capture-progress.json is absent).");
    console.log("Start one with: npm run training:capture");
    process.exitCode = EXIT.noRun;
    return;
  }
  const now = Date.now();
  const counts = tally(progress);
  const stale = isStale(progress, now);
  if (JSON_OUT) {
    const verdict = outcomeExitQuiet(progress, counts, now);
    console.log(JSON.stringify({
      // An unfinished file is not necessarily a live process. Once the staleness contract says
      // the run is wedged, reporting `running: true` and an ETA makes automation wait forever or
      // restart the wrong thing. Keep `finished` implicit for compatibility and expose the real
      // state directly.
      running: !progress.finishedAt && !stale,
      stale,
      total: progress.total,
      captured: counts.captured,
      failed: counts.failed,
      skipped: counts.skipped,
      current: inFlight(progress),
      workers: progress.workers ?? [progress.worker],
      eta_minutes: etaMinutes(progress, counts, now),
      worker: progress.worker,
      last_update_ms_ago: stalenessMs(progress, now),
      outcome: progress.outcome ?? null,
      failures: Object.entries(progress.cases ?? {}).filter(([, c]) => c.status === "failed")
        .map(([id, c]) => ({ id, reason: c.reason })),
      verdict,
      next_command: verdict === EXIT.failures ? "npm run training:capture -- --resume --no-cache"
        : verdict === EXIT.stale ? "npm run doctor && npm run training:capture -- --resume --no-cache"
        : progress.finishedAt ? "npm run training:check-signals && npm run training:export"
        : "npm run training:wait",
    }, null, 2));
    process.exitCode = verdict;
    return;
  }
  printProgressLines(progress, counts, now);
  console.log("worker now: " + (await workerState(progress.worker)));
  printFailures(progress);
  if (progress.outcome) console.log("\noutcome:  " + progress.outcome);
  process.exitCode = outcomeExit(progress, counts, now);
}

main().catch((error) => {
  console.error("training:status failed:", error.message);
  process.exitCode = 1;
});
