// no-token: gh
//
// This file imports `arm-pr.mjs`, which spawns `gh`, and the parser charges a command its whole import
// closure. True of the IMPORT and false of the CALL: every impure test here injects its own `run`.
//
// PROVED, NOT ASSERTED, since #827's check is deliberately shallow: GH_TOKEN and GITHUB_TOKEN unset, a
// fake `gh` first on PATH that exits 97 and shouts -- 17 pass, 0 fail, and the fake never printed.
/**
 * #725: AN ARMED PR CARRIES NOTHING SAYING WHOSE IT IS.
 *
 * Measured 2026-09-09, 12:30Z: ceo read the open-PR list, found #717 opened seven minutes earlier and
 * armed, and could not say whose it was without three hops -- PR -> branch name -> row number -> row's
 * `session:*` label -- and the last hop only worked because the branch happened to end in its row
 * number. Every worker's branch shares the `agent/*` prefix, so the branch alone never says who.
 *
 * The fix is in the arm path, because `arm-pr.mjs` already has the row's label in hand at exactly the
 * moment it decides whether to arm (#645's hold check reads the PR; this reads the row the PR closes) --
 * one place where the information and the action coincide.
 *
 * THE ROW IS READ FROM THE PR BODY'S `Closes #N`, NEVER FROM THE BRANCH NAME. Deriving it from
 * `agent/…-655` would be the same three-hop guess with fewer steps visible, and wrong for any branch
 * not ending in its row number -- so these tests drive `closedRowNumbers` from body text, never a
 * branch, and there is no branch-name parsing anywhere in `arm-pr.mjs` to accidentally exercise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
// #2046: the armed predicate now lives beside the hold predicate, in its own leaf module.
import { armedQueryArgs, armedReason } from "../../../agent-org/src/pr-armed-state.mjs";
import {
  closedRowNumbers,
  sessionLabelsOf,
  sessionLabelsForArm,
  labelArmedPr,
  LIVE_SESSIONS,
  RETIRED_SESSIONS,
  unknownSessionLabels,
  settledReason,
  prState,
  waitForSettled,
  armMerge,
  runArmPr,
  EXIT,
  TRUNK_FIX_POLICY,
  extractTrunkFixDeclaration,
  redStreak,
  redStreakReading,
  jumpDecision,
  atFrontOfQueue,
  enqueueAtFront,
} from "../../../agent-org/src/arm-pr.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** A fake `run` recording every call it received and returning canned `gh issue view` output. */
function fakeRun(rowLabelsByNumber: Record<string, string[]>) {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args[0] === "issue" && args[1] === "view") {
      const number = args[2];
      const labels = rowLabelsByNumber[number] ?? [];
      return JSON.stringify({ labels: labels.map((name) => ({ name })) });
    }
    return "";
  };
  return { run, calls };
}

test("closedRowNumbers reads the row from `Closes #N` in the PR body, never a branch name -- there is "
  + "no branch argument to this function at all", () => {
  assert.deepEqual(closedRowNumbers("## Summary\n\nCloses #725\n"), [725]);
  assert.deepEqual(closedRowNumbers("Closes #717, #718\n"), [717, 718]);
});

test("closedRowNumbers is EMPTY, not a guess, when the body names no row -- MISSING, MALFORMED, and "
  + "an explicit `Closes: none` all come back with nothing to label from", () => {
  assert.deepEqual(closedRowNumbers("no closes line here"), []);
  assert.deepEqual(closedRowNumbers("Closes: none — nothing to close"), []);
  assert.deepEqual(closedRowNumbers(null), []);
  assert.deepEqual(closedRowNumbers(undefined), []);
});

test("sessionLabelsOf keeps only session:* -- a row's other labels (ready, backlog, in-progress) are "
  + "not attribution and must not leak onto the PR", () => {
  assert.deepEqual(
    sessionLabelsOf(["ready", "in-progress", "session:worker-capture", "backlog"]),
    ["session:worker-capture"],
  );
});

test("A ROW WITH NO SESSION LABEL CONTRIBUTES NOTHING -- #725's own ruling: a row with no session "
  + "label is unclaimed whoever filed it, and a PR is not the place to assert a claim the row does "
  + "not make", () => {
  assert.deepEqual(sessionLabelsOf(["ready", "backlog"]), []);
  assert.deepEqual(sessionLabelsForArm([["ready", "backlog"]]), []);
});

test("Arming a PR for a row carrying session:X puts session:X on the PR", () => {
  assert.deepEqual(
    sessionLabelsForArm([["ready", "in-progress", "session:worker-capture"]]),
    ["session:worker-capture"],
  );
});

test("A row with two session labels puts both on, rather than picking one", () => {
  assert.deepEqual(
    sessionLabelsForArm([["session:worker-capture", "session:orchestrator"]]).sort(),
    ["session:orchestrator", "session:worker-capture"],
  );
});

test("Two rows closed by one PR: each row's session label is kept, deduplicated, order-independent", () => {
  assert.deepEqual(
    sessionLabelsForArm([["session:worker-capture"], ["session:worker-capture"], ["ready"]]),
    ["session:worker-capture"],
  );
  assert.deepEqual(
    sessionLabelsForArm([["session:a"], ["session:b"]]).sort(),
    ["session:a", "session:b"],
  );
});

test("labelArmedPr: a row carrying session:X gets it added to the PR, read from the row at arm time", () => {
  const { run, calls } = fakeRun({ "725": ["ready", "in-progress", "session:worker-capture"] });
  labelArmedPr({ number: "817", repo: "org/repo", prBody: "Closes #725\n", run });
  const editCall = calls.find((c) => c[1] === "pr" && c[2] === "edit");
  assert.ok(editCall, "expected a `gh pr edit` call");
  assert.ok(editCall!.includes("--add-label") && editCall!.includes("session:worker-capture"));
});

test("labelArmedPr: a row with NO session label leaves the PR unlabelled -- no gh pr edit call at all, "
  + "not an invented label", () => {
  const { run, calls } = fakeRun({ "725": ["ready", "backlog"] });
  labelArmedPr({ number: "817", repo: "org/repo", prBody: "Closes #725\n", run });
  assert.equal(calls.find((c) => c[1] === "pr" && c[2] === "edit"), undefined);
});

test("labelArmedPr: a PR body with no Closes declaration makes no gh call at all -- nothing to read, "
  + "nothing to label, and no branch name ever consulted", () => {
  const { run, calls } = fakeRun({});
  labelArmedPr({ number: "817", repo: "org/repo", prBody: "no closes line here", run });
  assert.equal(calls.length, 0);
});

test("labelArmedPr: two rows, two different session labels -- both go on the PR in one call", () => {
  const { run, calls } = fakeRun({
    "717": ["session:worker-capture"],
    "718": ["session:orchestrator"],
  });
  labelArmedPr({ number: "900", repo: "org/repo", prBody: "Closes #717, #718\n", run });
  const editCall = calls.find((c) => c[1] === "pr" && c[2] === "edit")!;
  assert.ok(editCall.includes("session:worker-capture") && editCall.includes("session:orchestrator"));
});

test("labelArmedPr: a row this can't read leaves the PR unlabelled for it rather than throwing -- arming "
  + "already succeeded by the time this runs, and a label is not worth failing the arm over", () => {
  const run = (_cmd: string, args: string[]) => {
    if (args[0] === "issue" && args[1] === "view") throw new Error("row not found");
    return "";
  };
  assert.doesNotThrow(() => labelArmedPr({ number: "817", repo: "org/repo", prBody: "Closes #725\n", run }));
});

test("Re-arming an already-labelled PR calls labelArmedPr again but issues the SAME single add-label "
  + "call, not an accumulating one -- gh's own --add-label is idempotent, so no special-case dedup "
  + "against the PR's current labels is needed here", () => {
  const { run, calls } = fakeRun({ "725": ["session:worker-capture"] });
  labelArmedPr({ number: "817", repo: "org/repo", prBody: "Closes #725\n", run });
  labelArmedPr({ number: "817", repo: "org/repo", prBody: "Closes #725\n", run });
  const editCalls = calls.filter((c) => c[1] === "pr" && c[2] === "edit");
  assert.equal(editCalls.length, 2, "one call per arm, as designed -- idempotent on GitHub's side");
  for (const c of editCalls) {
    assert.equal(c.filter((a) => a === "session:worker-capture").length, 1,
      "never more than one copy of the same label in a single call");
  }
});

// --- #1000: A RETIRED SESSION LABEL IS REFUSED, BY NAME ----------------------------------------------
//
// #913 retired four session labels BY DESCRIPTION rather than by deletion: deleting one strips it from the
// merged PRs carrying it as attribution, and eleven of thirteen are read by `attributionFor` to return the
// `worker` verdict. So four live labels carry a retired meaning, and the only thing keeping them retired
// was that nobody applied one -- a rule nobody enforces, which is a rule that has already drifted.

test("#1000: the live and retired sets are DISJOINT, and the split is checked against the REAL labels", () => {
  // worker-capture's review: the first version compared these two lists against a THIRD hand-typed one in
  // this same file, so "a sixth session added next month fails this" was not delivered -- creating
  // `session:worker-fleet` tomorrow changed nothing the test read. My own #1016 reasoning is the argument
  // against it: a literal is a second copy of something GitHub holds, and a drifted one names things that
  // do not exist.
  //
  // So the DISJOINTNESS is checked here (pure, always), and the COVERAGE is checked against `gh label
  // list` in arm-pr-labels-live.test.ts (#1140) -- which needs a token, so it reports honestly rather than
  // passing when it cannot ask.
  assert.deepEqual(LIVE_SESSIONS.filter((s) => RETIRED_SESSIONS.includes(s)), [],
    "a session cannot be both live and retired");
  assert.ok(LIVE_SESSIONS.length >= 1 && RETIRED_SESSIONS.length >= 1);
});

test("#1000: a not-live label is NAMED, and says WHICH KIND of not-live", () => {
  assert.deepEqual(unknownSessionLabels(["session:worker-judge", "session:dispatcher"]),
    [{ label: "session:dispatcher", retired: true }]);
  assert.deepEqual(unknownSessionLabels(["session:ceo", "session:product-manager"]), [],
    "every live session passes -- a refusal that fires on the normal case is how a guard gets bypassed");
  // worker-capture's second finding: a typo and a session created next week are NOT retired, and telling
  // them they were sends the reader to a row with nothing to do with their problem. Refusing all three is
  // right -- failing closed -- but the sentence has to be true of each.
  assert.deepEqual(unknownSessionLabels(["session:worker-captur", "session:brand-new-role"]),
    [{ label: "session:worker-captur", retired: false }, { label: "session:brand-new-role", retired: false }]);
});

test("#1000: the refusal applies NOTHING -- not even the live label beside the retired one", () => {
  // A partial arm is the state nobody can tell from a complete one: the PR would carry one true claim and
  // silently lack another, and `attributionFor` reads what is there, not what was meant.
  const { calls, run } = fakeRun({ 725: ["session:dispatcher", "session:worker-judge"] });
  labelArmedPr({ number: "817", repo: "org/repo", prBody: "Closes #725\n", run });
  assert.equal(calls.find((c) => c[1] === "pr" && c[2] === "edit"), undefined,
    "a retired label refuses the whole arm; nothing is applied");
});

test("#1000: a row carrying only LIVE labels arms exactly as it does today -- both directions", () => {
  const { calls, run } = fakeRun({ 725: ["session:worker-judge"] });
  labelArmedPr({ number: "817", repo: "org/repo", prBody: "Closes #725\n", run });
  const editCall = calls.find((c) => c[1] === "pr" && c[2] === "edit");
  assert.ok(editCall, "a live session must arm unchanged -- a refusal that fires on the normal case is "
    + "how a guard gets bypassed");
  assert.ok(editCall!.includes("session:worker-judge"));
});
;

// --- #1022: ARMING IS VERIFIED FROM THE PR'S STATE, NEVER FROM `gh`'s EXIT CODE ---
//
// Found live: marking #1020 ready fired the `arm` workflow while `gate` was already green, so GitHub
// merged the PR immediately and `gh pr merge --auto` answered `GraphQL: Merge already in progress`. Every
// non-zero `gh` exit threw, so the workflow went RED on a PR that had merged correctly -- `mergedAt` is
// 01:15:33Z and the merge call was refused at 01:15:33.05Z, the same second.
//
// The mirror of this is ALREADY PINNED ABOVE, for disarming: "`gh pr merge --disable-auto` returns success
// on a PR that is already merging, having changed nothing". Disarming is read from the state because the
// exit code lies about SUCCESS; arming was read from the exit code, which lies about FAILURE. One half of
// the class was fixed. These tests are the other half.

/**
 * The three shapes the GraphQL armed read can come back with, as the API really returns them.
 * `QUEUED` is #2044's own, read at 2026-09-22T23:5xZ while the red `arm` check still stood (#2046).
 */
const QUEUED_PR = { merged: false, autoMergeRequest: null, mergeQueueEntry: { state: "AWAITING_CHECKS" } };
const AUTO_MERGING_PR = { merged: false, autoMergeRequest: { enabledAt: "2026-09-22T23:49:40Z" }, mergeQueueEntry: null };
const UNARMED_PR = { merged: false, autoMergeRequest: null, mergeQueueEntry: null };

/**
 * A `gh` stub: `pr view --json state` answers `state`, `pr merge` fails with `mergeError` if given, and
 * (#2046) `api graphql` answers `armed` -- UNARMED by default, which is the answer that makes a refused
 * merge a real fault. The string `"unreadable"` makes the read itself FAIL, which is not the same as
 * "not armed" and is tested as its own case; a sentinel rather than `undefined`, because `undefined`
 * would hit the parameter default above and quietly answer UNARMED instead.
 */
function ghStub({ state, mergeError, states, armed = UNARMED_PR }: {
  state?: string; mergeError?: string; states?: (string | undefined)[]; armed?: object | null | "unreadable";
}) {
  const calls: string[][] = [];
  let reads = 0;
  const run = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args[1] === "merge") {
      if (mergeError) { const e = new Error(mergeError) as Error & { status: number }; e.status = 1; throw e; }
      return "";
    }
    if (args[1] === "view") {
      const answer = states ? states[Math.min(reads, states.length - 1)] : state;
      reads += 1;
      if (answer === undefined) throw new Error("gh: HTTP 502");
      return JSON.stringify({ state: answer });
    }
    if (args[0] === "api") {
      if (armed === "unreadable") throw new Error("gh: HTTP 502");
      return JSON.stringify(armed);
    }
    return "";
  };
  return { run, calls };
}

/** Swallows the stderr line `armedAlready` prints when its read fails -- asserted where it matters. */
const QUIET = { sleep: () => "ok" as const, error: () => {} };

test("#1022 ACCEPTANCE: a merge refused because the PR ALREADY MERGED is a success, not a failure -- and "
  + "the verdict names the STATE it read", () => {
  const { run, calls } = ghStub({ mergeError: "GraphQL: Merge already in progress (mergePullRequest)",
    state: "MERGED" });
  const outcome = armMerge({ number: "1020", repo: "o/r" }, { run, sleep: () => "ok" as const });
  assert.equal(outcome.armed, false, "nothing was armed -- and that is the correct outcome here");
  assert.match(outcome.reason, /already merged/,
    "the reason must name the state, so a reader can tell this from a swallowed error");
  assert.ok(calls.some((c) => c[2] === "view" && c.includes("state")),
    "the verdict must come from a STATE read, not from the merge call's own message");
});

test("#1022 ACCEPTANCE (the direction that must not be lost): a PR that is still OPEN after a refused "
  + "merge RE-THROWS -- an un-armed PR nobody merged is a real fault", () => {
  const { run } = ghStub({ mergeError: "GraphQL: Base branch was modified", state: "OPEN" });
  assert.throws(
    () => armMerge({ number: "1020", repo: "o/r" }, { run, sleep: () => "ok" as const, attempts: 2 }),
    /Base branch was modified/,
    "the ORIGINAL error must reach the caller unchanged -- without this the fix is `ignore the error`");
});

test("#1022: the verdict is read from the STATE, not from the message text -- a reworded GraphQL string "
  + "must change nothing, for the reason `merge-guard` keys recovery on FAULT.* codes and never on prose", () => {
  for (const wording of ["GraphQL: Merge already in progress (mergePullRequest)",
    "Pull request is already merged", "something GitHub has not said yet"]) {
    const { run } = ghStub({ mergeError: wording, state: "MERGED" });
    const outcome = armMerge({ number: "1020", repo: "o/r" }, { run, sleep: () => "ok" as const });
    assert.equal(outcome.armed, false, `wording "${wording}" must not change the verdict`);
    assert.match(outcome.reason, /already merged/);
  }
});

test("#1022: a merge that SUCCEEDS still reports armed, and never reads the state at all", () => {
  const { run, calls } = ghStub({ state: "OPEN" });
  const outcome = armMerge({ number: "999", repo: "o/r" }, { run, sleep: () => "ok" as const });
  assert.deepEqual(outcome, { armed: true, reason: "auto-merge enabled" });
  assert.deepEqual(calls.filter((c) => c[2] === "view"), [],
    "the happy path must cost no extra call -- a state read only happens once a merge has been refused");
});

test("#1022: waitForSettled WAITS ON A POSITIVE VERDICT -- `OPEN` on the first read is also what a "
  + "genuinely un-armable PR looks like, so one read cannot tell them apart", () => {
  const { run, calls } = ghStub({ states: ["OPEN", "OPEN", "MERGED"] });
  const sleeps: number[] = [];
  assert.equal(waitForSettled({ number: "1", repo: "o/r" },
    { run, sleep: (ms: number) => { sleeps.push(ms); return "ok" as const; }, attempts: 5, intervalMs: 7 }),
    "MERGED");
  assert.equal(calls.filter((c) => c[2] === "view").length, 3, "it must stop the moment it settles");
  assert.deepEqual(sleeps, [7, 7], "and sleep BETWEEN reads, never before the first one");
});

test("#1022: waitForSettled gives up rather than waiting forever, and an UNREADABLE state never counts "
  + "as settled -- unreadable is not merged, the same distinction `armDecision` draws for labels", () => {
  const stillOpen = ghStub({ state: "OPEN" });
  assert.equal(waitForSettled({ number: "1", repo: "o/r" },
    { run: stillOpen.run, sleep: () => "ok" as const, attempts: 3, intervalMs: 1 }), null);
  assert.equal(stillOpen.calls.filter((c) => c[2] === "view").length, 3, "exactly the budget, no more");
  const unreadable = ghStub({ state: undefined });
  assert.equal(waitForSettled({ number: "1", repo: "o/r" },
    { run: unreadable.run, sleep: () => "ok" as const, attempts: 2, intervalMs: 1 }), null,
    "a failed read must not resolve to MERGED, which would turn this row's false RED into a false GREEN");
});

test("#1022: settledReason is pure and refuses to call an unreadable state settled", () => {
  assert.match(settledReason("MERGED")!, /already merged/);
  assert.match(settledReason("CLOSED")!, /already closed/);
  assert.equal(settledReason("OPEN"), null);
  assert.equal(settledReason(null), null, "null is `could not read`, and could-not-read is never `done`");
  assert.equal(settledReason("merged"), null, "gh answers in upper case; a lower-case match would be "
    + "matching a spelling this API does not use");
});

test("#1022: prState returns null rather than a guess when the read fails", () => {
  assert.equal(prState({ number: "1", repo: "o/r", run: () => { throw new Error("gh: HTTP 502"); } }), null);
  assert.equal(prState({ number: "1", repo: "o/r", run: () => "not json" }), null);
  assert.equal(prState({ number: "1", repo: "o/r", run: () => JSON.stringify({}) }), null);
  assert.equal(prState({ number: "1", repo: "o/r", run: () => JSON.stringify({ state: "OPEN" }) }), "OPEN");
});

/**
 * #2046: `MERGED` AND `CLOSED` WERE TWO OF THE THREE STATES IN WHICH THERE IS NOTHING LEFT TO ARM.
 *
 * The third is the one a busy queue spends most of its time in, and `waitForSettled` above reads it as
 * `OPEN` five times in a row: a pull request that has been ARMED INTO THE MERGE QUEUE is `OPEN`, with
 * `autoMergeRequest: null` and `mergeQueueEntry` non-null. So when the SWEEP in `arm-pr`'s own workflow run
 * won the race to arm the PR, the `arm` job's merge call was refused, five state reads all answered `OPEN`,
 * and the original error was re-thrown uncaught -- a RED check on a pull request that was correctly armed
 * and sitting at position 1.
 *
 * MEASURED, NOT INFERRED -- #2044, run 35799243526, one `ready_for_review` event at 2026-09-22T23:49:28Z:
 *
 *   23:49:40.69  sweep: SWEEP: #2044 ARMED -- 52 check run(s) on its head     <- sweep won
 *   23:49:50.72  arm:   GraphQL: Pull request Auto merge is already enabled    <- arm refused
 *   23:49:50.72  arm:   -> uncaught -> exit 1                                  <- arm went RED
 *
 * and the PR read back the same night, while the red check still stood:
 *
 *   {"isInMergeQueue": true, "mergeQueueEntry": {"position": 1, "state": "AWAITING_CHECKS"}, "state": "OPEN"}
 *
 * `armedFromApi` on that object answers TRUE and `settledReason("OPEN")` answers NULL -- two predicates
 * disagreeing about the same pull request at the same moment, which is the whole row. The right one was
 * already written, already exported and already tested in `auto-arm-sweep.mjs`, and this path did not call
 * it: the same second-copy-of-a-predicate shape this file's own header records about the HOLD predicate
 * (#645), and the third row it has cost (#1729, #2004, #2046). It now lives in `pr-armed-state.mjs`.
 */

test("#2046 ACCEPTANCE: a merge refused because SOMEBODY ELSE ARMED IT FIRST is a success, not a failure "
  + "-- it RETURNS, and the reason names the merge queue", () => {
  const { run, calls } = ghStub({
    mergeError: "GraphQL: Pull request Auto merge is already enabled (enablePullRequestAutoMerge)",
    state: "OPEN", armed: QUEUED_PR });
  const outcome = armMerge({ number: "2044", repo: "a11ign/a11ign" }, { run, ...QUIET });
  assert.equal(outcome.armed, false, "this run armed nothing -- and that is the correct outcome here");
  assert.match(outcome.reason, /already queued to merge/,
    "the reason must name the state, so a reader can tell this from a swallowed error");
  assert.ok(calls.some((c) => c[1] === "api" && c.includes("graphql")),
    "the verdict must come from the GraphQL read: `mergeQueueEntry` exists on neither `gh pr view --json` "
    + "nor the REST pulls endpoint, so a state read structurally cannot answer this");
});

test("#2046 ACCEPTANCE (the direction that must not be lost): a PR that NOBODY has armed still RE-THROWS "
  + "-- an un-armed PR nobody merged is a real fault, and this row must not become `ignore the error`", () => {
  const { run } = ghStub({ mergeError: "GraphQL: Base branch was modified", state: "OPEN", armed: UNARMED_PR });
  assert.throws(
    () => armMerge({ number: "1020", repo: "o/r" }, { run, ...QUIET, attempts: 2 }),
    /Base branch was modified/,
    "the ORIGINAL error must reach the caller unchanged");
});

test("#2046: UNREADABLE IS NOT ARMED -- a failed armed read re-throws rather than resolving to `nothing "
  + "left to arm`, and it SAYS the read failed", () => {
  const { run } = ghStub({ mergeError: "GraphQL: Base branch was modified", state: "OPEN", armed: "unreadable" });
  const said: string[] = [];
  assert.throws(
    () => armMerge({ number: "1020", repo: "o/r" },
      { run, sleep: () => "ok" as const, attempts: 2, error: (l: string) => said.push(l) }),
    /Base branch was modified/,
    "`armDecision`'s `Unreadable is not unheld`, pointed at the other predicate: a false `armed` hides a "
    + "pull request nobody is merging, which is the worse direction");
  assert.ok(said.some((l) => /could not read whether #1020 is already armed/.test(l)),
    "and the failed read is NAMED -- a silent one makes `not armed` and `could not ask` the same line");
});

test("#2046: each of the three armed states RETURNS and names ITSELF, because they are not "
  + "interchangeable to the reader of a green `arm` step", () => {
  const cases: [object, RegExp][] = [
    [QUEUED_PR, /already queued to merge/],
    [AUTO_MERGING_PR, /auto-merge is already enabled/],
    [{ merged: true, autoMergeRequest: null, mergeQueueEntry: null }, /already merged/],
  ];
  for (const [armed, expected] of cases) {
    const { run } = ghStub({ mergeError: "GraphQL: whatever GitHub said", state: "OPEN", armed });
    const outcome = armMerge({ number: "2044", repo: "o/r" }, { run, ...QUIET, attempts: 1 });
    assert.equal(outcome.armed, false);
    assert.match(outcome.reason, expected);
    assert.match(outcome.reason, /nothing was left to arm/);
  }
});

test("#2046: the verdict is read from the ARMED STATE, not from the message text -- a reworded GraphQL "
  + "string must change nothing, the same rule #1022 pins for the settled states", () => {
  for (const wording of ["GraphQL: Pull request Auto merge is already enabled (enablePullRequestAutoMerge)",
    "! Pull request #2044 is already queued to merge", "something GitHub has not said yet"]) {
    const { run } = ghStub({ mergeError: wording, state: "OPEN", armed: QUEUED_PR });
    assert.match(armMerge({ number: "2044", repo: "o/r" }, { run, ...QUIET, attempts: 1 }).reason,
      /already queued to merge/, `wording "${wording}" must not change the verdict`);
    const unarmed = ghStub({ mergeError: wording, state: "OPEN", armed: UNARMED_PR });
    assert.throws(() => armMerge({ number: "2044", repo: "o/r" }, { run: unarmed.run, ...QUIET, attempts: 1 }),
      /./, `and "${wording}" must not EXCUSE an unarmed PR either -- the state decides both ways`);
  }
});

test("#2046: the settled path is unchanged and still costs no armed read -- a MERGED PR is answered by "
  + "`waitForSettled` and never reaches the GraphQL call", () => {
  const { run, calls } = ghStub({ mergeError: "GraphQL: Merge already in progress (mergePullRequest)",
    state: "MERGED", armed: QUEUED_PR });
  assert.match(armMerge({ number: "1020", repo: "o/r" }, { run, ...QUIET }).reason, /already merged/);
  assert.deepEqual(calls.filter((c) => c[1] === "api"), [],
    "#1022's two states are answered before this row's read is bought at all");
});

test("#2046: a merge that SUCCEEDS reads neither the state nor the armed state", () => {
  const { run, calls } = ghStub({ state: "OPEN", armed: QUEUED_PR });
  assert.deepEqual(armMerge({ number: "999", repo: "o/r" }, { run, ...QUIET }),
    { armed: true, reason: "auto-merge enabled" });
  assert.deepEqual(calls.filter((c) => c[1] === "view" || c[1] === "api"), [],
    "the happy path must cost no extra call -- every read here happens only after a refusal");
});

test("#2046 PURE: armedReason names the state `armedFromApi` decided, and answers null for a PR nobody "
  + "armed or a read that came back empty", () => {
  assert.match(armedReason(QUEUED_PR)!, /already queued to merge/);
  assert.match(armedReason(AUTO_MERGING_PR)!, /auto-merge is already enabled/);
  assert.match(armedReason({ merged: true, autoMergeRequest: null, mergeQueueEntry: null })!, /already merged/);
  assert.match(armedReason({ merged: true, autoMergeRequest: null,
    mergeQueueEntry: { state: "MERGEABLE" } })!, /already merged/,
    "most-advanced-first: a landed PR carrying a stale entry reads as merged, not as queued");
  assert.equal(armedReason(UNARMED_PR), null);
  assert.equal(armedReason(null), null, "a read that returned nothing is not evidence of arming");
  assert.equal(armedReason({}), null, "nor is a response missing every field");
  // CAST DELIBERATELY. TypeScript already refuses this shape at the call, which is half a guard and
  // covers none of the `.mjs` callers, where no type exists to refuse anything. The runtime answer is
  // the one this row is about: `{state: "OPEN"}` is exactly what a `gh pr view --json state` read hands
  // back for a pull request at position 1 of the queue, and it must read as NOT ARMED here.
  assert.equal(armedReason({ state: "OPEN" } as Parameters<typeof armedReason>[0]), null,
    "and `state` is not one of the fields it decides on -- the whole point is that state cannot answer this");
});

test("#2046 ONE PREDICATE, ONE MODULE: arm-pr reads the armed rule from `pr-armed-state.mjs` and spells "
  + "no copy of it -- the shape this row is the third instance of", () => {
  const source = stripComments(readFileSync(`${REPO}packages/agent-org/src/arm-pr.mjs`, "utf8"));
  assert.match(source, /from "\.\/pr-armed-state\.mjs"/,
    "the predicate is IMPORTED, the way `pr-hold-state.mjs` already is on the line above it");
  // #2391 NARROWED, NOT DELETED. The two proxies this test used to use -- the strings `mergeQueueEntry` and
  // `pullRequest(number` anywhere in the file -- stood in for "the armed rule is not re-spelled here", and the
  // jump needs to ask a DIFFERENT question of the same object: WHERE a queued PR sits (`position`), not WHETHER it
  // is armed. So the test now names what a copy of the RULE would contain -- the `autoMergeRequest` field, the
  // one part of the three-state rule that exists nowhere else -- and allows the queue-seat read in exactly one
  // place, `SEAT_QUERY`. The mutation that matters is pinned below: a re-spelled armed rule still fails this.
  assert.doesNotMatch(source, /autoMergeRequest/,
    "and the three-state rule must not be re-spelled here: a second copy is how #1729, #2004 and #2046 "
    + "each happened, and `arm-pr.mjs`'s own header says so about the hold predicate");
  const seatQuery = /const SEAT_QUERY = [^;]+;/.exec(source)?.[0] ?? "";
  assert.match(seatQuery, /pullRequest\(number:\$n\)\{id headRefOid mergeStateStatus mergeQueueEntry\{position/,
    "POSITIVE CONTROL: the one allowed query is found, so the check below is not an emptiness over nothing");
  assert.doesNotMatch(source.replace(seatQuery, ""), /pullRequest\(number/,
    "nor may any OTHER GraphQL query be re-assembled here -- `armedQueryArgs` is what makes both callers ask "
    + "the identical armed question, and the seat query asks a different one");
  assert.match("const armed = pr.autoMergeRequest != null;", /autoMergeRequest/,
    "CONTROL: the fingerprint finds a re-spelled armed rule, so a copy cannot pass by being quiet");
});

test("#2046 WIRING: both callers of the armed read build it from the SAME `armedQueryArgs`, so the "
  + "sweep and the arm job cannot drift into asking different questions", () => {
  const queued = armedQueryArgs({ number: "2044", repo: "a11ign/a11ign" });
  assert.deepEqual(queued.slice(0, 2), ["api", "graphql"],
    "REST structurally cannot see the merge queue -- this must be the GraphQL read");
  assert.ok(queued.some((a) => a.includes("mergeQueueEntry")),
    "and it must ask for every field `armedFromApi` decides on, `mergeQueueEntry` above all");
  assert.ok(queued.includes("o=a11ign") && queued.includes("r=a11ign") && queued.includes("n=2044"),
    "the owner, repo and number are variables, never interpolated into the query text");
  for (const caller of ["arm-pr.mjs", "auto-arm-sweep.mjs"]) {
    assert.match(stripComments(readFileSync(`${REPO}packages/agent-org/src/${caller}`, "utf8")),
      /armedQueryArgs\(\{ number, repo \}\)/, `${caller} must build the read from the shared argv`);
  }
});

// --- #1453: the live set is READ from packages/agent-org/docs/roles/sessions.json, and arm-pr types none ---

const SESSIONS_FILE = new URL("../../../../packages/agent-org/docs/roles/sessions.json", import.meta.url);
/** A `live` entry, read wide enough to see the keys it carries as well as its name (#1951's question). */
type SessionEntry = { name: string; family?: unknown } & Record<string, unknown>;
const sessionsFile = () => JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as { live: SessionEntry[]; retired: { name: string }[] };

test("#1453 ACCEPTANCE: arm-pr's live and retired sets EQUAL packages/agent-org/docs/roles/sessions.json's, worker-tooling included", () => {
  const file = sessionsFile();
  // #2403: a FAMILY entry is a rule for many addresses, so it is not one name in the list -- `isLiveSession` reads it.
  assert.deepEqual([...LIVE_SESSIONS], file.live.filter((s) => s.family === undefined).map((s) => s.name),
    "the live set is the file's addresses, in the file's order");
  assert.deepEqual([...RETIRED_SESSIONS], file.retired.map((s) => s.name), "and so is the retired set");
  assert.ok(LIVE_SESSIONS.includes("worker-tooling"), "the session the typed list predated");
  assert.deepEqual(unknownSessionLabels(["session:worker-tooling"]), [],
    "the label the auto-arm job refused on #1412 now passes");
});

// #1951: A `live` ENTRY IS A ROLE. `session:<name>` is a ROUTING ADDRESS, and every enforcement path around
// it already compares strings -- `runnerReason`/`laneReason` compare a label's suffix against `mySession`,
// `LIVE_SESSIONS` is `.live.map((s) => s.name)`, `work-gate.mjs`'s `ROUTED_TO` is a frozen array of names.
// The one exception was this file: six of six entries carried `workspace: { herdr: "w6", primary: "…" }`, a
// tmux pane id, which NOTHING in the tree read -- so the roster lied the moment a pane moved. The runtime
// registry is herdr itself (`wake.mjs`'s `readAgents` asks it for the workspace list, and `route` matches by
// LABEL), so there was no second reader to move the field to and it was dropped.
//
// An ALLOWLIST rather than a denylist of suspicious key names, deliberately: a rule that infers whether a
// key smells like a process handle is the defect this row is about one level up. Adding a genuine role fact
// here is one line, and it makes the writer say which of the two it is.
// #2403 added `family`: `{prefix, from}` says every `<prefix><n>` for n from `from` is an instance of the ROLE, so the
// roster need not carry one entry per address. A fact about the role, like `spare`; it names no pane, pid or workspace.
const ROLE_ENTRY_KEYS = ["name", "role", "brief", "started", "spare", "drain", "family"];

/** The `live` entries carrying a key that is not a role fact, each with the keys that offend. */
function processBoundEntries(live: SessionEntry[]): { name: unknown; keys: string[] }[] {
  return live
    .map((entry) => ({ name: entry.name, keys: Object.keys(entry).filter((k) => !ROLE_ENTRY_KEYS.includes(k)) }))
    .filter((entry) => entry.keys.length > 0);
}

test("#1951: a `live` entry is a ROLE -- it carries no pane, pid or other process handle", () => {
  const file = sessionsFile();
  assert.ok(file.live.length > 0, "the population this asserts empty of offenders is not itself empty");
  assert.deepEqual(processBoundEntries(file.live), [],
    `sessions.json binds a role to a process again. A \`live\` entry may carry ${ROLE_ENTRY_KEYS.join(", ")} and `
    + "nothing else: `session:<name>` is a routing address, and the pane herdr currently gives a session is "
    + "herdr's to answer at runtime (`wake.mjs`), not this file's to remember. If the new key really is a role "
    + "fact, add it to ROLE_ENTRY_KEYS and say why in the file's `_rolesNotProcesses`.");
  // POSITIVE CONTROL, built from the file's own first entry so this test types no roster: the exact shape
  // #1951 removed is found by the same predicate.
  const asItWas = [{ ...file.live[0], workspace: { herdr: "w4", primary: "/home/agent/repos/a11y-witness" } }];
  assert.deepEqual(processBoundEntries(asItWas), [{ name: file.live[0].name, keys: ["workspace"] }],
    "the predicate finds the pane binding this row removed");
});

test("#1453: a retired session is refused because it is ABSENT from `live`, and `retired` only words the refusal", () => {
  const file = sessionsFile();
  assert.ok(!file.live.some((s) => s.name === "worker-audit") && file.retired.some((s) => s.name === "worker-audit"),
    "the fixture's premise: worker-audit is in `retired` and not in `live`");
  assert.deepEqual(unknownSessionLabels(["session:worker-audit"]), [{ label: "session:worker-audit", retired: true }]);
  assert.deepEqual(unknownSessionLabels(["session:worker-fleet"]), [{ label: "session:worker-fleet", retired: false }],
    "a name in neither list is refused too, and is not called retired");
});

test("#1453: the refusal counts the live sessions from the file, rather than saying 'five'", () => {
  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
  try {
    const { run } = fakeRun({ 725: ["session:worker-audit"] });
    labelArmedPr({ number: "817", repo: "org/repo", prBody: "Closes #725\n", run });
  } finally {
    console.error = realError;
  }
  const said = errors.join("\n");
  assert.match(said, new RegExp(`The ${LIVE_SESSIONS.length} live sessions`), said);
  assert.doesNotMatch(said, /The five live sessions/);
});

/** The array literals in `source`'s code (comments stripped) that hold a quoted session name from `names`. */
function typedSessionArrays(source: string, names: string[]): string[] {
  const code = source.split("\n").filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .map((line) => line.replace(/\s\/\/.*$/, "")).join("\n");
  const alternation = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return code.match(new RegExp(`\\[[^\\]]*["'\`](?:${alternation})["'\`][^\\]]*\\]`, "g")) ?? [];
}

test("#1453 STRUCTURAL: arm-pr.mjs declares no session-name array -- a typed list is refused", () => {
  const file = sessionsFile();
  const names = [...file.live, ...file.retired].map((s) => s.name);
  const source = readFileSync(new URL("../../../agent-org/src/arm-pr.mjs", import.meta.url), "utf8");
  assert.deepEqual(typedSessionArrays(source, names), [],
    "arm-pr.mjs types a session list instead of reading packages/agent-org/docs/roles/sessions.json");
  // POSITIVE CONTROL, built from the file's own names so this test file types no list either: the shape of the line #1453
  // removed is found by the same predicate.
  const typed = `export const LIVE_SESSIONS = [${file.live.map((s) => JSON.stringify(s.name)).join(", ")}];`;
  assert.equal(typedSessionArrays(typed, names).length, 1, "the predicate finds a typed session array");
});

// --- #1478: the ENTRY POINT, driven with an injected runner ----------------------------------------------------------
//
// worker-judge's #1399 sweep: `gh pr merge --auto` LANDS, then `labelArmedPr`'s `gh pr edit --add-label` ran with no
// guard. A throw there escaped `main`, and Node exited 1 -- the code this script already uses for a REFUSED label -- for
// a PR that IS armed, and `arm-pr: armed #N` was never printed. These drive `runArmPr`, the path the workflow runs.

/** A `gh` for the whole entry point, recording every call. The row #725 carries `rowLabel`. */
function entryRun({ viewFails = false, state = "OPEN", mergeFails = false, editFails = false,
  rowLabel = "session:worker-tooling" }: { viewFails?: boolean; state?: string; mergeFails?: boolean;
  editFails?: boolean; rowLabel?: string } = {}) {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args[0] === "pr" && args[1] === "view") {
      if (viewFails) throw new Error("gh: HTTP 502 on pr view");
      return args.includes("labels,body,state")
        ? JSON.stringify({ labels: [], body: "Closes #725\n", state })
        : JSON.stringify({ state });
    }
    if (args[0] === "pr" && args[1] === "merge") {
      if (mergeFails) throw Object.assign(new Error("GraphQL: Pull request is not mergeable"), { status: 1 });
      return "";
    }
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ labels: [{ name: rowLabel }] });
    if (args[0] === "pr" && args[1] === "edit") {
      if (editFails) throw Object.assign(new Error("gh: HTTP 502 on pr edit"), { status: 1 });
      return "";
    }
    return "";
  };
  return { run, calls };
}

/** Runs the entry point for PR #817 in org/repo with `stub`, capturing its own log and error lines. */
function entry(stub: ReturnType<typeof entryRun>, argv = ["node", "arm-pr.mjs", "--pr=817", "--repo=org/repo"]) {
  const log: string[] = [];
  const error: string[] = [];
  const code = runArmPr({ argv, env: {}, run: stub.run as never, sleep: () => "ok" as const,
    log: (line: string) => log.push(line), error: (line: string) => error.push(line) });
  return { code, log, error };
}

const callIndex = (calls: string[][], sub: string) => calls.findIndex((c) => c[1] === "pr" && c[2] === sub);

test("#1478 ACCEPTANCE: the label edit throws AFTER auto-merge landed -- exit 3, naming the armed PR and the labels not applied", () => {
  const stub = entryRun({ editFails: true });
  const { code, log, error } = entry(stub);
  assert.equal(code, EXIT.ARMED_THEN_LABEL_FAILED, "not 1: that is the REFUSED code, and this PR is armed");
  assert.ok(callIndex(stub.calls, "merge") >= 0 && callIndex(stub.calls, "merge") < callIndex(stub.calls, "edit"),
    "the merge landed first, then the edit threw");
  assert.ok(log.some((line) => line.startsWith("arm-pr: armed #817")), "what landed is printed before the step that failed");
  const said = error.join("\n");
  assert.match(said, /#817 IS ARMED: auto-merge was enabled/);
  assert.match(said, /NOT applied: session:worker-tooling/);
  assert.match(said, /HTTP 502 on pr edit/, "the underlying error is quoted, never swallowed");
  assert.match(said, /Apply them by hand: gh pr edit 817 --repo org\/repo --add-label session:worker-tooling$/,
    "the one failed step is named as a command, because re-running arm-pr would re-arm an armed PR");
});

test("#1478 CONTROL: a failure BEFORE any write -- the PR cannot be read -- exits CANNOT_ASK, and nothing is written", () => {
  const stub = entryRun({ viewFails: true });
  const { code } = entry(stub);
  assert.equal(code, EXIT.CANNOT_ASK);
  assert.equal(callIndex(stub.calls, "merge"), -1);
  assert.equal(callIndex(stub.calls, "edit"), -1);
});

test("#1478 CONTROL: every call succeeds -- exit 0, armed, and labelled from the row", () => {
  const stub = entryRun();
  const { code, log } = entry(stub);
  assert.equal(code, EXIT.DONE);
  assert.ok(log.some((line) => line.startsWith("arm-pr: armed #817")));
  const edit = stub.calls[callIndex(stub.calls, "edit")];
  assert.deepEqual(edit.slice(edit.indexOf("--add-label")), ["--add-label", "session:worker-tooling"]);
});

test("#1478 CONTROL: a merge refused on a PR that stays OPEN still throws -- nothing landed, and no label is written", () => {
  const stub = entryRun({ mergeFails: true });
  assert.throws(() => entry(stub), /not mergeable/);
  assert.equal(callIndex(stub.calls, "edit"), -1);
});

test("#1478: a PR that already MERGED is not armed and exits 0 with no write at all", () => {
  const stub = entryRun({ state: "MERGED" });
  assert.equal(entry(stub).code, EXIT.DONE);
  assert.equal(callIndex(stub.calls, "merge"), -1);
  assert.equal(callIndex(stub.calls, "edit"), -1);
});

test("#1478: a RETIRED session label still exits REFUSED (1), distinct from the partial-success code", () => {
  const stub = entryRun({ rowLabel: "session:dispatcher" });
  const { code, log } = entry(stub);
  assert.equal(code, EXIT.REFUSED);
  assert.ok(log.some((line) => line.startsWith("arm-pr: armed #817")), "the arm line still says what landed");
  assert.equal(callIndex(stub.calls, "edit"), -1);
});

test("#1478: a missing --pr exits CANNOT_ASK before any call", () => {
  const stub = entryRun();
  assert.equal(entry(stub, ["node", "arm-pr.mjs", "--repo=org/repo"]).code, EXIT.CANNOT_ASK);
  assert.equal(stub.calls.length, 0);
});

test("#1478: the script's header documents every exit code, the partial-success code included", () => {
  assert.deepEqual(EXIT, { DONE: 0, REFUSED: 1, CANNOT_ASK: 2, ARMED_THEN_LABEL_FAILED: 3, JUMP_UNCONFIRMED: 4 });
  const source = readFileSync(new URL("../../../agent-org/src/arm-pr.mjs", import.meta.url), "utf8");
  const header = source.slice(0, source.indexOf("export const EXIT"));
  for (const [name, code] of Object.entries(EXIT)) {
    assert.match(header, new RegExp(`\`${code}\` ${name}:`), `the header documents ${code} ${name}`);
  }
});


// --- #2391: THE FIX PR FOR A RED `main` JUMPS THE MERGE QUEUE -------------------------------------------------------
//
// NOT VERIFIABLE WITHOUT A LIVE QUEUE, and this file does not pretend to. Every test below drives `gh` with a stub
// that answers as the API's documented shape does (`EnqueuePullRequestInput`/`MergeQueueEntry`, schema read by
// introspection 2026-09-24), so what it proves is this script's DECISIONS and its refusal to believe an exit code.
// Whether the real `merge-queue-main` ruleset lets the arming identity jump is read from the first real red, from
// `mergeQueueEntry.position`, and the PR says so.

const RED_SHA = "a1b2c3d4e5f6789012345678901234567890abcd";
const OLDER_RED_SHA = "0123456789abcdef0123456789abcdef01234567";
const GREEN_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const HEAD_OID = "5555555555555555555555555555555555555555";

type TrunkRun = { id: number; head_sha: string; status: string; conclusion: string | null; html_url: string; created_at: string };
const trunkRun = (id: number, head_sha: string, conclusion: string | null, status = "completed"): TrunkRun => ({
  id, head_sha, status, conclusion, html_url: `https://example.test/runs/${id}`,
  created_at: `2026-09-24T${String(10 + id).padStart(2, "0")}:00:00Z`,
});
/** newest first, as the API answers -- the reader sorts anyway, and one test hands them in the other order. */
const RED_MAIN = { workflow_runs: [trunkRun(3, RED_SHA, "failure"), trunkRun(2, GREEN_SHA, "success")] };
const GREEN_MAIN = { workflow_runs: [trunkRun(3, GREEN_SHA, "success"), trunkRun(2, RED_SHA, "failure")] };

type Seat = { id: string; headRefOid: string; mergeStateStatus: string; mergeQueueEntry: { position: number; state: string } | null };
const seat = (over: Partial<Seat> = {}): Seat => ({ id: "PR_node", headRefOid: HEAD_OID, mergeStateStatus: "CLEAN", mergeQueueEntry: null, ...over });
const queuedAt = (position: number): Seat => seat({ mergeQueueEntry: { position, state: "QUEUED" } });

/**
 * A `gh` for a PR carrying `body`. `runs` answers the `trunk.yml` read (`"unreadable"` makes it fail); `seats` are
 * the successive answers to the queue-seat read -- the first is the read BEFORE the mutation, the second the
 * READ-BACK -- and `"unreadable"` in a slot makes that read fail. `pages` answers the `trunk.yml` read PAGE BY PAGE
 * (the `page=N` of the URL picks the entry; past the end it is an empty page, as GitHub answers) and beats `runs`. The mutation succeeds unless `mutationFails`.
 */
function jumpRun({ body, runs = RED_MAIN, pages, seats = [seat(), queuedAt(1)], mutationFails, editFails }: {
  body: string; runs?: object | "unreadable"; pages?: (object | "unreadable")[]; seats?: (Seat | "unreadable")[]; mutationFails?: string; editFails?: boolean;
}) {
  const calls: string[][] = [];
  let seatReads = 0;
  const graphql = (args: string[]) => {
    if (args.some((a) => a.startsWith("query=mutation"))) {
      if (mutationFails) throw new Error(mutationFails);
      return JSON.stringify({ data: { enqueuePullRequest: { mergeQueueEntry: { position: 1 } } } });
    }
    const answer = seats[Math.min(seatReads, seats.length - 1)];
    seatReads += 1;
    if (answer === "unreadable") throw new Error("gh: HTTP 502 on the seat read");
    return JSON.stringify(answer);
  };
  const trunkRuns = (url: string) => {
    const answer = pages ? (pages[Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1) - 1] ?? { workflow_runs: [] }) : runs;
    if (answer === "unreadable") throw new Error("gh: HTTP 403 on the runs read");
    return JSON.stringify(answer);
  };
  const editLabels = () => {
    if (editFails) throw new Error("gh: HTTP 502 on pr edit");
    return "";
  };
  const run = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    const route = `${args[0]} ${args[1]}`;
    if (route === "pr view") return JSON.stringify({ labels: [], body, state: "OPEN" });
    if (route === "pr edit") return editLabels();
    if (route === "issue view") return JSON.stringify({ labels: [{ name: "session:worker-tooling" }] });
    if (route === "api graphql") return graphql(args);
    if (args[0] === "api" && args[1].includes("actions/workflows/trunk.yml/runs")) return trunkRuns(args[1]);
    return "";
  };
  return { run, calls };
}

const MARKED = `Closes #725\n\nFixes-trunk: ${RED_SHA}\n`;
const UNMARKED = "Closes #725\n";
const isMutation = (c: string[]) => c[1] === "api" && c.some((a) => a.startsWith("query=mutation"));
const mutations = (calls: string[][]) => calls.filter(isMutation);
const mergeCalls = (calls: string[][]) => calls.filter((c) => c[1] === "pr" && c[2] === "merge");
const apiCalls = (calls: string[][]) => calls.filter((c) => c[1] === "api");

test("#2391 ACCEPTANCE: a PR carrying the trunk-fix marker, while main is red, is armed with `jump: true` -- and one without it is not", () => {
  const marked = jumpRun({ body: MARKED });
  const { code, log } = entry(marked);
  assert.equal(code, EXIT.DONE);
  assert.equal(mutations(marked.calls).length, 1, "the marked PR is enqueued by the mutation");
  const [mutation] = mutations(marked.calls);
  assert.match(mutation.find((a) => a.startsWith("query=")) ?? "", /enqueuePullRequest\(input:\{pullRequestId:\$id,jump:true,/);
  assert.ok(mutation.includes(`oid=${HEAD_OID}`), "the head whose readiness was read is the head enqueued (`expectedHeadOid`)");
  assert.equal(mergeCalls(marked.calls).length, 0, "it is enqueued INSTEAD of armed, not in addition to it");
  assert.ok(log.some((l) => /jump GRANTED/.test(l)) && log.some((l) => /jump for #817 -- front/.test(l)));

  const plain = jumpRun({ body: UNMARKED });
  assert.equal(entry(plain).code, EXIT.DONE);
  assert.equal(mutations(plain.calls).length, 0, "an unmarked PR is never enqueued by the mutation");
  assert.equal(mergeCalls(plain.calls).length, 1, "it is armed the ordinary way");
  assert.equal(apiCalls(plain.calls).length, 0, "and an unmarked PR costs NOT ONE extra API call -- the privilege is asked for, not probed for");
});

test("#2391: a jump is REFUSED while main is NOT red -- and the PR is still armed, the ordinary way", () => {
  const stub = jumpRun({ body: MARKED, runs: GREEN_MAIN });
  const { code, log } = entry(stub);
  assert.equal(code, EXIT.DONE, "a refused privilege is not a failure");
  assert.equal(mutations(stub.calls).length, 0);
  assert.equal(mergeCalls(stub.calls).length, 1, "a stale or mistyped marker must not strand the PR");
  assert.ok(log.some((l) => /jump REFUSED: main is NOT red/.test(l)));
});

test("#2391: UNREADABLE IS NOT RED -- a failed read of trunk.yml grants nothing, and the PR still arms", () => {
  const stub = jumpRun({ body: MARKED, runs: "unreadable" });
  const { code, log, error } = entry(stub);
  assert.equal(code, EXIT.DONE);
  assert.equal(mutations(stub.calls).length, 0);
  assert.equal(mergeCalls(stub.calls).length, 1);
  assert.ok(log.some((l) => /jump REFUSED: could not read whether main is red/.test(l)));
  assert.ok(error.some((l) => /HTTP 403 on the runs read/.test(l)), "the failed read is said, not swallowed");
});

test("#2391: a marker naming a merge that is NOT in the current red streak grants nothing", () => {
  const stub = jumpRun({ body: `Closes #725\nFixes-trunk: ${OLDER_RED_SHA}\n` });
  const { log } = entry(stub);
  assert.equal(mutations(stub.calls).length, 0);
  assert.ok(log.some((l) => /none of 0123456789abcdef0123456789abcdef01234567 is in its current red streak/.test(l)));
});

test("#2391 SECOND RED: the marker is honoured for ANY merge in the current red streak, not only the newest", () => {
  const twoReds = { workflow_runs: [trunkRun(4, RED_SHA, "failure"), trunkRun(3, OLDER_RED_SHA, "failure"), trunkRun(2, GREEN_SHA, "success")] };
  for (const named of [RED_SHA, OLDER_RED_SHA]) {
    const stub = jumpRun({ body: `Closes #725\nFixes-trunk: ${named.slice(0, 9)}\n`, runs: twoReds });
    entry(stub);
    assert.equal(mutations(stub.calls).length, 1, `${named.slice(0, 9)} names a merge in the streak, by an abbreviated sha too`);
  }
  // ...and a red that ENDED in green ends the privilege with it.
  const ended = { workflow_runs: [trunkRun(4, GREEN_SHA, "success"), trunkRun(3, OLDER_RED_SHA, "failure")] };
  const stub = jumpRun({ body: `Closes #725\nFixes-trunk: ${OLDER_RED_SHA}\n`, runs: ended });
  entry(stub);
  assert.equal(mutations(stub.calls).length, 0);
});

test("#2391: a marker in PROSE grants nothing -- the line is anchored, so a PR that merely discusses the marker is not a fix", () => {
  const prose = `Closes #725\n\nThis PR adds the \`Fixes-trunk: ${RED_SHA}\` marker and explains it.\n`;
  assert.deepEqual(extractTrunkFixDeclaration(prose), { kind: "none" },
    "NONE, not malformed: a mid-line mention read as a botched marker is still a PR that 'declared' one, and is logged as such");
  const stub = jumpRun({ body: prose });
  const { log } = entry(stub);
  assert.equal(apiCalls(stub.calls).length, 0);
  assert.equal(mutations(stub.calls).length, 0);
  assert.ok(!log.some((l) => /Fixes-trunk/.test(l)), "and the log says nothing about a privilege nobody asked for");
});

test("#2391: a granted jump on a PR that is NOT READY (mergeStateStatus not CLEAN) enqueues nothing and arms the ordinary way", () => {
  const stub = jumpRun({ body: MARKED, seats: [seat({ mergeStateStatus: "BLOCKED" })] });
  const { code, log } = entry(stub);
  assert.equal(code, EXIT.DONE);
  assert.equal(mutations(stub.calls).length, 0, "not enqueued before its checks are green");
  assert.equal(mergeCalls(stub.calls).length, 1);
  assert.ok(log.some((l) => /jump for #817 -- not-jumped: mergeStateStatus is BLOCKED, not CLEAN/.test(l)));
});

test("#2391 THE VERDICT IS THE QUEUE, NEVER THE EXIT CODE: a mutation that SUCCEEDS but reads back at position 3 is exit 4, naming it", () => {
  const stub = jumpRun({ body: MARKED, seats: [seat(), queuedAt(3)] });
  const { code, error, log } = entry(stub);
  assert.equal(mutations(stub.calls).length, 1, "the mutation exited 0 -- and that proves nothing");
  assert.equal(code, EXIT.JUMP_UNCONFIRMED);
  assert.match(error.join("\n"), /JUMP NOT CONFIRMED for #817: .*position 3 \(QUEUED\), NOT the front/);
  assert.ok(log.some((l) => /^arm-pr: armed #817/.test(l)), "what landed is still said");
  assert.ok(log.some((l) => /jump for #817 -- behind: .*position 3/.test(l)), "and so is where it landed");
});

test("#2391: a mutation that reports success while the PR is NOT in the queue on read-back is UNCONFIRMED, not a success", () => {
  const { code, error } = entry(jumpRun({ body: MARKED, seats: [seat(), seat()] }));
  assert.equal(code, EXIT.JUMP_UNCONFIRMED);
  assert.match(error.join("\n"), /reported success and the PR is NOT in the merge queue on read-back/);
});

test("#2391: a FAILED read-back leaves the position unknown, and unknown is not the front", () => {
  const { code, error } = entry(jumpRun({ body: MARKED, seats: [seat(), "unreadable"] }));
  assert.equal(code, EXIT.JUMP_UNCONFIRMED);
  assert.match(error.join("\n"), /read-back FAILED, so its position is unknown/);
});

test("#2391: the exit code lies about FAILURE too -- a mutation that THROWS but reads back at position 1 is a jump that worked", () => {
  const stub = jumpRun({ body: MARKED, seats: [seat(), queuedAt(1)], mutationFails: "GraphQL: something reworded" });
  const { code, log } = entry(stub);
  assert.equal(code, EXIT.DONE);
  assert.equal(mergeCalls(stub.calls).length, 0, "no ordinary arm on a PR that is already first");
  assert.ok(log.some((l) => /jump for #817 -- front: the jump reported a failure \(GraphQL: something reworded\) yet it is queued/.test(l)));
});

test("#2391: a mutation REFUSED with the PR not queued arms the ordinary way, and quotes the refusal", () => {
  const stub = jumpRun({ body: MARKED, seats: [seat(), seat()], mutationFails: "GraphQL: Pull request is not mergeable" });
  const { code, log } = entry(stub);
  assert.equal(code, EXIT.DONE);
  assert.equal(mergeCalls(stub.calls).length, 1);
  assert.ok(log.some((l) => /not-jumped: the jump was refused: GraphQL: Pull request is not mergeable/.test(l)));
});

test("#2391: NOTHING DISPLACES A QUEUED PR -- one already queued behind others is reported, and no mutation is sent", () => {
  const stub = jumpRun({ body: MARKED, seats: [queuedAt(4)] });
  const { code, error } = entry(stub);
  assert.equal(mutations(stub.calls).length, 0);
  assert.equal(code, EXIT.JUMP_UNCONFIRMED);
  assert.match(error.join("\n"), /it was already queued, and the queue reads back position 4/);
  const first = jumpRun({ body: MARKED, seats: [queuedAt(1)] });
  assert.equal(entry(first).code, EXIT.DONE, "already first is the jump having worked");
  assert.equal(mutations(first.calls).length, 0);
});

test("#2391: an unreadable seat before the jump arms the ordinary way rather than jumping blind", () => {
  const stub = jumpRun({ body: MARKED, seats: ["unreadable"] });
  const { code, log } = entry(stub);
  assert.equal(code, EXIT.DONE);
  assert.equal(mutations(stub.calls).length, 0);
  assert.equal(mergeCalls(stub.calls).length, 1);
  assert.ok(log.some((l) => /could not read #817's queue seat/.test(l)));
});

test("#2391: a labelling failure keeps its OWN exit code, and an unconfirmed jump is still said", () => {
  const { code, error } = entry(jumpRun({ body: MARKED, seats: [seat(), queuedAt(2)], editFails: true }));
  assert.equal(code, EXIT.ARMED_THEN_LABEL_FAILED, "it names a command to run by hand; the jump's code would name none");
  assert.match(error.join("\n"), /JUMP NOT CONFIRMED/);
});

test("#2391 PURE: extractTrunkFixDeclaration keeps none, fixes-trunk and malformed apart", () => {
  assert.deepEqual(extractTrunkFixDeclaration(null), { kind: "none" });
  assert.deepEqual(extractTrunkFixDeclaration("Closes #1\n"), { kind: "none" });
  assert.deepEqual(extractTrunkFixDeclaration(`x\n  fixes-TRUNK: ${RED_SHA.toUpperCase()}\n`), { kind: "fixes-trunk", shas: [RED_SHA] },
    "indented, any case, and the sha is normalised so a later prefix match cannot miss on case");
  assert.deepEqual(extractTrunkFixDeclaration(`Fixes-trunk: ${RED_SHA}\nFixes-trunk: ${OLDER_RED_SHA}\nFixes-trunk: ${RED_SHA}\n`),
    { kind: "fixes-trunk", shas: [RED_SHA, OLDER_RED_SHA] });
  for (const bad of ["", "abc12", "not-a-sha", `${RED_SHA}0`, "https://example.test/run/1"]) {
    const d = extractTrunkFixDeclaration(`Fixes-trunk: ${bad}\n`);
    assert.equal(d.kind, "malformed", `\`${bad}\` names no merge sha`);
  }
  assert.equal(extractTrunkFixDeclaration(`Fixes-trunk: ${RED_SHA}\nFixes-trunk: oops\n`).kind, "malformed", "one bad line spoils the declaration");
});

test("#2391 PURE: redStreak is the run of reds up to the newest green -- through a cancelled or in-flight run", () => {
  assert.deepEqual(redStreak(GREEN_MAIN), []);
  assert.deepEqual(redStreak(RED_MAIN).map((r) => r.id), [3]);
  const runs = [trunkRun(6, "aaaaaaa", "failure"), trunkRun(5, "bbbbbbb", "cancelled"), trunkRun(4, "ccccccc", null, "in_progress"),
    trunkRun(3, "ddddddd", "failure"), trunkRun(2, "eeeeeee", "success"), trunkRun(1, "fffffff", "failure")];
  assert.deepEqual(redStreak({ workflow_runs: runs }).map((r) => r.id), [6, 3], "cancelled and running say nothing about main; the green ends it");
  assert.deepEqual(redStreak({ workflow_runs: [...runs].reverse() }).map((r) => r.id), [6, 3], "the order the API hands them in decides nothing");
  assert.deepEqual(redStreak({ workflow_runs: [trunkRun(1, "aaaaaaa", "cancelled")] }), [], "no verdict at all is not a red");
  assert.deepEqual(redStreak(null as never), []);
});

/** `reds` consecutive failures, newest first, then (optionally) a green -- with the newest red's sha and the oldest red's sha named. */
function longStreak({ reds, endsInGreen }: { reds: number; endsInGreen: boolean }) {
  const at = (n: number) => new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString();
  const runs: TrunkRun[] = Array.from({ length: reds }, (_, i) => {
    const n = reds - i;
    const sha = n === reds ? RED_SHA : n === 1 ? OLDER_RED_SHA : n.toString(16).padStart(40, "0");
    return { ...trunkRun(n + 1, sha, "failure"), created_at: at(n + 1) };
  });
  if (endsInGreen) runs.push({ ...trunkRun(1, GREEN_SHA, "success"), created_at: at(0) });
  return runs;
}
const inPagesOf = (runs: TrunkRun[], size = 100) =>
  Array.from({ length: Math.ceil(runs.length / size) }, (_, i) => ({ workflow_runs: runs.slice(i * size, (i + 1) * size) }));
const pageReads = (calls: string[][]) => calls.filter((c) => c[1] === "api" && c[2]?.includes("actions/workflows/trunk.yml/runs")).length;

test("#2441 A STREAK LONGER THAN ONE PAGE: a marker naming the OLDEST red of 250 is honoured -- the read pages until the green ends it", () => {
  const stub = jumpRun({ body: `Closes #725\nFixes-trunk: ${OLDER_RED_SHA}\n`, pages: inPagesOf(longStreak({ reds: 250, endsInGreen: true })) });
  const { code, log } = entry(stub);
  assert.equal(code, EXIT.DONE);
  assert.equal(mutations(stub.calls).length, 1, "the marker names a merge in the streak, however far back");
  assert.ok(log.some((l) => /jump GRANTED/.test(l)));
  assert.equal(pageReads(stub.calls), 3, "251 runs at 100 a page: the green is on the third");
});

test("#2441 THE READ STOPS WHEN IT HAS ITS ANSWER: the newest red is found on page one, and a green that ends the streak stops the paging", () => {
  const long = inPagesOf(longStreak({ reds: 250, endsInGreen: true }));
  const newest = jumpRun({ body: MARKED, pages: long });
  entry(newest);
  assert.equal(pageReads(newest.calls), 1, "the sha is in the streak already; nothing older can change that");
  assert.equal(mutations(newest.calls).length, 1);

  const named = inPagesOf([...longStreak({ reds: 50, endsInGreen: true })]);
  const unnamed = jumpRun({ body: `Closes #725\nFixes-trunk: deadbee\n`, pages: named });
  const { log } = entry(unnamed);
  assert.equal(pageReads(unnamed.calls), 1, "a green on the first page ends the streak: the marker names nothing, and there is no page two to read");
  assert.equal(mutations(unnamed.calls).length, 0);
  assert.ok(log.some((l) => /none of deadbee is in its current red streak/.test(l)));
});

test("#2441 EACH STOP IS ITS OWN: a green on a FULL page ends the read though more pages exist, and history running out ends it though no green came", () => {
  const streakThenHistory = longStreak({ reds: 29, endsInGreen: true });
  const older = longStreak({ reds: 70, endsInGreen: false }).map((r, i) => ({ ...r, id: 1000 + i, created_at: `2026-08-01T00:${String(i).padStart(2, "0")}:00Z` }));
  const fullPage = [...streakThenHistory, ...older];
  assert.equal(fullPage.length, 100, "the green sits INSIDE a full page, so only `ended` can stop the read");
  const greenOnFullPage = jumpRun({ body: `Closes #725\nFixes-trunk: deadbee\n`, pages: [{ workflow_runs: fullPage }, { workflow_runs: older }] });
  entry(greenOnFullPage);
  assert.equal(pageReads(greenOnFullPage.calls), 1, "the older runs on page two cannot lengthen a streak a green already ended");

  const shortHistory = jumpRun({ body: `Closes #725\nFixes-trunk: deadbee\n`, pages: inPagesOf(longStreak({ reds: 30, endsInGreen: false })) });
  const { log, error } = entry(shortHistory);
  assert.equal(pageReads(shortHistory.calls), 1, "a page shorter than the page size is the end of the history: there is no page two to ask for");
  assert.ok(log.some((l) => /none of deadbee is in its current red streak/.test(l)), "the whole history was read, so this is `names nothing`, not `could not read`");
  assert.deepEqual(error, []);
});

test("#2441 A STREAK THAT OUTRUNS THE CAP is `could not read`, never `the marker names nothing` -- and the PR still arms", () => {
  const endless = inPagesOf(longStreak({ reds: 1100, endsInGreen: false }));
  const stub = jumpRun({ body: `Closes #725\nFixes-trunk: deadbee\n`, pages: endless });
  const { code, log, error } = entry(stub);
  assert.equal(code, EXIT.DONE);
  assert.equal(pageReads(stub.calls), 10, "bounded: the cap is the limit, not the length of the history");
  assert.equal(mutations(stub.calls).length, 0);
  assert.equal(mergeCalls(stub.calls).length, 1, "a refused jump still arms the ordinary way");
  assert.ok(error.some((l) => /longer than 1000 runs and names none of deadbee -- not read to its end/.test(l)));
  assert.ok(log.some((l) => /jump REFUSED: could not read whether main is red/.test(l)));

  const found = jumpRun({ body: `Closes #725\nFixes-trunk: ${OLDER_RED_SHA}\n`, pages: inPagesOf(longStreak({ reds: 1100, endsInGreen: false }).map((r, i) => (i === 950 ? { ...r, head_sha: OLDER_RED_SHA } : r))) });
  entry(found);
  assert.equal(pageReads(found.calls), 10, "found on the tenth page, inside the cap");
  assert.equal(mutations(found.calls).length, 1, "a sha the reads DID reach is in the streak whatever lies beyond");
});

test("#2441 a page that FAILS partway is unreadable, not a shorter streak: nothing is granted from the pages that did answer", () => {
  const [first] = inPagesOf(longStreak({ reds: 250, endsInGreen: true }));
  const stub = jumpRun({ body: `Closes #725\nFixes-trunk: ${OLDER_RED_SHA}\n`, pages: [first, "unreadable"] });
  const { code, error } = entry(stub);
  assert.equal(code, EXIT.DONE);
  assert.equal(mutations(stub.calls).length, 0);
  assert.equal(mergeCalls(stub.calls).length, 1);
  assert.ok(error.some((l) => /HTTP 403 on the runs read/.test(l)));
});

test("#2441 PURE: redStreakReading says whether the streak is KNOWN to have ended -- only a green after the reds ends it", () => {
  assert.deepEqual(redStreakReading(RED_MAIN).ended, true);
  assert.deepEqual(redStreakReading(GREEN_MAIN), { streak: [], ended: true });
  const unfinished = redStreakReading({ workflow_runs: [trunkRun(3, RED_SHA, "failure"), trunkRun(2, OLDER_RED_SHA, "failure")] });
  assert.deepEqual(unfinished.streak.map((r) => r.id), [3, 2]);
  assert.equal(unfinished.ended, false, "reds that run out of runs are a streak that may go on");
  assert.equal(redStreakReading({ workflow_runs: [trunkRun(2, RED_SHA, "failure"), trunkRun(1, GREEN_SHA, "cancelled")] }).ended, false, "a cancelled run ends nothing");
  assert.deepEqual(redStreakReading(null as never), { streak: [], ended: false });
});

test("#2391 PURE: jumpDecision grants only a marked PR, on a red main, naming a merge in the streak", () => {
  const fix = { kind: "fixes-trunk" as const, shas: [RED_SHA.slice(0, 7)] };
  const streak = redStreak(RED_MAIN);
  assert.equal(jumpDecision({ kind: "none" }, streak).marked, false);
  assert.equal(jumpDecision({ kind: "malformed", detail: "x" }, streak).grant, false);
  assert.equal(jumpDecision(fix, null).grant, false, "unreadable is not red");
  assert.equal(jumpDecision(fix, []).grant, false, "green is not red");
  assert.equal(jumpDecision({ kind: "fixes-trunk", shas: ["deadbee"] }, streak).grant, false);
  assert.equal(jumpDecision(fix, streak).grant, true);
});

test("#2391 PURE: atFrontOfQueue answers yes only for position 1 -- a missing answer is not a yes", () => {
  assert.equal(atFrontOfQueue({ position: 1 }), true);
  for (const not of [{ position: 2 }, { position: 0 }, { position: "1" }, {}, null, undefined]) {
    assert.equal(atFrontOfQueue(not as never), false, JSON.stringify(not));
  }
});

test("#2391: enqueueAtFront's mutation is the only write, and is sent once", () => {
  const stub = jumpRun({ body: MARKED });
  assert.equal(enqueueAtFront({ number: "817", repo: "org/repo", run: stub.run as never }).kind, "front");
  assert.equal(mutations(stub.calls).length, 1);
  assert.equal(stub.calls.filter((c) => c[1] === "pr").length, 0, "no pr merge, no pr edit: the only write is the enqueue");
});

test("#2391 THE POLICY THE ROW ASKED TO BE DECIDED is written as data and pinned", () => {
  assert.deepEqual({ ...TRUNK_FIX_POLICY }, {
    marker: "Fixes-trunk:",
    grantedOnlyWhileMainIsRed: true,
    unreadableRedIsNotRed: true,
    refusedJumpStillArms: true,
    honouredForAnyMergeInTheRedStreak: true,
    neverDisplacesAQueuedPr: true,
  });
});
