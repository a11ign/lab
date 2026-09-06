// @ts-check
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
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { readProgress, isStale } from "./capture-progress.mjs";

/** Below this a corpus with NO self-report is treated as still being written. The fallback, not the rule. */
export const SETTLED_AFTER_MINUTES = 10;

/**
 * How recently a capture file was written, in minutes, or null when nothing was found.
 *
 * ONE COPY, and it arrived here as two. `audit-rule-coverage.ts` and `check-real-page-findings.ts` each
 * carried their own, and they had already begun to drift — `(dirs: string[])` against `(dir: string)`,
 * with the second call site wrapping itself to fit the first's shape at the point it injected it. That is
 * the fact-stated-twice shape caught before the third copy rather than after, so both now inject THIS.
 *
 * The reasoning is `audit-rule-coverage.ts`'s and is preserved verbatim, because it is what makes this a
 * FALLBACK rather than the test: *"Deliberately a file-mtime check rather than asking systemd whether a
 * job is running: the question is whether this EVIDENCE is settled, not whether a particular unit happens
 * to be up, and a corpus can be mid-write from a run nobody remembers starting."* `corpusState` prefers
 * the run's own `finishedAt` and reaches for this only when the corpus carries no progress file at all.
 *
 * @param {string[]} dirs
 * @returns {number | null}
 */
export function minutesSinceLastWrite(dirs) {
  let newest = 0;
  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        newest = Math.max(newest, statSync(join(dir, entry)).mtimeMs);
      } catch {
        continue;
      }
    }
  }
  return newest ? (Date.now() - newest) / 60_000 : null;
}

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

/**
 * MAY A TEST READ THE CORPUS RIGHT NOW? — the question every corpus-reading check has to ask before it
 * measures anything, and until 2026-09-06 not one of them did.
 *
 * `corpusState` above is the decision and it had exactly two callers, both GATES. The tests that read the
 * same bytes had no idea a capture was rewriting them: `evidence-fields.test.ts` passed a full `npm test`
 * and failed 20 minutes later on byte-identical code, because protocol-16 captures were landing underneath
 * it. An hour before that the same shape was seen, recorded as "transient", and not looked into — which is
 * this repo's diagnostics-lied lesson arriving at the one place that had no guard to lie with.
 *
 * **A GREEN RESULT FROM A MOVING CORPUS IS EXACTLY AS UNTRUSTWORTHY AS A RED ONE**, and that is the half
 * nobody reaches for. A red one gets re-run and looks flaky; a green one is believed. Both describe a
 * state that no longer exists.
 *
 * It matters beyond the tests themselves because the pre-push hook runs `npm test`: during a capture, a
 * push fails for a reason unrelated to the change, and a guard people cannot trust is a guard they bypass.
 * `A11Y_SKIP_VERIFY=1` was reached for nine times in one evening by this project's own record. This
 * removes the last legitimate reason to reach for it.
 *
 * ## ABSENT IS NOT MOVING, and collapsing them would destroy a distinction that already exists
 *
 * Every corpus reader already skips when `runs/` is absent — it is gitignored, so CI genuinely cannot see
 * it, and those skips are deliberate and honest (`verify.corpus.test.ts`: *"the corpus is present, or this
 * test is honestly skipped"*). That is a permanent property of the environment. A corpus being WRITTEN is
 * a temporary property of this minute, and it means "ask again shortly" rather than "not here". They need
 * different words or the second silently inherits the first's shrug, so `absent` is its own state.
 *
 * @param {{datasetRoots?: string[], evidenceDirs?: string[], present?: boolean, now?: number,
 *          minutesSinceLastWrite?: (dirs: string[]) => number | null}} options
 *   `present` is the caller's own answer to "did I find any corpus to read", because only the caller knows
 *   what it was looking for — a manifest, a capture directory, a set of fields.
 * @returns {{read: boolean, state: "settled"|"absent"|"in-flight"|"abandoned", why: string}}
 *   `read` is what the caller acts on; `why` is what it must PRINT. A skip that does not say which of the
 *   three reasons it was is the silent skip this guard exists to replace — the remedy wearing the defect's
 *   clothes.
 */
export function corpusReadable({
  datasetRoots = [], evidenceDirs = [], present = true, now = Date.now(),
  minutesSinceLastWrite: idleOf = minutesSinceLastWrite,
} = {}) {
  // MOVING IS CHECKED FIRST, and the order is load-bearing. A capture writing its first files into an
  // empty corpus looks ABSENT to a caller that has not found anything yet, and reporting that as "no
  // corpus here" would be the moving case wearing the permanent one's clothes — the exact collapse the
  // paragraph above exists to prevent.
  const settle = corpusState({ datasetRoots, evidenceDirs, now, minutesSinceLastWrite: idleOf });
  if (settle.blocking) {
    return { read: false, state: /** @type {"in-flight"|"abandoned"} */ (settle.state), why: settle.why };
  }
  if (!present) {
    return { read: false, state: "absent",
      why: "no corpus on disk — `runs/` is gitignored, so this is expected in CI and on a fresh worktree" };
  }
  return { read: true, state: "settled", why: settle.why };
}

/**
 * The sentence a skipping check prints. One spelling, because two callers describing one state differently
 * is how a reader comes to believe they are two states — the reason `corpusState` returns `why` at all.
 *
 * @param {{state: string, why: string}} verdict
 * @returns {string}
 */
export function skipLine({ state, why }) {
  return `    skipped: ${state === "absent" ? "no corpus to read" : "a capture is writing runs/"} — ${why}`;
}
