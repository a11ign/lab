// @ts-check
/**
 * WHAT IS THE SWEEP TIME SPENT ON? — #659, and the question is NOT how to cut it.
 *
 * `sweep` is the largest phase on every real page measured and the only one that scales with the page:
 * 88.5 s, 104.5 s, 369.9 s, and 78.5% of IKEA's run on its own (#397). That is the case for LOOKING, and
 * it is not a case that the cost is reducible. `collectByType` walks the page by quick-navigation and
 * **that is how this tool sees structure at all**; the biggest phase is not evidence of waste.
 *
 * `worker:compare`'s own rule is what separates the two causes, and they need opposite work:
 *
 *   ms up with round-trips FLAT  -> each trip is slower           (a cost per step: a settle, a wait)
 *   round-trips UP               -> the sweep is walking more     (a cost per element: the page is bigger)
 *
 * **A TOTAL CANNOT ANSWER IT.** Eight sweep types share one `sweep` phase, and one of them (`formField`)
 * carried an activation costing 86-88% of its own time (#677) while the other seven did not. Summed, that
 * one type's behaviour is everybody's; split by type, it is visibly one type's. So this reports per TYPE
 * per PAGE and never a phase total -- the same reason `bench-capture` reports p50/p95 rather than a mean.
 *
 * REPLAY, NOT RE-RUN. Every capture already carries `prevMs`/`nextMs` and `prevTrips`/`nextTrips` on its
 * `sweep` marks; nothing new is instrumented here. #431 is what made the records exist to replay.
 */

/**
 * THE CAPTURE INSIDE A RECORD ON DISK — both shapes, not either.
 *
 * A dataset capture IS the capture; a `runs/witness/` record WRAPS it as `{capturedAt, task, capture}`,
 * and `runs/witness/` is what #659's own Region names. A reader handling only the top level reported
 * "No captures with diagnostics" over a directory holding 24 of them — **a tool describing an empty
 * population rather than refusing an unreadable one**, and an empty answer looks like a finding about the
 * data. Same rule `evidence-diff` already carries for its own two shapes.
 *
 * Lives here rather than in `bench-capture.mjs` so it can be tested without one: that script resolves
 * `datasetRoot()` at module scope, so anything importing it needs a corpus, and the acceptance classifier
 * refuses such a command on a runner that has none. The decision is pure; only the file walk is not.
 *
 * @param {any} record @returns {any | null}
 */
export function captureIn(record) {
  if (Array.isArray(record?.diagnostics)) return record;
  return Array.isArray(record?.capture?.diagnostics) ? record.capture : null;
}

/**
 * DID THIS SWEEP NEVER RUN? — the one place that decides it, for every reader.
 *
 * A starved sweep records `found: 0`, `ms: 0` and TWO round trips: the baseline speech-log read it makes
 * before checking the deadline. Every consumer that divides by it gets a number that looks like the
 * cheapest or the emptiest in the set — `0 ms/trip` here, `ratio 0.00` in `sweep-vs-census.mjs` — and a
 * second spelling of this predicate is how those two would drift apart.
 *
 * READ FROM THE STOP REASON, never inferred from `ms === 0` or `found === 0`: a sweep can legitimately be
 * quick, and a page can legitimately have none of a type. Only the sweep's own account of why it stopped
 * can say it never got to look.
 *
 * @param {any} mark a `sweep` diagnostic
 */
export function sweepNeverRan(mark) {
  const ms = (mark?.prevMs ?? 0) + (mark?.nextMs ?? 0);
  return [mark?.prevStop, mark?.nextStop].includes("deadline") && ms === 0;
}

/** A sweep mark that can be read: it names a type and did not fail. */
const isReadableSweep = (/** @type {any} */ mark) =>
  mark && typeof mark === "object" && mark.event === "sweep"
  && typeof mark.type === "string" && typeof mark.error !== "string";

/**
 * Per-type cost for ONE capture: how long, how many round trips, and the rate between them.
 *
 * `msPerTrip` is `null` when there were no trips, NEVER 0 and never Infinity. A sweep that never moved
 * has no rate, and rendering one as `0 ms/trip` would put the cheapest possible number on the case where
 * nothing was measured -- this repository's most-recorded shape, in a divisor.
 *
 * A SWEEP THAT NEVER RAN HAS NO RATE, and this is the first thing the replay found in its own output.
 * A starved sweep records `found: 0`, `ms: 0` and **two** round trips — the baseline speech-log read it
 * makes before checking the deadline — so a naive divisor produces `0 ms/trip`, which then reads as the
 * FASTEST sweep in the set and drags every spread it enters. Measured on IKEA, where five sweeps returned
 * `deadline` having examined nothing (#677). `examined: false` is that state, and it is the same
 * distinction one level in: the absence of a measurement is not the measurement zero.
 *
 * @param {readonly unknown[]} diagnostics
 * @returns {{ type: string, found: number, ms: number, trips: number, msPerTrip: number | null,
 *             examined: boolean }[]}
 */
export function sweepCostsOf(diagnostics) {
  return (Array.isArray(diagnostics) ? diagnostics : []).filter(isReadableSweep).map((mark) => {
    // BOTH DIRECTIONS SUMMED, because a sweep is one walk in two halves and either can dominate. The
    // per-direction split is still on the mark for anyone who needs it; the rate is a property of the walk.
    const ms = (mark.prevMs ?? 0) + (mark.nextMs ?? 0);
    const trips = (mark.prevTrips ?? 0) + (mark.nextTrips ?? 0);
    // READ FROM THE STOP REASON, not inferred from `ms === 0`. A sweep can legitimately be fast; only its
    // own account of why it stopped can say it never got to look. Both directions, because either can be
    // the one that was starved.
    const starved = sweepNeverRan(mark);
    return {
      type: mark.type,
      found: typeof mark.found === "number" ? mark.found : 0,
      ms, trips,
      msPerTrip: trips > 0 && !starved ? ms / trips : null,
      examined: !starved,
    };
  });
}

/**
 * One page's captures, reduced to a per-type rate — the unit #659 asks for.
 *
 * Captures are grouped by the URL the capture was ASKED for (`capture.url`), not by whatever document it
 * was served: #687 established those can differ, and the question here is about the cost of sweeping a
 * page rather than about which page it was. A run whose document drifted is still a run whose sweep cost
 * what it cost.
 *
 * @param {readonly { url?: string, diagnostics?: unknown[] }[]} captures
 * @returns {Map<string, Map<string, { type: string, page: string, runs: number, neverRan: number,
 *            ms: number[], trips: number[], msPerTrip: number[], found: number[] }>>}
 */
export function sweepCostsByPage(captures) {
  /** @type {Map<string, Map<string, any>>} */
  const pages = new Map();
  for (const capture of captures) {
    const page = typeof capture?.url === "string" ? capture.url : "(url unrecorded)";
    if (!pages.has(page)) pages.set(page, new Map());
    const byType = /** @type {Map<string, any>} */ (pages.get(page));
    for (const cost of sweepCostsOf(capture?.diagnostics ?? [])) {
      if (!byType.has(cost.type)) {
        byType.set(cost.type, {
          type: cost.type, page, runs: 0,
          // COUNTED, not dropped. A type whose rate rests on two runs out of six is a different claim
          // from one measured six times, and the reader cannot see that from the rate alone.
          neverRan: 0,
          ms: [], trips: [], msPerTrip: [], found: [],
        });
      }
      const acc = byType.get(cost.type);
      acc.runs += 1;
      if (!cost.examined) acc.neverRan += 1;
      acc.ms.push(cost.ms);
      acc.trips.push(cost.trips);
      acc.found.push(cost.found);
      // A capture with no trips contributes to `runs` and not to the rate. Pushing a placeholder would
      // make "we could not measure a rate" indistinguishable from "the rate was low".
      if (cost.msPerTrip !== null) acc.msPerTrip.push(cost.msPerTrip);
    }
  }
  return pages;
}

/** The middle value, or `null` for an empty set — an average of nothing is not zero. */
export function median(/** @type {readonly number[]} */ values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The spread of a type's per-trip rate ACROSS pages — which is what decides the row's question.
 *
 * If a type's rate is the same on a four-element page and a four-hundred-element one, its total is a
 * function of how much there is to walk, and the cost is what seeing the page costs. If the rate itself
 * climbs with the page, something per-step is scaling and THAT is where a reducible cost would be.
 *
 * `spread` is max/min rather than a variance: with three pages a variance is a number nobody can act on,
 * and "the slowest page's trips cost 8x the fastest page's" is a sentence somebody can.
 *
 * PAGES WITH TOO FEW TRIPS ARE EXCLUDED AND COUNTED, never silently dropped: a verdict resting on two of
 * six pages is a different claim from one resting on six, and `thin` is what lets a reader see which.
 *
 * @param {readonly { page: string, msPerTrip: number[], trips: number[] }[]} perPage
 * @returns {{ pages: number, thin: number, rates: number[], slowest: number | null,
 *             fastest: number | null, spread: number | null }}
 */
export function rateAcrossPages(perPage) {
  const thick = perPage.filter((p) => (median(p.trips) ?? 0) >= MIN_TRIPS_FOR_A_RATE);
  const rates = thick.map((p) => median(p.msPerTrip)).filter((r) => /** @type {number|null} */ (r) !== null);
  const numbers = /** @type {number[]} */ (rates);
  const slowest = numbers.length ? Math.max(...numbers) : null;
  const fastest = numbers.length ? Math.min(...numbers) : null;
  return {
    pages: thick.length, thin: perPage.length - thick.length, rates: numbers, slowest, fastest,
    // `null` when there is nothing to divide, and when the fastest rate is 0 — a spread of Infinity is
    // not a finding, it is a division nobody should have done.
    spread: slowest !== null && fastest ? slowest / fastest : null,
  };
}

/**
 * Fewer trips than this and a page's rate is noise, not a rate — measured, not chosen.
 *
 * Every non-`formField` sweep on disk, bucketed by how many trips it made:
 *
 *     trips    n   median ms/trip   min   max
 *      6-10   55        112          88   286
 *     10-20   18        145         120   349
 *     20-50   24        167         151   229
 *       50+   41        180         161   220
 *
 * The SPREAD is what decides the floor: at 6-10 trips the same sweep type ranges 88-286 ms/trip, and at
 * 20+ it ranges 151-229. A page whose heading sweep found ONE heading produced 345 ms/trip and would have
 * been read as the strongest per-step scaling in the set; the page with EIGHTY headings produced 180.
 * **The rate was highest where the sweep found the least**, which is the signature of a denominator too
 * small to divide by rather than of a cost that scales.
 *
 * Note what the medians also say, because it cuts against the obvious explanation: the rate RISES with
 * trip count (112 -> 180). A large fixed entry cost spread over few trips would make small sweeps look
 * SLOWER, and they look faster. So the floor is about variance, not about subtracting a constant.
 */
export const MIN_TRIPS_FOR_A_RATE = 20;

/** Above this, a type's per-trip rate is not the same rate on every page and something per-step scales. */
export const RATE_IS_FLAT_WITHIN = 2.5;

/**
 * THE WALK RATE — what a round trip costs when nothing but walking happens on it.
 *
 * `formField` is the only sweep carrying an `onItem`, so every other type's rate is the walk alone. Taking
 * their median gives a baseline, and the excess of any type over it is that type's non-walk component.
 *
 * This is what turns the table into an answer. Measured 2026-09-09 across six pages, every type without
 * an `onItem` sits at 146-220 ms/trip with a spread of 1.1-1.2 — and `formField` reads **190 ms/trip**
 * over 271 fields and 951 trips on a capture taken with `--probe-forms` OFF, where 3 of those 271
 * controls were eligible to activate. **That is the walk, unmixed**, and it lands on the walk rate.
 *
 * IT IS NOT EVIDENCE THAT ACTIVATION IS CHEAP, and the distinction is the whole of why the excess is
 * attributable. Where controls ANNOUNCE, an activation costs a round trip — 19 of them cost 2.1 s on
 * hubspot, 111 ms each. Where they stay SILENT it costs `STATE_WAIT_MS`, and those are the population
 * behind the 1,261 and 463 readings. So a carrier at the walk rate means its probe barely fired, never
 * that firing is free.
 *
 * So the walk is a constant, and the excess over it is an interaction probe rather than the cost of
 * seeing the page. That is #659's question answered in one number rather than in a paragraph.
 *
 * @param {readonly { type: string, msPerTrip: number[] }[]} perTypePerPage every page's rate, all types
 * @param {string} carrier the one type with an `onItem`, excluded from the baseline
 */
export function walkRate(perTypePerPage, carrier = "formField") {
  return median(perTypePerPage
    .filter((entry) => entry.type !== carrier)
    .map((entry) => median(entry.msPerTrip))
    .filter((rate) => /** @type {number|null} */ (rate) !== null));
}

/**
 * WHICH OF THE TWO CAUSES DOES THE DATA SUPPORT? — the row's acceptance 3, and "neither" is a real answer.
 *
 * `"per-element"` — the rate is flat across pages, so the total is trips x a constant. That is the sweep
 * walking more of a bigger page, and it is what seeing the page costs. Nothing to reduce without seeing
 * less.
 *
 * `"per-step"` — the rate itself climbs with the page. Something is scaling inside each step, and that is
 * where a reducible cost would live.
 *
 * `"cannot say"` — fewer than two pages carry a rate for this type. **The row asks for this answer
 * explicitly and it is not a failure to give it**; a verdict from one page is a verdict about one page.
 *
 * The threshold is named rather than inline, and 2.5 is a judgement: the seven non-`formField` types
 * measured 2026-09-09 span 94-218 ms/trip across three pages differing by an order of magnitude in size,
 * a spread of 2.3. A type that stays inside the range the CONSTANT-rate types occupy is not evidence of
 * scaling. Move it with a measurement, not an argument.
 *
 * @param {ReturnType<typeof rateAcrossPages>} rate
 * @returns {"per-element" | "per-step" | "cannot say"}
 */
export function costCause(rate) {
  if (rate.pages < 2 || rate.spread === null) return "cannot say";
  return rate.spread <= RATE_IS_FLAT_WITHIN ? "per-element" : "per-step";
}
