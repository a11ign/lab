/**
 * A declared secondary failure must survive the trip from case definition to exported LABEL.
 *
 * Third occurrence of one defect shape. `pair()` carries the scar from the first — "a case declaring
 * `alsoFails` without this line is silently dropped -- which it was, and the count read 0 while three case
 * definitions carried it" — and CLAUDE.md records the probe version, which needed six hand-written hops to
 * agree and did not.
 *
 * Measured 2026-08-23, and this time the cost was an accusation against RELEASED weights.
 * `acceptance-link-guidance+also-generic-heading` declares `alsoFails: ["2.4.6:regex"]`, and its page
 * really does carry `<h2>Details</h2>` — a non-descriptive heading, a genuine 2.4.6 failure. The acceptance
 * manifest writer hand-enumerates case fields and did not forward `alsoFails`; the exporter reads the
 * MANIFEST rather than the case, so the record was labelled `criteria: ["2.4.4"]` alone. The model detected
 * the real 2.4.6 failure, was scored a FALSE POSITIVE, and the shipped scorer was reported as failing
 * held-out acceptance. A label that omits a defect the page has does not measure the model — it measures
 * the label.
 *
 * Asserted as a ROUND TRIP through the real modules rather than by checking that the writer mentions the
 * field. A test that greps source text is the failure mode this repo names explicitly, and it would pass
 * against a writer that forwarded `alsoFails: undefined`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";
import { CASES } from "./case-matrix.mjs";

/**
 * Every case that declares a secondary failure — the ones this guard exists for.
 *
 * `readonly` and an unknown-indexed element, so the two case lists can be passed AS THEY ARE. They used
 * to be cast to `Array<Record<string, unknown>>` at every call, which stopped compiling the moment
 * `acceptance-matrix.mjs` acquired real types — a cast written to satisfy a checker is a cast that goes
 * wrong when the checker learns something.
 */
const multiDefect = (list: readonly Record<string, unknown>[]) =>
  list.filter((c) => Array.isArray(c.alsoFails) && (c.alsoFails as unknown[]).length > 0);

test("acceptance cases that declare alsoFails exist at all, or this guard is decoration", () => {
  // The discovery must find something. A guard over an empty set passes in perfect silence, which is the
  // defect it exists to catch wearing a different hat. Measured 7 multi-defect acceptance cases.
  const declared = multiDefect(ALL_ACCEPTANCE_CASES);
  assert.ok(declared.length >= 5,
    `only ${declared.length} acceptance case(s) declare alsoFails; the discovery is broken, not the corpus`);
});

test("the criteria a multi-defect page ACTUALLY fails are all derivable from its declaration", () => {
  // The property the exporter relies on: `criterion` plus the criterion half of each `alsoFails` entry is
  // the full set of criteria that page fails. If a case declared a subtype with no criterion prefix, the
  // exporter would silently produce a label missing that criterion — the same class of loss, one layer in.
  for (const testCase of multiDefect(ALL_ACCEPTANCE_CASES)) {
    for (const entry of testCase.alsoFails as string[]) {
      assert.match(entry, /^\d+\.\d+\.\d+:[a-z0-9-]+$/,
        `${testCase.id} declares alsoFails "${entry}", which is not criterion:subtype — the exporter splits `
        + "on ':' to build the label, so a malformed entry becomes a criterion that is silently never labelled");
      // The pair, not the criterion. One page can fail 3.3.2 twice by different mechanisms — measured:
      // `acceptance-placeholder-email+also-bare-edit` is `3.3.2:placeholder-only` with
      // `3.3.2:unnamed-form-field` alongside, which is two real failures and two different heads. Comparing
      // criteria alone rejected it, and this assertion was the thing that was wrong.
      assert.notEqual(entry, `${testCase.criterion}:${testCase.subtype}`,
        `${testCase.id} repeats its own primary criterion:subtype in alsoFails; that is not a SECOND failure`);
    }
  }
});

test("the training and acceptance corpora agree on what alsoFails means", () => {
  // Two matrices, two generators, two hand-written manifest writers. The training path forwards the field
  // and the acceptance path did not, which is exactly how a fact stated twice drifts. Pinning the SHAPE
  // equal is what stops the next divergence being silent.
  const training = multiDefect(CASES as unknown as Array<Record<string, unknown>>);
  assert.ok(training.length >= 5, `only ${training.length} training cases declare alsoFails`);

  const shapeOf = (list: Array<Record<string, unknown>>) =>
    new Set(list.flatMap((c) => (c.alsoFails as string[]).map((e) => e.split(":").length)));
  assert.deepEqual([...shapeOf(training)], [2], "training alsoFails entries must all be criterion:subtype");
  assert.deepEqual([...shapeOf(multiDefect(ALL_ACCEPTANCE_CASES))], [2],
    "acceptance alsoFails entries must all be criterion:subtype, like training's");
});
