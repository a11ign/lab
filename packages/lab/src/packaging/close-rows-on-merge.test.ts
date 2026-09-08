/**
 * THE FOUR OUTCOMES MUST NEVER COLLAPSE INTO TWO.
 *
 * `Closes #N` is the tracker's whole closing mechanism under the pipeline, and GitHub does not apply it
 * when `github-actions[bot]` performs the merge — measured 2026-09-07, three of three bot merges left
 * their rows open (#310, #321, #344) while two of two human merges closed theirs, with `issues: write`
 * present. So the pipeline closes rows itself (#298, unit 1d).
 *
 * The dangerous outcome is `none declared`. Most PRs close nothing, so it is not a failure — and a job
 * that resolved no references and reported success having done nothing would be this repository's
 * most-recorded defect, in the one place whose whole job is to make merges finish their rows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
// A plain `.mjs`, and `scripts/**` IS in the typecheck program (#189), so this resolves and is checked.
import { closurePlan, EXIT } from "../../../../scripts/close-rows-for-merged-pr.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW = `${REPO}.github/workflows/close-rows.yml`;

test("an OPEN declared row is closed", () => {
  const plan = closurePlan([{ number: 344, state: "OPEN" }]);
  assert.deepEqual(plan.close, [344]);
  assert.deepEqual(plan.already, []);
  assert.equal(plan.none, false);
});

test("a row somebody already closed by hand is reported, never silently skipped", () => {
  // #310 and #321 were closed by hand once the defect was found. A later run must say so rather than
  // treat them as nothing — "already done" and "nothing to do" send a reader to different places.
  const plan = closurePlan([{ number: 310, state: "CLOSED" }]);
  assert.deepEqual(plan.close, []);
  assert.deepEqual(plan.already, [310]);
  assert.equal(plan.none, false);
});

test("NONE DECLARED is its own state — not an empty close list", () => {
  const plan = closurePlan([]);
  assert.equal(plan.none, true,
    "a PR that declares nothing must be distinguishable from one whose rows were all closed. Collapsing "
    + "them makes a job that resolved no references report success having done nothing.");
  assert.deepEqual(plan.close, []);
});

test("a mixed set is split, not decided by its first member", () => {
  const plan = closurePlan([
    { number: 1, state: "CLOSED" }, { number: 2, state: "OPEN" }, { number: 3, state: "OPEN" },
  ]);
  assert.deepEqual(plan.close, [2, 3]);
  assert.deepEqual(plan.already, [1]);
});

test("the exit codes are the contract, and CANNOT_ASK is distinct from a clean run", () => {
  assert.deepEqual(EXIT, { DONE: 0, COULD_NOT_CLOSE: 1, CANNOT_ASK: 2 });
});

test("the workflow fires only on a MERGED pull request into main", () => {
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, { if: string; steps: { uses?: string; run?: string; env?: Record<string, string> }[] }>;
  };
  // #394: `workflow_dispatch` joined `pull_request: closed` as a manual, on-demand path (a `push: main`
  // trigger would still need an entry on the watchdog allowlist and would still have to re-derive the
  // closing references from a commit range; neither is true of a manual dispatch against one named PR).
  assert.deepEqual(Object.keys(doc.on).sort(), ["pull_request", "workflow_dispatch"]);
  assert.deepEqual((doc.on as { pull_request: { types: string[] } }).pull_request, { types: ["closed"] });
  const job = doc.jobs.close;
  assert.match(job.if, /merged == true/,
    "without this a PR closed WITHOUT merging would close its rows — the exact 'closed a row whose work "
    + "did not land' failure close-merged-rows.mjs refuses to risk.");
  assert.match(job.if, /base\.ref == 'main'/,
    "a PR into a non-main base has not landed on the trunk and must close nothing.");
  assert.match(job.if, /workflow_dispatch/,
    "the manual trigger must be admitted by this job's own `if:`, or #394's dispatch input does nothing.");
});

test("the workflow can close issues and can do NOTHING else", () => {
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as { permissions: Record<string, string> };
  assert.equal(doc.permissions.issues, "write");
  assert.equal(doc.permissions.contents, "read",
    "this workflow must never be able to write code. `contents: write` here would give a job triggered "
    + "by a merged PR the ability to push, which is a far larger blast radius than closing a row.");
  assert.equal(doc.permissions["pull-requests"], "read");
});

test("the workflow actually RUNS the script — a correct plan wired to nothing is no plan", () => {
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    jobs: Record<string, { steps: { uses?: string; run?: string; env?: Record<string, string> }[] }>;
  };
  const steps = doc.jobs.close.steps;
  assert.ok(steps.some((s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout")),
    "it runs a script from the repo, so it needs a checkout — without one the step fails MODULE_NOT_FOUND, "
    + "the #331 shape where a workflow's missing prerequisite reads as a code bug.");
  const runner = steps.find((s) => s.run?.includes("close-rows-for-merged-pr.mjs"));
  assert.ok(runner, "no step runs scripts/close-rows-for-merged-pr.mjs.");
  assert.equal(runner?.env?.GH_TOKEN, "${{ github.token }}");
  assert.ok(runner?.env?.GITHUB_REPOSITORY,
    "the script exits CANNOT_ASK without it rather than guessing a repo.");
  assert.match(runner?.run ?? "", /pull_request\.number/,
    "it must act on the PR the event names, not on a search — acting on a set it derived itself is how a "
    + "tool closes a row nobody asked it to.");
});
