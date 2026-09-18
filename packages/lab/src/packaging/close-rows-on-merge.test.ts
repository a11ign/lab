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
  closurePlan, labelsToStrip, applyClosurePlan, EXIT, closeRowsExit, liveClosureEffects, stripClaimLabels,
  LIVE_SETTLE_DEPS, rateLimitHeaders, rateLimitLine, logRateLimit,
} from "../../../agent-org/src/close-rows-for-merged-pr.mjs";
import { refusalCause } from "../../../agent-org/src/settle-closed-status.mjs";
import { moveProjectStatus } from "../../../agent-org/src/row-claim.mjs";
import { scopedStatus } from "../../../agent-org/src/board-snapshot.mjs";
import { stripComments } from "@a11ign/evidence/source-text";
// THE AUDIT'S OWN DEBRIS CHECK, imported rather than re-derived -- #754's own mutation target is that
// THIS function, unchanged, must go quiet once labelsToStrip has done its work, and must report the
// finding again the moment it has not. Proving that with a re-implemented predicate would prove nothing
// about the real audit.
import { closedDebris } from "../../../agent-org/src/ready-label-audit.mjs";

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
  assert.deepEqual(EXIT, { DONE: 0, COULD_NOT_CLOSE: 1, CANNOT_ASK: 2, STATUS_NOT_MOVED: 3 });
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
  assert.ok(runner, "no step runs packages/agent-org/src/close-rows-for-merged-pr.mjs.");
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

/** #1400: a `settle` that moves nothing and reaches nothing. Every call below passes all three effects. */
const settledOk = () => ({ settled: true, refused: [] });

test("#776/#791 MUTATION TARGET: applyClosurePlan strips EVERY already-closed row's labels, not just "
  + "freshly-closed ones -- this is the exact wiring gap the real #677/#577/#752 bug had", () => {
  const stripped: Array<[number, string[]]> = [];
  const { failed } = applyClosurePlan(
    { close: [], already: [{ number: 677, labels: ["in-progress", "session:worker-capture"] }] },
    { prNumber: "769", sha: "abc123", repo: "DanBeckDev/a11y-witness" },
    { closeOne: () => true, strip: (n, labels) => { stripped.push([n, labels]); }, settle: settledOk },
  );
  assert.deepEqual(failed, []);
  assert.deepEqual(stripped, [[677, ["in-progress", "session:worker-capture"]]]);
});

test("applyClosurePlan still closes and strips a freshly-closing row, exactly as before", () => {
  const closedRows: number[] = [];
  const stripped: number[] = [];
  const { failed } = applyClosurePlan(
    { close: [{ number: 344, labels: ["ready"] }], already: [] },
    { prNumber: "1", sha: "abc", repo: "DanBeckDev/a11y-witness" },
    { closeOne: (n) => { closedRows.push(n); return true; }, strip: (n) => { stripped.push(n); }, settle: settledOk },
  );
  assert.deepEqual(failed, []);
  assert.deepEqual(closedRows, [344]);
  assert.deepEqual(stripped, [344]);
});

test("applyClosurePlan does NOT strip a row whose close failed -- a failed close reports failure, and "
  + "stripping labels on a row still actually open would be wrong", () => {
  const stripped: number[] = [];
  const { failed } = applyClosurePlan(
    { close: [{ number: 344, labels: ["ready"] }], already: [] },
    { prNumber: "1", sha: "abc", repo: "DanBeckDev/a11y-witness" },
    { closeOne: () => false, strip: (n) => { stripped.push(n); }, settle: settledOk },
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
  const { failed } = applyClosurePlan(
    { close: [{ number: 10, labels: [] }, { number: 11, labels: [] }], already: [{ number: 12, labels: [] }] },
    { prNumber: "1", sha: "abc", repo: "o/r" },
    { closeOne: () => true, strip: () => {}, settle: (n: number) => { settled.push(n); return { settled: true, refused: [] }; } });
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
  const { failed } = applyClosurePlan(
    { close: [{ number: 20, labels: [] }], already: [] },
    { prNumber: "1", sha: "abc", repo: "o/r" },
    { closeOne: () => false, strip: () => {}, settle: (n: number) => { settled.push(n); return { settled: true, refused: [] }; } });
  assert.deepEqual(failed, [20]);
  assert.deepEqual(settled, [],
    "the row is still OPEN -- moving it to Done would advertise finished work that is not finished, "
    + "which is the reverse direction of the defect this fixes");
});


test("#1299: applyClosurePlan NAMES a closed row whose Status did not move, on both paths -- and a clean run names none", () => {
  const plan = { close: [{ number: 31, labels: [] }], already: [{ number: 30, labels: [] }] };
  const ctx = { prNumber: "1", sha: "abc", repo: "o/r" };
  const deps = { closeOne: () => true, strip: () => {} };
  assert.deepEqual(applyClosurePlan(plan, ctx, { ...deps, settle: refuseOnly(30, "HTTP 500") }),
    { failed: [], unsettled: [refusal(30, "HTTP 500")] }, "the already-closed path");
  assert.deepEqual(applyClosurePlan(plan, ctx, { ...deps, settle: refuseOnly(31, "HTTP 500") }),
    { failed: [], unsettled: [refusal(31, "HTTP 500")] }, "the just-closed path");
  assert.deepEqual(applyClosurePlan(plan, ctx, { ...deps, settle: () => ({ settled: true, refused: [] }) }), { failed: [], unsettled: [] },
    "the positive control: a run whose every move settled names nobody");
});

/** CAPTURED, not composed: the reason `moveProjectStatus` gave for #1299 in trunk run 34769927592 (`02ae7420`). */
const CAPTURED_PROJECT_UNREADABLE = "could not move #1299's Status to \"Done\" -- board-snapshot: could not read "
  + "Project 2 items -- refusing to snapshot a partial board. NOT_FOUND (user.projectV2): Could not resolve to a "
  + "ProjectV2 with the number 2.";
/** A refusal classified by the real `refusalCause`, never a hand-typed cause. */
function refusal(row: number, message: string) { return { row, cause: refusalCause(message), message }; }
/** A `settle` that refuses exactly one row, for `message`, and settles every other. */
function refuseOnly(row: number, message: string) {
  return (n: number) => (n === row ? { settled: false, refused: [refusal(n, message)] } : { settled: true, refused: [] });
}

test("#1299: the dispatch path's exit is ONE pure decision -- a refused Status move exits STATUS_NOT_MOVED, named", () => {
  const unsettled = closeRowsExit({ failed: [], unsettled: [refusal(30, "HTTP 500"), refusal(31, "HTTP 500")] }, "CLOSE-ROWS");
  assert.equal(unsettled.code, EXIT.STATUS_NOT_MOVED);
  assert.match(unsettled.lines.join("\n"), /^CLOSE-ROWS: closed, but Status NOT moved for 2: #30 #31 /m);
  const both = closeRowsExit({ failed: [5], unsettled: [refusal(31, "HTTP 500")] }, "CLOSE-ROWS");
  assert.equal(both.code, EXIT.COULD_NOT_CLOSE, "a row that could not be closed outranks a Status that did not move");
  assert.match(both.lines.join("\n"), /could not close 1: 5\b/);
  assert.match(both.lines.join("\n"), /Status NOT moved for 1: #31\b/, "and the second fact is still named");
  // POSITIVE CONTROL: nothing failed and every Status settled exits DONE and says nothing.
  assert.deepEqual(closeRowsExit({ failed: [], unsettled: [] }, "CLOSE-ROWS"), { code: EXIT.DONE, lines: [] });
});

test("bridge: the dispatch path exits DONE with ONE DEGRADED line when every refusal is the captured project-unreadable -- 3 otherwise", () => {
  const ctx = { prNumber: "1", sha: "abc", repo: "o/r" };
  const plan = { close: [{ number: 31, labels: [] }], already: [{ number: 30, labels: [] }] };
  const deps = { closeOne: () => true, strip: () => {} };
  const unreadable = (n: number) => ({ settled: false, refused: [refusal(n, CAPTURED_PROJECT_UNREADABLE)] });

  const degraded = closeRowsExit(applyClosurePlan(plan, ctx, { ...deps, settle: unreadable }), "CLOSE-ROWS");
  assert.equal(degraded.code, EXIT.DONE, "the CI run as captured: nothing but an unreadable Project");
  assert.equal(degraded.lines.length, 1, "one line, and it says so");
  assert.match(degraded.lines[0], /^CLOSE-ROWS: DEGRADED -- closed, but Status NOT moved for 2: #30 #31 -- every refusal was project-unreadable/);

  const mixed = closeRowsExit(applyClosurePlan(plan, ctx,
    { ...deps, settle: (n: number) => (n === 31 ? { settled: false, refused: [refusal(n, "HTTP 500")] } : unreadable(n)) }),
  "CLOSE-ROWS");
  assert.equal(mixed.code, EXIT.STATUS_NOT_MOVED, "one refusal for another cause exits 3, whatever else was unreadable");
  assert.doesNotMatch(mixed.lines.join("\n"), /DEGRADED/);
  assert.match(mixed.lines.join("\n"), /not project-unreadable: #31\)/);

  const failedToo = closeRowsExit({ failed: [5], unsettled: [refusal(30, CAPTURED_PROJECT_UNREADABLE)] }, "CLOSE-ROWS");
  assert.equal(failedToo.code, EXIT.COULD_NOT_CLOSE, "a degraded Status never softens a row that could not be closed");
});

/** COMMENTS STRIPPED: commenting the call out IS the mutation a prose search agrees with. */
test("#1299: the dispatch path's main() EXITS WITH that decision -- worker-capture's M1 on #1357 left it untested", () => {
  const source = readFileSync(new URL("../../../agent-org/src/close-rows-for-merged-pr.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const mainBody = source.slice(source.indexOf("function main() {"));
  assert.match(mainBody, /const \{ code, lines \} = closeRowsExit\(applyClosurePlan\(/,
    "main() takes its exit from closeRowsExit over applyClosurePlan's outcome");
  const afterPlan = mainBody.slice(mainBody.indexOf("closeRowsExit(applyClosurePlan("));
  // #1443: exits through `exitAfterSweep`, not a bare `process.exit`, so a rate-limit reading always
  // pairs with the exit -- still, and only ever, with `code`, the same guarantee this test has pinned
  // since #1299/#1357.
  assert.match(afterPlan, /^\s*exitAfterSweep\(code\);/m, "and exits with that code");
  assert.doesNotMatch(afterPlan, /exitAfterSweep\(EXIT\.DONE\)/, "not with DONE, whatever the outcome said");
});

/**
 * #1400: A TEST THAT OMITS AN EFFECT MUST FAIL, NOT REACH GITHUB. Each effect used to default to the live one, and two
 * tests above reached the real Project 2 mover for #677 and #344 through the `settle` they left out -- passing while
 * they did it, because `settleClosedStatus` never throws. The positive control: leave each effect out in turn.
 */
test("#1400 POSITIVE CONTROL: an omitted effect is refused by name BEFORE any effect runs -- never a live call", () => {
  const plan = { close: [{ number: 41, labels: ["in-progress"] }], already: [{ number: 40, labels: ["in-progress"] }] };
  const ctx = { prNumber: "1", sha: "abc", repo: "o/r" };
  for (const omitted of ["closeOne", "strip", "settle"] as const) {
    const ran: string[] = [];
    const effects: Record<string, unknown> = {
      closeOne: () => { ran.push("closeOne"); return true; },
      strip: () => { ran.push("strip"); },
      settle: () => { ran.push("settle"); return settledOk(); },
    };
    delete effects[omitted];
    assert.throws(() => applyClosurePlan(plan, ctx, effects as never),
      new RegExp(`applyClosurePlan: no ${omitted} given`), `omitting ${omitted} is refused, naming it`);
    assert.deepEqual(ran, [], `and nothing ran before the refusal when ${omitted} was missing`);
  }
  assert.throws(() => applyClosurePlan(plan, ctx, undefined as never), /no closeOne, strip, settle given/,
    "no effects at all names all three");
});

test("#1400: liveClosureEffects is the ONE place the live effects are named -- main() passes it, nothing defaults to it", () => {
  const live = liveClosureEffects();
  assert.deepEqual(Object.keys(live).sort(), ["closeOne", "settle", "strip"]);
  assert.equal(live.strip, stripClaimLabels, "the live strip is the exported gh issue edit");
  for (const effect of Object.values(live)) assert.equal(typeof effect, "function", "each is a function, and none is called here");
  const source = readFileSync(new URL("../../../agent-org/src/close-rows-for-merged-pr.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const mainBody = source.slice(source.indexOf("function main() {"));
  assert.match(mainBody, /applyClosurePlan\(plan, \{ prNumber: number, sha, repo \}, liveClosureEffects\(\)\)/,
    "main() hands applyClosurePlan the live effects explicitly -- without them production would be refused too");
});

// --- #1360: both live settle paths use ONE definition, and it carries the scoped Status lookup ---

test("#1360 LIVE_SETTLE_DEPS carries the scoped Status lookup and the real move -- by identity, never called", () => {
  // Identity only: calling either reaches Project 2, which this file must not do (#1400).
  assert.equal(LIVE_SETTLE_DEPS.currentStatus, scopedStatus,
    "without the lookup every closed row is moved, Done or not -- the mutation #1360 exists to save");
  assert.equal(LIVE_SETTLE_DEPS.moveStatus, moveProjectStatus);
});

test("#1360 BOTH defaults settle with LIVE_SETTLE_DEPS: the per-merge effects and the sweep's closeOnePr", () => {
  // Read from CODE with comments stripped, anchored to the call shape only code can have. Measured before this test:
  // the sweep's own inline default could drop currentStatus and every close-rows test stayed green.
  const code = (rel: string) => stripComments(readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), "utf8"));
  assert.match(code("packages/agent-org/src/close-rows-for-merged-pr.mjs"), /settle:\s*\(\s*n\s*\)\s*=>\s*settleClosedStatus\(n,\s*LIVE_SETTLE_DEPS\)/,
    "liveClosureEffects' settle must use the one definition");
  assert.match(code("packages/agent-org/src/close-rows-sweep.mjs"), /settle\s*=\s*\(\s*n\s*\)\s*=>\s*settleClosedStatus\(n,\s*LIVE_SETTLE_DEPS\)/,
    "closeOnePr's default settle must use the one definition");
  for (const rel of ["packages/agent-org/src/close-rows-for-merged-pr.mjs", "packages/agent-org/src/close-rows-sweep.mjs"]) {
    assert.doesNotMatch(code(rel), /settleClosedStatus\(n,\s*\{/, `${rel} builds its own settle deps inline again`);
  }
});

// ---------------------------------------------------------------------------------------------------
// #1443: WAS #1360's SAVING (no Status move for a row already Done) WORTH ANYTHING, MEASURED?
//
// The reviewer's `not-convinced` on #1429 named exactly this gap: no before/after `X-Ratelimit-Used`
// evidence for one sweep. Real headers, captured live via `gh api graphql -f query=... --include`
// (confirmed live, 2026-09-18: `X-Ratelimit-Used=2361` before a dispatch, `2468` after -- the true cost
// of a real closeRows dispatch with a Status move to do), never `gh api rate_limit`'s own separately
// cached body (#1275: "always 5000/5000").
// ---------------------------------------------------------------------------------------------------

const REAL_HEADER_DUMP = [
  "HTTP/2.0 200 OK",
  "Access-Control-Allow-Origin: *",
  "X-Ratelimit-Limit: 5000",
  "X-Ratelimit-Remaining: 2680",
  "X-Ratelimit-Reset: 1789726162",
  "X-Ratelimit-Resource: graphql",
  "X-Ratelimit-Used: 2320",
  "",
  '{"data":{"rateLimit":{"limit":5000,"cost":1,"remaining":2680,"resetAt":"2026-09-18T10:09:22Z"}}}',
].join("\n");

test("#1443 rateLimitHeaders reads a REAL gh api ... --include dump, headers and body together", () => {
  assert.deepEqual(rateLimitHeaders(REAL_HEADER_DUMP), { used: "2320", reset: "1789726162" });
});

test("#1443 rateLimitHeaders is case-insensitive on the header name -- HTTP headers are", () => {
  const dump = "HTTP/2.0 200 OK\nx-ratelimit-used: 42\nx-ratelimit-reset: 111\n\n{}";
  assert.deepEqual(rateLimitHeaders(dump), { used: "42", reset: "111" });
});

test("#1443 rateLimitHeaders reads null for BOTH fields when the header is genuinely absent", () => {
  assert.deepEqual(rateLimitHeaders("HTTP/2.0 200 OK\nContent-Type: text/plain\n\n{}"),
    { used: null, reset: null });
});

test("#1443 MUTATION TARGET: a body line that happens to contain the words never matches -- header block only", () => {
  // The blank-line split is the whole point: a mutation that read the WHOLE dump for the pattern would
  // pass this test by accident (nothing here mentions the words in the body), so it is stated directly.
  const dump = "HTTP/2.0 200 OK\nContent-Type: text/plain\n\n"
    + "this body mentions x-ratelimit-used: 999 but is not a header";
  assert.deepEqual(rateLimitHeaders(dump), { used: null, reset: null });
});

test("#1443 rateLimitLine names both values when both are present", () => {
  const line = rateLimitLine("before sweep", REAL_HEADER_DUMP);
  assert.match(line, /^RATE-LIMIT before sweep:/);
  assert.match(line, /X-Ratelimit-Used=2320/);
  assert.match(line, /X-Ratelimit-Reset=1789726162/);
});

test("#1443 rateLimitLine states COULD NOT READ, never a silently blank line, when the header is absent", () => {
  const line = rateLimitLine("after sweep", "HTTP/2.0 200 OK\n\n{}");
  assert.match(line, /^RATE-LIMIT after sweep: COULD NOT READ/);
});

test("#1443 logRateLimit never throws, and asks with exactly the injected run -- never the live gh", () => {
  const asked: string[][] = [];
  const originalLog = console.log;
  const printed: string[] = [];
  console.log = (line: string) => printed.push(line);
  try {
    logRateLimit("before sweep", (args: string[]) => { asked.push(args); return REAL_HEADER_DUMP; });
  } finally {
    console.log = originalLog;
  }
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].slice(0, 2), ["api", "graphql"]);
  assert.ok(asked[0].includes("--include"), "must ask for the response headers, not just the body");
  assert.ok(printed.some((line) => /X-Ratelimit-Used=2320/.test(line)));
});

test("#1443 logRateLimit does not throw when the injected run itself throws -- a reading must not take the sweep down", () => {
  const originalError = console.error;
  const printed: string[] = [];
  console.error = (line: string) => printed.push(line);
  try {
    assert.doesNotThrow(() => logRateLimit("before sweep", () => { throw new Error("gh: rate-limited"); }));
  } finally {
    console.error = originalError;
  }
  assert.ok(printed.some((line) => /could not read/.test(line)));
});
