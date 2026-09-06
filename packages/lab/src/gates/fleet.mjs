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
import { inventoryWorkerUrls } from "@a11y-witness/worker-fleet/fleet-env";

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
 * `inventory` is INJECTED, defaulting to the real `inventoryWorkerUrls` — the same seam
 * `check-worker-code.mjs`'s pool resolver already uses, so a test can point this at a fixture inventory
 * (e.g. `inventory.example.yml`) rather than needing the real, gitignored `inventory.yml` on disk.
 *
 * @param {string | undefined} named a `--worker` / `A11Y_WORKER` value, if the caller gave one
 * @param {{ inventory?: () => string[], env?: Record<string, string | undefined> }} [deps]
 * @returns {{ workers: string[], scope: string }} `scope` is what the verdict must SAY it covered
 */
export function gateWorkers(named, { inventory = inventoryWorkerUrls, env = process.env } = {}) {
  if (named) return { workers: [named], scope: `${named} ONLY — one box, named explicitly` };

  // `A11Y_WORKERS` FIRST, AND ON THE LAB IT IS THE ONLY THING THERE IS.
  //
  // `inventory.yml` is gitignored and untracked (#54, the public-repo address exposure), so a pull DELETES
  // it from any checkout that has one. The control plane keeps its copy deliberately; the lab's is simply
  // gone after its next pull, and this gate runs ON THE LAB. Measured 2026-09-06, minutes after that
  // landed: `gate:stability` died with "no workers in inventory.yml, and none named -- a gate cannot
  // examine nothing". The guard was right and the input had been removed underneath it.
  //
  // Every lab job already RECEIVES the fleet: `lab-job.yml` derives `lab_fleet_workers` from the inventory
  // on the CONTROL PLANE, where the file lives, and hands the addresses over as `A11Y_WORKERS`. So the
  // list was always present in the environment and this gate was reading a file to rediscover it.
  //
  // Reading the env first makes `inventory.yml` control-plane-only BY CONSTRUCTION rather than by
  // convention -- which matters because I answered "does anything on the lab read it?" by grepping three
  // directories, missed this one, and gave a false all-clear an hour before it broke.
  const fromEnv = String(env.A11Y_WORKERS ?? "").split(",").map((w) => w.trim()).filter(Boolean);
  if (fromEnv.length) {
    return { workers: fromEnv, scope: `${fromEnv.length} worker(s) from A11Y_WORKERS` };
  }

  const workers = inventory();
  if (workers.length === 0) {
    throw new Error("no workers in A11Y_WORKERS and none in inventory.yml, and none named — a gate cannot "
      + "examine nothing. On the lab the fleet arrives as A11Y_WORKERS; `inventory.yml` is control-plane "
      + "only and a pull removes it here.");
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
  const { failures } = await drainAcrossPool({
    workers,
    items,
    // Nothing to set up per worker: a gate's boxes are bare metal that is always on. The pool calls this
    // to decide a worker is usable at all, so returning a value rather than throwing says "usable".
    prepare: async (/** @type {string} */ worker) => ({ worker }),
    // A THROW IS THAT ITEM'S RESULT, NEVER THE SHARD'S. The pool requeues a failed item onto another
    // worker, so a gate inherits eviction and requeue that the static split never had — but an item that
    // fails everywhere must still appear in the report, or the denominator silently shrinks.
    // A THROW IS REQUEUED BY THE POOL, and this must let it through. The comment here used to claim "a
    // gate inherits eviction and requeue that the static split never had" while the body CAUGHT every
    // error — so the pool saw nothing but successes, never requeued, never evicted, and a single broken
    // box turned its share of the pages into gate failures that a healthy neighbour would have passed.
    // That is precisely the confusion this file's header says must not happen: "flakiness versus a fleet
    // that is not interchangeable ... need opposite remedies".
    //
    // The catch was not gratuitous, though. It preserved the other half — "an item that fails everywhere
    // must still appear in the report, or the denominator silently shrinks" — because an item the pool
    // gives up on lands in `pool.failures` and never reaches `outcomes`. Both halves are real and the
    // comment described both while the code could only deliver one.
    //
    // Both, now: throw so the pool requeues, then fold `failures` back in below.
    handle: async (/** @type {any} */ item, /** @type {any} */ { worker }) => {
      outcomes.push({ item, worker, result: await runOne(item, worker), error: null });
    },
    // Gates do not evict on slowness: a gate is minutes, and a box retired mid-gate would shrink coverage
    // for a reason unrelated to what is being tested.
    isDegraded: async () => false,
    // Items here are pages and canaries, which have no `id`. Keyed on the whole item, which is what the
    // pool uses only to drop failure records.
    keyOf: (/** @type {any} */ item) => JSON.stringify(item),
  });
  // WHAT THE POOL GAVE UP ON, so the denominator is the item list whatever happened to the machines. An
  // item requeued and then passed is spliced out of `failures` by the pool, so nothing is double-counted;
  // what is left failed on every worker it was tried on, which is a finding about the ITEM.
  for (const failure of failures) {
    outcomes.push({
      item: failure.item, worker: failure.worker, result: null,
      error: failure.error instanceof Error ? failure.error.message : String(failure.error),
    });
  }
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
 * @param {{ of: number, what: string, workers: number, failed: number, controlPlane?: string }} about
 */
export function fleetVerdict(outcomes, { of, what, workers, failed, controlPlane }) {
  return gateVerdict({
    examined: outcomes.filter((o) => o.result !== null).length,
    of,
    // THE CONTROL PLANE IS PART OF THE POPULATION, for the same reason the machine is. Two verdicts that
    // look identical were produced from hosts that were not: one lost 9 of 40 responses on a laptop whose
    // battery fell 18% to 1%, and nothing in the output said so. Absent means an older caller that has not
    // been given it -- never "it ran somewhere fine".
    source: `${what}, sharded across ${workers} worker(s) from inventory.yml`
      + (controlPlane ? `, driven from ${controlPlane}` : ""),
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
