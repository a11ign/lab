/**
 * Page size is a COST decision with an evidence cliff at the end of it, and both halves went unchecked.
 *
 * The rescale (`6d5fcae`) gave every pair realistic furniture from five buckets up to 40 links. Measured
 * afterwards on the guest: 12.4 s with no filler, 58.1 s at 14 links, 123.4 s at 40 links. The last
 * number IS `DEFAULT_BUDGET_MS` (120_000), so that bucket ran out of budget mid-sweep and reported
 * `lists: 0` on a page with 40 list items — absence indistinguishable from truncation, the one finding
 * this project must never fabricate.
 *
 * Every existing check stayed green through all of it, because nothing here is a correctness property in
 * the usual sense: the pages were valid, the counts were plausible, and the cost lived in a wall-clock
 * measurement no test looked at. So `npm test` reported 444 passing over a corpus that could not be
 * recaptured inside 33 hours and whose largest pages produced unusable evidence.
 *
 * These assertions encode ADR 0009's two rules against the measured cost model. Pure arithmetic — no
 * worker, no capture, milliseconds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SCALE_BUCKETS } from "./case-matrix.mjs";

/**
 * Measured on one guest, quiet host, deployed code: 12.4 s with no filler, 58.1 s at 14 links (which
 * also carries 10 headings and 14 list items), 123.4 s at 40 links. Fitting those gives ~1.2 s per
 * element, which is two sweep steps (prev and next) at two round trips each, ~225 ms per trip.
 *
 * A bucket's element count is links + sections + one list item per link — the filler's actual shape,
 * not just its link count, which is the mistake that made 14 links look cheap.
 */
const BASELINE_MS = 12_400;
const MS_PER_ELEMENT = 1_200;
const CAPTURE_BUDGET_MS = 120_000; // DEFAULT_BUDGET_MS in capture-core.mjs

const elements = (b: { links: number; sections: number }) => b.links * 2 + b.sections;
const captureMs = (b: { links: number; sections: number }) => BASELINE_MS + MS_PER_ELEMENT * elements(b);

test("the buckets are populated, so nothing below is vacuously true", () => {
  assert.ok(SCALE_BUCKETS.length >= 2, `expected at least two buckets, got ${SCALE_BUCKETS.length}`);
});

test("no bucket lets a capture approach the budget, because past that absence is unreadable", () => {
  // ADR 0009's hard rule. Not a performance preference: a capture that exhausts its budget mid-sweep
  // returns an empty field, and an empty field IS the finding for several cases in this corpus. Half
  // the budget leaves room for the read-through, the probes, and a slow host.
  const ceiling = CAPTURE_BUDGET_MS / 2;
  for (const bucket of SCALE_BUCKETS) {
    const cost = captureMs(bucket);
    assert.ok(cost < ceiling,
      `bucket ${JSON.stringify(bucket)} implies a ~${(cost / 1000).toFixed(1)}s capture, over the `
      + `${(ceiling / 1000).toFixed(0)}s ceiling — at that size the sweeps truncate and report absence `
      + "they cannot distinguish from a page property (see docs/adr/0009-dataset-tiers.md)");
  }
});

test("a full recapture of the bulk corpus still fits one night", () => {
  // The affordability rule, and the reason the top two buckets went. A 33-hour feedback loop does not
  // get run — so in practice it means shipping evidence nobody revalidated, which is worse than a
  // smaller corpus. 1,061 pairs is 2,122 captures; 848 need recapturing today.
  const CAPTURES = 1_696;
  const NIGHT_HOURS = 12;
  const mean = SCALE_BUCKETS.reduce((sum, b) => sum + captureMs(b), 0) / SCALE_BUCKETS.length;
  const hours = (CAPTURES * mean) / 3_600_000;
  assert.ok(hours <= NIGHT_HOURS,
    `mean capture ~${(mean / 1000).toFixed(1)}s implies ~${hours.toFixed(1)}h for ${CAPTURES} captures `
    + `on one worker, over the ${NIGHT_HOURS}h budget — shrink SCALE_BUCKETS or cut the round trips per `
    + "sweep step, which is the term that dominates this figure");
});

test("a zero bucket survives, so page size stays a VARIABLE across the corpus", () => {
  // Every page the same size is its own defect: it makes size a constant the scorer can ignore, and
  // the whole reason for the rescale was that a corpus of uniformly tiny pages did not generalise.
  // Shrinking the ceiling must not collapse the range to one value.
  assert.ok(SCALE_BUCKETS.some((b) => elements(b) === 0), "no unfurnished bucket left");
  assert.ok(new Set(SCALE_BUCKETS.map(elements)).size >= 2, "all buckets are the same size");
});

test("buckets are ordered and non-negative, because the index is used round-robin", () => {
  // `SCALE_BUCKETS[index % length]` spreads sizes across cases, so a negative or NaN entry would
  // silently produce a page with no filler rather than failing.
  for (const b of SCALE_BUCKETS) {
    for (const key of ["links", "sections"] as const) {
      assert.ok(Number.isInteger(b[key]) && b[key] >= 0, `${JSON.stringify(b)}.${key} is not a count`);
    }
  }
  const sizes = SCALE_BUCKETS.map(elements);
  assert.deepEqual(sizes, [...sizes].sort((a, z) => a - z), "buckets must ascend, so the range is legible");
});
