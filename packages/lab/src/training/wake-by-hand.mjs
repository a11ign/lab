// @ts-check
/**
 * Wake exactly the worker(s) a BY-HAND entry names, before it dispatches a single capture.
 *
 * #2655 shipped `wakeFleet` (`@a11ign/control/fleet-wake`) and wired it everywhere a capture reaches a
 * worker THROUGH `lab:job` — its table's rows 6, 7 and 11 are the exceptions: `training:capture*`,
 * `capture-real-pages.mjs`, and `capture-fixtures`/`page-identity-rate`/`occurrence-verdict-stability`/
 * `training:repeat`/`bench-capture` when run directly, outside the job. This is the ONE call those seven
 * entries share, so there is no second implementation and no second packet rule.
 *
 * A small module of its own, not a member of the entry scripts: four of the seven import `dataset-paths.mjs`
 * (a `corpus` reader the token-less acceptance job cannot follow), so `wake-by-hand.test.ts` imports THIS
 * file, never an entry script, and stays out of that closure (`row-file`'s warning on #2682).
 *
 * Which workers to wake is PASSED IN by the caller — a URL from `--worker=`, or the list
 * `configuredWorkers()` already resolved — never read from an inventory or a corpus here. `wakeFleet`
 * itself decides `already-up`/`busy`/`woken`/`came-up` from a live probe, so a worker `lab:job` already woke
 * answers `already-up` on the first probe and is sent nothing: nothing here can wake a box twice.
 */
import { wakeFleet, wakeFailed, wakeReportLine } from "@a11ign/control/fleet-wake";

/**
 * @param {string} url
 * @returns {{ name: string, host: string }}
 */
function targetFor(url) {
  return { name: url.replace(/^https?:\/\//, ""), host: new URL(url).hostname };
}

/**
 * @typedef {{ ok: true } | { ok: false, refusal: string }} WakeVerdict
 */

/**
 * @param {string[]} urls the workers THIS entry names, in the caller's own words
 * @param {import("@a11ign/control/fleet-wake").WakeOptions} [wakeOptions] passed straight through to
 *   `wakeFleet` — a test supplies `request`/`send`/`sleep`/`now` here and reads no network and waits no time
 * @returns {Promise<WakeVerdict>}
 */
export async function wakeNamedWorkers(urls, wakeOptions = {}) {
  const results = await wakeFleet(urls.map(targetFor),
    { log: (line) => process.stdout.write(`${line}\n`), ...wakeOptions });
  const failed = results.filter(wakeFailed);
  if (!failed.length) return { ok: true };
  // #2655 done-when 3's own four words (`no-mac`, `no-answer`, `never-ready`, `not-listening`) come straight
  // off `wakeReportLine` — restating them here would be a second vocabulary that could drift from the first.
  return { ok: false, refusal: [
    `REFUSING: ${failed.length} of ${results.length} named worker(s) did not come up:`,
    ...failed.map(wakeReportLine),
  ].join("\n") };
}
