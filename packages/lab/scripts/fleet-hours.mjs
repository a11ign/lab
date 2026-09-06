// @ts-check
/**
 * What did a capture run COST the fleet, in worker-hours — measured, not multiplied.
 *
 * The obvious figure is wall clock times worker count, and it is wrong in the direction that flatters:
 * it bills every worker for the whole run including the time it sat idle waiting for a slow peer, the
 * minutes a degraded box spent in its own retry, and the tail where nine workers have finished and one
 * has not. This repo's record is mostly numbers that were correct values read from the wrong place, so
 * the cost of a run is summed from what each capture ACTUALLY occupied a worker for.
 *
 * ## Where the per-capture cost lives, and where it does NOT
 *
 * It is NOT in `capture-progress.json`. The plan this was built to was "sum the per-case start and finish
 * times already in every run's progress file" — and that file's `cases` map carries `{status, phrases}`
 * and nothing else. Measured across three progress files including a 1,623-case one: **0 of 1,623 cases
 * carry any time field.** Only the `current` array carries `startedAt`, and those entries are transient —
 * an in-flight case is removed the moment it completes, so the timings a completed run needs are exactly
 * the ones that file has already discarded.
 *
 * That is the same file, and the same mistake, as the waiter this repo already records: polling
 * `capture-progress.json` for a `p.captured` field that does not exist, `?? 0`-ing the absence into a
 * number that could never grow. One command against the real artefact answers it, and a tool built on a
 * guessed shape reports a confident zero for as long as you let it.
 *
 * It IS in each capture's own diagnostics. Every mark carries a cumulative `atMs` (`bench-capture.mjs`
 * has read them for phase costs since long before this), so the LAST mark is what that capture occupied
 * its worker for, end to end. Verified on a real capture: 23 of 23 marks carry `atMs`, last 193694 ms.
 *
 * `atMs` is in `NOT_EVIDENCE_KEYS` — deliberately excluded from evidence comparison as a wall-clock field
 * that would report drift for a change in how a capture was driven rather than in what the page says.
 * That is exactly what makes it the right input here: it is a COST field, so it belongs in a cost report
 * and nowhere near an evidence diff.
 *
 * ## What this deliberately does not claim
 *
 * A capture's occupancy is not the box's power draw, and this does not model idle time, provisioning,
 * reboots, or a worker held open between captures. It answers one question — how many worker-hours of
 * capture did this corpus cost — and says so in its own output rather than letting a reader assume more.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { runsRoot } from "../src/dataset-paths.mjs";

refuseUnknownFlags(["--dir=", "--json"], {
  entry: import.meta.url, command: "npm run fleet:hours",
});

/**
 * A capture whose last diagnostic sits outside this is not billed, and is COUNTED as implausible.
 *
 * Both bounds are set from measurement rather than taste. The hard capture timeout is minutes — the worst
 * real page this project has driven abandoned at 280 s, and the slowest capture on disk is 194 s — so half
 * an hour is roughly ten times the worst honest answer and still finite. A run of 5,396 captures excluded
 * exactly ONE at these bounds, which is the shape you want: wide enough that a legitimately slow capture is
 * billed, tight enough that a clock artefact cannot silently add hours to a board figure.
 *
 * The lower bound matters more than it looks. A capture reporting 12 ms did not cost nothing; it failed to
 * record, and billing it as free is how an absent capture comes to read as a cheap one.
 */
const MIN_PLAUSIBLE_MS = 1_000;
const MAX_PLAUSIBLE_MS = 30 * 60 * 1_000;

/** @param {any} json @returns {any} the capture, whether the file wraps it or is it. */
function unwrap(json) {
  // Fetched artefacts nest the capture under `.capture`; dataset files are the capture. Reading only the
  // top level is how a sibling guard came to be blind to 29 files on this disk — the same shape as
  // `capture:explain` reading the wrapper and reporting 0 of 20 tab stops.
  if (json?.diagnostics) return json;
  if (json?.capture?.diagnostics) return json.capture;
  return null;
}

/** @param {any} capture @returns {number|null} ms this capture occupied a worker, or null if unreadable. */
export function occupancyMs(capture) {
  const marks = Array.isArray(capture?.diagnostics) ? capture.diagnostics : [];
  let last = null;
  for (const mark of marks) if (typeof mark?.atMs === "number") last = Math.max(last ?? 0, mark.atMs);
  return last;
}

/** @param {string} dir @returns {{files: number, captures: number, billed: number[], noAtMs: number, implausible: number}} */
export function scan(dir) {
  const out = { files: 0, captures: 0, billed: /** @type {number[]} */ ([]), noAtMs: 0, implausible: 0 };
  const walk = (/** @type {string} */ d) => {
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      const path = join(d, name);
      let stats;
      try { stats = statSync(path); } catch { continue; }
      if (stats.isDirectory()) { walk(path); continue; }
      if (!name.endsWith(".json")) continue;
      out.files += 1;
      let json;
      try { json = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
      const capture = unwrap(json);
      if (!capture) continue;
      out.captures += 1;
      const ms = occupancyMs(capture);
      if (ms === null) { out.noAtMs += 1; continue; }
      if (ms < MIN_PLAUSIBLE_MS || ms > MAX_PLAUSIBLE_MS) { out.implausible += 1; continue; }
      out.billed.push(ms);
    }
  };
  walk(dir);
  return out;
}

/** @param {number[]} values @param {number} q */
function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * How the total was computed, EMITTED rather than described anywhere a human retypes it.
 *
 * The board's `docs/board/reported.json` records a `method` string beside every fleet-hours total, and it
 * had to: a total whose method is unstated cannot be checked or compared with the next edition. But a
 * method string typed into that file is the same fact as this file's implementation, in a second place,
 * with nothing comparing them — and the first version of that string described summing per-case times from
 * `capture-progress.json`, a field that does not exist. It was written from inference and stood until
 * somebody measured.
 *
 * So the tool says how it computed, and a recorder copies that rather than paraphrasing it. Delete a copy
 * rather than pin two equal — this repo's own order of preference.
 */
export const METHOD =
  "sum of each capture's last cumulative diagnostics.atMs — never wall clock x worker count";

/** @param {ReturnType<typeof scan>} found */
export function report(found) {
  const totalMs = found.billed.reduce((a, b) => a + b, 0);
  return {
    method: METHOD,
    workerHours: Number((totalMs / 3_600_000).toFixed(2)),
    capturesBilled: found.billed.length,
    capturesFound: found.captures,
    jsonFilesWalked: found.files,
    unbillable: { noAtMs: found.noAtMs, implausibleDuration: found.implausible },
    medianSeconds: Number((quantile(found.billed, 0.5) / 1000).toFixed(1)),
    p95Seconds: Number((quantile(found.billed, 0.95) / 1000).toFixed(1)),
  };
}

function main() {
  const dirArg = process.argv.slice(2).find((a) => a.startsWith("--dir="));
  const dir = dirArg ? dirArg.slice("--dir=".length) : runsRoot();
  const asJson = process.argv.includes("--json");
  const found = scan(dir);
  const summary = { ...report(found), dir };

  // VACUITY, and it is the whole reason this exits non-zero rather than printing 0.00. A cost report that
  // examined nothing prints the same reassuring small number as a cheap run, and this repo has shipped
  // that exact shape before -- `postSubmitFields: []` on all 2,122 captures with every check green.
  if (summary.capturesBilled === 0) {
    const why = summary.jsonFilesWalked === 0
      ? `no JSON found under ${dir} — is runs/ populated, or is this a fresh worktree?`
      : `walked ${summary.jsonFilesWalked} JSON file(s) and billed none `
        + `(${summary.capturesFound} looked like captures; ${found.noAtMs} carried no atMs)`;
    if (asJson) console.log(JSON.stringify({ ...summary, ok: false, why }, null, 2));
    else console.error(`fleet:hours REFUSES to report a total it did not measure: ${why}`);
    process.exit(2);
  }

  if (asJson) { console.log(JSON.stringify({ ...summary, ok: true }, null, 2)); return; }
  console.log(`fleet hours under ${dir}`);
  console.log(`  ${summary.workerHours} worker-hour(s) of capture, summed per capture`);
  console.log(`  ${summary.capturesBilled} capture(s) billed of ${summary.capturesFound} found `
    + `(${summary.jsonFilesWalked} JSON file(s) walked)`);
  console.log(`  median ${summary.medianSeconds}s, p95 ${summary.p95Seconds}s`);
  if (found.noAtMs || found.implausible) {
    console.log(`  NOT billed: ${found.noAtMs} with no atMs, ${found.implausible} outside `
      + `${MIN_PLAUSIBLE_MS}-${MAX_PLAUSIBLE_MS}ms — named so an absent capture cannot read as a cheap one`);
  }
  console.log("  this is capture occupancy only: not idle time, provisioning, reboots or power");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
