/**
 * #800 — DOES IKEA SERVE 265 FORM CONTROLS, OR IS THE SWEEP WALKING MORE THAN IS THERE?
 *
 * The row proposes comparing `formField.found` against the census's RAW `formControl` — never `distinct`,
 * because #737 established that `distinct` counts nameless elements as separate names and so inflates the
 * denominator the check rests on. The check is right and, on this page, it cannot decide the question.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CENSUS_KEY_FOR_SWEEP, populationVerdict, sweepAgainstCensus } from "./sweep-vs-census.mjs";
import fixture from "./fixtures-ikea-800.json" with { type: "json" };

const ratiosFor = (type: string) => fixture.captures
  .map((c) => sweepAgainstCensus(c.capture as never).find((r) => r.type === type)?.ratio ?? null);

/**
 * THE ANSWER, AND IT IS THE ROW'S SECOND BRANCH — but only once truncated sweeps are excluded.
 *
 * The first version of this test asserted `[0.45, 0.45, 2.27, 2.17, 2.12]` and called the type
 * `unstable`, reading the inversion as proof that the two numbers count different populations. **Three of
 * those five ratios came from sweeps that never finished**: the morning pair stopped `deadline/deadline`
 * and the 14:07 one stopped `cap/cap` at `MAX_SWEEP_STEPS`. A cut-off sweep reports a LOWER BOUND, and
 * dividing it by a real census produces a number that reads as coverage.
 *
 * Excluding them, every sweep that actually ended says the same thing.
 */
test("formField: NO verdict, because the two numbers describe different moments", () => {
  const ratios = ratiosFor("formField");
  assert.deepEqual(ratios.map((r) => r === null ? null : +r.toFixed(2)), [null, null, null, 2.17, 2.12]);
  assert.equal(populationVerdict(ratios), "not-simultaneous",
    "2.17 and 2.12 are real, and a verdict from them would compare a census at t=0 with a sweep at "
    + "t=300s that activated 64 controls while it walked");
});

/**
 * WHY THE MOMENT GATE IS NOT PEDANTRY — the nearest thing to a control in the set.
 *
 * `heading` carries no `onItem`, so nothing the tool does can change what it finds. It announces **80 on
 * every one of the five captures** while the census reports 83 in the morning and 69 in the afternoon.
 * A numerator that holds still under a denominator moving 17% is not that numerator's control, and on the
 * afternoon three the page gained at least eleven headings within the first hundred seconds.
 */
test("heading: found holds at 80 across a census that moves 83 -> 69", () => {
  const found = fixture.captures.map((c) =>
    sweepAgainstCensus(c.capture as never).find((r) => r.type === "heading")!.found);
  const present = fixture.captures.map((c) =>
    sweepAgainstCensus(c.capture as never).find((r) => r.type === "heading")!.present);
  assert.deepEqual(found, [80, 80, 80, 80, 80]);
  assert.deepEqual(present, [83, 83, 69, 69, 69]);
});

test("a verdict IS available once each capture says when its census was read", () => {
  // Not a placeholder: the gate opens on `readAtMs`, which no capture carries yet. This is the behaviour
  // the fix to `structureCensus.atMs` unlocks, pinned now so the gate cannot quietly become permanent.
  assert.equal(populationVerdict([2.17, 2.12], { censusReadAt: [400_000, 402_000] }), "sweep-exceeds");
  assert.equal(populationVerdict([0.96, 1.16], { censusReadAt: [100, 100] }), "agrees");
  assert.equal(populationVerdict([2.17, 2.12], { censusReadAt: [400_000, null] }), "not-simultaneous",
    "one capture without a read time is enough to disqualify the comparison");
});

test("the ratios excluded were sweeps that never ENDED, not sweeps that found little", () => {
  const perCapture = fixture.captures.map((c) =>
    sweepAgainstCensus(c.capture as never).find((r) => r.type === "formField")!);
  assert.deepEqual(perCapture.map((r) => r.completeness),
    ["truncated", "truncated", "truncated", "complete", "complete"]);
  // The morning pair really did find 100-101 against a census of 224 — a true number about a sweep that
  // ran out of time, and 0.45 read as "the sweep reaches under half of what is there".
  assert.equal(perCapture[0].found, 101);
  assert.equal(perCapture[0].ratio, null);
});

/**
 * AND THIS IS WHAT MAKES THAT MEAN ANYTHING. If every type disagreed, the census would simply be useless
 * and there would be no finding. `heading` and `landmark` agree on the SAME five captures.
 */
test("no type gets a verdict from the captures on disk, however clean its ratios look", () => {
  // `landmark` reads 0.86 on all five — the tightest agreement in the table — and still gets no verdict.
  // A gate that made an exception for the convincing-looking case would be no gate.
  for (const type of ["heading", "landmark", "formField", "graphic", "link"]) {
    assert.equal(populationVerdict(ratiosFor(type)), "not-simultaneous", `${type} was given a verdict`);
  }
});

test("the basis is stated as RAW, never left for the reader to assume", () => {
  const [row] = sweepAgainstCensus(fixture.captures[4].capture as never)
    .filter((r) => r.type === "formField");
  assert.equal(row.basis, "raw");
  assert.equal(row.present, 125, "the AX formControl count, not the distinct-name count");
  assert.equal(row.found, 265);
  assert.equal(row.completeness, "complete");
});

test("link has NO usable observation: three never ran and two were cut off", () => {
  // This is what the three-state check bought. `link` reads `0.00 0.00 0.13 0.12 0.00` raw; excluding the
  // sweeps that never started leaves 0.13 and 0.12, which look like a coverage finding — "the sweep
  // reaches an eighth of this page's links". Both are `deadline` stops that walked 78 and 74 trips before
  // the clock. **A lower bound is not a reach**, and reporting one as the other would have put a coverage
  // claim about IKEA into a row on the strength of two truncations.
  const perCapture = fixture.captures.map((c) =>
    sweepAgainstCensus(c.capture as never).find((r) => r.type === "link")!);
  assert.deepEqual(perCapture.map((r) => r.completeness),
    ["never-ran", "never-ran", "truncated", "truncated", "never-ran"]);
  assert.deepEqual(perCapture.map((r) => r.ratio), [null, null, null, null, null]);
  assert.equal(populationVerdict(ratiosFor("link")), "not-simultaneous");
});

test("a type with no census entry gets no invented denominator", () => {
  assert.equal(CENSUS_KEY_FOR_SWEEP.list, null);
  const list = sweepAgainstCensus(fixture.captures[4].capture as never).find((r) => r.type === "list")!;
  assert.equal(list.present, null);
  assert.equal(list.basis, "none");
  assert.equal(list.ratio, null);
});

test("fewer than two usable ratios is CANNOT SAY, never a verdict from one capture", () => {
  const moment = { censusReadAt: [1, 2, 3] };
  assert.equal(populationVerdict([1.9], moment), "cannot say");
  assert.equal(populationVerdict([null, null], moment), "cannot say");
  assert.equal(populationVerdict([], { censusReadAt: [] }), "cannot say");
});

test("consistent disagreement in one direction is reported as such", () => {
  // The two branches the row expected. They remain expressible — this is not a guard that answers
  // "unstable" to everything.
  const moment = { censusReadAt: [1, 2, 3] };
  assert.equal(populationVerdict([2.1, 2.3, 1.9], moment), "sweep-exceeds");
  assert.equal(populationVerdict([0.2, 0.4, 0.3], moment), "census-exceeds");
});

/** THE SAME ASSERTION AGAINST THE FILES — skips honestly when `runs/` is absent, as CI's is. */
test("the real captures on disk say what the fixture says", (t) => {
  const present = fixture.captures
    .map((c) => resolve(import.meta.dirname, "../../../..", c.source))
    .filter((p) => existsSync(p));
  if (present.length < fixture.captures.length) {
    t.skip(`needs all ${fixture.captures.length} IKEA captures under runs/witness — found ${present.length}`);
    return;
  }
  const fromDisk = present.map((p) =>
    sweepAgainstCensus(JSON.parse(readFileSync(p, "utf8")).capture).find((r) => r.type === "formField")?.ratio ?? null);
  assert.deepEqual(fromDisk, ratiosFor("formField"),
    "the fixture is a reduction and must not have changed the answer");
});
