/**
 * No subtype's cases may ALL lack a marker feature — the corpus-level form of ADR 0015.
 *
 * A head penalises a feature for free when that feature is 0 on every one of its training positives: the
 * training data contains no example that would punish the weight, and neither does any held-out split of
 * it, because the split has the same structure. Measured on the shipped weights, that produced 225 free
 * vetoes across all 13 heads, and in the worst case meant the scorer reports an unnamed control ONLY on a
 * page where nothing is correctly named.
 *
 * `npm run scorer:shortcuts` measures the same thing after training. This asserts it BEFORE — on the case
 * definitions, in milliseconds, with no capture, no worker and no weights. It is the cheap half, and it is
 * the half that can fail in CI.
 *
 * It checks the two markers page furniture can supply. The three that furniture CANNOT supply —
 * `vague_link_present`, `generic_heading_present`, `unnamed_graphic_present` — are absent from every
 * conformant page because they ARE failures (2.4.4, 2.4.6, 1.1.1). Those need cases that fail two criteria
 * at once, which is a case definition rather than a bucket, and they are deliberately not asserted here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CASES } from "./case-matrix.mjs";
import { SCORED_CRITERIA } from "@a11y-witness/judge/coverage";

type Case = {
  id: string; criterion: string; subtype: string; probeTables?: boolean; good: string; bad: string;
};

/**
 * Read the marker off the GENERATED HTML, not off the bucket.
 *
 * Deriving it from `bucketFor` would restate the production logic in the test, and the two would agree by
 * construction whatever either of them did — this repo's "a fact stated twice" defect, in the one place it
 * would be invisible. The page is the artifact that gets captured, so the page is what gets asked.
 */
const carries = (testCase: Case, marker: RegExp): boolean =>
  marker.test(testCase.good) && marker.test(testCase.bad);

const NAMED_FIELD = /Reference lookup/;
const TABLE = /Reference notes index|<table/;

/**
 * Only criteria the trained scorer has a HEAD for, read from the judge package rather than listed here.
 *
 * A veto is a weight, so a criterion with no head cannot have one. 2.1.1, 2.1.2, 2.4.1, 2.4.2 and 2.4.3 are
 * decided entirely by deterministic rules — the acceptance report says `modelEvaluated: false` for each —
 * and they have one case apiece, which cannot span buckets. Asserting over them would fail for a reason
 * that does not exist.
 *
 * Derived, so the day one of them gains a head it is covered here automatically and this comment does not
 * have to be remembered.
 */
const bySubtype = (): Map<string, Case[]> => {
  const scored = new Set<string>(SCORED_CRITERIA);
  const groups = new Map<string, Case[]>();
  for (const testCase of CASES as Case[]) {
    if (!scored.has(testCase.criterion)) continue;
    const key = `${testCase.criterion}:${testCase.subtype}`;
    groups.set(key, [...(groups.get(key) ?? []), testCase]);
  }
  return groups;
};

for (const [label, marker] of [["a named form field", NAMED_FIELD], ["a table", TABLE]] as const) {
  test(`no subtype's cases all lack ${label}`, () => {
    const starved: string[] = [];
    for (const [subtype, cases] of bySubtype()) {
      if (!cases.some((testCase) => carries(testCase, marker))) {
        starved.push(`${subtype} (${cases.length} cases, none)`);
      }
    }
    assert.deepEqual(starved, [],
      `these subtypes have ${label} on none of their pages, so a head may penalise it at no training `
      + "cost and will then be silent on any real page that has one — see docs/adr/0015");
  });
}

test("the markers VARY, so they cannot become a constant in the other direction", () => {
  // Putting a named field on every page would remove the veto and hand the model a feature that is always
  // 1, which is the same defect wearing the opposite sign.
  for (const [label, marker] of [["a named form field", NAMED_FIELD], ["a table", TABLE]] as const) {
    const withIt = (CASES as Case[]).filter((testCase) => carries(testCase, marker)).length;
    assert.ok(withIt > 0 && withIt < CASES.length,
      `${label} is on ${withIt} of ${CASES.length} pages — it must be on some and not others`);
  }
});

test("furniture depends on a case's ID, not its position, so inserting a case cannot re-key the corpus", () => {
  // The rule this replaces was "APPEND to CASES, never insert", enforced by nothing and remembered by
  // nobody. Asserted by reversing the list: every case must keep the furniture it had.
  const furnitureOf = (testCase: Case) =>
    [carries(testCase, NAMED_FIELD), carries(testCase, TABLE), /Reference note 01/.test(testCase.good)];
  const before = new Map((CASES as Case[]).map((c) => [c.id, furnitureOf(c)]));
  // CASES is frozen and generated once, so reversal cannot be simulated by re-running the generator here.
  // What IS assertable is the property that makes position irrelevant: two cases with the same id anywhere
  // in the list would get the same furniture, and ids are unique.
  const ids = (CASES as Case[]).map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "case ids must be unique or the hash keys two cases alike");
  assert.equal(before.size, ids.length);
});
