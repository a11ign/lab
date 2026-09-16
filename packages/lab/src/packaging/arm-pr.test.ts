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
} from "../../../agent-org/src/arm-pr.mjs";

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

/** A `gh` stub: `pr view --json state` answers `state`, `pr merge` fails with `mergeError` if given. */
function ghStub({ state, mergeError, states }: {
  state?: string; mergeError?: string; states?: (string | undefined)[];
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
    return "";
  };
  return { run, calls };
}

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

// --- #1453: the live set is READ from docs/roles/sessions.json, and arm-pr types none ---

const SESSIONS_FILE = new URL("../../../../docs/roles/sessions.json", import.meta.url);
const sessionsFile = () => JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as { live: { name: string }[]; retired: { name: string }[] };

test("#1453 ACCEPTANCE: arm-pr's live and retired sets EQUAL docs/roles/sessions.json's, worker-tooling included", () => {
  const file = sessionsFile();
  assert.deepEqual([...LIVE_SESSIONS], file.live.map((s) => s.name), "the live set is the file's, in the file's order");
  assert.deepEqual([...RETIRED_SESSIONS], file.retired.map((s) => s.name), "and so is the retired set");
  assert.ok(LIVE_SESSIONS.includes("worker-tooling"), "the session the typed list predated");
  assert.deepEqual(unknownSessionLabels(["session:worker-tooling"]), [],
    "the label the auto-arm job refused on #1412 now passes");
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
    "arm-pr.mjs types a session list instead of reading docs/roles/sessions.json");
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
  assert.deepEqual(EXIT, { DONE: 0, REFUSED: 1, CANNOT_ASK: 2, ARMED_THEN_LABEL_FAILED: 3 });
  const source = readFileSync(new URL("../../../agent-org/src/arm-pr.mjs", import.meta.url), "utf8");
  const header = source.slice(0, source.indexOf("export const EXIT"));
  for (const [name, code] of Object.entries(EXIT)) {
    assert.match(header, new RegExp(`\`${code}\` ${name}:`), `the header documents ${code} ${name}`);
  }
});

