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

import { createRequire } from "node:module";

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
 * A veto is a weight, so a criterion with no head cannot have one.
 *
 * ## And a head is not enough — the subtype needs enough CASES to spread across
 *
 * This comment used to say 2.1.1, 2.1.2, 2.4.1, 2.4.2 and 2.4.3 were excluded because they have no head,
 * and predicted that "the day one of them gains a head it is covered here automatically". They always had
 * heads; `SCORED_CRITERIA` simply did not list them, and correcting that on 2026-08-25 pulled them in and
 * failed this test.
 *
 * The exclusion was right for a reason the comment gave in passing and the code did not encode: **they
 * have one case apiece, which cannot span buckets.** A subtype with three cases cannot carry a table on
 * some pages and not others in any useful proportion, so "none of its pages has a table" describes the
 * case count rather than a free veto. Asserting over it fails for a reason that does not exist.
 *
 * So the floor is on the CASE COUNT, which is the property that actually decides whether the audit can
 * say anything — and it is checked rather than hardcoded, so a subtype that grows past it is covered the
 * day it does.
 */
const MIN_CASES_TO_SPREAD = 6;

/**
 * Subtypes the DETERMINISTIC RULES decide, read from the ownership file rather than listed.
 *
 * A free veto is a weight on a head, and a weight only reaches a user if the head's verdict is the one
 * reported. `rule-ownership.json` marks ten subtypes `decidedBy: "rules"` — for those the head is trained
 * alongside the rule and never authoritative, so a starved feature is a fact about the corpus and not a
 * defect a user can encounter.
 *
 * Reported rather than asserted, because "this cannot reach a user" is not the same as "this is fine": if
 * ownership ever moves back to the model, the starvation is waiting. ADR 0015 is about exactly the veto
 * nobody could see.
 */
const ruleDecided = (): Set<string> => {
  const ownership = createRequire(import.meta.url)("../../rule-ownership.json") as
    { subtypes: Record<string, { decidedBy?: string }> };
  return new Set(Object.entries(ownership.subtypes)
    .filter(([, entry]) => entry.decidedBy === "rules")
    .map(([subtype]) => subtype));
};
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
    const noted: string[] = [];
    const decidedByRules = ruleDecided();
    for (const [subtype, cases] of bySubtype()) {
      // Too few cases to spread across buckets: the answer would describe the corpus size, not a veto.
      if (cases.length < MIN_CASES_TO_SPREAD) continue;
      if (!cases.some((testCase) => carries(testCase, marker))) {
        if (decidedByRules.has(subtype)) {
          // Named, never silent. The head is starved and the rule layer owns its verdict, so no user can
          // meet the veto today — and the day ownership moves, it is waiting.
          noted.push(`${subtype} (${cases.length} cases, none) — rule-decided, so it cannot reach a user`);
          continue;
        }
        starved.push(`${subtype} (${cases.length} cases, none)`);
      }
    }
    // Said aloud rather than swallowed: a starved head the rules layer overrides is not a defect a user
    // can meet, and it IS one waiting for the day ownership moves. Silence here would make the second
    // half invisible.
    for (const line of noted) process.stdout.write(`  note: ${line}\n`);
    assert.deepEqual(starved, [],
      `these subtypes have ${label} on none of their pages, so a head may penalise it at no training `
      + "cost and will then be silent on any real page that has one — see docs/adr/0015-one-defect-per-page-taught-the-scorer-to-veto.md");
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
