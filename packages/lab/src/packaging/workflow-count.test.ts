/**
 * #909 (The CI Reset, step 4): THE WORKFLOW COUNT, ASSERTED AGAINST THE DIRECTORY AND NAMED.
 *
 * The plan said 8, the row said 10, and both were inherited from a table rather than derived from the
 * decisions that followed it: ceo ruled on #901 that the two board workflows stay (seven London-clock runs a
 * day pinned by board-schedule.test.ts), and on #909 that auto-arm.yml stays (drafts cannot be armed, and it
 * hosts the update-branch train's three non-push triggers). So the number is what the directory holds after
 * trunk-guard.yml, trunk-sweep.yml and close-rows.yml collapsed into trunk.yml: thirteen, each named here so
 * a fourteenth arriving is a failure with a name rather than a number. A row that removes or adds one moves
 * this list in the same commit and says why.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = fileURLToPath(new URL("../../../../.github/workflows/", import.meta.url));

const THE_THIRTEEN = [
  "action-smoke.yml",
  "auto-arm.yml",           // arms drafts on ready_for_review; the update-branch train (#1094, #1100, #1103)
  "board-report.yml",       // London-clock editions, kept by #901's ruling
  "board-summary-check.yml",
  "capture-regression.yml",
  "ci.yml",                 // the one required check, `gate`
  "consumer-gate.yml",
  "nightly.yml",            // coverage, ready-audit, doc-report, the org watch, and #417's hourly sweeps
  "release.yml",
  "reusable-acceptance.yml",
  "reusable-board.yml",
  "reusable-build-test.yml",
  "trunk.yml",              // #909: gate, revert-on-red, close-rows and the watchdogs, on every push to main
];

test("#909: the workflow directory holds exactly the thirteen named here, no more and no fewer", () => {
  const onDisk = readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  assert.deepEqual(onDisk, [...THE_THIRTEEN].sort(),
    "a workflow arrived or left without this list moving in the same commit -- name it here with its reason");
  assert.equal(onDisk.length, 13);
});

test("#909: the three collapsed workflows are gone, and the one that replaced them exists", () => {
  const onDisk = new Set(readdirSync(WORKFLOWS_DIR));
  for (const gone of ["trunk-guard.yml", "trunk-sweep.yml", "close-rows.yml"]) {
    assert.ok(!onDisk.has(gone), `${gone} was folded into trunk.yml by #909`);
  }
  assert.ok(onDisk.has("trunk.yml"));
});
