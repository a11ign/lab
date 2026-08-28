// @ts-check
/**
 * SHARD THE WORK ACROSS THE FLEET: n boxes, n-way throughput. Time is money.
 *
 * The capture RUNS have dispatched across the pool since there was a pool. The GATES never did -- they take
 * one `--worker` -- so `gate:stability` ran 40 captures on ONE machine while four sat idle, and reported
 * "8 of 8 canaries examined and clean" as though it described the tool.
 *
 * The first attempt at this fix ran the WHOLE gate on EVERY box. That is redundancy, not throughput: five
 * times the captures for the same wall clock, and with twenty boxes it would be twenty times. The unit of
 * work is a PAGE, and a page is assigned to a machine.
 *
 * A PAGE'S REPEATS STAY ON ONE BOX, and that is the invariant everything here protects. `gate:stability`
 * captures a page N times and compares by CONTENT; spreading those N across machines would conflate
 * run-to-run instability with box-to-box difference, which need opposite remedies -- flakiness versus a
 * fleet that is not interchangeable, and `fleet-consistency` answers the second separately. So the shard
 * boundary is BETWEEN pages, never inside one.
 *
 * WITHIN a box the work is SEQUENTIAL, because a worker serves one capture at a time and answers
 * `429 a capture is already in progress` to the second. Parallelism is across boxes only.
 */
import { inventoryWorkerUrls } from "../../../worker-fleet/src/fleet-env.mjs";

import { gateVerdict } from "./verdict.mjs";

/**
 * The boxes to spread the work over: the one named, or every worker in `inventory.yml`.
 *
 * Naming a worker is the ESCAPE HATCH, never the default -- the same convention capture runs already use,
 * where setting nothing dispatches across everything and naming one means you are managing it. A default of
 * "one box" is how a fleet-wide claim came to be made from a single machine, and how nineteen boxes would
 * sit idle.
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
 * Deal the items round-robin, so a fleet twice the size halves the wall clock.
 *
 * Round-robin rather than contiguous blocks: the items are ordered by whatever the caller happened to
 * write down, and a contiguous split hands one box every slow page if the slow ones are adjacent. Dealing
 * spreads that without needing to know which are slow.
 *
 * A box with nothing to do is returned with an EMPTY list rather than dropped, because the report must be
 * able to say "twenty boxes, eight had work" instead of silently describing eight.
 *
 * @template T
 * @param {T[]} items @param {string[]} workers
 * @returns {{ worker: string, items: T[] }[]}
 */
export function shardAcrossWorkers(items, workers) {
  const shards = workers.map((worker) => ({ worker, items: /** @type {T[]} */ ([]) }));
  items.forEach((item, i) => shards[i % shards.length].items.push(item));
  return shards;
}

/**
 * Run every shard at once; within a shard, one item after another.
 *
 * A THROW IS THAT ITEM'S RESULT, NEVER THE SHARD'S. A box that fails one page must still attempt the rest,
 * or one flaky capture silently removes every page behind it from the run -- and the verdict would report
 * the smaller number as though it were the whole. That is the vanishing-denominator defect, which this
 * repo has already paid for in `evidence-check`.
 *
 * @template T, R
 * @param {{ worker: string, items: T[] }[]} shards
 * @param {(item: T, worker: string) => Promise<R>} runOne
 * @returns {Promise<{ item: T, worker: string, result: R | null, error: string | null }[]>}
 */
export async function acrossFleet(shards, runOne) {
  const perShard = await Promise.all(shards.map(async ({ worker, items }) => {
    /** @type {{ item: T, worker: string, result: R | null, error: string | null }[]} */
    const out = [];
    for (const item of items) {
      try {
        out.push({ item, worker, result: await runOne(item, worker), error: null });
      } catch (error) {
        out.push({ item, worker, result: null, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return out;
  }));
  return perShard.flat();
}

/**
 * The verdict over the ITEMS, which is the population the caller asked about.
 *
 * The boxes are how the work was spread, not what was examined -- so the denominator stays the page list,
 * exactly as it was when this ran on one machine. Changing the denominator to match the machines is how a
 * gate comes to report a number nobody asked for.
 *
 * An item that could not be judged reduces COVERAGE; an item that came back bad is a FAILURE. "We could
 * not measure" and "it varied" need opposite responses.
 *
 * @param {{ result: unknown, error: string | null }[]} outcomes
 * @param {{ of: number, what: string, workers: number, failed: number }} about
 */
export function fleetVerdict(outcomes, { of, what, workers, failed }) {
  return gateVerdict({
    examined: outcomes.filter((o) => o.result !== null).length,
    of,
    source: `${what}, sharded across ${workers} worker(s) from inventory.yml`,
    failures: failed,
  });
}

/** How the work was actually spread, so an idle box or a lopsided shard is visible rather than inferred. */
export function renderShards(/** @type {{worker: string, items: unknown[]}[]} */ shards) {
  return shards.map((s) => `  ${s.worker.padEnd(28)} ${s.items.length} item(s)`).join("\n");
}
