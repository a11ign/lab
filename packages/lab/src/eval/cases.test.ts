/**
 * The eval cases ARE the judge's quality claim, so a broken case definition is a broken measurement.
 *
 * `npm run eval` reports recall and false positives over these cases, and `RELEASE.md` quotes those numbers. A
 * case pointing at a fixture that does not exist, or expecting a criterion that is not in WCAG 2.2 AA, does not
 * fail loudly — it quietly changes the denominator of the headline number. That is a check examining nothing,
 * applied to the measurement itself.
 *
 * Writing this found exactly that: two cases whose fixtures were never captured. It also corrected two wrong
 * assumptions of mine about the conventions, both recorded below, because the wrong readings are the tempting
 * ones.
 *
 * Pure data assertions — no model, no venv, no worker, milliseconds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { EVAL_CASES } from "./cases.js";
import { WCAG_22_AA } from "@a11y-witness/evidence/wcag";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const criteria = new Set(WCAG_22_AA.map((c) => c.num));

/** Added with their fixtures deferred — `layout-table` was never captured. See the test below. */
const DEFERRED_FIXTURES = new Set(["book-layout-table-good", "book-layout-table-bad"]);

test("there are cases at all, and the scan is not silently empty", () => {
  // Guard the guard: an empty list makes every assertion below vacuously true, and `npm run eval` would report
  // a perfect score over nothing.
  assert.ok(EVAL_CASES.length >= 30, `expected the full eval set, got ${EVAL_CASES.length}`);
});

test("every case points at a fixture that exists, except the known deferred ones", () => {
  // A real gap, listed rather than hidden: `npm run eval` scores 32 of 34 cases and reports recall over the
  // smaller denominator while the case list still says 34. Capture the two fixtures and delete DEFERRED_FIXTURES.
  const missing = EVAL_CASES.filter((c) => !existsSync(join(repoRoot, c.fixture)));
  const unexpected = missing.filter((c) => !DEFERRED_FIXTURES.has(c.id)).map((c) => `${c.id} -> ${c.fixture}`);
  assert.deepEqual(unexpected, [], `fixture(s) not on disk:\n  ${unexpected.join("\n  ")}`);
  // The gap must not grow silently, and must not close without this note being removed.
  assert.equal(missing.length, DEFERRED_FIXTURES.size,
    `the deferred-fixture list is stale: ${missing.length} missing, ${DEFERRED_FIXTURES.size} recorded`);
});

test("case ids are unique", () => {
  // Duplicates silently overwrite each other in per-id reporting, so a case can vanish from the results while
  // still appearing in the list.
  const seen = new Map<string, number>();
  for (const c of EVAL_CASES) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
  assert.deepEqual([...seen].filter(([, n]) => n > 1).map(([id]) => id), []);
});

test("every expected criterion is a real WCAG 2.2 AA criterion", () => {
  // A typo'd criterion can never be matched, so the case is a permanent miss and drags recall down for a reason
  // that has nothing to do with the judge.
  const unknown = EVAL_CASES.flatMap((c) =>
    (c.expect ?? []).filter((num) => !criteria.has(num)).map((num) => `${c.id} expects ${num}`));
  assert.deepEqual(unknown, []);
});

test("every allowed criterion is real too", () => {
  // A typo here silently stops suppressing, which surfaces as a mysterious false positive rather than as a bad
  // case definition.
  const unknown = EVAL_CASES.flatMap((c) =>
    (c.allow ?? []).filter((num) => !criteria.has(num)).map((num) => `${c.id} allows ${num}`));
  assert.deepEqual(unknown, []);
});

test("allow is a SUPERSET of expect, which is what makes it a suppression list", () => {
  // My first version asserted that a case must never both expect and allow the same criterion. That was wrong
  // about the semantics: `allow` lists everything that may appear without counting as a false positive, so it
  // naturally includes the expected ones. Recorded because the wrong reading looks like a contradiction.
  for (const c of EVAL_CASES) {
    const allowed = new Set(c.allow ?? []);
    if (allowed.size === 0) continue;
    const notAllowed = (c.expect ?? []).filter((num) => !allowed.has(num));
    assert.deepEqual(notAllowed, [],
      `${c.id} expects ${notAllowed.join(",")} without allowing it, so finding it would score as a catch AND a `
      + "false positive");
  }
});

test("a conformant case allows nothing, because anything found on it IS a false positive", () => {
  // Conformance is defined by an empty `expect`, NOT by the id — my other wrong guess: `w3c-bad-after` and
  // `w3c-wai-home` are both conformant and neither matches a `-good` pattern. An allow list on a conformant case
  // would suppress the very findings it exists to measure.
  const conformant = EVAL_CASES.filter((c) => (c.expect ?? []).length === 0);
  assert.ok(conformant.length >= 5, `only ${conformant.length} conformant case(s)`);
  for (const c of conformant) {
    assert.equal((c.allow ?? []).length, 0, `${c.id} expects nothing, so an allow list hides false positives`);
  }
});

test("every case carries a task, because the judge is asked whether the task is completable", () => {
  assert.deepEqual(EVAL_CASES.filter((c) => !c.task?.trim()).map((c) => c.id), []);
});

test("both halves of the set are represented", () => {
  // Recall with no conformant cases cannot see false positives; false positives with no failure cases cannot see
  // recall. RELEASE.md quotes both, so both have to exist.
  const conformant = EVAL_CASES.filter((c) => (c.expect ?? []).length === 0).length;
  assert.ok(conformant >= 5, `only ${conformant} conformant case(s); false positives under-measured`);
  assert.ok(EVAL_CASES.length - conformant >= 10, "too few failure cases to measure recall meaningfully");
});
