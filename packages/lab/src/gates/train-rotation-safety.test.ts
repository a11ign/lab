import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "../../../..");
const TRAIN = "packages/lab/scripts/train-screenreader-model.py";
const source = () => readFileSync(join(REPO, TRAIN), "utf8");

/**
 * WHY THE ROTATION IS SAFE, pinned rather than remembered.
 *
 * `train-screenreader-model.py` rotates the previous release-eligible model aside at STARTUP — before the
 * train that might justify it. Read alone that says two crashes in a row destroy a release-eligible model:
 * the first spends the retained generation, the second overwrites what is left.
 *
 * They cannot, and the reason is a property of WHEN the report is written, not of the rotation at all.
 * `_read_existing_report` decides eligibility by reading `training-report.json` from the output directory;
 * that file is written LAST and ATOMICALLY (`.tmp` then `Path.replace`), so a train that dies anywhere —
 * including mid-write — leaves no readable report there. The next run reads nothing, returns early, and
 * never reaches the rotation branch.
 *
 * The source comment states this and ends with its own expiry condition: *"If you change WHAT A FAILED
 * TRAIN LEAVES BEHIND, this reasoning expires with it."* That is a guard depending on somebody remembering,
 * which this repo's own record calls a rule that gets broken. These tests are the remembering.
 *
 * The backlog row offered two closures — rotate on success, or state the ordering at the code. The second
 * was taken, deliberately, because the first restructures the one path holding release-eligible weights for
 * a hazard measurement says does not bite. That trade is only sound while the property below holds.
 */

test("the training report is written ATOMICALLY — a partial write must never read as eligible", () => {
  // `.write_text` to a temp path then `Path.replace` is an atomic rename on POSIX. Writing in place would
  // leave a truncated, unparseable file — which `_read_existing_report` treats as NOT eligible, so that
  // case is survivable — but a partially-written file that happens to parse is not, and only the rename
  // rules it out.
  const src = source();
  assert.match(src, /report_tmp\s*=\s*args\.output\s*\/\s*"training-report\.json\.tmp"/,
    "the report must be staged to a .tmp path");
  assert.match(src, /report_tmp\.replace\(\s*args\.output\s*\/\s*"training-report\.json"\s*\)/,
    "the staged report must land by atomic replace, not by writing in place");
});

test("nothing else writes training-report.json — one writer, or the atomicity is decorative", () => {
  // A second writer earlier in the run (progress reporting, a checkpoint) would put a readable report in
  // the output directory BEFORE the train finishes. That is exactly the change the source comment says
  // expires its reasoning: a crash after it would leave a release-eligible-looking report behind.
  const src = source();
  const mentions = [...src.matchAll(/training-report\.json/g)].length;
  // Three legitimate mentions: the read site, the `.tmp` staging path, and the `replace` target. A fourth
  // means a second writer arrived, and this guarantee needs re-deriving rather than assuming.
  assert.equal(mentions, 3,
    `"training-report.json" appears ${mentions} times, expected 3 (read site, .tmp, replace target). `
    + "Re-derive whether a crashed train can now leave a readable release-eligible report.");
});

test("releaseEligible is set at INITIALISATION and only ever cleared, never set True later", () => {
  // The source states this as its reason: "an eligibility that starts True and is cleared later is one a
  // later branch can quietly restore." A single assignment to True at build time, and every other
  // assignment False, is what makes that true rather than intended.
  const src = source();
  const assignments = [...src.matchAll(/report\["releaseEligible"\]\s*=\s*(\w+)/g)].map((m) => m[1]);
  assert.ok(assignments.length > 0, "no later assignments found at all — has the field been renamed?");
  assert.deepEqual([...new Set(assignments)], ["False"],
    `releaseEligible is assigned ${assignments.join(", ")} after initialisation. `
    + "Only False is safe: a later True can restore an eligibility a gate cleared.");
});
