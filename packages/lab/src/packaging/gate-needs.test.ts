/**
 * WHAT THE ONE REQUIRED CHECK WAITS FOR -- #902, step 2 of the CI Reset.
 *
 * `gate` is the only required context on a pull request, and it runs no tests: it reads its siblings'
 * results. Which siblings it reads is therefore the whole policy, and it was eleven jobs, seven of them
 * policing the process. Measured across the last forty red `ci` runs: `ts` 13, `acceptance` 10,
 * `mergeSafety` 10, `docs` 9, `changed`/`ownedPaths` 5 -- two of every three red pull requests were red
 * for something that said nothing about whether the code works.
 *
 * The five were DROPPED FROM `needs`, not deleted. They still run and still report; they stop deciding.
 * That distinction is what this file pins, in both directions: a job that stopped running would be a
 * silent loss of coverage, and a job back in `needs` would quietly restore the policy that row removed.
 *
 * `acceptance` AND `ownedPaths` CAME BACK ON 2026-09-17, and this file now pins the reversal.
 *
 * #902 was right that two of every three red pull requests said nothing about whether the code worked.
 * It was the REMEDY that had a hole: `gate` is the only required context (branch protection's contexts
 * are exactly `["gate"]`, required approvals 0), so a job outside `needs` runs, reports, and is IGNORED.
 * Two pull requests merged red in two days through that hole, and on the second the acceptance command
 * had already RUN AND PASSED -- the red was its PR body.
 *
 * A check that cannot block is worse than no check: it teaches everyone to scroll past red, and that
 * habit is what makes the checks that DO matter unreadable. So each job is now one thing or the other.
 *
 * These two are worth blocking on, and the measurement says so rather than the intuition. Over the last
 * 40 pull-request runs `acceptance` failed 4 times and caught ZERO broken builds -- twice a duplicated
 * `Acceptance:` section, twice a missing `Closes` declaration. Neither is noise in #902's sense: a
 * duplicated section means the checker CANNOT TELL which command to run, which is a refusal to verify
 * rather than a verdict on the code; and both are fixable by the author in a minute. `edited` is in this
 * workflow's triggers, so a corrected body re-runs the check -- the 2026-09-07 deadlock (a body-only
 * defect with no trigger watching the body) is the condition that made blocking unsafe then, and it does
 * not hold now.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CI = readFileSync(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8");

/** A job's own block, from its key to the next job at the same indent (or EOF for the last job). */
function jobBlock(name: string): string {
  const start = CI.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `ci.yml has no \`${name}\` job`);
  const rest = CI.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The `gate` job's own block, from its key to the next job at the same indent. */
function gateBlock(): string {
  assert.notEqual(CI.indexOf("\n  gate:\n"), -1,
    "ci.yml has no `gate` job -- the required check is named somewhere else now");
  return jobBlock("gate");
}

// #1109: `ci.yml` DECLARES `merge_group` (`on: { ..., merge_group: { branches: [main] } }`), so `gate` --
// the one required check -- is REACHABLE from the merge queue. Whether it is a real second pass or a
// weaker one depends on which of the jobs it `needs` actually ran to produce that result, which this pair
// of tests pins.
//
// THE ONE PATTERN THAT EXCLUDES `merge_group` TODAY: an `if:` requiring `github.event_name ==
// 'pull_request'`. Nothing else in this file's `if:` lines is event-shaped -- the rest gate on
// `needs.changed.outputs.*`, which answers "did the diff touch this", true or false on ANY event.
function excludesMergeGroup(block: string): boolean {
  const ifLine = /\n {4}if: (.+)\n/.exec(block)?.[1] ?? "";
  return /github\.event_name == 'pull_request'/.test(ifLine);
}

// JOBS EXEMPT ON `merge_group`, WITH WHY -- #1109's own deliverable ("an exemption table, not a widened
// condition"). Each reason is echoed as a comment on the job's own `if:` in ci.yml so a reader at either
// file finds the other; keeping both is the repeated-second-reading trade this file already makes for
// `KEPT`/`DROPPED` above, not an accident of two people writing the same thing once.
const EXEMPT_ON_MERGE_GROUP: Record<string, string> = {
  deliberateRefusals: "reads github.event.pull_request (a hold, #549's Closes check) -- merge_group has none",
  acceptance: "runs a command out of github.event.pull_request.body -- merge_group has no PR and no body",
  ownedPaths: "diffs against github.base_ref, empty on merge_group (its base is github.event.merge_group.base_ref)",
};

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
const KEPT = ["changed", "ts", "python", "ansible", "changeset", "rulesFitness", "deliberateRefusals",
  "acceptance", "ownedPaths"];
// #1065: `docs` left this list when it was deleted outright -- red and unread on an environment-only failure,
// its population already run unscoped by trunk-guard after every merge.
// `acceptance` and `ownedPaths` left this list on 2026-09-17 by moving INTO `KEPT` -- see the header. The
// population must stay non-empty for the control below to mean anything, and `board` keeps it so.
const DROPPED = ["board"];

test("the gate waits for exactly the jobs allowed to decide -- #902, amended 2026-09-17", () => {
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
  assert.match(job, /run: node packages\/agent-org\/src\/merge-guard\.mjs --ci-gate/,
    "the hold refusal left this job; no other workflow in this repo reads a `hold:` label");
  assert.match(job, /run: node packages\/agent-org\/src\/closes-mismatch-check\.mjs/,
    "#549's comparison left this job, and only it has a token");
  // The lane check was the third refusal here and is RETIRED: docs/lane-ownership.json set its own end
  // date (#916's CODEOWNERS, 2026-09-15) and that passed unbuilt, and it was the only guard in `gate` an
  // outside contributor structurally could not satisfy. Its data survives for row-file's lane labels.
  assert.doesNotMatch(job, /workflow-lane-check/,
    "the lane check is retired; a step still calling it would refuse PRs on a rule nobody can satisfy");
  assert.ok(KEPT.includes("deliberateRefusals"), "the job carrying both must be one the gate waits for");
});

test("#902: each job the gate stopped waiting for STILL RUNS -- dropped from needs, not deleted", () => {
  // The row's own words: none of them is simply dropped. A job that vanished would take its report with
  // it, and `docs`'s guards moving to the nightly report is a different row's work, not this one's.
  const missing = DROPPED.filter((job) => !CI.includes(`\n  ${job}:\n`));
  assert.ok(DROPPED.length > 0,
    "#1160: if `DROPPED` is empty this assertion passes having compared nothing -- "
    + "the control belongs on the population, not on `missing`");
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

test("#1109: gate's own `if:` never excludes merge_group", () => {
  // `always() && !cancelled()` (pinned above) is the whole of it -- no `event_name` clause. If one were
  // added, `gate` would stop being the merge queue's own second pass rather than merely a weaker one.
  assert.ok(!excludesMergeGroup(gateBlock()),
    "gate's `if:` now restricts by event_name -- it would never conclude on merge_group at all");
});

test("#1109: every job gate needs either runs on merge_group or is named with a reason", () => {
  for (const name of KEPT) {
    const excluded = excludesMergeGroup(jobBlock(name));
    if (name in EXEMPT_ON_MERGE_GROUP) {
      assert.ok(excluded,
        `${name} is in EXEMPT_ON_MERGE_GROUP but its \`if:\` no longer excludes merge_group -- ` +
        "it runs there now, so remove the entry (and ci.yml's matching comment) rather than leave a stale exemption");
    } else {
      assert.ok(!excluded,
        `${name} is skipped on merge_group with no entry in EXEMPT_ON_MERGE_GROUP -- gate would conclude ` +
        "on a merge_group event having examined less than it does on a pull_request (#1109)");
    }
  }
});
