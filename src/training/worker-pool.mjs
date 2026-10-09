// @ts-check
/**
 * Drain a queue of work across a pool of workers — one item per worker at a time.
 *
 * ## Why this is a module rather than a loop inside the corpus runner
 *
 * It was that loop, and it was the only place in the project that used the fleet. The corpus run took 4 h 34 m
 * across four workers; `evidence:check` took ~20 minutes against ONE while the other three sat idle, and
 * `capture:check` the same. The hardware existed and one caller knew how to use it.
 *
 * The alternative was a second, simpler pool inside each of those tools. That is this repo's most expensive
 * recurring shape — the channel table that got duplicated because it lived in a file about something else,
 * the browser config spread across eight sites — and a pool is worse than most, because the copies would
 * agree right up until a worker died.
 *
 * ## The unit of work is an ITEM, and the caller decides what one is
 *
 * For every current caller an item is a CASE, both variants, because a good/bad pair is only comparable if
 * both halves came from the same screen reader on the same machine. Splitting a pair across workers would
 * compare two NVDA instances and call the difference evidence. This module does not know that — it knows an
 * item is indivisible, which is the same constraint stated in a way it can enforce.
 *
 * A shared queue rather than a static split, so a slow item does not leave a worker idle while another still
 * has a backlog.
 *
 * ## What it owns, and what it deliberately does not
 *
 * It owns the coordination: the queue, each worker's failure streak, eviction, and handing a broken worker's
 * cases back. It knows nothing about caching, resume, progress files or evidence, because those differ per
 * caller and dragging them in here is how a shared module becomes a second copy of one caller.
 */
import { shouldEvictWorker } from "./capture-decisions.mjs";

/**
 * Hand a broken worker's items back to the pool: the one in hand plus everything it already failed.
 *
 * Those failures were the WORKER's fault rather than the items', so they must not stay recorded against the
 * items — otherwise a broken guest permanently fails two cases before the eviction threshold even trips, and
 * those are cases a healthy worker could have captured.
 *
 * One block -- an adjacent second one would orphan everything above it, and only the last attaches.
 *
 * @param {{ queue: any[], failures: any[], item: any, failedHere: any[],
 *           keyOf: (item: any) => string }} state
 *   `failedHere` is the LIST of cases this worker failed, not a count of them: it is spread back onto the
 *   queue and walked to drop their failure records. Typing it as a number compiled and described the
 *   opposite of what the paragraph above says this function is for.
 */
function requeueFrom({ queue, failures, item, failedHere, keyOf }) {
  queue.push(item, ...failedHere);
  for (const failed of failedHere) {
    const at = failures.findIndex((/** @type {Record<string, any>} */ f) => f.key === keyOf(failed));
    if (at !== -1) failures.splice(at, 1);
  }
  return failedHere.length + 1;
}

/**
 * One worker's whole working life: become usable, then take items until the queue empties or it leaves.
 *
 * Deliberately NOT split further. The per-item body mutates this worker's streak and its blame list and uses
 * `return` to end the worker — expressing that as another function would need either a mutable bag or a
 * sentinel return value, and two functions that cannot be understood apart are worse than one that reads
 * straight through.
 */
/** @param {string} worker @param {Record<string, any>} ctx */
async function drainWithWorker(worker, { pool, prepare, handle, isDegraded, hooks, keyOf }) {
  // Prepared BEFORE it takes any work. Readiness used to be consulted only after a failure, so a freshly
  // booted worker was still handed the first item and still lost it — the exact failure a readiness gate
  // exists to prevent. A worker that never becomes usable simply takes nothing; the others drain the queue.
  let context;
  try {
    context = await prepare(worker);
  } catch (error) {
    hooks.onWorkerUnusable?.(worker, error);
    return;
  }

  let consecutiveFailures = 0;
  const failedHere = [];
  while (pool.queue.length) {
    const item = pool.queue.shift();
    try {
      await handle(item, { worker, context });
      // A success clears the streak AND the blame: these items were fine, so they must not be handed back
      // if this worker dies later.
      consecutiveFailures = 0;
      failedHere.length = 0;
      if (await retire({ worker, context, pool, isDegraded, hooks })) return;
    } catch (error) {
      consecutiveFailures += 1;
      // Evict, but NEVER the last worker standing: with nothing left to hand the work to, recording the
      // failures is more useful than abandoning the run quietly.
      if (shouldEvictWorker({
        consecutiveFailures,
        poolSize: pool.size,
        evictedCount: pool.evicted.length,
        retiredCount: pool.retired.length,
      })) {
        const handedBack = requeueFrom({ queue: pool.queue, failures: pool.failures, item, failedHere, keyOf });
        pool.evicted.push(worker);
        hooks.onEvicted?.(worker, { consecutiveFailures, handedBack, error });
        return;
      }
      // A failure is also the moment to ask whether the worker is answering at all. A wedged worker never
      // SUCCEEDS, so the success-path check can never see it, and it never fails cleanly enough to reach the
      // eviction threshold either. Its items go back like an eviction's, because unlike a degraded-but-working
      // guest this one genuinely did not do them.
      if (await retire({ worker, context, pool, isDegraded, hooks, requeue: { item, failedHere, keyOf } })) return;

      failedHere.push(item);
      pool.failures.push({ key: keyOf(item), item, worker, error });
      hooks.onItemFailed?.(item, error, { worker });
    }
  }
}

/**
 * Retire a degraded worker, optionally handing its work back. Returns whether it left the pool.
 *
 * **The DECISION belongs to the caller and the COUNTS belong to the pool**, so the pool hands its counts to
 * the predicate rather than deciding. `shouldRetireWorker` needs the worker's vitals and its unreachable
 * streak — things only the caller can measure — and also the "never the last one standing" guard, which
 * needs numbers only the pool has. Splitting it the other way would mean either duplicating the counts or
 * teaching this module what a worker's vitals are.
 *
 * A predicate that throws is not evidence that the worker is bad: a health probe which cannot answer says
 * nothing about the guest, and treating it as a retirement would remove a healthy worker on a network blip.
 */
/** @param {Record<string, any>} ctx */
async function retire({ worker, context, pool, isDegraded, hooks, requeue }) {
  if (!isDegraded) return false;
  let verdict;
  try {
    verdict = await isDegraded({
      worker, context,
      poolSize: pool.size, evictedCount: pool.evicted.length, retiredCount: pool.retired.length,
    });
  } catch {
    return false;
  }
  // `{retire, reason}` or a bare boolean, because `shouldRetireWorker` returns the former and a simpler
  // caller has no reason to invent one.
  const retiring = verdict === true || verdict?.retire === true;
  if (!retiring) return false;
  pool.retired.push(worker);
  const handedBack = requeue
    ? requeueFrom({ queue: pool.queue, failures: pool.failures, ...requeue })
    : 0;
  hooks.onRetired?.(worker, { handedBack, reason: verdict?.reason });
  return true;
}

/**
 * Run every item across the pool and report what happened to the RUN, not to each worker.
 *
 * @param {object} options
 * @param {string[]} options.workers
 * @param {any[]} options.items                      indivisible units of work
 * @param {(worker: string) => Promise<any>} options.prepare   throws to take this worker out
 * @param {(item: any, ctx: {worker: string, context: any}) => Promise<void>} options.handle
 *        throws to mark the item failed on this worker
 * @param {((ctx: {worker: string, context: any, poolSize: number, evictedCount: number,
 *              retiredCount: number}) => Promise<boolean | {retire: boolean, reason: string|null}>)}
 *        [options.isDegraded]
 *   BOTH SHAPES, because `retire()` below already accepts both and says so -- "`{retire, reason}` or a
 *   bare boolean, because `shouldRetireWorker` returns the former and a simpler caller has no reason to
 *   invent one". Declaring only the boolean made the real caller's return a type error and, worse, would
 *   have invited someone to "fix" it by dropping the reason a worker was retired.
 * @param {(item: any) => string} [options.keyOf] item identity, for requeue bookkeeping
 *
 * `any` rather than `unknown` for the ITEM and the worker CONTEXT, deliberately. This pool is generic
 * over both -- the dataset run passes cases and a `prepare` returning an environment, the real-page run
 * passes pages -- and `unknown` forces every caller to cast its own item back to what it just handed in,
 * which is a cast that proves nothing. The types that matter here are `workers`, the callbacks' arity and
 * the returned accounting, and those stay exact.
 * @param {object} [options.hooks]                    reporting only; never control flow
 * @returns {Promise<{failures: {key: string, item: any, worker: string, error: any}[],
 *                     evicted: string[], retired: string[]}>}
 *   The failure records are NAMED, because both callers build their run summary out of them -- `f.key`
 *   and `f.error` are what a human reads when a corpus run ends short. As `object[]` every one of those
 *   reads was a type error at the call site, which is the wrong end: the shape is decided here.
 */
export async function drainAcrossPool({
  workers, items, prepare, handle, isDegraded, keyOf = (/** @type {any} */ item) => item.id, hooks = {},
}) {
  // The accumulators are shared by every worker on purpose — the queue IS the coordination mechanism.
  const pool = { queue: [...items], failures: [], evicted: [], retired: [], size: workers.length };
  await Promise.all(workers.map((worker) =>
    drainWithWorker(worker, { pool, prepare, handle, isDegraded, hooks, keyOf })));
  return { failures: pool.failures, evicted: pool.evicted, retired: pool.retired };
}
