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
import {
  closurePlan, labelsToStrip, applyClosurePlan, settleClosedStatus, EXIT,
} from "../../../../scripts/close-rows-for-merged-pr.mjs";
// THE AUDIT'S OWN DEBRIS CHECK, imported rather than re-derived -- #754's own mutation target is that
// THIS function, unchanged, must go quiet once labelsToStrip has done its work, and must report the
// finding again the moment it has not. Proving that with a re-implemented predicate would prove nothing
// about the real audit.
import { closedDebris } from "../../../../scripts/ready-label-audit.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW = `${REPO}.github/workflows/trunk.yml`; // #909: close-rows.yml folded into trunk.yml's closeRows job

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
  assert.deepEqual(plan.already, [{ number: 310, labels: [] }]);
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
  assert.deepEqual(plan.already, [{ number: 1, labels: [] }]);
});

test("the exit codes are the contract, and CANNOT_ASK is distinct from a clean run", () => {
  assert.deepEqual(EXIT, { DONE: 0, COULD_NOT_CLOSE: 1, CANNOT_ASK: 2 });
});

test("#909: the closeRows job rides trunk.yml's push to main, and cannot push (contents: read)", () => {
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    on: Record<string, unknown>;
    jobs: Record<string, { permissions?: Record<string, string>; steps: { uses?: string; run?: string; env?: Record<string, string> }[] }>;
  };
  assert.deepEqual(Object.keys(doc.on).sort(), ["push", "workflow_dispatch"]);
  assert.deepEqual((doc.on as { push: { branches: string[] } }).push, { branches: ["main"] },
    "a push to main IS a merge landing (every merge is a PAT merge since #416); a PR closed WITHOUT merging "
    + "pushes nothing, so the 'closed a row whose work did not land' failure close-merged-rows.mjs refuses "
    + "to risk cannot arise from this trigger");
  const job = doc.jobs.closeRows;
  assert.ok(job, "trunk.yml carries the closeRows job");
  assert.deepEqual(job.permissions, { issues: "write", "pull-requests": "read", contents: "read" },
    "a job triggered by a merge must never be able to push -- the permissions close-rows.yml carried, and no more, "
    + "pinned on THIS job because decideRevert beside it legitimately holds contents: write");
  const run = job.steps.map((s) => s.run ?? "").join("\n");
  assert.match(run, /close-rows-for-merged-pr\.mjs/, "the same closure plan drives the dispatch path");
  assert.match(run, /close-rows-sweep\.mjs/, "and the push path");
  const env = job.steps.find((s) => s.run?.includes("close-rows"))?.env ?? {};
  assert.equal(env.GH_TOKEN, "${{ github.token }}");
  assert.equal(env.GITHUB_REPOSITORY, "${{ github.repository }}");
});

test("#909: the closeRows JOB can close issues and can do NOTHING else -- pinned at the job, beside a job that can push", () => {
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    permissions?: Record<string, string>;
    jobs: Record<string, { permissions?: Record<string, string> }>;
  };
  assert.deepEqual(doc.jobs.closeRows.permissions, { issues: "write", "pull-requests": "read", contents: "read" },
    "close-rows.yml carried exactly these at the workflow level; folded into trunk.yml they are pinned on the job, "
    + "because decideRevert in the same file legitimately holds contents: write and a workflow-level grant would "
    + "hand it to this job too");
  assert.equal(doc.permissions, undefined, "no workflow-level permissions block widens what closeRows gets");
});

test("#909: the closeRows job actually RUNS the scripts -- a correct plan wired to nothing is no plan", () => {
  const doc = parseYaml(readFileSync(WORKFLOW, "utf8")) as {
    jobs: Record<string, { steps: { uses?: string; run?: string; env?: Record<string, string> }[] }>;
  };
  const steps = doc.jobs.closeRows.steps;
  assert.ok(steps.some((s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout")),
    "it runs a script from the repo, so it needs a checkout -- without one the step fails MODULE_NOT_FOUND, "
    + "the #331 shape where a workflow's missing prerequisite reads as a code bug.");
  const runner = steps.find((s) => s.run?.includes("close-rows-for-merged-pr.mjs"));
  assert.ok(runner, "no step runs scripts/close-rows-for-merged-pr.mjs.");
  assert.equal(runner?.env?.GH_TOKEN, "${{ github.token }}");
  assert.ok(runner?.env?.GITHUB_REPOSITORY, "the script exits CANNOT_ASK without it rather than guessing a repo.");
  assert.equal(runner?.env?.DISPATCH_PR, "${{ github.event.inputs.pr }}",
    "the dispatch path acts on the PR the dispatcher names; the push path sweeps the window the merge is in, "
    + "idempotently, because a push event carries no PR number");
  assert.match(runner?.run ?? "", /close-rows-sweep\.mjs --window=60/);
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

// --- #776/#791: a NATIVELY-closed row (GitHub's own closing-keyword resolution) still gets stripped ---

test("#776/#791 ACCEPTANCE: closurePlan puts a natively-closed row's labels into `already`, not `close` "
  + "-- confirming the exact shape the real #677/#577/#752 bug had", () => {
  const plan = closurePlan([
    { number: 677, state: "CLOSED", labels: ["in-progress", "session:worker-capture"] },
  ]);
  assert.deepEqual(plan.close, []);
  assert.deepEqual(plan.already, [{ number: 677, labels: ["in-progress", "session:worker-capture"] }]);
});

test("#776/#791 MUTATION TARGET: the real #677 measurement, end to end through closedDebris -- a row "
  + "already CLOSED by the time closurePlan sees it must still read debris-free once already's labels "
  + "have been stripped, exactly like a freshly-closed row does", () => {
  const alreadyClosedByGitHub = { number: 677, state: "CLOSED" as const, title: "row 677",
    labels: ["backlog", "in-progress", "session:worker-capture", "started"] };
  const plan = closurePlan([alreadyClosedByGitHub]);
  assert.equal(plan.close.length, 0, "GitHub closed it before this script ran -- it is in already, not close");
  const stripped = alreadyClosedByGitHub.labels.filter((l) => !labelsToStrip(alreadyClosedByGitHub.labels).includes(l));
  assert.deepEqual(closedDebris([{ ...alreadyClosedByGitHub, labels: stripped }]), []);
});

// --- #776/#791: applyClosurePlan -- the WIRING, proven with injected closeOne/strip ---

test("#776/#791 MUTATION TARGET: applyClosurePlan strips EVERY already-closed row's labels, not just "
  + "freshly-closed ones -- this is the exact wiring gap the real #677/#577/#752 bug had", () => {
  const stripped: Array<[number, string[]]> = [];
  const failed = applyClosurePlan(
    { close: [], already: [{ number: 677, labels: ["in-progress", "session:worker-capture"] }] },
    { prNumber: "769", sha: "abc123", repo: "DanBeckDev/a11y-witness" },
    { strip: (n, labels) => { stripped.push([n, labels]); } },
  );
  assert.deepEqual(failed, []);
  assert.deepEqual(stripped, [[677, ["in-progress", "session:worker-capture"]]]);
});

test("applyClosurePlan still closes and strips a freshly-closing row, exactly as before", () => {
  const closedRows: number[] = [];
  const stripped: number[] = [];
  const failed = applyClosurePlan(
    { close: [{ number: 344, labels: ["ready"] }], already: [] },
    { prNumber: "1", sha: "abc", repo: "DanBeckDev/a11y-witness" },
    { closeOne: (n) => { closedRows.push(n); return true; }, strip: (n) => { stripped.push(n); } },
  );
  assert.deepEqual(failed, []);
  assert.deepEqual(closedRows, [344]);
  assert.deepEqual(stripped, [344]);
});

test("applyClosurePlan does NOT strip a row whose close failed -- a failed close reports failure, and "
  + "stripping labels on a row still actually open would be wrong", () => {
  const stripped: number[] = [];
  const failed = applyClosurePlan(
    { close: [{ number: 344, labels: ["ready"] }], already: [] },
    { prNumber: "1", sha: "abc", repo: "DanBeckDev/a11y-witness" },
    { closeOne: () => false, strip: (n) => { stripped.push(n); } },
  );
  assert.deepEqual(failed, [344]);
  assert.deepEqual(stripped, []);
});

/**
 * #1227: THE CLOSE-SIDE STATUS WRITE. `row-claim` wrote `In progress` on claim and nothing wrote the
 * resting state, so the board refilled with closed rows at a live Status **at the rate the org closes
 * rows** — measured during #1223/#1224 at roughly one per twenty minutes. Two backfills cleared 316 and
 * neither closed the loop, because a guard that DETECTS and a write that PREVENTS are different things.
 */
test("#1227: every row the plan closes gets its Status settled, in the same act", () => {
  const settled: number[] = [];
  const failed = applyClosurePlan(
    { close: [{ number: 10, labels: [] }, { number: 11, labels: [] }], already: [{ number: 12, labels: [] }] },
    { prNumber: "1", sha: "abc", repo: "o/r" },
    { closeOne: () => true, strip: () => {}, settle: (n: number) => { settled.push(n); } });
  assert.deepEqual(failed, []);
  // ALREADY-CLOSED rows too: #776/#791's reasoning is that such a row may be THIS merge one second
  // earlier, and its Status is exactly as stale as a freshly-closed row's.
  // [12, 10, 11] -- the ALREADY-CLOSED loop runs first. Asserted in order rather than sorted: the
  // sequence is a fact about the function and sorting it away would hide a reordering that changed it.
  assert.deepEqual(settled, [12, 10, 11],
    "a row closed by this run and a row already closed both need settling -- leaving the second is how "
    + "the population regrows from the path that was supposed to have fixed it");
});

test("#1227: a row that FAILED to close is not settled -- the Status must not say Done", () => {
  const settled: number[] = [];
  const failed = applyClosurePlan(
    { close: [{ number: 20, labels: [] }], already: [] },
    { prNumber: "1", sha: "abc", repo: "o/r" },
    { closeOne: () => false, strip: () => {}, settle: (n: number) => { settled.push(n); } });
  assert.deepEqual(failed, [20]);
  assert.deepEqual(settled, [],
    "the row is still OPEN -- moving it to Done would advertise finished work that is not finished, "
    + "which is the reverse direction of the defect this fixes");
});

test("#1227: the three outcomes are reported distinctly, never folded into one success", () => {
  const said: string[] = [];
  const log = console.log;
  console.log = (line: string) => { said.push(String(line)); };
  try {
    settleClosedStatus(1, { moveStatus: () => ({ moved: true }) });
    settleClosedStatus(2, { moveStatus: () => ({ moved: false, notOnBoard: true, reason: "not an item" }) });
    settleClosedStatus(3, { moveStatus: () => ({ moved: false, notOnBoard: false, reason: "HTTP 500" }) });
  } finally { console.log = log; }
  assert.match(said[0], /#1 Status -> Done/);
  assert.match(said[1], /#2 is not on the Project/,
    "a row not on the board is a real, common state and not a defect -- ceo's ruling");
  assert.match(said[2], /#3 CLOSED but Status NOT moved -- HTTP 500/,
    "and a genuine failure is the half-applied case: the close landed and the board write did not, which "
    + "must not look like an ordinary success");
});
