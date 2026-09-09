/**
 * #659 — IS THE SWEEP COST REDUCIBLE, OR IS IT WHAT SEEING THE PAGE COSTS?
 *
 * The row is explicit that it must NOT become a plan to make sweeps cheaper: `collectByType` walks the
 * page by quick-navigation and that is how this tool sees structure at all. The question is what the time
 * is SPENT on, and `worker:compare`'s rule separates the two causes — ms up with trips flat means each
 * trip is slower, trips up means the sweep is walking more.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  captureIn, costCause, MIN_TRIPS_FOR_A_RATE, median, rateAcrossPages, sweepCostsByPage, sweepCostsOf,
  walkRate,
} from "./sweep-costs.mjs";

const sweep = (over: Record<string, unknown>) => ({
  event: "sweep", type: "link", found: 40, prevMs: 3000, nextMs: 3000,
  prevTrips: 20, nextTrips: 20, prevStop: "exhausted", nextStop: "exhausted", ...over,
});

test("both directions are summed, because a sweep is one walk in two halves", () => {
  const [cost] = sweepCostsOf([sweep({ prevMs: 1000, nextMs: 3000, prevTrips: 5, nextTrips: 15 })]);
  assert.equal(cost.ms, 4000);
  assert.equal(cost.trips, 20);
  assert.equal(cost.msPerTrip, 200);
});

/**
 * THE DEFECT THIS TOOL FOUND IN ITS OWN FIRST OUTPUT.
 *
 * A starved sweep records `found: 0`, `ms: 0` and TWO round trips — the baseline speech-log read it makes
 * before checking the deadline. Divided naively that is `0 ms/trip`, which then reads as the FASTEST
 * sweep in the set and drags every spread it enters. It appeared on the first replay, on the IKEA capture
 * where five sweeps returned `deadline` having examined nothing.
 */
test("a sweep that never ran has no rate, and is not the fastest sweep in the set", () => {
  const [cost] = sweepCostsOf([sweep({
    type: "graphic", found: 0, prevMs: 0, nextMs: 0, prevTrips: 1, nextTrips: 1,
    prevStop: "deadline", nextStop: "deadline" })]);
  assert.equal(cost.examined, false);
  assert.equal(cost.msPerTrip, null, "0 ms/trip would be the cheapest number in the set for the case where nothing was measured");
  assert.equal(cost.trips, 2, "the trips are still recorded — they happened");
});

test("a genuinely fast sweep is not mistaken for a starved one", () => {
  // READ FROM THE STOP REASON, never inferred from `ms === 0`. A sweep can be legitimately quick; only
  // its own account of why it stopped can say it never got to look.
  const [cost] = sweepCostsOf([sweep({ prevMs: 0, nextMs: 90, prevTrips: 1, nextTrips: 1,
    prevStop: "exhausted", nextStop: "exhausted" })]);
  assert.equal(cost.examined, true);
  assert.equal(cost.msPerTrip, 45);
});

test("no trips at all is null, never zero", () => {
  const [cost] = sweepCostsOf([sweep({ prevTrips: 0, nextTrips: 0, prevMs: 0, nextMs: 0 })]);
  assert.equal(cost.msPerTrip, null);
});

test("a failed sweep mark is not a reading", () => {
  assert.deepEqual(sweepCostsOf([sweep({ error: "CDP listed no page target" })]), []);
  assert.deepEqual(sweepCostsOf([{ event: "structureCensus", heading: 4 }]), []);
});

test("captures group by the page ASKED for, and starved runs are counted rather than dropped", () => {
  const pages = sweepCostsByPage([
    { url: "https://a.example/", diagnostics: [sweep({})] },
    { url: "https://a.example/", diagnostics: [sweep({ prevMs: 0, nextMs: 0, prevStop: "deadline" })] },
    { url: "https://b.example/", diagnostics: [sweep({})] },
  ]);
  assert.deepEqual([...pages.keys()], ["https://a.example/", "https://b.example/"]);
  const a = pages.get("https://a.example/")!.get("link")!;
  assert.equal(a.runs, 2, "both runs counted");
  assert.equal(a.neverRan, 1, "a verdict resting on one run of two is a different claim from one resting on two");
  assert.equal(a.msPerTrip.length, 1, "only the run that actually swept contributes a rate");
});

test("the median of nothing is null — an average of no observations is not zero", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 3]), 2);
  assert.equal(median([3, 1, 2]), 2);
});

/**
 * THE FLOOR CHANGED A VERDICT, which is why it is measured rather than chosen.
 *
 * Before it, `heading` read `spread 3.1 -> per-step` on the strength of one page whose heading sweep found
 * ONE heading and reported 345 ms/trip. The page with EIGHTY headings reported 180. **The rate was highest
 * where the sweep found the least** — a denominator too small to divide by, not a cost that scales. With
 * the floor, `heading` reads `spread 1.1 -> per-element`.
 */
test("a page whose sweep barely moved cannot set the verdict", () => {
  const page = (name: string, trips: number, ms: number) =>
    ({ page: name, trips: [trips], msPerTrip: [ms / trips] });
  const withNoise = rateAcrossPages([
    page("big", 100, 18_000),      // 180 ms/trip
    page("also-big", 80, 13_840),  // 173 ms/trip
    page("one-heading", 4, 1_380), // 345 ms/trip, on a sweep that found one thing
  ]);
  assert.equal(withNoise.pages, 2, "the thin page is excluded from the comparison");
  assert.equal(withNoise.thin, 1, "and COUNTED, so a reader can see the verdict rests on two of three");
  assert.ok(withNoise.spread! < 1.2);
  assert.equal(costCause(withNoise), "per-element");
});

test("the floor is a real threshold, not decoration", () => {
  const thin = rateAcrossPages([
    { page: "a", trips: [MIN_TRIPS_FOR_A_RATE - 1], msPerTrip: [100] },
    { page: "b", trips: [MIN_TRIPS_FOR_A_RATE - 1], msPerTrip: [900] },
  ]);
  assert.equal(thin.pages, 0);
  assert.equal(costCause(thin), "cannot say",
    "two pages of noise must not produce a 9x per-step verdict");
});

test("a rate that climbs with the page is per-step, and that is where a reducible cost would live", () => {
  // `formField` measured 222 / 1261 / 323 / 463 ms/trip across four pages — spread 5.7 — because it is
  // the only sweep carrying an `onItem`, and that activation is 86-88% of its time (#677).
  const rate = rateAcrossPages([
    { page: "small", trips: [40], msPerTrip: [222] },
    { page: "large", trips: [200], msPerTrip: [1261] },
  ]);
  assert.equal(costCause(rate), "per-step");
});

test("one page is CANNOT SAY, and the row asks for that answer explicitly", () => {
  // A verdict from one page is a verdict about one page. #659's own acceptance: "state which of the two
  // causes the data supports, or that it supports neither -- 'neither' is a real and useful answer here."
  const one = rateAcrossPages([{ page: "only", trips: [100], msPerTrip: [180] }]);
  assert.equal(one.pages, 1);
  assert.equal(costCause(one), "cannot say");
  assert.equal(costCause(rateAcrossPages([])), "cannot say");
});

/**
 * #659's ANSWER IN ONE NUMBER. Every sweep type but `formField` walks and does nothing else, so their
 * median rate is what a round trip costs. The excess of any type over it is that type's non-walk work.
 */
test("the walk rate is taken from the types that only walk", () => {
  const rate = walkRate([
    { type: "heading", msPerTrip: [173, 180] },
    { type: "link", msPerTrip: [178, 189] },
    { type: "graphic", msPerTrip: [162, 174] },
    { type: "formField", msPerTrip: [1261] },
  ]);
  assert.ok(rate !== null && rate > 150 && rate < 200,
    `the carrier's 1,261 must not enter the baseline it is measured against; got ${rate}`);
});

test("the carrier's own rate is the walk PLUS its probe, and the two are separable", () => {
  // Measured: IKEA at 14:15Z ran `formField` at 190 ms/trip over 951 trips with 271 fields — the same
  // rate as every walking-only sweep. Its 1,261 elsewhere is the activation firing on silent controls at
  // up to STATE_WAIT_MS each, not a walk that got slower. So a high carrier rate is a probe finding, and
  // a carrier rate AT the walk rate says the probe cost nothing on that page.
  const baseline = walkRate([
    { type: "heading", msPerTrip: [180] }, { type: "link", msPerTrip: [184] },
    { type: "formField", msPerTrip: [190] },
  ])!;
  assert.ok(Math.abs(190 - baseline) < 15, "IKEA's formField walked at the walk rate — no probe cost that run");
});

test("with nothing but the carrier there is no baseline, and null says so", () => {
  assert.equal(walkRate([{ type: "formField", msPerTrip: [1261] }]), null);
  assert.equal(walkRate([]), null);
});

/**
 * BOTH RECORD SHAPES, and reading one reported an empty population over a full directory.
 *
 * `bench-capture --from-disk` handled only the bare dataset shape, so pointing it at `runs/witness` —
 * the directory #659's own Region names — printed "No captures with diagnostics" over 24 of them.
 */
test("a wrapped witness record and a bare dataset capture both yield their capture", () => {
  const diagnostics = [{ event: "sweep", type: "link", found: 1 }];
  assert.equal(captureIn({ url: "https://bare/", diagnostics })?.url, "https://bare/");
  assert.equal(captureIn({ capturedAt: "t", task: "x", capture: { url: "https://wrapped/", diagnostics } })?.url,
    "https://wrapped/");
});

test("a record with no diagnostics either way is null, not an empty capture", () => {
  // `null` so the caller SKIPS it. An empty capture would be counted into the population and reported as
  // a run that found nothing, which is the same conflation one level up.
  assert.equal(captureIn({ url: "https://x/" }), null);
  assert.equal(captureIn({ capture: { url: "https://x/" } }), null);
  assert.equal(captureIn(null), null);
  assert.equal(captureIn({ diagnostics: "not an array" }), null);
});
