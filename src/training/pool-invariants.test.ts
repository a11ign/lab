/**
 * A worker leaves the pool two different ways, and the guards must never remove the last one.
 *
 * EVICTED means it kept failing; RETIRED means it degraded. Both guards enforce the same invariant — keep at
 * least one worker taking cases, because a slow run beats no run — and each used to subtract only its OWN
 * count. So each was blind to the other:
 *
 *   - with three workers and two already RETIRED, `shouldEvictWorker` computed `3 - 0 = 3` remaining and would
 *     evict the third, leaving zero;
 *   - the mirror image held for `shouldRetireWorker` after two evictions.
 *
 * The result is a run that abandons its queue with no worker and no explanation, and it would have been
 * attributed to the guests rather than to arithmetic. Found by applying Clean Code's Concurrency chapter —
 * "limit the scope of shared data": two counters tracking one concept, neither seeing the other.
 *
 * These are pure functions, so the invariant is cheap to state directly. That matters because the failure it
 * prevents needs three workers, two failure modes and a specific order to reproduce live.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { shouldEvictWorker, shouldRetireWorker, workersStillWorking } from "./capture-decisions.mjs";

const FAILING = 3; // at or above MAX_CONSECUTIVE_WORKER_FAILURES
const DEGRADED_VITALS = { recoveries: 99, captures: 4, failures: 0 };

test("remaining workers counts BOTH ways a worker leaves the pool", () => {
  assert.equal(workersStillWorking({ poolSize: 3, evictedCount: 0, retiredCount: 0 }), 3);
  assert.equal(workersStillWorking({ poolSize: 3, evictedCount: 1, retiredCount: 1 }), 1);
  assert.equal(workersStillWorking({ poolSize: 3, evictedCount: 0, retiredCount: 2 }), 1);
});

test("eviction is refused when the others were RETIRED, not evicted", () => {
  // The regression: `evictedCount` alone said 3 remaining, so the last worker was evictable.
  assert.equal(
    shouldEvictWorker({ consecutiveFailures: FAILING, poolSize: 3, evictedCount: 0, retiredCount: 2 }),
    false,
    "evicting here leaves ZERO workers and the run abandons its queue",
  );
  assert.equal(
    shouldEvictWorker({ consecutiveFailures: FAILING, poolSize: 3, evictedCount: 1, retiredCount: 1 }),
    false,
    "one evicted plus one retired also leaves exactly one — still the last one standing",
  );
});

test("eviction still happens while more than one worker remains", () => {
  // Guard the guard: a fix that simply refused every eviction would pass the test above and be useless.
  assert.equal(
    shouldEvictWorker({ consecutiveFailures: FAILING, poolSize: 3, evictedCount: 0, retiredCount: 1 }),
    true,
  );
  assert.equal(
    shouldEvictWorker({ consecutiveFailures: FAILING, poolSize: 2, evictedCount: 0, retiredCount: 0 }),
    true,
  );
  // And a healthy worker is never evicted, however many have left.
  assert.equal(
    shouldEvictWorker({ consecutiveFailures: 0, poolSize: 3, evictedCount: 0, retiredCount: 0 }),
    false,
  );
});

test("retirement is refused when the others were EVICTED, not retired", () => {
  const { retire } = shouldRetireWorker({
    vitals: DEGRADED_VITALS, poolSize: 3, retiredCount: 0, evictedCount: 2,
  });
  assert.equal(retire, false, "retiring here leaves ZERO workers; a degraded worker beats none");
});

test("retirement still happens while more than one worker remains", () => {
  const { retire } = shouldRetireWorker({
    vitals: DEGRADED_VITALS, poolSize: 3, retiredCount: 0, evictedCount: 0,
  });
  assert.equal(retire, true, "a degraded worker in a healthy pool should be retired");
});

test("omitting the other count keeps the old behaviour rather than crashing", () => {
  // `evictedCount` defaults to 0 so an older caller cannot throw. Documented deliberately: it means a caller
  // that forgets to pass it silently gets the ORIGINAL bug, which is why both call sites are asserted below.
  assert.equal(
    shouldEvictWorker({ consecutiveFailures: FAILING, poolSize: 3, evictedCount: 0 }),
    true,
    "without retiredCount the guard cannot see retirements — the default must not pretend otherwise",
  );
});

test("the pool's eviction call passes both counts, and the dataset run no longer decides retirement at all", () => {
  // The defaults above make a forgetful caller silently wrong, so the caller is checked directly. Read as
  // text: importing the run module starts a capture, because it has no main guard.
  //
  // THE RETIREMENT CALL SITE MOVED OUT OF THE RUN (A11-263). Eviction counts consecutive failures, which only the pool can see, so it decides there -- and still does,
  // for the clients that dispatch through the pool. Retirement needed the worker's vitals, which only the dataset run measured, so the pool handed it the counts and
  // the run made the call. The run submits a fleet job now and holds no pool: the SERVICE takes a box out of a job (three captures in a row failed, or the drift
  // record lists it) and its lease says so. So the second half of this invariant has no caller left in the lab to forget a count, and what is asserted is that
  // it is gone, rather than a call site that cannot exist.
  const pool = readFileSync(fileURLToPath(new URL("./worker-pool.mjs", import.meta.url)), "utf8");
  const run = readFileSync(
    fileURLToPath(new URL("./capture-screenreader-dataset.mjs", import.meta.url)), "utf8");

  const evictCall = /shouldEvictWorker\(\{[\s\S]{0,200}?\}\)/.exec(pool)?.[0] ?? "";
  assert.match(evictCall, /evictedCount/, "the evict call must pass evictedCount");
  assert.match(evictCall, /retiredCount/, "the evict call must pass retiredCount");
  assert.match(pool, /poolSize: pool\.size,\s*evictedCount: pool\.evicted\.length,\s*retiredCount: pool\.retired\.length,/,
    "the pool must hand its counts to the degradation predicate");

  assert.doesNotMatch(run, /shouldRetireWorker|drainAcrossPool|isDegraded/,
    "the dataset run holds no pool any more: if it grows one, the retire call must pass both counts again and this test must say so");
});
