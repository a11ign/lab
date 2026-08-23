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
 * The cost model. THIS is the single source for these numbers — `case-matrix.mjs` used to restate them
 * and went stale within the hour, so it now points here instead.
 *
 * A bucket's element count is links + sections + one list item per link: the filler's actual shape, not
 * just its link count, which is the mistake that made 14 links look cheap.
 *
 * CORRECTED after regenerating the pages and timing them. The first version of this file used
 * `BASELINE_MS = 12_400`, taken from CLAUDE.md's documented per-capture figure — and that figure was
 * measured on a different host state, so the model it produced **underestimated reality by ~55%** and
 * this test passed against it. A test asserting on a model nobody checked against a measurement is the
 * count-based check in a new costume: it reports affordability it has not observed.
 *
 * Measured on THIS host, deployed code, pages regenerated from the two buckets below:
 *
 *   bucket {0, 0}  ->  28.1 s   (predicted 12.4 s)
 *   bucket {6, 4}  ->  37.2 s   (predicted 21 s)
 *
 * So the baseline is the dominant term, not the per-element cost, which is the opposite of what the
 * five-bucket data suggested — and it means shrinking pages alone cannot buy affordability. Quote the
 * host state with any of these, per this repo's own rule.
 */
const BASELINE_MS = 28_100;
const MS_PER_ELEMENT = 570; // (37_200 - 28_100) / 16 elements in {6, 4}
const CAPTURE_BUDGET_MS = 120_000; // DEFAULT_BUDGET_MS in capture-core.mjs

/**
 * ADR 0015's cross-criterion furniture costs capture time too, and it must be in the model or the night
 * budget below is measuring a page that no longer exists.
 *
 * MEASURED over all 2,122 captures in the corpus, by median total capture time with and without each
 * feature — not estimated from element counts, which is what the first version of this did and what the
 * comment above the baseline warns against:
 *
 *   a form field     1,032 captures  31.5 s   vs  1,090 without  27.8 s   ->  +3.7 s
 *   a disclosure       144 captures  32.5 s   vs  1,978 without  28.6 s   ->  +3.9 s
 *   a table            122 captures  36.5 s   vs  2,000 without  28.6 s   ->  +7.9 s
 *
 * Charged as milliseconds rather than as fake "elements": these are a sweep and a probe activation, not
 * more list items, and converting them into an element count would hide that behind a number whose unit
 * does not apply. The table is the expensive one — the table sweep walks cells — and it is why the table
 * bucket is the largest.
 *
 * CONFOUNDED, and worth stating: the captures carrying each feature are that feature's own CASES, which
 * differ in other ways too. So these are upper bounds on what furniture adds, which is the safe direction
 * for a budget. Re-measure from the first run that carries the furniture itself.
 */
const NAMED_FIELD_MS = 3_700;
const DISCLOSURE_MS = 3_900;
const DATA_TABLE_MS = 7_900;

type Bucket = { links: number; sections: number; namedField?: boolean; dataTable?: boolean;
  disclosure?: boolean };
const elements = (b: Bucket) => b.links * 2 + b.sections;
const furnitureMs = (b: Bucket) => (b.namedField ? NAMED_FIELD_MS : 0)
  + (b.dataTable ? DATA_TABLE_MS : 0) + (b.disclosure ? DISCLOSURE_MS : 0);
const captureMs = (b: Bucket) => BASELINE_MS + MS_PER_ELEMENT * elements(b) + furnitureMs(b);

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

test("a full recapture of the bulk corpus fits one night on the pool we can actually run", () => {
  // The affordability rule, and the reason the top two buckets went. A 33-hour feedback loop does not
  // get run — so in practice it means shipping evidence nobody revalidated, which is worse than a
  // smaller corpus. 1,061 pairs is 2,122 captures; 848 need recapturing today.
  //
  // Stated honestly, because the measured baseline is worse than the model was: at ~32.6 s mean this is
  // ~15.4 h on ONE worker, which does NOT fit a night. It fits on two. Two is the ceiling worth using —
  // three guests over-commit a 36 GB host into swap, which is the documented way to starve workers — and
  // two measured 1.90x. So the pool is part of the affordability claim and is named here rather than
  // hidden in a comfortable single-worker number.
  const CAPTURES = 2_612; // 1,306 pairs, after the multi-defect family grew to 240 (ADR 0015)
  const NIGHT_HOURS = 12;
  // MEASURED on the bare-metal fleet, 2026-08-22, not inferred: a full recapture moved 855 captures across
  // four workers in about 193 minutes — 4.43 captures/minute against 1.56 for a single worker at the 38.5 s
  // mean below, so 2.84x. The old 1.9 was two UTM guests sharing one Mac, which is a different machine and
  // a different constraint (that host swapped at three guests; these are separate boxes).
  //
  // Quote the fleet with this number. It is four bare-metal workers on real Ethernet, and it does not
  // transfer to a laptop running VMs.
  const WORKERS_SCALING = 2.84;
  const mean = SCALE_BUCKETS.reduce((sum, b) => sum + captureMs(b), 0) / SCALE_BUCKETS.length;
  const oneWorkerHours = (CAPTURES * mean) / 3_600_000;
  const hours = oneWorkerHours / WORKERS_SCALING;
  assert.ok(hours <= NIGHT_HOURS,
    `mean capture ~${(mean / 1000).toFixed(1)}s implies ~${oneWorkerHours.toFixed(1)}h on one worker and `
    + `~${hours.toFixed(1)}h on two, over the ${NIGHT_HOURS}h budget — shrink SCALE_BUCKETS, or cut the `
    + "round trips per sweep step, which is now the only lever big enough to matter");
});

test("a zero bucket survives, so page size stays a VARIABLE across the corpus", () => {
  // Every page the same size is its own defect: it makes size a constant the scorer can ignore, and
  // the whole reason for the rescale was that a corpus of uniformly tiny pages did not generalise.
  // Shrinking the ceiling must not collapse the range to one value.
  assert.ok(SCALE_BUCKETS.some((b) => elements(b) === 0), "no unfurnished bucket left");
  assert.ok(new Set(SCALE_BUCKETS.map(elements)).size >= 2, "all buckets are the same size");
});

test("buckets are ordered and non-negative, because one is chosen per case by hash", () => {
  // `bucketFor(id)` picks one, so a negative or NaN entry would silently produce a page with no filler
  // rather than failing. (It was `SCALE_BUCKETS[index % length]`; keying on the array position meant
  // inserting a case re-sized every case after it — see `withRealisticScale`.)
  for (const b of SCALE_BUCKETS) {
    for (const key of ["links", "sections"] as const) {
      assert.ok(Number.isInteger(b[key]) && b[key] >= 0, `${JSON.stringify(b)}.${key} is not a count`);
    }
  }
  // Ordered by what a capture COSTS, not by element count: the furniture pieces are milliseconds rather
  // than elements, so an element-ordered list would read as ascending while the real costs interleave.
  const costs = SCALE_BUCKETS.map(captureMs);
  assert.deepEqual(costs, [...costs].sort((a, z) => a - z),
    "buckets must ascend in capture cost, so the range is legible");
  // The furniture markers are the point of the last two buckets. A bucket list that lost them would still
  // pass every size assertion above while quietly restoring the correlation ADR 0015 exists to break.
  assert.ok(SCALE_BUCKETS.some((b) => b.namedField), "no bucket carries a named form field");
  assert.ok(SCALE_BUCKETS.some((b) => b.dataTable), "no bucket carries a data table");
  assert.ok(SCALE_BUCKETS.some((b) => b.disclosure), "no bucket carries a disclosure");
});
