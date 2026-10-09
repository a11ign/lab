// @ts-check
/**
 * The per-run record of a capture run: how many boxes were ready, which took part, and why each other sat out (#4459).
 *
 * Until this existed a run left no trace of its own fleet. The ready count was never written, the participants
 * survived only as one stdout line (`Across N worker(s)`) in one local log, and an exclusion after
 * `EXIT_FLEET_INCONSISTENT` was a hand edit of the worker list that wrote nothing, so a baseline of "how many
 * boxes does a run really get" (#4444, #4405 part (d)) had nothing to be read from.
 *
 * ITS OWN FILE, for the reason `capture-fleet-guard.mjs` is: nothing here reads the corpus, so the acceptance job
 * (which has no `runs/`) can import it. The path is PASSED IN rather than resolved from `dataset-paths.mjs`,
 * whose closure reaches the corpus.
 *
 * NO ESTIMATES. A figure the run did not read is `null`, never a guess and never `0`: absence is not a count.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Beside the captures, under `runs/`; one JSON object per line, appended and never rewritten. */
export const CAPTURE_RUNS_FILE = "capture-runs.jsonl";

/**
 * Why a named box did not take part, and the three are different findings:
 * - `inconsistent`: it answered, and the fleet it was in disagreed (or went unasked), so the run exited 3.
 * - `asleep`: the wake step could not bring it up, so it was never going to answer.
 * - `down`: it did not answer the guard's own `/health` probe.
 */
export const EXCLUSION_REASONS = Object.freeze(["inconsistent", "asleep", "down"]);

/** @typedef {"inconsistent" | "asleep" | "down"} ExclusionReason */
/** @typedef {{ worker: string, reason: ExclusionReason }} Exclusion */
/** @typedef {{ startedAt: string, readyCount: number | null, participants: string[], excluded: Exclusion[] }} CaptureRunRecord */

/** @param {string} runsRoot */
export function captureRunsFile(runsRoot) {
  return join(runsRoot, CAPTURE_RUNS_FILE);
}

/**
 * @param {{ startedAt: string, readyCount: number | null, participants: string[], excluded: Exclusion[] }} run
 * @returns {CaptureRunRecord}
 */
export function buildRunRecord({ startedAt, readyCount, participants, excluded }) {
  const unknown = excluded.filter(({ reason }) => !EXCLUSION_REASONS.includes(reason));
  if (unknown.length) {
    throw new Error(`capture run record: ${unknown.map(({ worker, reason }) => `${worker} (${reason})`).join(", ")} `
      + `is not one of ${EXCLUSION_REASONS.join("/")}`);
  }
  return { startedAt, readyCount, participants: [...participants], excluded: excluded.map(({ worker, reason }) => ({ worker, reason })) };
}

/**
 * Why each named worker that is not in `participants` is not, for the ones that never reached the guard.
 *
 * Told apart by what ONE `/health` probe says, with `fleet-wake`'s own words: a box that returned NOTHING
 * (`no-answer`: off, asleep, or the path dropped it) is `asleep`; one that answered, or refused the connection,
 * is up and not usable, which is `down`. The probe is PASSED IN (`fleet-wake`'s `probeWorker`), so this file
 * keeps no dependency on `@a11ign/control` and stays importable by the acceptance job.
 *
 * @param {{ named: string[], participants: string[], probe: (url: string) => Promise<{ outcome: string }> }} fleet
 * @returns {Promise<Exclusion[]>}
 */
export async function absentFrom({ named, participants, probe }) {
  const absent = named.filter((worker) => !participants.includes(worker));
  return Promise.all(absent.map(async (worker) => ({
    worker,
    reason: /** @type {ExclusionReason} */ ((await probe(worker)).outcome === "no-answer" ? "asleep" : "down"),
  })));
}

/** @param {string} dir */
function makeDirectory(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Append one line. `append` and `makeDir` are options so a test records without touching a disk it does not own.
 *
 * @param {CaptureRunRecord} record
 * @param {string} file
 * @param {{ append?: (file: string, text: string) => void, makeDir?: (dir: string) => void }} [io]
 */
export function appendRunRecord(record, file, { append = appendFileSync, makeDir = makeDirectory } = {}) {
  makeDir(dirname(file));
  append(file, `${JSON.stringify(record)}\n`);
}

/**
 * The record of a run that never passes the fleet guard (#4462): `capture-screenreader-dataset.mjs`, which the ruling
 * leaves OUTSIDE the guard because wiring it in would change what that capture refuses.
 *
 * The guard is what reads a ready count, so a run without it read none and `readyCount` is `null`, never a count
 * borrowed from somewhere else. `named` is the fleet the run was asked to use and `participants` the boxes it did use;
 * the difference is probed, exactly as for a guarded run. A record that cannot be written is SAID and never changes
 * the run's exit: the capture is worth more than its trace.
 *
 * @param {{ file: string, startedAt: string, named: string[], participants: string[] }} run
 * @param {{ probe: (url: string) => Promise<{ outcome: string }>, report?: (message: string) => void,
 *   append?: (file: string, text: string) => void, makeDir?: (dir: string) => void }} io
 */
export async function recordUnguardedRun({ file, startedAt, named, participants }, { probe, report = writeStderr, ...io }) {
  try {
    const excluded = await absentFrom({ named, participants, probe });
    appendRunRecord(buildRunRecord({ startedAt, readyCount: null, participants, excluded }), file, io);
  } catch (error) {
    report(`CAPTURE RUN RECORD NOT WRITTEN to ${file}: ${/** @type {Error} */ (error).message}\n`);
  }
}

/** @param {string} message */
function writeStderr(message) {
  process.stderr.write(message);
}
