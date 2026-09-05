// @ts-check
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
import { pathToFileURL } from "node:url";
import { inFlight, isStale, readProgress, stalenessMs, tally } from "./capture-progress.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * as `doctor`.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--json", "--since"], { entry: import.meta.url, command: "npm run training:status" });

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const HEALTH_TIMEOUT_MS = 5_000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

const EXIT = { ok: 0, failures: 1, noRun: 2, stale: 3 };
const JSON_OUT = process.argv.includes("--json");

/**
 * `--since=<instant>`: report the run on disk ONLY if it started at or after that instant.
 *
 * WHY THIS EXISTS, and it is the third instance of one defect in the block that consumes it. The
 * progress file is keyed on a CORPUS, never on a RUN, so it answers "what did this corpus last do"
 * where the caller asked "what is the job I named doing". `lab-status.yml` has been fixed for this
 * twice already — once for acceptance reading the training corpus's numbers, once for jobs that do not
 * capture at all reading the dataset's — and its own comment names the root cause: "the ASSUMPTION that
 * every job captures". The complement went unnoticed: a COMPOSITE job (`everything`, `retrain`) captures
 * for part of its life and then exports, trains and runs gates for the rest. Its progress file is
 * correct during the capture and describes a FINISHED run for every hour after it.
 *
 * That is not a cosmetic wrong number. It is the exact misread that destroyed 12 in-flight captures on
 * 2026-09-05: a progress file reading `running: false, 49 of 49` was the FINISHED run's, a second run
 * had started a minute earlier and not yet written its own, and a deploy went out underneath it.
 * CLAUDE.md records it as "ask the authoritative source, and let it tell you what it is BOUNDED to" —
 * so this is the `_SYSTEMD_INVOCATION_ID` remedy applied to the progress file instead of the journal:
 * bound the answer to the invocation the caller asked about, and refuse to answer outside it.
 *
 * A PREDATING FILE IS EXIT 2 (no run), deliberately, rather than a fifth exit code. "There is no
 * progress for the run you named" is what `noRun` already means, and the four codes are a contract
 * `training:wait` and `lab-status.yml` both consume — adding a fifth to express a shade of the same
 * answer would break every existing caller to say something none of them asks.
 */
function sinceFromArgv() {
  const flag = process.argv.find((a) => a.startsWith("--since="));
  if (flag === undefined) return null;
  const raw = flag.slice("--since=".length).trim();
  // systemd's own two spellings of "this unit has never been active". A job that never ran has no run to
  // bound, so these mean "no constraint" rather than "a value I could not read" -- and letting the caller
  // pass the field through unconditionally is what keeps the date handling out of Jinja, where this repo
  // has twice paid for escaping decided by reading rather than by running.
  if (raw === "" || raw === "n/a") return null;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    // REFUSED, never ignored. An unparseable instant that silently became "no constraint" would report a
    // stale run as live -- reintroducing, through the remedy, the exact fault the remedy exists to stop.
    // Note the live case this catches: systemd renders ActiveEnterTimestamp in the machine's local zone,
    // and Date.parse accepts "... UTC" but NOT "... BST", so a lab whose clock leaves UTC fails loudly
    // here instead of quietly answering about the wrong run.
    console.error("training:status: --since=" + JSON.stringify(raw) + " is not a readable instant.\n"
      + "  Pass an ISO 8601 instant (2026-09-05T18:10:51Z) or a systemd UTC timestamp\n"
      + "  (\"Sat 2026-09-05 18:10:51 UTC\"). An empty value or \"n/a\" means no constraint.");
    process.exitCode = EXIT.noRun;
    return { invalid: true };
  }
  return { at: parsed, raw };
}

const SINCE = sinceFromArgv();

/**
 * Did the run on disk begin before the instant the caller bounded us to?
 *
 * `startedAt` and not `updatedAt`: a finished run's file keeps getting no updates, so `updatedAt` would
 * read as old for a live run that has merely been quiet, and as recent for a stale one that crashed
 * mid-write. The question is which RUN this is, and only its start answers that.
 *
 * @param {Record<string, any>} progress
 */
function predatesRequestedRun(progress) {
  if (!SINCE || SINCE.invalid || !progress.startedAt) return false;
  const started = Date.parse(progress.startedAt);
  // An unreadable `startedAt` cannot be shown to belong to this run, and cannot be shown not to. Treat it
  // as NOT predating -- the numbers are then shown with their own timestamps beside them, which is the
  // weaker but honest answer, rather than suppressed on a comparison that did not happen.
  return !Number.isNaN(started) && started < SINCE.at;
}


/** @param {number} ms */
function minutes(ms) {
  return (ms / MS_PER_SECOND / SECONDS_PER_MINUTE).toFixed(1) + " min";
}

// Reported as unreachable rather than thrown: the worker being gone is a finding to print,
// not a reason for the status command itself to fail.
/** @param {string} worker */
async function workerState(worker) {
  if (!worker) return "not recorded";
  try {
    const response = await fetch(worker + "/health", { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return "HTTP " + response.status;
    const health = await response.json();
    return health.busy ? "capturing now" : "idle";
  } catch (error) {
    return "unreachable (" + /** @type {Error} */ (error).message + ")";
  }
}

/** @param {Record<string, any>} progress */
function printFailures(progress) {
  const failed = Object.entries(progress.cases ?? {}).filter(([, c]) => c.status === "failed");
  if (!failed.length) return;
  console.log("\nfailed cases:");
  for (const [id, entry] of failed) console.log("  " + id + ": " + entry.reason);
}

// Remaining time from observed throughput. Deliberately derived from THIS run rather than a
// stored average: capture cost varies with page size and with what else the host is doing.
/** @param {Record<string, any>} progress @param {Record<string, number>} counts @param {number} now */
function etaMinutes(progress, counts, now) {
  const done = counts.captured + counts.failed + counts.skipped;
  if (!done || progress.finishedAt || isStale(progress, now)) return null;
  const perCase = (now - Date.parse(progress.startedAt)) / done;
  return +(((progress.total - done) * perCase) / 60000).toFixed(1);
}

/** @param {Record<string, any>} progress @param {Record<string, number>} counts @param {number} now */
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

/** @param {Record<string, any>} progress @param {Record<string, number>} counts @param {number} now */
function outcomeExitQuiet(progress, counts, now) {
  if (progress.finishedAt) return counts.failed ? EXIT.failures : EXIT.ok;
  return isStale(progress, now) ? EXIT.stale : EXIT.ok;
}

/** @param {Record<string, any>} progress @param {Record<string, number>} counts @param {number} now */
function outcomeExit(progress, counts, now) {
  if (progress.finishedAt) return counts.failed ? EXIT.failures : EXIT.ok;
  if (isStale(progress, now)) {
    console.log("\nWEDGED: no update within one capture timeout plus slack. Check the worker, then");
    console.log("re-run with --resume --no-cache to pick up from the captures already on disk.");
    return EXIT.stale;
  }
  return EXIT.ok;
}

/**
 * No progress file at all.
 *
 * `--json` must ALWAYS emit JSON, including here. This branch printed two English lines whatever the
 * caller asked for, so `JSON.parse(stdout)` threw precisely when there was no run — the one case an
 * automated caller most needs to handle, and the reason this command was recorded as returning "nothing
 * parseable". The exit code was right the whole time; the payload was not.
 */
function reportNoRun() {
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
}

/**
 * Report that the file on disk belongs to an EARLIER run than the one asked about.
 *
 * "There is nothing here" and "there is something here and it is not yours" send a reader to different
 * places, so both instants are named. This file's own no-run branch already makes the same point by
 * saying WHERE it looked rather than only that it found nothing.
 *
 * @param {Record<string, any>} progress
 */
function reportPredatingRun(progress) {
  if (JSON_OUT) {
    console.log(JSON.stringify({
      running: false,
      stale: false,
      total: 0,
      captured: 0,
      failed: 0,
      skipped: 0,
      progress_file: ROOT + "/capture-progress.json",
      // The two instants that decided it, so a caller can tell a bounding mistake from a real absence
      // without re-reading the file itself.
      predates_requested_run: true,
      run_started_at: progress.startedAt ?? null,
      requested_since: SINCE?.raw ?? null,
      verdict: EXIT.noRun,
      next_command: "npm run lab:log -- -e job=<name>",
    }, null, 2));
    process.exitCode = EXIT.noRun;
    return;
  }
  console.log("No progress for the run you asked about.");
  console.log("  " + ROOT + "/capture-progress.json describes a run that started " + progress.startedAt);
  console.log("  which is BEFORE " + SINCE?.raw + ", the run you asked about.");
  console.log("A job that captures and then does other work leaves this file behind; it is the earlier");
  console.log("capture's, not this one's. Read the job's own output: npm run lab:log -- -e job=<name>");
  process.exitCode = EXIT.noRun;
}

async function main() {
  if (SINCE?.invalid) return;
  const progress = readProgress(ROOT);
  if (progress && predatesRequestedRun(progress)) return reportPredatingRun(progress);
  if (!progress) return reportNoRun();
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

// Only when RUN, never on import. `training:wait` and the lab status playbook both consume this script's
// exit code as a contract (0 clean, 1 finished with failures, 2 no run, 3 wedged), and importing it used to
// set `process.exitCode` on the IMPORTING process -- so a test or tool that merely loaded this file inherited
// a verdict about a capture run it had nothing to do with.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("training:status failed:", error.message);
    process.exitCode = 1;
  });
}
