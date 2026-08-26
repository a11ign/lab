/**
 * Progress state for dataset capture.
 *
 * A full capture run is ~346 NVDA captures over several hours, unattended. Watching a log
 * scroll is not observability: you cannot tell finished from wedged, you cannot tell which
 * cases failed without re-reading everything, and nothing else can consume it. So the run
 * publishes its state to one JSON file after every step, and `npm run training:status`
 * reads it.
 *
 * Two properties matter more than the shape:
 *
 *   - Writes are atomic (temp file then rename). A reader polling this file must never see
 *     a half-written document, and a run killed mid-write must not leave one behind.
 *   - `updatedAt` advances at the START of each capture as well as the end, so staleness
 *     means something. A single capture may legitimately take minutes, so the file also
 *     carries `captureTimeoutMs`: anything past that plus slack is wedged, not working.
 */
import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic as writeAtomic } from "./write-atomic.mjs";
import { resolve } from "node:path";

/** Grace on top of one capture timeout before a quiet run counts as wedged. */
export const STALE_SLACK_MS = 60_000;

export function progressPath(root) {
  return resolve(root, "capture-progress.json");
}



export function readProgress(root) {
  const path = progressPath(root);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Start recording a run. Returns the recorder the capture script drives; every method
 * persists immediately, because the value of this file is that it survives the process.
 */
export function beginRun({ root, worker, baseUrl, cases, captureTimeoutMs }) {
  const path = progressPath(root);
  const state = {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    outcome: null,
    worker,
    baseUrl,
    captureTimeoutMs,
    total: cases.length,
    workers: [],
    // A LIST, because with a worker pool there are several cases in flight at once. Readers
    // must tolerate the old single-object shape from runs recorded before pooling.
    /**
     * The cases in flight right now. Typed because an empty literal infers as `never[]`, and every push
     * into it then fails a check — the value is real and the annotation is what states it.
     * @type {{id: string, variant: string|null, worker: string|null, startedAt: string}[]}
     */
    current: [],
    cases: Object.fromEntries(cases.map((c) => [c.id, { status: "pending" }])),
  };

  // Tolerates the pre-pool shape, where `current` was a single object or null.
  const current = () => (Array.isArray(state.current) ? state.current : state.current ? [state.current] : []);

  const save = () => {
    state.updatedAt = new Date().toISOString();
    writeAtomic(path, state);
  };
  save();

  return {
    path,
    skipped(id, reason) {
      state.cases[id] = { status: "skipped", reason };
      save();
    },
    setWorkers(workers) {
      state.workers = workers;
      save();
    },
    startCase(id, variant, worker = null) {
      const entry = { id, variant, worker, startedAt: new Date().toISOString() };
      state.current = [...current().filter((c) => c.id !== id), entry];
      state.cases[id] = { ...state.cases[id], status: "capturing" };
      save();
    },
    captured(id, phrases) {
      state.cases[id] = { status: "captured", phrases };
      state.current = current().filter((c) => c.id !== id);
      save();
    },
    failed(id, reason) {
      state.cases[id] = { status: "failed", reason };
      state.current = current().filter((c) => c.id !== id);
      save();
    },
    finish(outcome) {
      state.finishedAt = new Date().toISOString();
      state.outcome = outcome;
      state.current = [];
      save();
    },
  };
}

/** Counts by status, for both the run's own summary line and the status command. */
export function tally(progress) {
  const counts = { captured: 0, failed: 0, skipped: 0, pending: 0, capturing: 0 };
  for (const entry of Object.values(progress.cases ?? {})) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }
  return counts;
}

/**
 * Is this run wedged? Only meaningful while unfinished. `null` means "cannot tell", which is
 * deliberately distinct from "healthy" -- claiming health from a missing timestamp is how a
 * monitor ends up reporting green on a dead process.
 */
export function stalenessMs(progress, now) {
  if (progress.finishedAt || !progress.updatedAt) return null;
  return now - Date.parse(progress.updatedAt);
}

export function isStale(progress, now) {
  const quiet = stalenessMs(progress, now);
  if (quiet === null) return false;
  return quiet > (progress.captureTimeoutMs ?? 0) + STALE_SLACK_MS;
}

/** `current` as a list, whatever shape the file uses. Pre-pool runs recorded a single object. */
export function inFlight(progress) {
  const c = progress?.current;
  return Array.isArray(c) ? c : c ? [c] : [];
}
