/**
 * A path-filtered workflow must still fire on the code it exists to test.
 *
 * `capture-regression.yml` runs the capture checks on a REAL Windows runner — the only automated place NVDA
 * actually runs. It is path-filtered so doc edits do not spend Windows minutes, and that filter said
 * `src/capture/**`. When M8 rewrote paths mechanically it became `packages/lab/src/capture/**`: a directory
 * holding two lab files and no capture code at all.
 *
 * Nothing would have failed. The job would simply have stopped firing on worker changes and kept firing on
 * unrelated ones — a check that silently stops running, which is strictly worse than one that fails, and is
 * this repo's most repeated defect in a new costume.
 *
 * So the property is asserted rather than commented: the filter must cover the worker package, and the harness
 * it runs must exist at the path the workflow names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const workflow = readFileSync(join(root, ".github/workflows/capture-regression.yml"), "utf8");

test("the Windows capture job fires on changes to the worker package", () => {
  assert.ok(workflow.includes('"packages/nvda-worker/**"'),
    "capture-regression.yml must be filtered on the worker package, or it stops testing the capture path "
    + "without anyone noticing");
  // And on the training code, because a probe and its signal are coupled: `case-matrix.mjs` decides what each
  // signal reads, so a change there can blind a probe without touching the worker — which is exactly where the
  // guard bug lived that failed 44 cases in a live run.
  assert.ok(workflow.includes('"packages/lab/src/training/**"'),
    "a probe and its signal are coupled; the filter must cover the training code too");
});

test("every program the capture workflow runs exists at the path it names", () => {
  // A moved harness makes the job fail on the runner with MODULE_NOT_FOUND — visible, but only after spending
  // Windows minutes to find out. Cheaper to know here.
  const referenced = [...workflow.matchAll(/node\s+(packages\/[A-Za-z0-9._/-]+\.mjs)/g)].map((m) => m[1]);
  assert.ok(referenced.length > 0, "found no program invocations in the workflow; the scan is broken");
  for (const path of referenced) {
    assert.ok(existsSync(join(root, path)), `capture-regression.yml runs ${path}, which does not exist`);
  }
});
