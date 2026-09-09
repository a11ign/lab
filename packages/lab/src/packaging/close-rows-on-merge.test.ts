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
import { closurePlan, labelsToStrip, EXIT } from "../../../../scripts/close-rows-for-merged-pr.mjs";
// THE AUDIT'S OWN DEBRIS CHECK, imported rather than re-derived -- #754's own mutation target is that
// THIS function, unchanged, must go quiet once labelsToStrip has done its work, and must report the
// finding again the moment it has not. Proving that with a re-implemented predicate would prove nothing
// about the real audit.
import { closedDebris } from "../../../../scripts/ready-label-audit.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW = `${REPO}.github/workflows/close-rows.yml`;

test("an OPEN declared row is closed", () => {
  const plan = closurePlan([{ number: 344, state: "OPEN" }]);
  assert.deepEqual(plan.close, [{ number: 344, labels: [] }]);
  assert.deepEqual(plan.already, []);
  assert.equal(plan.none, false);
});

test("#754: a row's labels travel with it into the close plan, from the SAME lookup that resolved state", () => {
  const plan = closurePlan([{ number: 344, state: "OPEN", labels: ["ready", "in-progress", "session:x"] }]);
  assert.deepEqual(plan.close, [{ number: 344, labels: ["ready", "in-progress", "session:x"] }]);
});

test("#754: a row with no labels field at all (an older caller, or a row with none) defaults to []", () => {
  const plan = closurePlan([{ number: 344, state: "OPEN" }]);
  assert.deepEqual(plan.close[0].labels, []);
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
  assert.deepEqual(plan.close, [{ number: 2, labels: [] }, { number: 3, labels: [] }]);
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

// --- #754: labelsToStrip -- the row's claim removed in the SAME act as the close ---

test("#754 ACCEPTANCE: a row closed by a merged PR loses ready, in-progress, started and session:* -- "
  + "MUTATION TARGET, this function is what makes audit's DEBRIS finding go quiet", () => {
  const stripped = labelsToStrip(["ready", "in-progress", "started", "session:worker-contracts", "backlog"]);
  assert.deepEqual(stripped.sort(), ["in-progress", "ready", "session:worker-contracts", "started"]);
});

test("#754 ACCEPTANCE: the was-ready marker is UNTOUCHED -- it is a record of what the row was, not a "
  + "claim on it (matches #703's real state after the 2026-09-09 hand clean-up)", () => {
  const stripped = labelsToStrip(["was-ready", "backlog"]);
  assert.deepEqual(stripped, []);
});

test("a row carrying none of the four never produces a spurious strip", () => {
  assert.deepEqual(labelsToStrip(["backlog", "ready-audit-exempt"]), []);
});

test("a row with no session:* label at all strips only what it actually carries", () => {
  assert.deepEqual(labelsToStrip(["ready", "backlog"]), ["ready"]);
});

test("only a label spelled EXACTLY session:<name>, not merely containing the word, is stripped as a claim", () => {
  assert.deepEqual(labelsToStrip(["session-notes", "backlog"]), [],
    "a label that happens to start with the letters 'session' but is not the session:<name> convention "
    + "must not be mistaken for a claim label");
});

// --- #754's OWN MUTATION TARGET: audit's real closedDebris(), driven against the real DEBRIS shapes ---

test("#754 MUTATION TARGET: closedDebris (the real audit check) reports the EXACT finding from the "
  + "2026-09-09 measurement -- #721 (ready), #703 (in-progress + session:product-manager), #687 "
  + "(in-progress + session:worker-capture) -- when a merge-close does NOT strip labels", () => {
  const closedWithoutStripping = [
    { number: 721, title: "row 721", state: "CLOSED" as const, labels: ["ready", "backlog"] },
    { number: 703, title: "row 703", state: "CLOSED" as const,
      labels: ["in-progress", "session:product-manager", "was-ready"] },
    { number: 687, title: "row 687", state: "CLOSED" as const, labels: ["in-progress", "session:worker-capture"] },
  ];
  const found = closedDebris(closedWithoutStripping);
  assert.deepEqual(found.map((f) => f.number).sort(), [687, 703, 721],
    "this is the exact finding measured 13:24:55Z before the hand clean-up -- the audit must reproduce "
    + "it against the unstripped shape, or this test is not proving anything about the real regression");
});

test("#754 ACCEPTANCE: closedDebris (the real audit check) is QUIET once labelsToStrip's output has "
  + "actually been removed from each of those same three rows -- was-ready survives and does not "
  + "trigger it", () => {
  const rowsAfterStripping = [
    { number: 721, title: "row 721", labels: ["ready", "backlog"] },
    { number: 703, title: "row 703", labels: ["in-progress", "session:product-manager", "was-ready"] },
    { number: 687, title: "row 687", labels: ["in-progress", "session:worker-capture"] },
  ].map((row) => ({
    ...row,
    state: "CLOSED" as const,
    labels: row.labels.filter((l) => !labelsToStrip(row.labels).includes(l)),
  }));
  assert.deepEqual(closedDebris(rowsAfterStripping), []);
  // The record survives -- proving the filter above did not simply delete every label.
  assert.ok(rowsAfterStripping.find((r) => r.number === 703)?.labels.includes("was-ready"));
});
