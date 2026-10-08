/**
 * INCONCLUSIVE must stay a third outcome, distinct from both PASS and FAIL.
 *
 * The gate had two: it FAILED on a stale local corpus, which is not a defect in the code being pushed and
 * not something a working copy can distinguish from a corpus needing recapture. The only way past it was
 * `A11Y_SKIP_VERIFY=1`, which disables lint, typecheck and every unit test as collateral — so a check that
 * could not answer its own question switched off the ones that could.
 *
 * Collapsing the three back into two is therefore a regression with a known cost, and these pin it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { UNDETERMINED, partitionProblems } from "../scripts/score-rules.js";

test("an unattributable problem is separated from a real one", () => {
  const { conclusive, undetermined } = partitionProblems([
    "4.1.2:unnamed-control fired on a conformant page",
    UNDETERMINED + "3.3.2:placeholder-only present, export records no exclusion set",
  ]);
  assert.deepEqual(conclusive, ["4.1.2:unnamed-control fired on a conformant page"]);
  assert.deepEqual(undetermined, ["3.3.2:placeholder-only present, export records no exclusion set"]);
});

test("the marker is stripped, so a human never reads the plumbing", () => {
  const { undetermined } = partitionProblems([UNDETERMINED + "a stale export"]);
  assert.equal(undetermined[0], "a stale export");
});

test("a real problem alongside an unattributable one is still a real problem", () => {
  // The dangerous direction: one stale-corpus artefact must never launder a genuine failure into a skip.
  const { conclusive } = partitionProblems([UNDETERMINED + "stale", "a rule fired on a conformant page"]);
  assert.equal(conclusive.length, 1, "a conclusive failure must survive being mixed with an undetermined one");
});

test("nothing marked means nothing undetermined", () => {
  const { conclusive, undetermined } = partitionProblems(["a", "b"]);
  assert.equal(undetermined.length, 0);
  assert.equal(conclusive.length, 2);
});
