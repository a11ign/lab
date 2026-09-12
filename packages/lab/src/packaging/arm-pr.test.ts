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
import { execFileSync } from "node:child_process";
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
} from "../../../../scripts/arm-pr.mjs";

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
  // list` below -- which needs a token, so it reports honestly rather than passing when it cannot ask.
  assert.deepEqual(LIVE_SESSIONS.filter((s) => RETIRED_SESSIONS.includes(s)), [],
    "a session cannot be both live and retired");
  assert.ok(LIVE_SESSIONS.length >= 1 && RETIRED_SESSIONS.length >= 1);
});

test("#1000: every `session:*` label that EXISTS is classified -- asked of GitHub, skipped honestly", () => {
  // THE COVERAGE HALF, and it cannot be a literal: the question is "which labels exist", which only the
  // repository can answer. CI has no token, so this says so rather than passing -- a check that cannot ask
  // must report that, which is this repo's own rule and the reason the skip prints.
  // OPT-IN, and that is not timidity: this file declares `// no-token: gh`, and a test that spawns `gh`
  // whenever a token happens to be present makes that declaration false on exactly the machines where it
  // matters. The flag keeps both true -- the acceptance job never spawns, and an agent asks deliberately.
  if (process.env.A11Y_CHECK_SESSION_LABELS !== "1") {
    console.log("  NOT RUN: the label coverage check is opt-in -- `A11Y_CHECK_SESSION_LABELS=1 npx tsx "
      + "--test packages/lab/src/packaging/arm-pr.test.ts` asks GitHub which `session:*` labels exist. The "
      + "disjointness test above ran; nothing here checked that the two lists COVER them.");
    return;
  }
  let labels: string[];
  try {
    labels = JSON.parse(execFileSync("gh",
      ["label", "list", "--repo", "DanBeckDev/a11y-witness", "--limit", "200", "--json", "name"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
      .map((l: { name: string }) => l.name).filter((n: string) => n.startsWith("session:"));
  } catch {
    console.log("  SKIPPED: `gh label list` could not be asked (no token here). NOT a pass -- the "
      + "disjointness test above still ran, but nothing checked that the two lists COVER the labels that "
      + "exist. Run this locally with a token before trusting the split.");
    return;
  }
  const classified = new Set([...LIVE_SESSIONS, ...RETIRED_SESSIONS].map((s) => `session:${s}`));
  const unclassified = labels.filter((l) => !classified.has(l)).sort();
  assert.deepEqual(unclassified, [],
    `these \`session:*\` labels exist and are neither live nor retired: ${unclassified.join(", ")}. A new `
    + "session must be added to LIVE_SESSIONS in arm-pr.mjs, or arm-pr will refuse every row it claims.");
  const missing = [...classified].filter((l) => !labels.includes(l)).sort();
  assert.deepEqual(missing, [],
    `these are classified in arm-pr.mjs and no longer exist as labels: ${missing.join(", ")}`);
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
