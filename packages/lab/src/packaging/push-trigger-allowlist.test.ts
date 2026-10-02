/**
 * ONLY A WATCHDOG MAY TRIGGER ON A PUSH TO MAIN.
 *
 * The chairman's rule (`ci.yml`'s own header, 2026-09-06) is that a check gating code must run on the PR,
 * before the merge, because a check that runs after a merge cannot stop it -- and `push: branches: [main]`
 * is exactly that class. `board-liveness.yml` and `npm-token-liveness.yml` keep it anyway, and correctly:
 * both are watchdogs asking whether a SCHEDULED job elsewhere has gone silent, and a watchdog that is
 * itself scheduled has the disease it watches for -- GitHub disables a cron after 60 days with no repo
 * activity, silently. `push` is immune to that specific failure because a push IS activity. Neither
 * workflow gates anything: `continue-on-error: true`, no required check, nothing they run can block a
 * merge. They are not in the class the rule addresses.
 *
 * So the rule this file pins is narrower than "no push trigger anywhere": a workflow may trigger on push
 * to main ONLY if it is on one of the allowlists below AND is structurally the shape that list requires.
 * Each is a closed set with a reason attached to each entry; a fourth push-triggered workflow fails here
 * until someone argues its case here, in writing, the same way the others already have.
 *
 * ## A THIRD CATEGORY -- `TRUNK_FOLLOWUP_ALLOWLIST`, ceo's ruling 2026-09-08 (C2, #416's sibling)
 *
 * `sweep` and `stalled` (in `auto-arm.yml`) are neither of the first two shapes. They are not schedule
 * watchdogs -- there is no cron here for GitHub to silently disable, so the schedule-disable immunity the
 * first category exists for does not apply. And they are not `trunk.yml`'s reactive check on `main`'s OWN
 * tip -- they never build or test anything, and a failure here is never meant to be acted on the way a
 * revert is. It is a third, narrower shape: a push-to-main job that acts on or reports about OTHER open pull
 * requests after a merge -- never on main's own tip -- and cannot gate anything because the merge it reacts to
 * already happened. `continue-on-error: true` is required by the category's own definition (a red run must
 * never read as a gate failure when nothing downstream waits on it), and each entry's reason must name WHICH
 * PRs the job touches and WHY a schedule cannot do the job -- the answer is always the same shape: a
 * schedule cannot know a merge just happened, which is exactly why `push` is the right trigger and not a
 * workaround for one.
 *
 * The category's first member, the `update-branch` job, was deleted by #3046: the merge queue builds every
 * PR on `main` and runs `ci` on that merge commit, so nothing pushes `main` into a PR branch any more.
 */
import { declareWalkScope } from "../../../guards/src/walk-scope.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

// #929: THIS GUARD READS ONLY `packages/agent-org`, `.github/workflows`, so a diff that cannot reach it need not run this file.
// Undeclared means unbounded, which is why the selector runs 173 always-run guards on every pull
// request. The declaration is ENFORCED rather than trusted: `declareWalkScope` observes what this
// file actually reads and fails it here if anything lands outside the scope -- so a scope that is
// too narrow is loud, never a guard that silently stopped running.
export const WALK_SCOPE = ["packages/agent-org",".github/workflows"];
await declareWalkScope(import.meta.url);

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOWS_DIR = `${REPO}.github/workflows/`;
const readWorkflow = (name: string) => readFileSync(`${WORKFLOWS_DIR}${name}`, "utf8");

/**
 * Every step this workflow's own jobs run, PLUS every step of any LOCAL reusable workflow one of its jobs
 * calls via `uses: ./.github/workflows/<file>.yml` -- one hop only, never recursive, because nothing in
 * this repo's own workflows currently calls a reusable workflow from within another one.
 *
 * A1 (#452) split `ci.yml` and `trunk.yml`'s build/test steps into `reusable-build-test.yml`, so a
 * structural check reading only a caller's OWN `steps:` would see nothing at all -- a caller job has
 * `uses:`/`with:` instead of `steps:`, and the real `npm run build`/test commands moved to the callee.
 * This is the discovery-follows-the-real-shape fix, not a special case for one file: any future reusable
 * split gets the same treatment for free.
 */
function allStepsIncludingLocalReusableCalls(file: string): Array<Record<string, unknown>> {
  const doc = parseYaml(readWorkflow(file)) as {
    jobs: Record<string, { uses?: string; steps?: Array<Record<string, unknown>> }>;
  };
  const steps: Array<Record<string, unknown>> = [];
  for (const job of Object.values(doc.jobs)) {
    if (job.steps) steps.push(...job.steps);
    const match = /^\.\/\.github\/workflows\/([\w-]+\.yml)$/.exec(job.uses ?? "");
    if (match) {
      const calleeDoc = parseYaml(readWorkflow(match[1])) as { jobs: Record<string, { steps?: Array<Record<string, unknown>> }> };
      for (const calleeJob of Object.values(calleeDoc.jobs)) steps.push(...(calleeJob.steps ?? []));
    }
  }
  return steps;
}

// Every entry needs a reason, and the reason is what a reviewer checks -- not the presence of a key.
//
// EMPTY SINCE #901 (The CI Reset, step 1), AND MEANT TO STAY EMPTY. The three watchdogs that lived here
// (board editions, NPM_TOKEN, workflow-run liveness) each fired their own workflow on every push to main --
// 777 runs on 2026-09-09 for three scripts that take seconds. They still run on push, for the reason this
// category existed (a cron dies with the inactivity it watches for), but as three continue-on-error steps
// in `trunk.yml`'s `watchdogs` job, which runs on every push anyway. A NEW watchdog goes there too,
// as a step, never as a workflow of its own: `trunk.yml`'s structural test below allows
// `continue-on-error` only inside that one job.
const PUSH_TO_MAIN_ALLOWLIST: Record<string, string> = {};

// A SECOND, SEPARATE closed category -- opened 2026-09-07 by board decision (pipeline unit 3, #316).
// `trunk.yml` is deliberately NOT a watchdog: it DOES build, it DOES run the full suite, and it is
// NOT continue-on-error, because a red run there is exactly the signal that drives an automatic revert,
// not something to observe and move past. It exists because unit 1 (#298) made `strict=false` real:
// GitHub now completes a merge the instant a PR's own head is green, with no requirement that the actual
// MERGE COMMIT landing on `main` was ever tested -- `ci.yml`'s `pull_request` trigger tests a PR's head,
// never the commit it produces on merge. That is a genuinely different gap from "did a schedule go
// silent", and closing it needs the opposite shape from a watchdog: real verification, real action. See
// `trunk.yml`'s own header for the full reasoning and `packages/agent-org/src/trunk-red.mjs`'s for why a red `main` wakes
// a fixer and nothing reverts it (#2356).
const TRUNK_GATE_ALLOWLIST: Record<string, string> = {
  "trunk.yml": "pipeline unit 3 (#316): the merge commit landing on main after strict=false (#298) "
    + "has never itself been tested by ci.yml's pull_request-triggered run. This is the one place that gap "
    + "is closed, and unlike a watchdog, a failure here is meant to be ACTED ON (an automatic revert, "
    + "bounded to never fire on inherited failure or after main has moved on), not merely observed.",
};

// A THIRD, SEPARATE closed category -- ceo's ruling, 2026-09-08 (C2, #416's sibling). Neither of the two
// above fits a push-to-main job that acts on OTHER open PRs rather than on main's own tip or a schedule:
// it is not a watchdog (no cron here to go silently disabled) and not a trunk gate (no build, no suite, no
// revert). Each reason must name which PRs the job touches and why a SCHEDULE cannot do the job instead --
// the answer is always that a schedule cannot know a merge just happened, which is why `push` is the right
// trigger and not a workaround for one.
const TRUNK_FOLLOWUP_ALLOWLIST: Record<string, string> = {
  "auto-arm.yml": "the `sweep` and `stalled` jobs (#344, #361): after a merge lands on main they ARM every "
    + "OTHER open PR the queue could not see, and REPORT every armed, green PR that has drifted into a real "
    + "conflict -- never touching main's own tip and never pushing to a PR's branch (the `update-branch` job "
    + "that did was deleted by #3046). A schedule cannot do this job: it cannot know a merge just happened, "
    + "only that some time has passed, so a cron-driven version would either run needlessly often or leave "
    + "a stranded PR unarmed for its whole interval -- and a cron is what GitHub disables after 60 days of "
    + "inactivity. `push` is the one event that means exactly 'the queue just moved'.",
};

const triggersOnPushToMain = (doc: unknown): boolean => {
  const on = (doc as { on?: Record<string, unknown> })?.on;
  const push = on?.push;
  if (push === undefined) return false;
  if (push === null) return true; // `push:` with no filter at all means every branch, main included
  const branches = (push as { branches?: unknown }).branches;
  if (branches === undefined) return true; // no `branches:` filter -- every branch, main included
  return Array.isArray(branches) && branches.includes("main");
};

const allWorkflowFiles = (): string[] => readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml"));

// A `continue-on-error: true` regex over the RAW file text matches a comment that merely MENTIONS the
// key, not only the key itself -- found by mutation while writing the followup category's own entry
// above: its header prose spells the exact phrase `continue-on-error: true` to explain the requirement,
// and removing the real key from the job left the header sentence alone to satisfy the assertion. Strip
// everything from an unquoted `#` to end of line before matching, the same shape as `stripComments` does
// for `.mjs` in `cli-flags.test.ts` -- comments describe the code and must never be mistaken for it.
const stripYamlComments = (source: string): string =>
  source.split("\n").map((line) => line.replace(/(?<!["'\S])#.*$/, "")).join("\n");

test("every workflow triggering on push to main is on one of the three closed allowlists, with a reason", () => {
  const offenders: string[] = [];
  for (const file of allWorkflowFiles()) {
    const doc = parseYaml(readWorkflow(file));
    if (triggersOnPushToMain(doc) && !(file in PUSH_TO_MAIN_ALLOWLIST) && !(file in TRUNK_GATE_ALLOWLIST)
      && !(file in TRUNK_FOLLOWUP_ALLOWLIST)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [],
    `${offenders.join(", ")} trigger(s) on push to main and are not on PUSH_TO_MAIN_ALLOWLIST, `
    + "TRUNK_GATE_ALLOWLIST or TRUNK_FOLLOWUP_ALLOWLIST -- a check that gates code must run on the PR "
    + "(chairman's direction, 2026-09-06: a check that runs after the merge cannot stop it). If this is a "
    + "non-gating watchdog immune to the schedule-disable problem the same way board-liveness.yml is, add "
    + "it to PUSH_TO_MAIN_ALLOWLIST; if it is a reactive trunk check like trunk.yml, argue its case "
    + "for TRUNK_GATE_ALLOWLIST in writing, the same way #316 did; if it acts on OTHER open PRs after a "
    + "merge rather than on main's own tip or a schedule, argue its case for TRUNK_FOLLOWUP_ALLOWLIST the "
    + "same way C2/#416 did.");
});

test("the watchdog allowlist is EMPTY since #901 -- a watchdog is a step in trunk.yml's watchdogs job, never a workflow", () => {
  assert.deepEqual(Object.keys(PUSH_TO_MAIN_ALLOWLIST), []);
  const doc = parseYaml(readWorkflow("trunk.yml")) as { jobs: Record<string, { steps?: Array<Record<string, unknown>> }> };
  const runLines = (doc.jobs.watchdogs?.steps ?? []).map((s) => String(s.run ?? "")).join("\n");
  // Each watchdog by the thing that RUNS it: the two that live in the agent-org dependency are `agent-org <command>` (#2975), and
  // npm-token-liveness, which stayed in scripts/, is a path. Pinning one shape for all three would assert where each lives rather
  // than that it still runs.
  for (const [script, runs] of [["board-schedule-liveness.mjs", /agent-org board:liveness\b/],
    ["npm-token-liveness.mjs", /\/npm-token-liveness\.mjs/], ["workflow-run-liveness.mjs", /agent-org workflow:liveness\b/]] as const) {
    assert.match(runLines, runs,
      `${script} is no longer a workflow of its own and must therefore be a step in trunk.yml's `
      + "watchdogs job -- a watchdog that is in neither place has silently stopped running");
  }
});

test("the trunk-gate allowlist names exactly the one known trunk check", () => {
  assert.deepEqual(Object.keys(TRUNK_GATE_ALLOWLIST).sort(), ["trunk.yml"]);
});

test("the trunk-followup allowlist names exactly the one known followup workflow", () => {
  assert.deepEqual(Object.keys(TRUNK_FOLLOWUP_ALLOWLIST).sort(), ["auto-arm.yml"]);
});

// STRUCTURAL PROOF that each allowlisted entry is actually a watchdog and not a gate wearing the allowlist
// as cover -- the allowlist alone is just a list of filenames; these assertions are what makes it cost
// something to add a third one.
for (const file of Object.keys(PUSH_TO_MAIN_ALLOWLIST)) {
  test(`${file}: structurally a watchdog -- continue-on-error, no build step, no full-suite run`, () => {
    const text = readWorkflow(file);
    const doc = parseYaml(text) as { jobs: Record<string, { steps: Array<Record<string, unknown>> }> };

    assert.match(stripYamlComments(text), /continue-on-error:\s*true/,
      `${file} triggers on push and must be continue-on-error, or a red push blocks nothing but still `
      + "reads as a gate to whoever sees it fail");

    const steps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
    const runLines = steps.map((s) => String(s.run ?? "")).join("\n");

    assert.ok(!/npm run build\b/.test(runLines),
      `${file} runs a full monorepo build -- a watchdog answering "is a schedule silent" needs no build `
      + "step at all, and one here is a sign this has grown into something that gates");
    assert.ok(!/\b(npm test|npm run test|pytest|ansible-playbook|npx tsx --test)\b/.test(runLines),
      `${file} invokes a full test suite -- that is minutes of runtime on every push to main, which is `
      + "exactly the cost the chairman's rule moved off push in the first place");
  });
}

// THE INVERSE STRUCTURAL PROOF for the trunk-gate category: it must NOT look like a watchdog, or the
// split above is decorative. A workflow that builds, tests and is not continue-on-error, wearing the
// TRUNK_GATE_ALLOWLIST label, is exactly what would let a real gate hide behind this file's own exception.
for (const file of Object.keys(TRUNK_GATE_ALLOWLIST)) {
  test(`${file}: structurally the trunk gate, not a watchdog -- builds, runs the full suite, is NOT continue-on-error`, () => {
    const text = readWorkflow(file);

    // #901: `continue-on-error` is permitted ONLY inside the `watchdogs` job, which `trunkRecheck` does not
    // depend on. Everywhere else in this file it would let a red gate be shrugged off.
    const parsed = parseYaml(text) as { jobs: Record<string, { steps?: Array<Record<string, unknown>>; "continue-on-error"?: unknown }> };
    for (const [name, job] of Object.entries(parsed.jobs)) {
      if (name === "watchdogs") continue;
      assert.notEqual(job["continue-on-error"], true, `${file}: job ${name} is continue-on-error`);
      for (const step of job.steps ?? []) {
        assert.notEqual(step["continue-on-error"], true,
          `${file}: a step in job ${name} is continue-on-error -- the trunk gate's whole point is that a `
          + "failure here is ACTED ON (it wakes a fixer, #2356), so a red run must be able to drive something, not be "
          + "shrugged off. Only the watchdogs job may carry it");
      }
    }
    const recheck = parsed.jobs.trunkRecheck as { needs?: string[] } | undefined;
    assert.ok(recheck && !(recheck.needs ?? []).includes("watchdogs"),
      `${file}: trunkRecheck must not depend on watchdogs, or a red watchdog could read as a red main`);

    // A1 (#452): follows a local `uses: ./.github/workflows/reusable-build-test.yml` call -- the real
    // build/test commands checked below now live there, not in this file's own steps.
    const steps = allStepsIncludingLocalReusableCalls(file);
    const runLines = steps.map((s) => String(s.run ?? "")).join("\n");

    assert.match(runLines, /npm run build\b/,
      `${file} must build -- it is meant to verify main's real tip, and an unbuilt tree cannot tell you `
      + "that");
    assert.match(runLines, /\b(npm test|npm run test|pytest|npx tsx --test)\b/,
      `${file} must run a real test suite -- a trunk gate that checks nothing cannot be the fact this `
      + "row exists to establish");
  });
}

// STRUCTURAL PROOF for the followup category: same shape requirement as a watchdog (no build, no full
// suite, continue-on-error so a red run can never read as a gate) -- but for the OPPOSITE reason. A
// watchdog is cheap because it only asks "is a schedule silent"; a followup job is cheap because it only
// acts on OTHER PRs, and building or testing here would mean it had grown into verifying
// something -- which is `trunk.yml`'s job, not this one's.
for (const file of Object.keys(TRUNK_FOLLOWUP_ALLOWLIST)) {
  test(`${file}: structurally a followup workflow -- continue-on-error, no build step, no full-suite run`, () => {
    const text = readWorkflow(file);
    const doc = parseYaml(text) as { jobs: Record<string, { steps: Array<Record<string, unknown>> }> };

    assert.match(stripYamlComments(text), /continue-on-error:\s*true/,
      `${file} triggers on push and must be continue-on-error, or a red run blocks nothing but still `
      + "reads as a gate to whoever sees it fail");

    const steps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
    const runLines = steps.map((s) => String(s.run ?? "")).join("\n");

    assert.ok(!/npm run build\b/.test(runLines),
      `${file} runs a full monorepo build -- a followup job that only acts on other PRs needs no `
      + "build step at all, and one here is a sign this has grown into something that verifies main's tip");
    assert.ok(!/\b(npm test|npm run test|pytest|ansible-playbook|npx tsx --test)\b/.test(runLines),
      `${file} invokes a full test suite -- that is minutes of runtime on every push to main, which is `
      + "exactly the cost the chairman's rule moved off push in the first place");
  });
}

// #3046 done-when 1: THE DELETION IS THE JOB, NOT THE FILE. A test that only said "no update-branch job"
// passes on a workflow file that was emptied; the POSITIVE CONTROL is that `arm`, `sweep` and `stalled` are
// all still here, and still triggered by every event they were triggered by before.
test("#3046: auto-arm.yml has no job that pushes main into a PR branch, and still has arm, sweep and stalled", () => {
  const text = readWorkflow("auto-arm.yml");
  const doc = parseYaml(text) as { jobs: Record<string, { steps?: Array<Record<string, unknown>> }> };
  assert.deepEqual(Object.keys(doc.jobs).sort(), ["arm", "stalled", "sweep"],
    "the control: the three jobs that are NOT being deleted are all present, and nothing else is");
  const runLines = Object.values(doc.jobs).flatMap((job) => job.steps ?? []).map((s) => String(s.run ?? "")).join("\n");
  assert.doesNotMatch(runLines, /update-branch-sweep|gh pr update-branch|gh api\b[^\n]*update-branch/,
    "no step calls the sweep that pushed main into armed PRs, or GitHub's own update-branch");
});

test("#3046: auto-arm.yml is triggered by every event it was before the job went", () => {
  const { on } = parseYaml(readWorkflow("auto-arm.yml")) as { on: Record<string, unknown> };
  assert.deepEqual(Object.keys(on).sort(), ["pull_request", "push", "workflow_dispatch", "workflow_run"]);
  assert.deepEqual(on.push, { branches: ["main"] }, "`sweep` and `stalled` ride a push to main");
  assert.deepEqual((on.workflow_run as { workflows: string[] }).workflows, ["ci"], "`stalled` rides a ci completion");
});

test("PROOF: a synthetic third push-to-main workflow, not on the allowlist, fails the guard above", () => {
  const dir = mkdtempSync(join(tmpdir(), "push-trigger-proof-"));
  try {
    const fixture = join(dir, "sneaky-gate.yml");
    writeFileSync(fixture, "on:\n  push:\n    branches: [main]\njobs:\n  x:\n    runs-on: ubuntu-latest\n"
      + "    steps: []\n");
    const doc = parseYaml(readFileSync(fixture, "utf8"));
    assert.ok(triggersOnPushToMain(doc), "the fixture itself must trigger on push to main, or this proves "
      + "nothing");
    assert.ok(!("sneaky-gate.yml" in PUSH_TO_MAIN_ALLOWLIST),
      "the fixture must not already be on the allowlist, or this proves nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
