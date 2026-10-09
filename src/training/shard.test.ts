/**
 * Sharding is invisible when it is wrong, which is the only reason these tests are worth writing.
 *
 * A parser that drops one page of 77 produces a corpus of 76 that looks exactly like a corpus of 77, and a
 * parser that hands the same page to two shards captures somebody else's site twice while reporting
 * success. Neither shows up in a count of failures, so the properties are asserted directly: every item in
 * exactly one shard, and the shards concatenating to the whole list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseShard, shardOf } from "./shard.mjs";

test("no --shard means the whole list, which is the normal single-runner case", () => {
  assert.deepEqual(parseShard([]), { index: 0, count: 1 });
  assert.deepEqual(parseShard(["--role=training"]), { index: 0, count: 1 });
  assert.deepEqual(shardOf([1, 2, 3], parseShard([])), [1, 2, 3]);
});

test("i/n parses", () => {
  assert.deepEqual(parseShard(["--shard=0/4"]), { index: 0, count: 4 });
  assert.deepEqual(parseShard(["--shard=3/4"]), { index: 3, count: 4 });
  assert.deepEqual(parseShard(["--role=x", "--shard=1/2", "--worker=http://a:1"]), { index: 1, count: 2 });
});

test("a malformed shard is an ERROR, not a silent fall back to doing everything", () => {
  // This is the one that matters. Falling back to the whole list means four runs each capturing all 77
  // pages — four times the requests to somebody else's site, reported as success.
  for (const bad of ["4/4", "5/4", "-1/4", "1/0", "1", "a/b", "1/2/3", "", "1.5/4", "1/4extra"]) {
    assert.throws(() => parseShard([`--shard=${bad}`]), /--shard must be i\/n/, `should refuse ${bad}`);
  }
});

test("every item lands in exactly one shard, and the shards rebuild the list", () => {
  const items = Array.from({ length: 77 }, (_, i) => i);
  for (const count of [1, 2, 3, 4, 7, 77]) {
    const slices = Array.from({ length: count }, (_, index) => shardOf(items, { index, count }));
    const seen = slices.flat().sort((a, b) => a - b);
    assert.deepEqual(seen, items, `count=${count} must cover every item exactly once`);
    assert.equal(slices.reduce((n, s) => n + s.length, 0), items.length, `count=${count} lengths must sum`);
  }
});

test("more shards than items leaves later shards empty rather than throwing", () => {
  // A run that asks for 8 shards of 3 pages should get three one-page runs and five that do nothing, not a
  // crash — the caller reports "no pages for this shard" and exits, which is already what it does.
  const slices = Array.from({ length: 8 }, (_, index) => shardOf([1, 2, 3], { index, count: 8 }));
  assert.deepEqual(slices.flat(), [1, 2, 3]);
  assert.equal(slices.filter((s) => s.length === 0).length, 5);
});

test("shards interleave rather than taking contiguous blocks — that is the politeness property", () => {
  // Consecutive requests from one shard must go to DIFFERENT publishers. Contiguous blocks would hand one
  // shard a run of pages from the same site, which is the crawl this deliberately is not.
  assert.deepEqual(shardOf(["a1", "b1", "c1", "d1", "a2", "b2"], { index: 0, count: 2 }),
    ["a1", "c1", "a2"]);
});
