/**
 * EVERY CRITERION THE MODEL IS GATED ON MUST HAVE HELD-OUT POSITIVES, AND NOTHING COMPARED THE TWO LISTS.
 *
 * `acceptance-matrix.mjs` declares its subtypes BY HAND and `case-matrix.mjs` declares the corpus's
 * separately. They are a fact stated twice, at the level of what this project can measure at all — and
 * they drifted the moment the corpus gained a subtype.
 *
 * **Measured cost, 2026-09-03/04.** The 29 language cases entered the corpus, a `3.1.2:language-unmarked`
 * head was trained, and the held-out set had ZERO examples of it. `evaluate-screenreader-acceptance.py`
 * refused the model it could not evaluate — correctly — with *"3.1.2: fewer than 3 acceptance
 * positives"*. That verdict arrives at stage 11 of a 13-stage pipeline, AFTER a full real-page capture,
 * an export, an acceptance recapture and a train. It cost two complete pipeline runs, and the second one
 * failed identically because regenerating the acceptance set cannot invent a subtype the matrix does not
 * declare.
 *
 * This asks the same question in milliseconds. It is the repo's third remedy for a forced duplication —
 * delete a copy, derive one from the other, or PIN THEM EQUAL — and the first two are unavailable here,
 * because the held-out cases must be DIFFERENT content from the corpus or they measure memorisation and
 * report it as generalisation.
 *
 * Counted per CRITERION rather than per subtype, because that is what the gate counts: `1.1.1` clears the
 * floor across three subtypes while none of them reaches it alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CASES } from "./case-matrix.mjs";
import { ALL_ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";
import { MODEL_EXCLUDED_SUBTYPES } from "./export-screenreader-dataset.mjs";

/** `--min-positive`'s default in `evaluate-screenreader-acceptance.py`. */
const MIN_POSITIVES = 3;

const OWNERSHIP = JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../../rule-ownership.json"), "utf8")) as
  { subtypes: Record<string, { decidedBy?: string }> };

const isRulesOwned = (subtype: string) => OWNERSHIP.subtypes[subtype]?.decidedBy === "rules";

/**
 * Criteria the model is actually gated on: those with at least one corpus subtype that is neither
 * rules-decided nor excluded from the export. A criterion decided entirely by rules needs no head, so it
 * needs no held-out positives either.
 */
function gatedCriteria(): string[] {
  const criteria = new Set<string>();
  for (const testCase of CASES as readonly { criterion?: string; subtype?: string }[]) {
    if (!testCase.criterion || !testCase.subtype) continue;
    const qualified = `${testCase.criterion}:${testCase.subtype}`;
    if (isRulesOwned(qualified)) continue;
    if ((MODEL_EXCLUDED_SUBTYPES as Set<string>).has(qualified)) continue;
    criteria.add(testCase.criterion);
  }
  return [...criteria].sort();
}

function acceptancePositivesByCriterion(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const testCase of ALL_ACCEPTANCE_CASES as readonly { criterion?: string }[]) {
    if (!testCase.criterion) continue;
    counts.set(testCase.criterion, (counts.get(testCase.criterion) ?? 0) + 1);
  }
  return counts;
}

test("every criterion the model is gated on has held-out positives", () => {
  const gated = gatedCriteria();
  assert.ok(gated.length > 5,
    `only ${gated.length} gated criteria found — the derivation broke and this guard examines nothing`);

  const held = acceptancePositivesByCriterion();
  const starved = gated
    .map((criterion) => ({ criterion, have: held.get(criterion) ?? 0 }))
    .filter(({ have }) => have < MIN_POSITIVES);

  assert.deepEqual(starved, [],
    "These criteria are decided by a trained head and have too few held-out positives:\n  "
    + starved.map(({ criterion, have }) => `${criterion}: ${have} (need ${MIN_POSITIVES})`).join("\n  ")
    + "\n\nThe acceptance gate REFUSES a model it cannot evaluate, and it does so at stage 11 of the"
    + "\npipeline — after a real-page capture, an export, an acceptance recapture and a train. Add cases"
    + "\nto `acceptance-matrix.mjs`, with DIFFERENT content from the corpus: these measure generalisation,"
    + "\nso a passage reused from `case-matrix.mjs` measures memorisation and reports it as success.");
});

/*
 * THE CONVERSE IS DELIBERATELY NOT ASSERTED, and the first version of this file got it wrong.
 *
 * It required every acceptance criterion to have a head, and reported 3.3.2, 3.3.3 and 4.1.2 as cases
 * that "measure nothing". Reading `evaluate-screenreader-acceptance.py` refutes that: a criterion whose
 * subtypes are all rules-decided is recorded `modelEvaluated: false` with the reason *"every subtype of
 * this criterion is decided by the authoritative deterministic rule layer"* and SKIPPED — not failed. Its
 * held-out pages are still captured and exported, and whether anything else reads them is a question I did
 * not answer.
 *
 * So the claim would have been an assertion of waste I had not established — the same shape as a comment
 * asserting a limit the code no longer has, which is the defect this session found five times. Better to
 * assert the one direction that is load-bearing: a head with no held-out positives stops a release.
 */
