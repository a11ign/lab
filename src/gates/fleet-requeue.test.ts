import { test } from "node:test";
import assert from "node:assert/strict";

import { acrossFleet } from "./fleet.mjs";

/**
 * A GATE MUST SEPARATE "this page is flaky" FROM "that box is broken".
 *
 * `acrossFleet` caught every error from `runOne`, so `drainAcrossPool` — which requeues a thrown item onto
 * another worker — only ever saw successes. One bad machine therefore turned its share of the pages into
 * gate FAILURES that a healthy neighbour would have passed, which is exactly the confusion this module's
 * header says needs opposite remedies.
 *
 * The catch was protecting something real: an item the pool gives up on lands in its `failures` list and
 * never reaches the caller, so the denominator would silently shrink. Both properties are asserted here,
 * because a fix that trades one for the other is how this got written the first time.
 */

test("a broken box is EVICTED and the pages it lost are re-run on a healthy one", async () => {
  // The pool requeues on EVICTION, not on a single failure, and that split is deliberate: one failure is
  // the item's fault, a streak is the machine's. So the property to assert is that a box which fails
  // repeatedly stops taking work and hands back what it never did — none of which could happen while
  // `acrossFleet` swallowed the throw.
  const attempts: string[] = [];
  const pages = ["a", "b", "c", "d", "e", "f"];
  const outcomes = await acrossFleet(pages, ["http://broken:8765", "http://healthy:8765"],
    async (item, worker) => {
      attempts.push(`${worker}:${item}`);
      if (worker.includes("broken")) throw new Error("EHOSTUNREACH");
      return `captured ${item}`;
    });

  const good = outcomes.filter((o) => o.result !== null).map((o) => o.item).sort();
  assert.deepEqual(good, pages, `every page must end up captured, got ${JSON.stringify(outcomes)}`);
  assert.ok(attempts.some((a) => a.startsWith("http://healthy")),
    "the healthy box must have been given work");
  const brokenTried = attempts.filter((a) => a.startsWith("http://broken")).length;
  assert.ok(brokenTried < pages.length,
    `the broken box was handed all ${pages.length} pages, so it was never evicted`);
});

test("an item that fails EVERYWHERE still appears, so the denominator cannot shrink", async () => {
  // The half the catch was protecting. `drainAcrossPool` keeps such an item in `pool.failures`, from
  // which it never reaches the caller — so folding those back in is not optional.
  const outcomes = await acrossFleet(["page-a"], ["http://a:8765", "http://b:8765"],
    async () => { throw new Error("the page itself is broken"); });

  assert.equal(outcomes.length, 1, "the item must be reported, not dropped");
  assert.equal(outcomes[0]?.result, null);
  assert.match(String(outcomes[0]?.error), /the page itself is broken/);
});

test("a requeued-then-passing item is reported once, never twice", async () => {
  // If the pool's `failures` were folded in without it splicing a recovered item out, one page would
  // produce two outcomes and `examined` could exceed `of` — a coverage number above 100%.
  let attempts = 0;
  const outcomes = await acrossFleet(["page-a"], ["http://a:8765", "http://b:8765"],
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient");
      return "ok";
    });
  assert.equal(outcomes.length, 1, `one item must yield one outcome, got ${JSON.stringify(outcomes)}`);
});

test("every item is reported when nothing fails", async () => {
  const outcomes = await acrossFleet(["a", "b", "c"], ["http://x:8765", "http://y:8765"],
    async (item) => `captured ${item}`);
  assert.equal(outcomes.length, 3);
  assert.deepEqual(outcomes.map((o) => o.result).sort(), ["captured a", "captured b", "captured c"]);
});
