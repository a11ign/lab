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

// `deliberateRefusals` is what `mergeSafety` became: THREE checks a person's own decision drives -- a
// `hold:` label, the declared Closes against what GitHub will actually close (#549), and a crossing into
// another session's lane. It stays REQUIRED. None is process noise: none of the last forty red runs was any
// of them. ceo ruled the lane check out and then back in on worker-capture's objection -- the first ruling
// covered only ASSIGNED crossings, and an unassigned one would merge silently, since the record ceo relies
// on IS the line this check enforces. The head-vs-tip race it also carries (#294) is not #277's "behind
// main", which branch protection now owns.
// WHERE THE RULE LIVES: `ci-changed.test.ts` owns it, deriving the required set from ci.yml itself so a
// job added tomorrow is required by DEFAULT. `KEPT` here is a second copy and deliberately a dumb one --
// it names today's answer so this file can assert the loop and the needs list against each other. A
// correctly-added job turns two tests here red until KEPT is edited too; that friction is the price of
// the second reading, and the edit is one line (worker-capture's review of #1001).
const KEPT = ["changed", "ts", "python", "ansible", "changeset", "rulesFitness", "deliberateRefusals"];
const DROPPED = ["docs", "board", "acceptance", "ownedPaths"];

test("#902: the gate waits for the product jobs and nothing else", () => {
  const needs = /needs: \[([^\]]+)\]/.exec(gateBlock())?.[1];
  assert.ok(needs, "the gate's `needs` is no longer a single-line list; this guard cannot read it");
  assert.deepEqual(needs!.split(",").map((name) => name.trim()).sort(), [...KEPT].sort());
});

test("#902: the three deliberate refusals are all in one job the gate needs", () => {
  // The hold refusal rides on `merge-guard.mjs --ci-gate`, and dropping its job from `needs` would leave a
  // held PR reporting red while the gate went green -- so an ARMED one would merge. `pr-hold.mjs` disarms
  // when it takes a hold, but the armed-then-held window is caught here and nowhere else in CI.
  const job = /\n {2}deliberateRefusals:\n[\s\S]*?(?=\n {2}[A-Za-z][\w-]*:\n)/.exec(CI)?.[0] ?? "";
  // THE `run:` LINE, NOT THE NAME ANYWHERE IN THE BLOCK. The first version of this matched
  // `merge-guard.mjs --ci-gate` anywhere in the job, and the comment above the step says those words too:
  // deleting the step left the test green on its own explanation. A guard satisfied by prose about itself
  // is the shape this repo has paid for more than once.
  assert.match(job, /run: node scripts\/merge-guard\.mjs --ci-gate/,
    "the hold refusal left this job; no other workflow in this repo reads a `hold:` label");
  assert.match(job, /run: node scripts\/closes-mismatch-check\.mjs/,
    "#549's comparison left this job, and only it has a token");
  assert.match(job, /run: \|\n[\s\S]*?node scripts\/workflow-lane-check\.mjs/,
    "the lane check left this job; an UNASSIGNED crossing would then merge with no record, which is the "
    + "case ceo's second ruling of 2026-09-11 kept it for");
  assert.ok(KEPT.includes("deliberateRefusals"), "the job carrying all three must be one the gate waits for");
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
