/**
 * EVERY BUILDER OF A TRAINING RECORD MUST EMIT `observation` BESIDE `input`.
 *
 * `observation` carries which questions the capture actually put, and the featurizer crosses two channels with
 * it. Its failure mode is the worst kind: **absent and `asked: false` are the same row by design**, so a builder
 * that never learned about the field produces records that are structurally valid, featurize cleanly, and quietly
 * say "nobody looked" about every capture it made. It was missed at two of four sites within an hour of being
 * written, and neither miss was careless.
 *
 * Moved from the core's `record-builders.test.ts` (ADR 0045 cut 1), whose discovery walked `packages/` and so
 * reached the three lab builders through the core's `packages/lab/` path. The fourth builder is the product's
 * live scorer (`score.py`, `@a11ign/scorer`), which is the core's file: that half stays in the core's test.
 * Builders are DISCOVERED rather than listed, because a hand-kept list of call sites is one more copy of the
 * fact it is checking.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { LAB_ROOT, labSources } from "./lab-sources.ts";

/** The corpus export, the realism tier and the multi-defect composer: fewer found means the matcher went blind. */
const MIN_BUILDERS = 3;

/** A file that constructs a training record: an `input:`/`"input":` key paired with `target: {`, which every record carries. */
function recordBuilders(): string[] {
  return labSources(/\.(ts|mjs|py)$/)
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      return /(^|\s)("input"|input):/m.test(text) && /(^|\s)("target"|target):\s*\{/m.test(text);
    })
    .map((file) => relative(LAB_ROOT, file))
    .filter((file) => !(file in NOT_A_BUILDER));
}

/**
 * Files the matcher reaches that do not CONSTRUCT a record, each with the reason. Classified rather than
 * pattern-excluded, because "nothing needs this" and "somebody forgot" must stay different states.
 */
const NOT_A_BUILDER: Readonly<Record<string, string>> = {
  "scripts/score-rules.ts":
    "declares the record's TYPE (`interface Record_`) to read an exported corpus; it constructs nothing. "
    + "It also reads `ruleEvidence`, the other sibling of `input`, but as a consumer.",
};

test("every lab training-record builder emits `observation` beside `input`", () => {
  const builders = recordBuilders();
  // Mutation-safety: a matcher that finds nothing would pass having examined nothing, which is the exact
  // failure mode of the field it is guarding.
  assert.ok(builders.length >= MIN_BUILDERS,
    `found only ${builders.length} record builder(s); the matcher went blind. Expected the corpus export, `
    + "the realism tier and the multi-defect composer.");

  const silent = builders.filter((file) =>
    !/(^|\s)("observation"|observation):/m.test(readFileSync(`${LAB_ROOT}/${file}`, "utf8")));
  assert.deepEqual(silent, [],
    "These build a training record and never set `observation`:\n  " + silent.join("\n  ")
    + "\n\nAbsent and `asked: false` are the SAME row for the featurizer, so such a record says 'nobody"
    + "\nlooked' about every capture and nothing downstream can tell that from the truth. Import"
    + "\n`observationOf` from @a11ign/scorer/evidence-units rather than writing a second spelling.");
});

test("the lab builders discovered are the ones we think", () => {
  // Named so that a NEW builder is a visible change to this list rather than a silent pass, and so that a
  // builder that disappears is noticed. It is an assertion about coverage, not about correctness.
  assert.deepEqual(recordBuilders(), [
    "scripts/build-realism-tier.ts",
    "scripts/compose-multi-defect-probe.py",
    "src/training/export-screenreader-dataset.mjs",
  ], "the set of lab training-record builders changed: confirm the new one sets `observation`, then update this list");
});
