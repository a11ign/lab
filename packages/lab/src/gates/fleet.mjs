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
import { drainAcrossPool } from "../training/worker-pool.mjs";

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
 * Hand each item to whichever worker is FREE — `drainAcrossPool`, wrapped for gates.
 *
 * THIS REPLACED A STATIC SPLIT I WROTE, and the pool's own header says why that was wrong: "a shared queue
 * rather than a static split, so a slow item does not leave a worker idle while another still has a
 * backlog." Dealing 8 canaries as 2,2,2,1,1 means a box three times slower still gets 2 and everything
 * waits for it. That is invisible at five boxes and expensive at twenty — and this fleet already RETIRED
 * `a11y-worker-1` for being too slow, so heterogeneous hardware is the normal case here, not a hypothetical.
 *
 * Building it beside the pool rather than on it was this repo's most expensive recurring shape, committed
 * while fixing other instances of it. *Software Engineering at Google* names the property a corpus run
 * needs — "work spread into small chunks and ASSIGNED DYNAMICALLY to workers" — and it is also the whole
 * of what a message broker would have bought, which is why there is no broker here.
 *
 * THE ITEM IS INDIVISIBLE, which the pool already enforces and gates depend on: a canary's repeats, and
 * both probe orders of a page, must run on ONE box or a difference between runs becomes indistinguishable
 * from a difference between machines.
 *
 * @template T, R
 * @param {T[]} items @param {string[]} workers
 * @param {(item: T, worker: string) => Promise<R>} runOne
 * @returns {Promise<{ item: T, worker: string, result: R | null, error: string | null }[]>}
 */
export async function acrossFleet(items, workers, runOne) {
  /** @type {{ item: T, worker: string, result: R | null, error: string | null }[]} */
  const outcomes = [];
  await drainAcrossPool({
    workers,
    items,
    // Nothing to set up per worker: a gate's boxes are bare metal that is always on. The pool calls this
    // to decide a worker is usable at all, so returning a value rather than throwing says "usable".
    prepare: async (/** @type {string} */ worker) => ({ worker }),
    // A THROW IS THAT ITEM'S RESULT, NEVER THE SHARD'S. The pool requeues a failed item onto another
    // worker, so a gate inherits eviction and requeue that the static split never had — but an item that
    // fails everywhere must still appear in the report, or the denominator silently shrinks.
    handle: async (/** @type {any} */ item, /** @type {any} */ { worker }) => {
      try {
        outcomes.push({ item, worker, result: await runOne(item, worker), error: null });
      } catch (error) {
        outcomes.push({ item, worker, result: null,
          error: error instanceof Error ? error.message : String(error) });
      }
    },
    // Gates do not evict on slowness: a gate is minutes, and a box retired mid-gate would shrink coverage
    // for a reason unrelated to what is being tested.
    isDegraded: async () => false,
    // Items here are pages and canaries, which have no `id`. Keyed on the whole item, which is what the
    // pool uses only to drop failure records.
    keyOf: (/** @type {any} */ item) => JSON.stringify(item),
  });
  return outcomes;
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

/**
 * Where the work actually LANDED, counted after the fact.
 *
 * A dynamic pool has no shard list to print up front — that is the point of it — so this reports the real
 * distribution, which is more useful anyway: an uneven split is now EVIDENCE that one box is slower rather
 * than an artefact of how the work was dealt.
 */
export function renderShards(/** @type {{worker: string}[]} */ outcomes) {
  /** @type {Map<string, number>} */
  const byWorker = new Map();
  for (const o of outcomes) byWorker.set(o.worker, (byWorker.get(o.worker) ?? 0) + 1);
  return [...byWorker].sort().map(([w, n]) => `  ${w.padEnd(28)} ${n} item(s)`).join("\n");
}
