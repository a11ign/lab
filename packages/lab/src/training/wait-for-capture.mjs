// Block until a capture run finishes, then exit with its outcome.
//
//   npm run training:wait
//   npm run training:wait -- --json
//
// For anything driving this repo without a human watching. A full run is hours, and the
// alternative is polling `training:status` in a loop and guessing an interval: too short
// wastes calls, too long delays the next step, and neither can tell a finished run from a
// wedged one.
//
// Event-driven, not polled: it watches the run's progress file and wakes on change.
//
// Exit codes match capture-status.mjs, so a caller can branch on them:
//   0  finished, no failures
//   1  finished with failures        -> re-run with --resume --no-cache
//   2  no run recorded               -> nothing to wait for
//   3  wedged, gave up waiting       -> the worker stopped updating
import { watch } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { isStale, readProgress, tally } from "./capture-progress.mjs";

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const JSON_OUT = process.argv.includes("--json");

// A backstop, not the mechanism. fs.watch is the thing that wakes us; this only guards
// against a missed event, which is possible across platforms and filesystems. Long on
// purpose — waking every 30s to re-read one small file is not polling in the sense that
// matters, and it means a lost event costs 30s rather than the whole run.
const BACKSTOP_MS = 30_000;

const EXIT = { ok: 0, failures: 1, noRun: 2, stale: 3 };

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
    startedAt: progress.startedAt,
    finishedAt: progress.finishedAt ?? null,
  };
}

// The point of the whole exercise: say what to do next, so the caller does not have to
// work it out from counts.
function nextCommand(summary, verdict) {
  if (verdict === EXIT.failures) return "npm run training:capture -- --resume --no-cache";
  if (verdict === EXIT.stale) return "npm run doctor && npm run training:capture -- --resume --no-cache";
  if (verdict === EXIT.noRun) return "npm run training:capture";
  return "npm run training:check-signals && npm run training:export";
}

function report(summary, verdict) {
  const next = nextCommand(summary, verdict);
  if (JSON_OUT) {
    console.log(JSON.stringify({ ...summary, verdict, next_command: next }, null, 2));
    return;
  }
  if (verdict === EXIT.noRun) console.log("No capture run recorded — nothing to wait for.");
  else if (verdict === EXIT.stale) console.log(`WEDGED: no progress update in too long (${summary.captured}/${summary.total} captured).`);
  else console.log(`Run finished: ${summary.outcome ?? `${summary.captured}/${summary.total}`}`);
  for (const f of summary.failures) console.log(`  failed: ${f.id}: ${f.reason}`);
  console.log(`next: ${next}`);
}

/** Terminal verdict for this progress state, or null to keep waiting. */
function verdictFor(progress) {
  if (progress.finishedAt) return tally(progress).failed ? EXIT.failures : EXIT.ok;
  if (isStale(progress, Date.now())) return EXIT.stale;
  return null;
}

function finish(progress, verdict) {
  report(summarise(progress), verdict);
  process.exit(verdict);
}

// Only when RUN, never on import. This script's exit code IS its contract -- 0 clean, 1 finished with
// failures, 2 no run, 3 wedged -- and unguarded, importing it called `process.exit(EXIT.noRun)` on the
// IMPORTING process. So `node -e "import('./wait-for-capture.mjs')"`, which CLAUDE.md makes the only real
// check that this file still loads, terminated with a verdict about a capture run it had nothing to do with.
function main() {
  const initial = readProgress(ROOT);
  if (!initial?.startedAt) {
    report({ failures: [] }, EXIT.noRun);
    process.exit(EXIT.noRun);
  }
  const startingVerdict = verdictFor(initial);
  if (startingVerdict !== null) finish(initial, startingVerdict);

  if (!JSON_OUT) {
    const done = tally(initial);
    console.log(`Waiting for the run that started ${initial.startedAt} (${done.captured}/${initial.total} so far) ...`);
  }

  // Watch the DIRECTORY, not the file. The progress file is written atomically — temp file
  // then rename — and a rename replaces the inode, so a watcher bound to the original file
  // stops receiving events after the first write and this would hang forever.
  watch(ROOT, (_event, filename) => {
    if (filename && filename.startsWith("capture-progress.json")) check();
  });
  setInterval(check, BACKSTOP_MS).unref();
}

function check() {
  const progress = readProgress(ROOT);
  if (!progress) return;
  const verdict = verdictFor(progress);
  if (verdict !== null) finish(progress, verdict);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
