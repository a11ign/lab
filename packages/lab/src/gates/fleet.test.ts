/**
 * Sharding a gate's pages across the fleet: n boxes, n-way throughput.
 *
 * THREE wrong shapes preceded this one, and the tests below exist to refuse each. The first ran every gate
 * on ONE box, so `gate:stability` did 40 captures while four machines idled. The second ran the WHOLE gate
 * on EVERY box — redundancy rather than throughput. The third, and the subtlest, DEALT the items up front:
 * a static split, so a box three times slower still took its share and everyone waited for it — beside a
 * `drainAcrossPool` whose own header says a shared queue exists for exactly that reason.
 *
 * The unit of work is a PAGE, handed to whichever machine is free. A page's captures stay together on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { gateWorkers, acrossFleet, fleetVerdict, renderShards } from "./fleet.mjs";
import { inventoryWorkerUrls } from "@a11ign/worker-fleet/fleet-env";

// The real inventory.yml is gitignored (real addresses, restored from the secrets store at bring-up), so
// this reads inventory.example.yml instead -- INJECTED through `gateWorkers`'s `inventory` seam rather
// than a second inventoryWorkerUrls() call this file would have to keep in step by hand. Worker COUNT is
// what this test needs (more than one), and the example is guaranteed to match the real fleet's count
// (inventory-example-parity.test.ts).
const EXAMPLE_INVENTORY = fileURLToPath(new URL("../../../control/ansible/inventory.example.yml", import.meta.url));
const exampleInventoryWorkers = () => inventoryWorkerUrls({ inventoryPath: EXAMPLE_INVENTORY });

test("naming a worker is the ESCAPE HATCH, and the scope says so out loud", () => {
  const named = gateWorkers("http://REDACTED-INTERNAL-ADDRESS:8765");
  assert.deepEqual(named.workers, ["http://REDACTED-INTERNAL-ADDRESS:8765"]);
  assert.match(named.scope, /ONLY/,
    "a one-box run must announce itself as one box, or its verdict reads as a fleet claim");
});

test("the DEFAULT is every worker in the inventory, not one", () => {
  const all = gateWorkers(undefined, { inventory: exampleInventoryWorkers });
  assert.ok(all.workers.length > 1, "a default of one box is how nineteen sit idle");
  assert.match(all.scope, /inventory\.yml/);
});

test("WORK IS SPLIT, NOT REPEATED — each item runs exactly once", async () => {
  // The redundancy shape would run all 8 on all 3. This is the assertion that refuses it.
  const ran: string[] = [];
  const outcomes = await acrossFleet(["a", "b", "c", "d", "e", "f", "g", "h"], ["w1", "w2", "w3"],
    async (item) => { ran.push(item); return { ok: true }; });
  assert.equal(ran.length, 8, "8 items across 3 boxes is 8 units of work, never 24");
  assert.deepEqual([...ran].sort(), ["a", "b", "c", "d", "e", "f", "g", "h"]);
  assert.equal(outcomes.length, 8);
});

test("A SLOW BOX TAKES FEWER ITEMS — which a static split could not do", async () => {
  // The whole reason this is `drainAcrossPool` and not the round-robin deal I wrote first. With a static
  // split w1 would get its share regardless of speed and everyone would wait for it; with a shared queue
  // the fast boxes simply take more. At twenty heterogeneous boxes this is the difference that matters,
  // and this fleet already retired a worker for being too slow.
  const perWorker: Record<string, number> = { w1: 0, fast1: 0, fast2: 0 };
  await acrossFleet(Array.from({ length: 12 }, (_, i) => i), ["w1", "fast1", "fast2"],
    async (_item, worker) => {
      perWorker[worker] += 1;
      await new Promise((r) => setTimeout(r, worker === "w1" ? 60 : 5));
      return { ok: true };
    });
  assert.equal(Object.values(perWorker).reduce((a, b) => a + b), 12);
  // STRICTLY FEWER THAN EACH FAST BOX, not fewer than their SUM. The first version compared w1 against
  // `fast1 + fast2`, which a static 4/4/4 deal satisfies trivially — so the mutation back to a static split
  // passed. Caught by mutation, not by reading: an assertion the defect also satisfies is not a test.
  assert.ok(perWorker.w1 < perWorker.fast1 && perWorker.w1 < perWorker.fast2,
    `the slow box must take fewer than EACH fast one; a static deal gives them all the same: `
    + JSON.stringify(perWorker));
});

test("ONE ITEM'S FAILURE DOES NOT REMOVE THE REST", async () => {
  // The vanishing-denominator defect: if a throw ended the run, the items behind it would silently leave
  // and the verdict would report the smaller number as though it were the whole.
  const outcomes = await acrossFleet(["ok1", "boom", "ok2", "ok3"], ["w1"], async (item) => {
    if (item === "boom") throw new Error("ETIMEDOUT");
    return { verdict: "PASS" };
  });
  assert.equal(outcomes.length, 4, "all four items must be accounted for");
  assert.equal(outcomes.filter((o) => o.result !== null).length, 3);
  assert.equal(outcomes.find((o) => o.item === "boom")?.error, "ETIMEDOUT");
});

test("every result names the box that produced it, so a failure is attributable", async () => {
  const outcomes = await acrossFleet(["a"], ["w1"], async () => ({ verdict: "PASS" }));
  assert.deepEqual(outcomes.map((o) => [o.item, o.worker]), [["a", "w1"]]);
});

test("the report shows where work LANDED, so an uneven split is evidence rather than an artefact", async () => {
  const outcomes = await acrossFleet(["a", "b"], ["w1", "w2"], async () => ({ ok: true }));
  const rendered = renderShards(outcomes);
  assert.match(rendered, /w1|w2/);
  assert.equal(rendered.split("\n").length >= 1, true);
});

test("THE DENOMINATOR IS THE PAGES, not the machines", () => {
  // The boxes are how the work was spread; the pages are what was examined. Swapping them is how a gate
  // reports a number nobody asked for.
  const verdict = fleetVerdict(
    [{ result: {}, error: null }, { result: {}, error: null }, { result: {}, error: null }],
    { of: 3, what: "3 canaries x 5 captures", workers: 5, failed: 0 });
  assert.equal(verdict.verdict, "PASS");
  assert.equal(verdict.of, 3, "three pages on five boxes is a claim about three pages");
  assert.match(verdict.why, /sharded across 5 worker\(s\)/);
});

test("an item nobody could judge reduces COVERAGE rather than passing quietly", () => {
  const verdict = fleetVerdict(
    [{ result: {}, error: null }, { result: null, error: "ETIMEDOUT" }],
    { of: 2, what: "2 canaries", workers: 5, failed: 0 });
  assert.equal(verdict.verdict, "INCONCLUSIVE");
  assert.equal(verdict.examined, 1);
});

test("a bad result FAILS, and outranks an unmeasurable one", () => {
  const verdict = fleetVerdict(
    [{ result: {}, error: null }, { result: null, error: "ETIMEDOUT" }],
    { of: 2, what: "2 canaries", workers: 5, failed: 1 });
  assert.equal(verdict.verdict, "FAIL", "a defect proven on one page is a defect however little else said");
});
