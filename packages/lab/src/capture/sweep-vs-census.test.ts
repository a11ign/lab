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
 * THE ANSWER, AND IT IS THE ROW'S THIRD OPTION. Five captures of one URL, one day, every one
 * `targetMatch: matched` with no navigation — and the comparison changes SIGN.
 */
test("formField: the ratio inverts across captures of the same page, so neither branch is supported", () => {
  const ratios = ratiosFor("formField");
  assert.deepEqual(ratios.map((r) => r && +r.toFixed(2)), [0.45, 0.45, 2.27, 2.17, 2.12]);
  assert.equal(populationVerdict(ratios), "unstable",
    "a denominator whose comparison changes sign is not measuring the numerator's population");
});

/**
 * AND THIS IS WHAT MAKES THAT MEAN ANYTHING. If every type disagreed, the census would simply be useless
 * and there would be no finding. `heading` and `landmark` agree on the SAME five captures.
 */
test("heading and landmark agree on the same captures, so the census is not useless in general", () => {
  assert.equal(populationVerdict(ratiosFor("heading")), "agrees");
  assert.equal(populationVerdict(ratiosFor("landmark")), "agrees");
});

test("the basis is stated as RAW, never left for the reader to assume", () => {
  const [row] = sweepAgainstCensus(fixture.captures[4].capture as never)
    .filter((r) => r.type === "formField");
  assert.equal(row.basis, "raw");
  assert.equal(row.present, 125, "the AX formControl count, not the distinct-name count");
  assert.equal(row.found, 265);
});

test("a sweep that never ran has no ratio, and is not a sweep that found almost nothing", () => {
  // The same defect `sweep-costs.mjs` found in its own first output, in a different divisor: a starved
  // sweep reports `found: 0`, which over a real census is 0.00 and reads as catastrophic coverage. On
  // these captures `link` reads 0.00, 0.00, 0.13, 0.12, 0.00 and three of those five are deadline stops.
  const link = sweepAgainstCensus(fixture.captures[0].capture as never).find((r) => r.type === "link")!;
  assert.equal(link.neverRan, true);
  assert.equal(link.ratio, null, "0.00 would be a real number about a sweep that never looked");
  assert.deepEqual(ratiosFor("link").filter((r) => r !== null).length, 2, "only the two that ran");
});

test("a type with no census entry gets no invented denominator", () => {
  assert.equal(CENSUS_KEY_FOR_SWEEP.list, null);
  const list = sweepAgainstCensus(fixture.captures[4].capture as never).find((r) => r.type === "list")!;
  assert.equal(list.present, null);
  assert.equal(list.basis, "none");
  assert.equal(list.ratio, null);
});

test("fewer than two usable ratios is CANNOT SAY, never a verdict from one capture", () => {
  assert.equal(populationVerdict([1.9]), "cannot say");
  assert.equal(populationVerdict([null, null]), "cannot say");
  assert.equal(populationVerdict([]), "cannot say");
});

test("consistent disagreement in one direction is reported as such", () => {
  // The two branches the row expected. They remain expressible — this is not a guard that answers
  // "unstable" to everything.
  assert.equal(populationVerdict([2.1, 2.3, 1.9]), "sweep-exceeds");
  assert.equal(populationVerdict([0.2, 0.4, 0.3]), "census-exceeds");
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
