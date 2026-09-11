/**
 * WHAT THE ONE REQUIRED CHECK WAITS FOR -- #902, step 2 of the CI Reset.
 *
 * `gate` is the only required context on a pull request, and it runs no tests: it reads its siblings'
 * results. Which siblings it reads is therefore the whole policy, and it was eleven jobs, seven of them
 * policing the process. Measured across the last forty red `ci` runs: `ts` 13, `acceptance` 10,
 * `mergeSafety` 10, `docs` 9, `changed`/`ownedPaths` 5 -- two of every three red pull requests were red
 * for something that said nothing about whether the code works.
 *
 * The five are DROPPED FROM `needs`, not deleted. They still run and still report; they stop deciding.
 * That distinction is what this file pins, in both directions: a job that stopped running would be a
 * silent loss of coverage, and a job back in `needs` would quietly restore the policy this row removed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CI = readFileSync(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8");

/** The `gate` job's own block, from its key to the next job at the same indent. */
function gateBlock(): string {
  const start = CI.indexOf("\n  gate:\n");
  assert.notEqual(start, -1, "ci.yml has no `gate` job -- the required check is named somewhere else now");
  const rest = CI.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const KEPT = ["changed", "ts", "python", "ansible", "changeset", "rulesFitness"];
const DROPPED = ["docs", "board", "acceptance", "ownedPaths", "mergeSafety"];

test("#902: the gate waits for the product jobs and nothing else", () => {
  const needs = /needs: \[([^\]]+)\]/.exec(gateBlock())?.[1];
  assert.ok(needs, "the gate's `needs` is no longer a single-line list; this guard cannot read it");
  assert.deepEqual(needs!.split(",").map((name) => name.trim()).sort(), [...KEPT].sort());
});

test("#902: each job the gate stopped waiting for STILL RUNS -- dropped from needs, not deleted", () => {
  // The row's own words: none of them is simply dropped. A job that vanished would take its report with
  // it, and `docs`'s guards moving to the nightly report is a different row's work, not this one's.
  const missing = DROPPED.filter((job) => !CI.includes(`\n  ${job}:\n`));
  assert.deepEqual(missing, [],
    `these jobs were removed from ci.yml entirely, not just from the gate's needs: ${missing.join(", ")}`);
});

test("#902: the gate's step reads exactly the results it declares -- no orphan, no unread need", () => {
  // A name left in the loop after leaving `needs` evaluates to the empty string, which is neither
  // "success" nor "skipped", so the gate would fail every run. The two lists must not drift.
  const read = [...gateBlock().matchAll(/needs\.([A-Za-z][\w-]*)\.result/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(read)].sort(), [...KEPT].sort());
});

test("#902: a CANCELLED run reports nothing -- `!cancelled()`, the third instance measured", () => {
  // A cancelled run's jobs report `cancelled`, which the step's own test treats as a failure, so every
  // superseded run left a red `gate` check-run sitting on the head beside the real one. Two sessions read
  // PR #996 as red from exactly that on 2026-09-11, twenty minutes apart.
  assert.match(gateBlock(), /if: always\(\) && !cancelled\(\)/,
    "without `!cancelled()` the gate fails whenever a push supersedes its own run, and that red persists");
});
