import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ABSENCE_CRITERIA } from "@a11y-witness/judge/internal";

/**
 * THE DISCRIMINATIVE GATE'S RULES-OWNED SET, PINNED TO THE ONE DECLARATION — known-gaps §16.
 *
 * `ABSENCE_CRITERIA` decides which model findings `applyGate` drops so the deterministic rule's
 * authoritative one can stand. It was frozen at `["1.1.1", "4.1.2"]`, correct when the rules owned exactly
 * those two, and `rule-ownership.json` has declared seven more since. A model's 1.3.1 or 3.3.2 finding
 * therefore survived the gate and then SUPPRESSED the rule's, because `withRuleFindings` adds only rule
 * findings whose criterion the model did not already flag — the model's weaker finding beating the rule's
 * exact one, which inverts the ownership design.
 *
 * The judge package cannot import `rule-ownership.json`: the lab depends on the judge, not the reverse.
 * So the set is written out there and derived here, where both are visible. That is the third remedy for a
 * fact stated twice — pin them equal — and the same one `name-normalisation.test.ts` uses.
 */
const OWNERSHIP = join(import.meta.dirname, "../../rule-ownership.json");

interface Subtype { decidedBy?: string; reportsAs?: string }

/**
 * Criteria where a rule's finding SUBSTITUTES for the model's.
 *
 * Both halves are load-bearing, and `score.py` states the same test for the scorer's `ruleOwned`. The
 * rules must decide the subtype AND report it under that subtype's own criterion — one they decide but
 * report elsewhere must not be suppressed, or the model is silenced while nothing supplies a finding and
 * the criterion is decided by neither layer.
 */
function rulesOwnedCriteria(): Set<string> {
  const declared = JSON.parse(readFileSync(OWNERSHIP, "utf8")).subtypes as Record<string, Subtype>;
  const owned = new Set<string>();
  for (const [subtype, entry] of Object.entries(declared)) {
    const criterion = subtype.split(":")[0];
    if (entry.decidedBy === "rules" && entry.reportsAs === criterion) owned.add(criterion);
  }
  return owned;
}

test("the gate suppresses exactly the criteria the rules own and report as themselves", () => {
  const expected = [...rulesOwnedCriteria()].sort();
  // ANTI-VACUITY: an empty or near-empty derivation would make this pass having compared nothing, which
  // is the shape the gate itself was in.
  assert.ok(expected.length >= 5,
    `only ${expected.length} rules-owned criteria derived; rule-ownership.json has changed shape`);
  assert.deepEqual([...ABSENCE_CRITERIA].sort(), expected,
    "ABSENCE_CRITERIA has drifted from rule-ownership.json. A criterion the rules own and report as "
    + "themselves must be here, or the model's weaker finding survives and suppresses the rule's.");
});

test("a criterion declared OVERLAP is NOT suppressed", () => {
  // 2.4.4 is the case that makes widening to `RULE_CRITERIA` wrong: the rules cover a deliberate subset
  // and the head owns the rest, so dropping the model's finding discards the half nothing else supplies.
  const declared = JSON.parse(readFileSync(OWNERSHIP, "utf8")).subtypes as Record<string, Subtype>;
  const overlap = Object.entries(declared)
    .filter(([, entry]) => entry.decidedBy === "overlap")
    .map(([subtype]) => subtype.split(":")[0]);
  assert.ok(overlap.length > 0, "no overlap subtype is declared, so this test is examining nothing");
  for (const criterion of overlap) {
    assert.ok(!ABSENCE_CRITERIA.has(criterion),
      `${criterion} is declared overlap; suppressing the model's finding discards what the rules do not cover`);
  }
});

test("a subtype the rules report under ANOTHER criterion does not put that criterion in the set", () => {
  // The half of the test that is easy to drop. Nothing in the corpus is in this state today — every
  // rules-decided subtype reports as itself — so the property is asserted directly rather than left to a
  // fixture that does not exist. `score.py`'s own comment cites a stale example of it.
  const declared = JSON.parse(readFileSync(OWNERSHIP, "utf8")).subtypes as Record<string, Subtype>;
  const reportedElsewhere = Object.entries(declared)
    .filter(([subtype, entry]) => entry.decidedBy === "rules" && entry.reportsAs !== subtype.split(":")[0]);
  for (const [subtype, entry] of reportedElsewhere) {
    const criterion = subtype.split(":")[0];
    const alsoOwnedDirectly = Object.entries(declared).some(([other, e]) =>
      other.split(":")[0] === criterion && e.decidedBy === "rules" && e.reportsAs === criterion);
    if (alsoOwnedDirectly) continue;
    assert.ok(!ABSENCE_CRITERIA.has(criterion),
      `${subtype} is reported as ${entry.reportsAs}, so nothing supplies a ${criterion} finding if the `
      + "model's is suppressed");
  }
});
