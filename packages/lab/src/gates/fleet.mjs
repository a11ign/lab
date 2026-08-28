// @ts-check
/**
 * EVERY CHECK RUNS ON EVERY WORKER, because a verdict from one box is a claim about one box.
 *
 * The capture RUNS have dispatched across the pool since there was a pool. The GATES never did: they take
 * one `--worker`, and `gate:stability` reported "8 of 8 canaries examined and clean" while describing a
 * single machine of five. That is the D6 defect — scope not travelling with a verdict — surviving inside
 * the gate that was migrated to prevent it, and it took somebody asking "are you running this on the fleet
 * or just one machine?" to find.
 *
 * THE UNIT IS THE BOX, AND THAT IS NOT NEGOTIABLE. Spreading one page's repeats across workers would
 * conflate run-to-run instability with box-to-box difference, and those need opposite remedies — one is
 * flakiness, the other is a fleet that is not interchangeable, which `fleet-consistency` answers
 * separately. So the whole gate runs on each box, and the boxes are the population of the fleet verdict.
 *
 * PARALLEL, because the boxes are independent machines and serialising them buys nothing. Measured on
 * `fleet:provision`: 10 m 07 s across five boxes against 26 minutes serial. The same argument applies here
 * with more force, since a gate on one box leaves four idle for its whole duration.
 */
import { inventoryWorkerUrls } from "../../../worker-fleet/src/fleet-env.mjs";

import { gateVerdict } from "./verdict.mjs";

/**
 * The boxes a gate should run on: the one named, or every worker in `inventory.yml`.
 *
 * Naming a worker is the ESCAPE HATCH, never the default — the same convention capture runs already use,
 * where setting nothing dispatches across everything and naming a worker means you are managing it. A
 * default of "one box" is how a fleet-wide claim came to be made from a single machine.
 *
 * @param {string | undefined} named a `--worker` / `A11Y_WORKER` value, if the caller gave one
 * @returns {{ workers: string[], scope: string }} `scope` is what the verdict must SAY it covered
 */
export function gateWorkers(named) {
  if (named) return { workers: [named], scope: `${named} ONLY — one box, named explicitly` };
  const workers = inventoryWorkerUrls();
  if (workers.length === 0) {
    throw new Error("no workers in inventory.yml, and none named — a gate cannot examine nothing");
  }
  return { workers, scope: `${workers.length} worker(s) from inventory.yml` };
}

/**
 * Run one gate against every box at once, and never let one box's crash hide the others' answers.
 *
 * A thrown error becomes that box's verdict rather than the run's, because "four boxes are clean and the
 * fifth is unreachable" is the report you want — and `Promise.all` would have discarded it along with the
 * four results that were already in hand.
 *
 * @template T
 * @param {string[]} workers
 * @param {(worker: string) => Promise<T>} runOne
 * @returns {Promise<{ worker: string, result: T | null, error: string | null }[]>}
 */
export async function acrossFleet(workers, runOne) {
  return Promise.all(workers.map(async (worker) => {
    try {
      return { worker, result: await runOne(worker), error: null };
    } catch (error) {
      return { worker, result: null, error: error instanceof Error ? error.message : String(error) };
    }
  }));
}

/**
 * The fleet's verdict over the boxes' verdicts.
 *
 * A box that could not answer reduces COVERAGE; a box that answered FAIL is a failure. That is the same
 * split `gateVerdict` makes one level down, applied one level up — an unreachable worker and a worker
 * reporting instability need opposite responses, and collapsing them is how "we could not measure" becomes
 * "fine".
 *
 * @param {{ worker: string, result: { verdict: string } | null, error: string | null }[]} outcomes
 * @param {string} what names the check, so the verdict says what ran as well as where
 */
export function fleetVerdict(outcomes, what) {
  const answered = outcomes.filter((o) => o.result && o.result.verdict !== "INCONCLUSIVE");
  const failed = answered.filter((o) => o.result?.verdict === "FAIL");
  return gateVerdict({
    examined: answered.length,
    of: outcomes.length,
    source: `${what} on every worker in inventory.yml`,
    failures: failed.length,
  });
}

/** One line per box, so a fleet result is readable without opening five logs. */
export function renderPerWorker(/** @type {{worker: string, result: {verdict: string, why: string}|null, error: string|null}[]} */ outcomes) {
  return outcomes.map((o) => `  ${o.worker.padEnd(28)} `
    + (o.error ? `ERROR — ${o.error}` : `${o.result?.verdict} — ${o.result?.why}`)).join("\n");
}
