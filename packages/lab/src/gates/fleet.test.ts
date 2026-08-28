/**
 * Sharding a gate's pages across the fleet: n boxes, n-way throughput.
 *
 * Two wrong shapes preceded this one, and both are worth keeping in mind because the tests below exist to
 * refuse them. The first ran every gate on ONE box, so `gate:stability` did 40 captures while four
 * machines idled. The second ran the WHOLE gate on EVERY box — redundancy rather than throughput, five
 * times the captures for the same wall clock, and twenty times it with twenty boxes.
 *
 * The unit of work is a PAGE, assigned to a machine. A page's repeats stay together on that machine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { gateWorkers, shardAcrossWorkers, acrossFleet, fleetVerdict, renderShards } from "./fleet.mjs";

test("naming a worker is the ESCAPE HATCH, and the scope says so out loud", () => {
  const named = gateWorkers("http://REDACTED-INTERNAL-ADDRESS:8765");
  assert.deepEqual(named.workers, ["http://REDACTED-INTERNAL-ADDRESS:8765"]);
  assert.match(named.scope, /ONLY/,
    "a one-box run must announce itself as one box, or its verdict reads as a fleet claim");
});

test("the DEFAULT is every worker in the inventory, not one", () => {
  const all = gateWorkers(undefined);
  assert.ok(all.workers.length > 1, "a default of one box is how nineteen sit idle");
  assert.match(all.scope, /inventory\.yml/);
});

test("WORK IS SPLIT, NOT REPEATED — each item lands on exactly one box", () => {
  // The redundancy shape would put all 8 on all 3. This is the assertion that refuses it.
  const shards = shardAcrossWorkers(["a", "b", "c", "d", "e", "f", "g", "h"], ["w1", "w2", "w3"]);
  const placed = shards.flatMap((s) => s.items);
  assert.equal(placed.length, 8, "8 items across 3 boxes is 8 units of work, never 24");
  assert.deepEqual([...placed].sort(), ["a", "b", "c", "d", "e", "f", "g", "h"]);
});

test("twice the boxes is half the longest shard, which is the wall clock", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const longest = (/** @type {string[]} */ workers: string[]) =>
    Math.max(...shardAcrossWorkers(items, workers).map((s) => s.items.length));
  assert.equal(longest(["a", "b", "c", "d", "e"]), 4);
  assert.equal(longest(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]), 2,
    "doubling the fleet must halve the critical path, or the sharding is not buying throughput");
});

test("dealt round-robin, so adjacent slow pages do not all land on one box", () => {
  const shards = shardAcrossWorkers(["slow1", "slow2", "fast1", "fast2"], ["w1", "w2"]);
  assert.deepEqual(shards[0].items, ["slow1", "fast1"]);
  assert.deepEqual(shards[1].items, ["slow2", "fast2"],
    "a contiguous split would give w1 both slow pages; dealing spreads them without knowing which is slow");
});

test("a box with nothing to do is REPORTED, not dropped", () => {
  // "twenty boxes, eight had work" is the report you want. Dropping the empty ones describes eight.
  const shards = shardAcrossWorkers(["a", "b"], ["w1", "w2", "w3", "w4"]);
  assert.equal(shards.length, 4);
  assert.deepEqual(shards[3].items, []);
  assert.match(renderShards(shards), /w4\s+0 item\(s\)/);
});

test("ONE ITEM'S FAILURE DOES NOT REMOVE THE REST OF ITS SHARD", async () => {
  // The vanishing-denominator defect: if a throw ended the shard, the pages behind it would silently
  // leave the run and the verdict would report the smaller number as though it were the whole.
  const shards = shardAcrossWorkers(["ok1", "boom", "ok2", "ok3"], ["w1"]);
  const outcomes = await acrossFleet(shards, async (item) => {
    if (item === "boom") throw new Error("ETIMEDOUT");
    return { verdict: "PASS" };
  });
  assert.equal(outcomes.length, 4, "all four items must be accounted for");
  assert.equal(outcomes.filter((o) => o.result !== null).length, 3);
  assert.equal(outcomes.find((o) => o.item === "boom")?.error, "ETIMEDOUT");
});

test("every result names the box that produced it, so a failure is attributable", async () => {
  const shards = shardAcrossWorkers(["a", "b"], ["w1", "w2"]);
  const outcomes = await acrossFleet(shards, async () => ({ verdict: "PASS" }));
  assert.deepEqual(outcomes.map((o) => [o.item, o.worker]).sort(), [["a", "w1"], ["b", "w2"]]);
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
