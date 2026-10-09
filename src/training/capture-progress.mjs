// @ts-check
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

/** @param {string} root */
export function progressPath(root) {
  return resolve(root, "capture-progress.json");
}



/** @param {string} root @returns {Record<string, any>|null} */
export function readProgress(root) {
  const path = progressPath(root);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Start recording a run. Returns the recorder the capture script drives; every method
 * persists immediately, because the value of this file is that it survives the process.
 */
/**
 * @param {{ root: string, worker?: string|null, baseUrl?: string|null, cases: { id: string }[],
 *           captureTimeoutMs?: number }} run
 */
export function beginRun({ root, worker, baseUrl, cases, captureTimeoutMs }) {
  const path = progressPath(root);
  const state = {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // `string | null`, because both are FILLED IN by `finish()`. Inferred from the initial literal they
    // are `null` and nothing else, so the one assignment that matters is the type error.
    /** @type {string | null} */
    finishedAt: null,
    /** @type {string | null} */
    outcome: null,
    worker,
    baseUrl,
    captureTimeoutMs,
    total: cases.length,
    /**
     * Same reason as `current` below, which already carries this annotation: an empty literal infers
     * `never[]` and every push then fails. Applied to both, since the argument was never specific to one.
     * @type {string[]}
     */
    workers: [],
    // A LIST, because with a worker pool there are several cases in flight at once. Readers
    // must tolerate the old single-object shape from runs recorded before pooling.
    /**
     * The cases in flight right now. Typed because an empty literal infers as `never[]`, and every push
     * into it then fails a check — the value is real and the annotation is what states it.
     * @type {{id: string, variant: string|null, worker: string|null, startedAt: string}[]}
     */
    current: [],
    /**
     * Per case: its status and whatever the outcome carried -- a `reason` for a skip or a failure, a
     * `phrases` count for a capture. Inferred from the initial literal it is `{ status: string }` alone,
     * so every one of those outcomes reads as an unknown property on a shape nothing declared.
     * @type {Record<string, { status: string, reason?: string, phrases?: number,
     *                         variant?: string|null, worker?: string|null, startedAt?: string }>}
     */
    cases: Object.fromEntries(cases.map((/** @type {{ id: string }} */ c) => [c.id, { status: "pending" }])),
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
    /** @param {string} id @param {string} reason */
    skipped(id, reason) {
      state.cases[id] = { status: "skipped", reason };
      save();
    },
    /** @param {string[]} workers */
    setWorkers(workers) {
      state.workers = workers;
      save();
    },
    /** @param {string} id @param {string} variant @param {string|null} [worker] */
    startCase(id, variant, worker = null) {
      const entry = { id, variant, worker, startedAt: new Date().toISOString() };
      state.current = [...current().filter((c) => c.id !== id), entry];
      state.cases[id] = { ...state.cases[id], status: "capturing" };
      save();
    },
    /** @param {string} id @param {number} phrases */
    captured(id, phrases) {
      state.cases[id] = { status: "captured", phrases };
      state.current = current().filter((c) => c.id !== id);
      save();
    },
    /** @param {string} id @param {string} reason */
    failed(id, reason) {
      state.cases[id] = { status: "failed", reason };
      state.current = current().filter((c) => c.id !== id);
      save();
    },
    /** @param {string} outcome */
    finish(outcome) {
      state.finishedAt = new Date().toISOString();
      state.outcome = outcome;
      state.current = [];
      save();
    },
  };
}

/** Counts by status, for both the run's own summary line and the status command. */
/**
 * @param {Record<string, any>|null} progress
 *
 * `?? {}` on a NULL progress, not just an absent `cases`. A run that has not started and a run whose
 * cases key is missing are the same answer here -- all zeroes -- and reading `.cases` off null would
 * throw instead of saying so.
 */
export function tally(progress) {
  /** @type {Record<string, number>} */
  const counts = { captured: 0, failed: 0, skipped: 0, pending: 0, capturing: 0 };
  for (const entry of Object.values(progress?.cases ?? {})) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }
  return counts;
}

/**
 * Is this run wedged? Only meaningful while unfinished. `null` means "cannot tell", which is
 * deliberately distinct from "healthy" -- claiming health from a missing timestamp is how a
 * monitor ends up reporting green on a dead process.
 *
 * ONE BLOCK. This was two adjacent ones and only the last attaches, so everything above was orphaned --
 * the paragraph explaining why `null` is distinct from "healthy" was invisible to every tool.
 *
 * @param {Record<string, any>|null} progress
 * @param {number} now
 */
export function stalenessMs(progress, now) {
  // NO PROGRESS AT ALL is the strongest form of "cannot tell", and this used to throw on it -- which the
  // paragraph above rules out by name: a missing timestamp must not become a claim about health, and a
  // crash is a worse version of the same mistake. `readProgress` returns null for a run that never
  // started, so this is reachable from every caller that does not guard first.
  if (!progress || progress.finishedAt || !progress.updatedAt) return null;
  return now - Date.parse(progress.updatedAt);
}

/** @param {Record<string, any>|null} progress @param {number} now */
export function isStale(progress, now) {
  const quiet = stalenessMs(progress, now);
  if (quiet === null) return false;
  // `?.` because a non-null `quiet` already implies a non-null progress -- true, and not something
  // the compiler can follow through another function. The optional read costs nothing and says it.
  return quiet > (progress?.captureTimeoutMs ?? 0) + STALE_SLACK_MS;
}

/**
 * `current` as a list, whatever shape the file uses. Pre-pool runs recorded a single object.
 *
 * One block: the third pair of adjacent JSDoc comments in this file, and only the last of a pair
 * attaches. Every prose explanation sitting above a bare `@param` block was invisible.
 *
 * @param {Record<string, any>|null} progress
 */
export function inFlight(progress) {
  const c = progress?.current;
  return Array.isArray(c) ? c : c ? [c] : [];
}
