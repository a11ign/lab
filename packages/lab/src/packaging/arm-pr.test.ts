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
import {
  closedRowNumbers,
  sessionLabelsOf,
  sessionLabelsForArm,
  labelArmedPr,
  LIVE_SESSIONS,
  RETIRED_SESSIONS,
  retiredSessionLabels,
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

test("#1000: the live and retired sets are DISJOINT and cover every session label that exists", () => {
  // The lists are a literal in `arm-pr.mjs` because no file holds "who is live": `docs/roles/README.md`'s
  // roster names eleven agents including every retired one, since it is a record of the roles this org has
  // HAD. So the literal is pinned here against the labels themselves -- a sixth session added next month
  // fails this rather than silently attributing to nothing.
  const overlap = LIVE_SESSIONS.filter((s) => RETIRED_SESSIONS.includes(s));
  assert.deepEqual(overlap, [], "a session cannot be both live and retired");
  assert.deepEqual([...LIVE_SESSIONS, ...RETIRED_SESSIONS].sort(),
    ["ceo", "dispatcher", "orchestrator", "product-manager", "worker-audit", "worker-capture",
      "worker-config", "worker-contracts", "worker-judge"].sort(),
    "every `session:*` label this repository has must be classified on one side or the other");
});

test("#1000: a retired label is NAMED, never silently dropped", () => {
  assert.deepEqual(retiredSessionLabels(["session:worker-judge", "session:dispatcher"]),
    ["session:dispatcher"]);
  assert.deepEqual(retiredSessionLabels(["session:ceo", "session:product-manager"]), [],
    "every live session passes -- a refusal that fires on the normal case is how a guard gets bypassed");
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
