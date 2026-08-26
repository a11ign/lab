/**
 * Is the corpus still being written — asked, not guessed from the clock.
 *
 * Three audits refused to measure a corpus whose newest capture file was under ten minutes old, on the
 * reasoning that a count taken mid-recapture describes a state that has already changed. The reasoning is
 * right and the test was a PROXY: file age stands in for "a run is in flight", and it is wrong in both
 * directions, which is this repo's oldest lesson about sleeping a duration instead of waiting for a
 * condition.
 *
 *   - TOO LONG. A capture that finished cleanly thirty seconds ago is settled, and the audit refuses for
 *     another nine and a half minutes. Measured 2026-08-26: the whole chain — capture, check-signals,
 *     export, build-realism, rules-gate — ran green in about five minutes, and `rules:coverage` then
 *     refused with "wait for the run" when there was no run to wait for.
 *   - TOO SHORT, which is the half that actually costs something. A run pausing longer than ten minutes —
 *     a worker retry, a slow page, an eviction and requeue — reads as settled while it is mid-write, and
 *     the audit measures exactly the moving target it exists to refuse.
 *
 * The run records the answer itself. `capture-progress.mjs` writes `finishedAt` on completion and
 * `updatedAt` on every case, and `capture-status.mjs` already treats those as authoritative. Reading them
 * is not "asking systemd whether a unit is up" — the objection `audit-rule-coverage.ts` correctly raised
 * against that — because the progress file sits WITH the evidence, describes the evidence, and survives a
 * run nobody remembers starting. It is the evidence's own account of whether it is finished.
 *
 * ## Three states, where there used to be two
 *
 * `settled` and `in-flight` were the only answers, so a run that DIED mid-write had to be one of them and
 * became "settled" once its files aged past ten minutes — a half-written corpus measured as a whole one.
 * `abandoned` is now its own answer, because the remedy differs: wait for one, and re-run or clear the
 * other.
 */
import { readProgress, isStale } from "./capture-progress.mjs";

/** Below this a corpus with NO self-report is treated as still being written. The fallback, not the rule. */
export const SETTLED_AFTER_MINUTES = 10;

/**
 * @param {{datasetRoots?: string[], evidenceDirs?: string[], now?: number,
 *          minutesSinceLastWrite?: (dirs: string[]) => number | null}} options
 * @returns {{state: "settled"|"in-flight"|"abandoned", why: string, blocking: boolean}}
 *   `blocking` is what a caller acts on; `why` is what it prints. An audit must never have to re-derive
 *   the sentence, which is how two callers come to describe the same state differently.
 */
export function corpusState({ datasetRoots = [], evidenceDirs = [], now = Date.now(), minutesSinceLastWrite }) {
  for (const root of datasetRoots) {
    const progress = readProgress(root);
    if (!progress) continue;
    if (progress.finishedAt) {
      return { state: "settled", blocking: false,
        why: `the last capture run finished at ${progress.finishedAt}` };
    }
    if (isStale(progress, now)) {
      // Unfinished AND quiet past its own capture timeout: nothing is coming. Say so rather than waiting
      // for a run that has stopped, and rather than measuring a corpus it may have left half written.
      return { state: "abandoned", blocking: true,
        why: `a capture run started ${progress.startedAt} never finished and has gone quiet since `
          + `${progress.updatedAt}. The corpus may be half written, so this refuses to measure it. `
          + `Re-run the capture, or clear the run with \`npm run lab:stop -- -e job=capture\`` };
    }
    return { state: "in-flight", blocking: true,
      why: `a capture run is in flight — started ${progress.startedAt}, last wrote ${progress.updatedAt}. `
        + "Every count would describe a state that has already changed" };
  }
  // NO self-report, so the clock is all there is. This is the honest use of the proxy: it is the fallback
  // for a corpus copied without its progress file, not the primary test.
  const idle = minutesSinceLastWrite?.(evidenceDirs) ?? null;
  if (idle !== null && idle < SETTLED_AFTER_MINUTES) {
    return { state: "in-flight", blocking: true,
      why: `a capture was written ${idle.toFixed(1)} minute(s) ago and this copy carries no progress file, `
        + "so whether a run is still going cannot be asked — only guessed from the clock" };
  }
  return { state: "settled", blocking: false,
    why: idle === null ? "no captures found to date-check" : `nothing written for ${idle.toFixed(0)} minute(s)` };
}
