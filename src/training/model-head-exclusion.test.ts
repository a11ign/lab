/**
 * `score-rules.ts`'s `ownershipFailures` must take the identical `modelHead: false` exemption
 * `train-screenreader-model.py`'s `assert_declaration_matches_data` takes, in the same change — the two
 * assert the same boundary from opposite sides, and one exempting a subtype while the other still crashes
 * on it is exactly the "declared twice, drifted apart" shape `rule-ownership.json`'s own header exists to
 * end.
 *
 * `ownership` is injected here rather than read from the real file: `rule-ownership.json` has no
 * `modelHead: false` entry yet (both real declarations are HELD pending this mechanism landing), so
 * exercising the exemption needs a fabricated map. `python/tests/test_model_head_exclusion.py` is this
 * file's Python-side twin, over the trainer's own version of the same boundary.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ownershipFailures } from "../../scripts/score-rules.js";
import type { Ownership } from "./rule-ownership.js";

/** An empty coverage map: no subtype has any records, which is 1.4.2's own shape -- declared, absent. */
const NO_COVERAGE = new Map();

function ownership(entries: Record<string, Ownership>): Map<string, Ownership> {
  return new Map(Object.entries(entries));
}

test("a declared, absent subtype with modelHead: false is not a failure", () => {
  // 1.4.2's own shape: declared `rules`, `modelHead: false`, no corpus case at all yet.
  const failures = ownershipFailures(NO_COVERAGE, ownership({
    "1.4.2:autoplay-uncontrollable": {
      decidedBy: "rules", reportsAs: "1.4.2", modelHead: false, why: "no corpus case yet",
    },
  }));
  assert.deepEqual(failures, []);
});

test("a declared, absent subtype WITHOUT modelHead: false is still the defect this gate exists to catch", () => {
  // The guard this exemption must not weaken: ordinary declared-and-absent is still wrong.
  const failures = ownershipFailures(NO_COVERAGE, ownership({
    "4.1.2:regex": { decidedBy: "rules", reportsAs: "4.1.2" },
  }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /nothing defines it|stale export/);
});

test("a PRESENT subtype with modelHead: false is judged on its OTHER rules, not exempted from everything", () => {
  // 2.4.7's own shape: declared `rules`, `modelHead: false`, nine real records -- the "must be present"
  // exemption is irrelevant here (it IS present), and must not be read as "skip this subtype entirely".
  const coverage = new Map([
    ["2.4.7:focus-removed-on-receipt", { total: 9, dueByRule: 9, caughtByRule: 9, alsoFired: 0, missed: [] }],
  ]);
  const failures = ownershipFailures(coverage, ownership({
    "2.4.7:focus-removed-on-receipt": {
      decidedBy: "rules", reportsAs: "2.4.7", modelHead: false, why: "shares every feature with 2.1.1",
    },
  }));
  assert.deepEqual(failures, [], "present and exactly caught by the rule -- nothing here should fail");
});
