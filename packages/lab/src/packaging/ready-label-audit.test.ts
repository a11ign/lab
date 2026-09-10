/**
 * `ready` must be mutually exclusive with every label that already means "not actually pickable" (#121).
 * See `scripts/ready-label-audit.mjs`'s own header for the incident: `dispatcher` labelled #13 and #75
 * `ready` to hit a floor, while one was disputed and the other had no Region or Acceptance at all.
 */
// no-token: defaultRun
// Every fetcher this file exercises (fetchOpenIssues, fetchReportedOpenIssueNumbers, fetchClosingPrRefs,
// fetchLatestReopenedAt, fetchClaimActivity, ...) is called only with an injected `{ run }` fixture below
// -- `defaultRun`, the module-scope const that actually spawns `gh`, is never referenced by name in this
// file. The #827 closure walk still reaches it because these functions are imported from the shared
// ready-label-audit.mjs module, whose own real-`gh` fetchers this file's tests never invoke.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  READY_LABEL, WAS_READY_LABEL, MUTEX_LABELS, mutexViolations, handClaims, strandedByIncompleteDecline,
  fetchOpenIssues, fetchOpenIssuesChecked, fetchReportedOpenIssueNumbers, openIssueSetSummary, fetchAllIssues, closedDebris,
  isClosedDebrisLabel, openRowsAbsentFromBoard, labellessRows,
  readyRowsAlreadyMerged, fetchClosingPrRefs, fetchLatestReopenedAt, CHECKS, runCheck, isProjectsCredentialGap,
  fetchClosedUnmergedPrs, fetchClosingIssueRefs, soleUnmergedCloserRows,
  criterionStatusesFromSource, criterionOwningRow, coverageTrackerDisagreements, fetchClosedCompletedIssues,
  reachableCriteriaWithoutRow,
} from "../../../../scripts/ready-label-audit.mjs";
// #782: `isClosedDebrisLabel` now DERIVES from this, rather than pinning the two equal with a separate
// test -- so this import is the proof the derivation actually happened, not a second, parallel check.
import { labelsToStrip } from "../../../../scripts/close-rows-for-merged-pr.mjs";

// --- mutexViolations: pure, no I/O ---

test("a row carrying ready alone is not a violation", () => {
  const issues = [{ number: 1, title: "fine", labels: ["backlog", READY_LABEL] }];
  assert.deepEqual(mutexViolations(issues), []);
});

test("a row carrying a mutex label WITHOUT ready is not a violation -- the rule is about the PAIR", () => {
  const issues = [{ number: 2, title: "blocked, correctly unlabelled ready", labels: ["backlog", "disputed"] }];
  assert.deepEqual(mutexViolations(issues), []);
});

test("ready + disputed is caught, exactly tonight's #13", () => {
  const issues = [{ number: 13, title: "disputed row", labels: [READY_LABEL, "disputed"] }];
  const violations = mutexViolations(issues);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].number, 13);
  assert.deepEqual(violations[0].conflicting, ["disputed"]);
});

test("#673: ready + in-progress + session:* is NO LONGER a mutexViolations match -- #246's shape moved " +
  "to its own check (handClaims, below), since it names a cause row-claim.mjs's own atomicity makes " +
  "provable rather than a generic pair to remove one of", () => {
  const issues = [
    { number: 230, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-judge"] },
    { number: 223, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-capture"] },
    { number: 222, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-audit"] },
  ];
  assert.deepEqual(mutexViolations(issues), []);
});

test("a row carrying ONLY session:* -- dispatched but not started -- is deliberately still pickable-" +
  "adjacent and must NOT be flagged", () => {
  // #246's own scope note: session:* alone is dispatchRow's "dispatched, not started" state. Only
  // in-progress is the contradiction.
  const issues = [{ number: 5, title: "dispatched, not yet started",
    labels: ["backlog", READY_LABEL, "session:worker-judge"] }];
  assert.deepEqual(mutexViolations(issues), []);
});

test("every MUTEX_LABELS entry is individually caught, not just the first one tested", () => {
  for (const label of MUTEX_LABELS) {
    const issues = [{ number: 99, title: "t", labels: [READY_LABEL, label] }];
    const violations = mutexViolations(issues);
    assert.equal(violations.length, 1, `ready + ${label} was not caught`);
    assert.deepEqual(violations[0].conflicting, [label]);
  }
});

test("a row carrying MULTIPLE mutex labels alongside ready names all of them", () => {
  const issues = [{ number: 3, title: "doubly wrong", labels: [READY_LABEL, "fleet-gated", "decision"] }];
  const violations = mutexViolations(issues);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].conflicting.sort(), ["decision", "fleet-gated"]);
});

test("only the ready-carrying rows are scanned -- a clean board scans everything and flags nothing", () => {
  const issues = [
    { number: 1, title: "a", labels: [READY_LABEL] },
    { number: 2, title: "b", labels: ["disputed"] },
    { number: 3, title: "c", labels: ["fleet-gated", "epic"] },
  ];
  assert.deepEqual(mutexViolations(issues), []);
});

// --- MUTATION: the rule must not silently stop covering a label ---

test("MUTATION: in-progress is genuinely OUT of MUTEX_LABELS -- #673 gave it a dedicated check", () => {
  // If in-progress ever re-enters this list, a hand claim reports as BOTH a generic mutex violation AND
  // a hand claim, which buries the cause-naming message #673 exists to produce back under the generic
  // "remove one or the other" wording.
  assert.ok(!MUTEX_LABELS.includes("in-progress"),
    "in-progress must NOT be in MUTEX_LABELS -- #673 split it into handClaims/reportHandClaims");
});

test("MUTATION: review-only is genuinely in MUTEX_LABELS, not just described as such", () => {
  // #27's own shape -- a row that solicits review and should never be started as work. If this list ever
  // drops the label the row was filed to add, the rule keeps working for the other five and goes silent
  // for exactly the case that motivated it.
  assert.ok(MUTEX_LABELS.includes("review-only"),
    "review-only must be in MUTEX_LABELS -- it is #27's own shape, the reason this label exists at all");
});

// --- handClaims: #673 -- ready + in-progress together, which row-claim.mjs's own atomic label-write
// can never produce, so this co-occurrence is proof the claim was made some other way ---

test("#673 ACCEPTANCE: a row hand-claimed by applying in-progress + session:x to a ready row is " +
  "reported as a hand claim", () => {
  const issues = [
    { number: 634, title: "sweep row", labels: ["backlog", READY_LABEL, "in-progress", "session:x"] },
  ];
  const claims = handClaims(issues);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].number, 634);
  assert.deepEqual(claims[0].sessions, ["session:x"]);
});

test("#673's own measured rows: all three (#634, #635, #633) are caught, not a subset", () => {
  const issues = [
    { number: 634, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-a"] },
    { number: 635, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-b"] },
    { number: 633, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-c"] },
  ];
  assert.equal(handClaims(issues).length, 3);
});

test("#673 MUTATION TARGET: a row claimed through row-claim.mjs -- in-progress WITHOUT ready, since " +
  "writeRowLabels removes ready in the same edit that adds in-progress -- is silent", () => {
  const issues = [
    { number: 1, title: "claimed through row-claim", labels: ["backlog", "in-progress", "session:x"] },
  ];
  assert.deepEqual(handClaims(issues), [],
    "row-claim's own mechanism can never leave ready in place, so this must never be flagged");
});

test("ready alone, not yet claimed, is not a hand claim", () => {
  const issues = [{ number: 2, title: "genuinely pickable", labels: ["backlog", READY_LABEL] }];
  assert.deepEqual(handClaims(issues), []);
});

test("in-progress alone with no ready -- normal claimed-and-started state -- is not a hand claim", () => {
  const issues = [
    { number: 3, title: "started normally", labels: ["backlog", "in-progress", "session:x"] },
  ];
  assert.deepEqual(handClaims(issues), []);
});

test("a hand claim with no session:* label yet -- assigned directly, not through session bookkeeping -- " +
  "is still caught, with sessions reported empty rather than guessed", () => {
  const issues = [
    { number: 4, title: "no session label", labels: ["backlog", READY_LABEL, "in-progress"] },
  ];
  const claims = handClaims(issues);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].sessions, []);
});

// --- strandedByIncompleteDecline: #449, the population no other check here can see ---

test("#449 ACCEPTANCE: an open row carrying was-ready, neither ready nor in-progress, is stranded -- "
  + "the exact #171 shape", () => {
  const issues = [{ number: 171, title: "declined but not restored",
    labels: ["backlog", WAS_READY_LABEL] }];
  const stranded = strandedByIncompleteDecline(issues);
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0].number, 171);
});

test("#449 MUTATION TARGET: a row carrying was-ready AND ready (the restore worked) is NOT stranded", () => {
  const issues = [{ number: 172, title: "correctly restored", labels: [READY_LABEL, WAS_READY_LABEL] }];
  assert.deepEqual(strandedByIncompleteDecline(issues), [],
    "declineRow removes was-ready in the SAME edit it adds ready back -- a row genuinely mid-restore "
    + "should never be observable carrying both, but this pins the filter's own logic regardless");
});

test("a row carrying was-ready while still claimed (in-progress) is NOT stranded -- the claim has not "
  + "been declined yet, there is nothing to have restored", () => {
  const issues = [{ number: 173, title: "still claimed", labels: [WAS_READY_LABEL, "in-progress"] }];
  assert.deepEqual(strandedByIncompleteDecline(issues), []);
});

test("a row with no was-ready marker at all is never flagged, however it is labelled", () => {
  const issues = [
    { number: 174, title: "ordinary backlog", labels: ["backlog"] },
    { number: 175, title: "ordinary blocked", labels: ["blocked"] },
  ];
  assert.deepEqual(strandedByIncompleteDecline(issues), []);
});

// --- fetchOpenIssues: the vacuity guard, same discipline as row-claim.mjs's fetchLabels ---

function jsonRun(response: string) {
  return () => response;
}

function throwingRun(message: string) {
  return () => { throw new Error(message); };
}

test("fetchOpenIssues parses a well-formed gh response", () => {
  const run = jsonRun(JSON.stringify([
    { number: 1, title: "a row", labels: [{ name: READY_LABEL }] },
  ]));
  const result = fetchOpenIssues({ run });
  assert.deepEqual(result, [{ number: 1, title: "a row", labels: [READY_LABEL] }]);
});

test("MUTATION: gh itself failing is a thrown error, never an empty (= clean-board-reading) list", () => {
  const run = throwingRun("gh: authentication required");
  assert.throws(() => fetchOpenIssues({ run }), /could not list open issues/);
});

test("MUTATION: a non-JSON response is a thrown error, never a silent empty list", () => {
  const run = jsonRun("not json at all");
  assert.throws(() => fetchOpenIssues({ run }), /was not JSON/);
});

test("MUTATION: a response that is not a list is a thrown error", () => {
  const run = jsonRun(JSON.stringify({ number: 1 }));
  assert.throws(() => fetchOpenIssues({ run }), /was not a list/);
});

test("MUTATION: an entry missing labels is a thrown error, never silently skipped", () => {
  const run = jsonRun(JSON.stringify([{ number: 1, title: "a" }]));
  assert.throws(() => fetchOpenIssues({ run }), /missing number\/title\/labels/);
});

test("MUTATION: a label object with no name is a thrown error", () => {
  const run = jsonRun(JSON.stringify([{ number: 1, title: "a", labels: [{}] }]));
  assert.throws(() => fetchOpenIssues({ run }), /has a label with no name/);
});

// --- #788/#838: fetchReportedOpenIssueNumbers, openIssueSetSummary and fetchOpenIssuesChecked --
// every label-keyed audit states what it examined against what GitHub's own search index reports open.
// #838's own correction: a mismatch RE-READS ONCE before refusing -- measured live, "examined 66,
// search reports 65" refused five of nine checks on nothing more than a live tracker moving between two
// reads a second apart, the ORDINARY state, not a shrunk population. ---

test("fetchReportedOpenIssueNumbers reads GitHub's search-index issue numbers via --jq", () => {
  const run = () => "717\n725\n747\n";
  assert.deepEqual(fetchReportedOpenIssueNumbers({ run }), [717, 725, 747]);
});

test("fetchReportedOpenIssueNumbers: empty output is an empty list, not a crash on splitting nothing", () => {
  const run = () => "";
  assert.deepEqual(fetchReportedOpenIssueNumbers({ run }), []);
});

test("fetchReportedOpenIssueNumbers throws, never falls back to an empty list, when gh fails", () => {
  const run = throwingRun("gh: not authenticated");
  assert.throws(() => fetchReportedOpenIssueNumbers({ run }), /could not read GitHub's reported open-issue numbers/);
});

test("fetchReportedOpenIssueNumbers throws on a non-number line rather than guessing", () => {
  const run = () => "717\nnot a number\n";
  assert.throws(() => fetchReportedOpenIssueNumbers({ run }), /non-number line/);
});

test("openIssueSetSummary: identical sets agree, regardless of order", () => {
  assert.deepEqual(openIssueSetSummary([1, 2, 3], [3, 1, 2]),
    { agree: true, onlyExamined: [], onlyReported: [] });
});

test("openIssueSetSummary: names exactly which numbers are in one and not the other, on each side "
  + "separately -- #838's own point: a bare count difference cannot say WHICH row", () => {
  assert.deepEqual(openIssueSetSummary([1, 2, 3], [2, 3, 4]),
    { agree: false, onlyExamined: [1], onlyReported: [4] });
});

test("openIssueSetSummary: equal COUNTS with different MEMBERS still disagree -- the comparison is the "
  + "set, never the length", () => {
  assert.deepEqual(openIssueSetSummary([1, 2], [1, 3]),
    { agree: false, onlyExamined: [2], onlyReported: [3] });
});

/** A `run` that answers the two calls `fetchOpenIssuesChecked` makes -- `gh issue list` and `gh api
 * search/issues` -- differently, and can return a DIFFERENT answer on a second call of either kind, for
 * driving the retry path. */
function dualCallRun(issuePages: string[], reportedPages: string[]) {
  let issueCalls = 0;
  let reportedCalls = 0;
  return (_cmd: string, args: string[]) => {
    if (args[0] === "issue" && args[1] === "list") {
      const page = issuePages[Math.min(issueCalls, issuePages.length - 1)];
      issueCalls += 1;
      return page;
    }
    const page = reportedPages[Math.min(reportedCalls, reportedPages.length - 1)];
    reportedCalls += 1;
    return page;
  };
}

test("fetchOpenIssuesChecked: examined numbers match reported numbers on the FIRST read -- returns the "
  + "issues and the count, no retry needed", () => {
  const run = dualCallRun(
    [JSON.stringify([{ number: 1, title: "a", labels: [{ name: READY_LABEL }] }])],
    ["1\n"]);
  const result = fetchOpenIssuesChecked({ run });
  assert.deepEqual(result.issues, [{ number: 1, title: "a", labels: [READY_LABEL] }]);
  assert.equal(result.reportedCount, 1);
});

test("#838 ACCEPTANCE: a first-read mismatch that the SECOND read resolves is NOT a refusal -- the "
  + "ordinary single-row race, named rather than treated as partial", () => {
  const run = dualCallRun(
    [
      JSON.stringify([{ number: 1, title: "a", labels: [] }]),
      JSON.stringify([{ number: 1, title: "a", labels: [] }, { number: 2, title: "b", labels: [] }]),
    ],
    ["1\n2\n", "1\n2\n"],
  );
  const result = fetchOpenIssuesChecked({ run });
  assert.equal(result.issues.length, 2, "the RETRY's issues are what's returned, not the first read's");
  assert.equal(result.reportedCount, 2);
});

test("#838 ACCEPTANCE, MUTATION TARGET: a mismatch that persists on BOTH reads STILL refuses, naming "
  + "which numbers are in one and not the other on the second (not the first) read", () => {
  const run = dualCallRun(
    [JSON.stringify([{ number: 1, title: "a", labels: [] }])],
    ["1\n5\n"],
  );
  assert.throws(() => fetchOpenIssuesChecked({ run }),
    /Examined but not in search: none\. In search but not examined: 5/);
});

test("fetchOpenIssuesChecked: examined HIGHER than reported, persisting on both reads, also refuses -- "
  + "the comparison is a set equality, not a floor", () => {
  const run = dualCallRun(
    [JSON.stringify([{ number: 1, title: "a", labels: [] }, { number: 2, title: "b", labels: [] }])],
    ["1\n"],
  );
  assert.throws(() => fetchOpenIssuesChecked({ run }),
    /Examined but not in search: 2\. In search but not examined: none/);
});

// --- #378: a CLOSED row carrying ready/in-progress/session:* is DEBRIS, a separate population from
// mutexViolations, reported with separate wording, never collapsed with an open-row contradiction ---

test("isClosedDebrisLabel: ready, in-progress and any session:* label all count", () => {
  assert.ok(isClosedDebrisLabel(READY_LABEL));
  assert.ok(isClosedDebrisLabel("in-progress"));
  assert.ok(isClosedDebrisLabel("session:worker-audit"));
  assert.ok(isClosedDebrisLabel("session:anything-at-all"));
});

test("isClosedDebrisLabel: any runner:* label counts too (#444) -- a reservation with nobody left to honour it", () => {
  assert.ok(isClosedDebrisLabel("runner:worker-audit"));
  assert.ok(isClosedDebrisLabel("runner:anything-at-all"));
});

test("#444: runner: must NOT join MUTEX_LABELS -- a reserved-but-ready row is genuinely pickable, by its runner", () => {
  assert.ok(!MUTEX_LABELS.some((l) => l.startsWith("runner")),
    "a row reading ready + runner:worker-audit is not a contradiction the way ready + blocked is -- adding "
    + "runner: here would flag every reservation as a violation nobody can resolve");
  const issues = [{ number: 324, title: "V1 rehearsal", labels: [READY_LABEL, "runner:worker-audit"] }];
  assert.deepEqual(mutexViolations(issues), [],
    "a reserved-but-unclaimed row must not read as a mutex violation");
});

// --- #782: isClosedDebrisLabel DERIVES from labelsToStrip, so the two populations cannot drift again ---

test("#782 ACCEPTANCE, MUTATION TARGET: a closed row carrying ONLY a stale `started` label -- the exact "
  + "shape 52 real closed rows had 2026-09-09, invisible to the pre-#782 hand-rolled list, which never "
  + "named `started` at all -- IS now reported as debris", () => {
  assert.ok(isClosedDebrisLabel("started"),
    "labelsToStrip has always included `started` (#754); isClosedDebrisLabel's own list never did until "
    + "it started deriving from labelsToStrip instead");
  const issues = [{ number: 640, title: "closed with only started left", state: "CLOSED" as const,
    labels: ["backlog", "started", "was-ready"] }];
  assert.deepEqual(closedDebris(issues), [{ number: 640, title: "closed with only started left", debris: ["started"] }]);
});

test("#782: isClosedDebrisLabel agrees with labelsToStrip on every label labelsToStrip itself would strip "
  + "-- proven by calling THROUGH labelsToStrip, not by asserting a second hand-picked list", () => {
  for (const label of ["ready", "in-progress", "started", "session:worker-contracts", "session:anything"]) {
    assert.equal(isClosedDebrisLabel(label), labelsToStrip([label]).length > 0,
      `isClosedDebrisLabel(${label}) disagreed with labelsToStrip -- the two must never drift independently`);
  }
});

test("#782: was-ready is debris-exempt on BOTH sides -- labelsToStrip never touches it, and "
  + "isClosedDebrisLabel must not either, now that one derives from the other", () => {
  assert.equal(labelsToStrip([WAS_READY_LABEL]).length, 0);
  assert.equal(isClosedDebrisLabel(WAS_READY_LABEL), false);
});

test("isClosedDebrisLabel: an ordinary label, or a MUTEX_LABELS entry that is not ready/in-progress, does not count", () => {
  assert.ok(!isClosedDebrisLabel("backlog"));
  assert.ok(!isClosedDebrisLabel("disputed"), "disputed on a closed row is not the shape this exists for");
  assert.ok(!isClosedDebrisLabel("fleet-gated"));
});

test("closedDebris: exactly #378's own measured shape -- ready survives on a CLOSED row (#291/#292)", () => {
  const issues = [
    { number: 291, title: "t", labels: ["backlog", READY_LABEL], state: "CLOSED" as const },
  ];
  const debris = closedDebris(issues);
  assert.equal(debris.length, 1);
  assert.equal(debris[0].number, 291);
  assert.deepEqual(debris[0].debris, [READY_LABEL]);
});

test("closedDebris: the worker-audit shape -- in-progress + session:* surviving on a merged row (#84/#104/#105)", () => {
  const issues = [
    { number: 104, title: "t", labels: ["backlog", "in-progress", "session:worker-audit"], state: "CLOSED" as const },
  ];
  const debris = closedDebris(issues);
  assert.equal(debris.length, 1);
  assert.deepEqual(debris[0].debris.sort(), ["in-progress", "session:worker-audit"]);
});

test("closedDebris: an OPEN row carrying the identical labels is NOT debris -- state is the whole test", () => {
  const issues = [
    { number: 1, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-audit"], state: "OPEN" as const },
  ];
  assert.deepEqual(closedDebris(issues), []);
});

test("closedDebris: a CLOSED row with none of the three labels is not reported -- ordinary closed rows are not debris", () => {
  const issues = [{ number: 2, title: "t", labels: ["backlog", "disputed"], state: "CLOSED" as const }];
  assert.deepEqual(closedDebris(issues), []);
});

test("closedDebris: a row with no `state` at all (the pre-#378 shape) is never reported -- absence is not CLOSED", () => {
  // fetchOpenIssues's own long-standing fixtures never carried `state`; closedDebris must read that as
  // "not known to be closed", never as a guess in either direction.
  const issues = [{ number: 3, title: "t", labels: [READY_LABEL] }];
  assert.deepEqual(closedDebris(issues), []);
});

test("closedDebris and mutexViolations disagree on the SAME labels, by design: state is the only thing that changed", () => {
  // #673: in-progress moved out of MUTEX_LABELS (see handClaims, above), so this uses `disputed` --
  // a label that stays in MUTEX_LABELS -- to keep testing the state distinction rather than the
  // now-moved hand-claim one.
  const openRow = { number: 4, title: "t", labels: [READY_LABEL, "disputed"], state: "OPEN" as const };
  const closedRow = { number: 5, title: "t", labels: [READY_LABEL, "disputed"], state: "CLOSED" as const };
  assert.equal(mutexViolations([openRow]).length, 1, "open: a contradiction to resolve");
  assert.equal(closedDebris([openRow]).length, 0, "open: never reported as debris");
  assert.equal(closedDebris([closedRow]).length, 1, "closed: debris (the READY_LABEL itself qualifies)");
});

// --- fetchAllIssues: same discipline as fetchOpenIssues, but state IS in the requested shape ---

test("fetchAllIssues parses a well-formed gh response and carries state through", () => {
  const run = jsonRun(JSON.stringify([
    { number: 1, title: "a row", labels: [{ name: READY_LABEL }], state: "CLOSED" },
  ]));
  const result = fetchAllIssues({ run });
  assert.deepEqual(result, [{ number: 1, title: "a row", labels: [READY_LABEL], state: "CLOSED" }]);
});

test("MUTATION: fetchAllIssues throwing gh failure is a thrown error naming the state it asked for", () => {
  const run = () => { throw new Error("gh: authentication required"); };
  assert.throws(() => fetchAllIssues({ run }), /could not list all issues/);
});

test("MUTATION: a listing returned AT the real 500-row limit is refused, not read as complete", async () => {
  // #378's own header: 51 open + 174 closed already exceeded the audit's OLD 200-row cap once read
  // together. A result exactly AT the requested limit is indistinguishable from a truncated one.
  const { fetchIssues } = await import("../../../../scripts/ready-label-audit.mjs");
  const run = () => JSON.stringify(
    Array.from({ length: 500 }, (_unused, i) => ({ number: i, title: "t", labels: [], state: "OPEN" })));
  assert.throws(() => fetchIssues({ run, state: "all" }), /exactly the requested limit \(500\)/);
});

test("MUTATION: reverting fetchAllIssues to request --state open loses every closed row again", () => {
  // Reproduces the issue's own acceptance mutation-check, but the `run` here actually RESPONDS to the
  // requested `--state` the way the real `gh` CLI does -- `open` returns only #291 (the one open fixture
  // row), `all` returns #291 AND the closed #292 -- so this test is genuinely SENSITIVE to which state
  // fetchAllIssues asks for, unlike a fixed canned response that would pass whether the mutation landed
  // or not. If fetchAllIssues's `state: "all"` is ever reverted to `"open"`, this goes from "found #292"
  // to "found nothing", which is the exact silence #378 was filed to end.
  const ghLikeRun = (_cmd: string, args: string[]) => {
    const requestedState = args[args.indexOf("--state") + 1];
    const allIssues = [
      { number: 291, title: "open row", labels: [{ name: READY_LABEL }], state: "OPEN" },
      { number: 292, title: "closed row still carrying ready", labels: [{ name: READY_LABEL }], state: "CLOSED" },
    ];
    return JSON.stringify(requestedState === "all" ? allIssues : allIssues.filter((i) => i.state === "OPEN"));
  };
  const result = fetchAllIssues({ run: ghLikeRun });
  const debris = closedDebris(result);
  assert.equal(debris.length, 1, "fetchAllIssues must request --state all, or #292 (the closed row) never "
    + "reaches closedDebris at all -- a mutation back to --state open makes this assert 0, not 1");
  assert.equal(debris[0].number, 292);
});

// --- openRowsAbsentFromBoard: pure, no I/O -- #399's third population, widened to every open row by #788 ---

test("openRowsAbsentFromBoard: a row whose number is on the board is not reported", () => {
  const issues = [{ number: 1, title: "on the board", labels: [READY_LABEL] }];
  assert.deepEqual(openRowsAbsentFromBoard(issues, new Set([1])), []);
});

test("openRowsAbsentFromBoard: a row absent from the board's item numbers is reported", () => {
  const issues = [{ number: 1, title: "off the board", labels: [READY_LABEL] }];
  assert.deepEqual(openRowsAbsentFromBoard(issues, new Set([2, 3])), issues);
});

test("#788 ACCEPTANCE, MUTATION TARGET: a row with NO `ready` label, absent from the board, IS reported "
  + "-- the exact population the ready-only version could not see: 24 open rows of every other kind had "
  + "no Project item while it read clean", () => {
  const issues = [{ number: 1, title: "no ready label, off the board", labels: ["blocked"] }];
  assert.deepEqual(openRowsAbsentFromBoard(issues, new Set()), issues);
});

test("openRowsAbsentFromBoard: neither a label check nor a Status check alone would see this -- only the "
  + "comparison does", () => {
  // Three rows, deliberately mixed labels (READY_LABEL, none, a different one) -- #399's original shape
  // widened by #788: the label carried is irrelevant, only board membership is.
  const issues = [
    { number: 10, title: "row A", labels: [READY_LABEL] },
    { number: 11, title: "row B", labels: [] },
    { number: 12, title: "row C, genuinely on the board", labels: ["blocked"] },
  ];
  const boardNumbers = new Set([12]);
  const missing = openRowsAbsentFromBoard(issues, boardNumbers);
  assert.deepEqual(missing.map((i: { number: number }) => i.number), [10, 11]);
});

// --- labellessRows: pure, no I/O -- #788's own population, invisible to every OTHER check ---

test("#788 ACCEPTANCE, MUTATION TARGET: a row with NO labels at all is reported -- exactly #623's shape", () => {
  const issues = [{ number: 623, title: "the most irreversible row on the milestone", labels: [] }];
  assert.deepEqual(labellessRows(issues), issues);
});

test("labellessRows: a row carrying even one label (backlog is the safe default) is NOT reported -- a "
  + "check that fires on a labelled row is one people learn to ignore", () => {
  const issues = [{ number: 1, title: "fixed by hand", labels: ["backlog"] }];
  assert.deepEqual(labellessRows(issues), []);
});

test("labellessRows: a mixed population reports only the labelless ones, in order", () => {
  const issues = [
    { number: 600, title: "labelless", labels: [] },
    { number: 601, title: "labelled", labels: ["backlog"] },
    { number: 644, title: "also labelless", labels: [] },
  ];
  assert.deepEqual(labellessRows(issues).map((i) => i.number), [600, 644]);
});

// --- readyRowsAlreadyMerged: pure, no I/O -- #443's fourth population, refined by #550 ---

test("readyRowsAlreadyMerged: a ready row a MERGED PR declares Closes on is flagged ALREADY-MERGED", () => {
  const issues = [{ number: 438, title: "shipped already", labels: [READY_LABEL] }];
  const refs = new Map([[438, [{ number: 440, state: "MERGED", mergedAt: "2026-09-01T00:00:00Z" }]]]);
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs), [{ number: 438, title: "shipped already",
    state: "ALREADY-MERGED", closedBy: 440, mergedAt: "2026-09-01T00:00:00Z" }]);
});

test("readyRowsAlreadyMerged: a ready row whose closing PR is still OPEN is NOT flagged -- the fix has "
  + "not landed yet, which is worth knowing but is not this row's shape", () => {
  const issues = [{ number: 1, title: "in flight", labels: [READY_LABEL] }];
  const refs = new Map([[1, [{ number: 2, state: "OPEN", mergedAt: null }]]]);
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs), []);
});

test("readyRowsAlreadyMerged: a ready row with no closing reference at all is not flagged", () => {
  const issues = [{ number: 1, title: "nothing closes this yet", labels: [READY_LABEL] }];
  assert.deepEqual(readyRowsAlreadyMerged(issues, new Map()), []);
});

test("readyRowsAlreadyMerged: a row absent from the caller-supplied ready population is never flagged -- "
  + "this is the pure-function form of #443's own mutation instruction (close the fixture issue, confirm "
  + "the flag clears): closing it means it never reaches this function as a ready issue in the first place", () => {
  // Before: the issue is open and ready, and a merged PR closes it -- flagged.
  const openReady = [{ number: 438, title: "shipped already", labels: [READY_LABEL] }];
  const refs = new Map([[438, [{ number: 440, state: "MERGED", mergedAt: "2026-09-01T00:00:00Z" }]]]);
  assert.equal(readyRowsAlreadyMerged(openReady, refs).length, 1);
  // After: the issue is closed, so `fetchOpenIssues` never returns it and it never reaches this function --
  // the flag clears not because the predicate changed, but because the population the caller builds did.
  assert.equal(readyRowsAlreadyMerged([], refs).length, 0);
});

test("readyRowsAlreadyMerged: multiple closing PRs, only one merged, is still flagged by the merged one", () => {
  const issues = [{ number: 1, title: "row", labels: [READY_LABEL] }];
  const refs = new Map([[1, [{ number: 2, state: "CLOSED", mergedAt: null },
    { number: 3, state: "MERGED", mergedAt: "2026-09-01T00:00:00Z" }]]]);
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs), [{ number: 1, title: "row",
    state: "ALREADY-MERGED", closedBy: 3, mergedAt: "2026-09-01T00:00:00Z" }]);
});

// --- #550: REOPENED-AFTER-MERGE, distinguished from ALREADY-MERGED by comparing timestamps ---

test("#550 MUTATION (failing direction 1): a reopen BEFORE the merge is still ALREADY-MERGED, not "
  + "REOPENED-AFTER-MERGE -- the row was reopened for some earlier, unrelated reason and the merge is "
  + "the last word", () => {
  const issues = [{ number: 492, title: "the real #492 shape, reopen first", labels: [READY_LABEL] }];
  const refs = new Map([[492, [{ number: 529, state: "MERGED", mergedAt: "2026-09-08T18:37:31Z" }]]]);
  const reopens = new Map([[492, "2026-09-08T10:00:00Z"]]); // reopened HOURS before the merge
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs, reopens), [{ number: 492,
    title: "the real #492 shape, reopen first", state: "ALREADY-MERGED", closedBy: 529,
    mergedAt: "2026-09-08T18:37:31Z" }]);
});

test("#550 MUTATION (failing direction 2): a reopen AFTER the merge is REOPENED-AFTER-MERGE, never "
  + "the ALREADY-MERGED sentence -- #492's own real shape: closed by #529 at 18:37:31Z, reopened at "
  + "19:06:33Z", () => {
  const issues = [{ number: 492, title: "The build cannot run on windows-2022", labels: [READY_LABEL] }];
  const refs = new Map([[492, [{ number: 529, state: "MERGED", mergedAt: "2026-09-08T18:37:31Z" }]]]);
  const reopens = new Map([[492, "2026-09-08T19:06:33Z"]]);
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs, reopens), [{ number: 492,
    title: "The build cannot run on windows-2022", state: "REOPENED-AFTER-MERGE", closedBy: 529,
    mergedAt: "2026-09-08T18:37:31Z", reopenedAt: "2026-09-08T19:06:33Z" }]);
});

test("#550: the MOST RECENT qualifying merge is compared, never the first one found -- #492's real "
  + "shape has TWO merged closing PRs (#529, then #545), and only the later one is the one actually "
  + "racing the reopen", () => {
  const issues = [{ number: 492, title: "two merges, one reopen", labels: [READY_LABEL] }];
  const refs = new Map([[492, [
    { number: 529, state: "MERGED", mergedAt: "2026-09-08T18:37:31Z" },
    { number: 545, state: "MERGED", mergedAt: "2026-09-08T19:00:41Z" },
  ]]]);
  // Reopened BETWEEN the two merges -- comparing against the FIRST merge (#529) would wrongly read this
  // as REOPENED-AFTER-MERGE; comparing against the LATEST (#545, which is later than this reopen) is the
  // true ALREADY-MERGED, because #545 is main's actual last word and it postdates the reopen.
  const reopens = new Map([[492, "2026-09-08T18:51:57Z"]]);
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs, reopens), [{ number: 492,
    title: "two merges, one reopen", state: "ALREADY-MERGED", closedBy: 545, mergedAt: "2026-09-08T19:00:41Z" }]);
});

test("#550: a row never reopened at all (no entry in the map) is ALREADY-MERGED, not a crash on a missing key", () => {
  const issues = [{ number: 1, title: "never reopened", labels: [READY_LABEL] }];
  const refs = new Map([[1, [{ number: 2, state: "MERGED", mergedAt: "2026-09-01T00:00:00Z" }]]]);
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs, new Map()), [{ number: 1, title: "never reopened",
    state: "ALREADY-MERGED", closedBy: 2, mergedAt: "2026-09-01T00:00:00Z" }]);
  // and the caller's default (omitting the third argument entirely) behaves identically
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs), [{ number: 1, title: "never reopened",
    state: "ALREADY-MERGED", closedBy: 2, mergedAt: "2026-09-01T00:00:00Z" }]);
});

// --- fetchLatestReopenedAt: the gh-calling half for #550's reopen timestamp ---

/** One aliased issue node, shaped like `timelineItems(itemTypes: [REOPENED_EVENT])` really returns it. */
function reopenTimelineResponse(byIssue: Record<string, { number: number; reopens: string[] }>) {
  const repository: Record<string, unknown> = {};
  for (const [alias, { number, reopens }] of Object.entries(byIssue)) {
    repository[alias] = { number, timelineItems: { nodes: reopens.map((createdAt) => ({ createdAt })) } };
  }
  return JSON.stringify({ data: { repository } });
}

test("fetchLatestReopenedAt: empty input makes no gh call at all", () => {
  let called = false;
  const run = () => { called = true; return "{}"; };
  const map = fetchLatestReopenedAt([], { run });
  assert.deepEqual(map, new Map());
  assert.equal(called, false);
});

test("fetchLatestReopenedAt: an issue reopened twice returns the LATEST event, not the first", () => {
  const run = () => reopenTimelineResponse({
    i0: { number: 492, reopens: ["2026-09-08T18:51:57Z", "2026-09-08T19:06:33Z"] },
  });
  const map = fetchLatestReopenedAt([492], { run });
  assert.equal(map.get(492), "2026-09-08T19:06:33Z");
});

test("fetchLatestReopenedAt: an issue never reopened returns null, not undefined or a crash", () => {
  const run = () => reopenTimelineResponse({ i0: { number: 1, reopens: [] } });
  const map = fetchLatestReopenedAt([1], { run });
  assert.equal(map.get(1), null);
});

test("fetchLatestReopenedAt throws, rather than returning an empty map, when gh itself fails", () => {
  const run = () => { throw new Error("gh: not authenticated"); };
  assert.throws(() => fetchLatestReopenedAt([1], { run }), /could not resolve reopen history/);
});

test("fetchLatestReopenedAt throws on a response missing an expected issue alias, rather than guessing", () => {
  const run = () => JSON.stringify({ data: { repository: {} } });
  assert.throws(() => fetchLatestReopenedAt([492], { run }), /missing from the reopen-history response/);
});

// --- fetchClosingPrRefs: the gh-calling half, shaped exactly like the live GraphQL schema returns it ---

/** One aliased issue node, shaped like `closedByPullRequestsReferences` really returns it. */
function closingRefsResponse(byIssue: Record<string, { number: number;
  refs: Array<{ number: number; state: string; mergedAt?: string | null }> }>) {
  const repository: Record<string, unknown> = {};
  for (const [alias, { number, refs }] of Object.entries(byIssue)) {
    repository[alias] = { number, closedByPullRequestsReferences: { nodes: refs } };
  }
  return JSON.stringify({ data: { repository } });
}

test("fetchClosingPrRefs: empty input makes no gh call at all", () => {
  let called = false;
  const run = () => { called = true; return "{}"; };
  const map = fetchClosingPrRefs([], { run });
  assert.deepEqual(map, new Map());
  assert.equal(called, false, "an empty alias list is not valid GraphQL and needs no round trip");
});

test("fetchClosingPrRefs: one issue, one merged closing PR, carrying its mergedAt (#550)", () => {
  const run = () => closingRefsResponse({
    i0: { number: 438, refs: [{ number: 440, state: "MERGED", mergedAt: "2026-09-01T00:00:00Z" }] },
  });
  const map = fetchClosingPrRefs([438], { run });
  assert.deepEqual(map.get(438), [{ number: 440, state: "MERGED", mergedAt: "2026-09-01T00:00:00Z" }]);
});

test("fetchClosingPrRefs: a ref with no mergedAt (an OPEN PR) reads null, not undefined", () => {
  const run = () => closingRefsResponse({
    i0: { number: 1, refs: [] },
    i1: { number: 2, refs: [{ number: 20, state: "OPEN" }] },
  });
  const map = fetchClosingPrRefs([1, 2], { run });
  assert.deepEqual(map.get(1), []);
  assert.deepEqual(map.get(2), [{ number: 20, state: "OPEN", mergedAt: null }]);
});

test("fetchClosingPrRefs throws, rather than returning an empty map, when gh itself fails", () => {
  const run = () => { throw new Error("gh: not authenticated"); };
  assert.throws(() => fetchClosingPrRefs([1], { run }), /could not resolve closing PR references/);
});

test("fetchClosingPrRefs throws on a response missing an expected issue alias, rather than guessing", () => {
  const run = () => JSON.stringify({ data: { repository: {} } });
  assert.throws(() => fetchClosingPrRefs([438], { run }), /missing from the closing-references response/);
});

test("livesStateLabels: `ready` AND `in-progress` both advertise a live state", async () => {
  const { livesStateLabels } = await import("../../../../scripts/ready-label-audit.mjs");
  assert.ok(livesStateLabels(["backlog", "ready"]));
  assert.ok(livesStateLabels(["backlog", "in-progress"]));
  assert.ok(!livesStateLabels(["backlog", "fleet-gated"]));
});

test("claimsNobodyIsWorking: an in-progress row with no PR and a cold branch is flagged, with its session named", async () => {
  const { claimsNobodyIsWorking } = await import("../../../../scripts/ready-label-audit.mjs");
  const rows = [
    { number: 1, title: "cold", labels: ["in-progress", "session:worker-config"] },
    { number: 2, title: "has a PR", labels: ["in-progress"] },
    { number: 3, title: "fresh push", labels: ["in-progress"] },
    { number: 4, title: "not claimed", labels: ["ready"] },
  ];
  const flagged = claimsNobodyIsWorking(rows, { hasOpenPr: new Map([[2, true]]),
    lastPushMinutes: new Map([[1, 600], [3, 10]]),
    claimedMinutes: new Map([[1, 600], [2, 600], [3, 600], [4, 600]]) });
  assert.deepEqual(flagged.map((f: { number: number }) => f.number), [1],
    "only the claimed row with neither an open PR nor a recent push is stale");
  assert.deepEqual(flagged[0].sessions, ["session:worker-config"],
    "the flag must name the session holding it, or nobody knows whose claim to release");
});

test("#756 claimsNobodyIsWorking: a COMMENT in the window keeps a claim live, as `ceo`'s rule (#723) says", async () => {
  const { claimsNobodyIsWorking } = await import("../../../../scripts/ready-label-audit.mjs");
  // THE LIVE CASE THIS ROW WAS FILED FROM. #426 held `in-progress`, had no open PR and no branch at all,
  // and carried a comment 47 minutes old. The release rule read it live; this check read it DEAD, and
  // `tracker-auditor` had to overrule the tool to follow the rule.
  const rows = [{ number: 426, title: "commented, not pushed",
    labels: ["in-progress", "session:worker-audit", "session:orchestrator"] }];
  const activity = { hasOpenPr: new Map(), lastPushMinutes: new Map(),
    claimedMinutes: new Map([[426, 1800]]), lastCommentMinutes: new Map([[426, 47]]) };
  assert.deepEqual(claimsNobodyIsWorking(rows, activity), [],
    "a comment inside the window is work in progress that has produced no commit yet");
});

test("#756 claimsNobodyIsWorking: a comment OUTSIDE the window does not keep it alive", async () => {
  const { claimsNobodyIsWorking } = await import("../../../../scripts/ready-label-audit.mjs");
  // THE MUTATION #756's acceptance names: move the comment out of the window and the row comes back.
  const rows = [{ number: 426, title: "commented long ago", labels: ["in-progress", "session:orchestrator"] }];
  const flagged = claimsNobodyIsWorking(rows, { hasOpenPr: new Map(), lastPushMinutes: new Map(),
    claimedMinutes: new Map([[426, 1800]]), lastCommentMinutes: new Map([[426, 241]]) });
  assert.deepEqual(flagged.map((f: { number: number }) => f.number), [426]);
});

test("#756 claimsNobodyIsWorking: an ABSENT comment age is not read as fresh", async () => {
  const { claimsNobodyIsWorking } = await import("../../../../scripts/ready-label-audit.mjs");
  // A row whose comments could not be read is left ABSENT from the map, and absent must mean "no comment
  // seen", never "commented just now" -- the same discipline the branch age already keeps. The three-fact
  // shape (no `lastCommentMinutes` key at all) is the same case and must decide identically.
  const rows = [{ number: 9, title: "unreadable comments", labels: ["in-progress", "session:x"] }];
  const base = { hasOpenPr: new Map(), lastPushMinutes: new Map(), claimedMinutes: new Map([[9, 1800]]) };
  assert.deepEqual(claimsNobodyIsWorking(rows, base).map((f: { number: number }) => f.number), [9],
    "an older three-fact caller still decides, and still flags");
  assert.deepEqual(claimsNobodyIsWorking(rows, { ...base, lastCommentMinutes: new Map() })
    .map((f: { number: number }) => f.number), [9]);
});

test("#756 claimsNobodyIsWorking: a comment does not rescue a row claimed ten minutes ago into a push report", async () => {
  const { claimsNobodyIsWorking } = await import("../../../../scripts/ready-label-audit.mjs");
  // The reported `minutes` must keep describing the BRANCH. A row kept alive by a comment and one kept
  // alive by a push are different situations, and the line that names one must not silently mean the
  // other -- so a row that IS flagged still reports its push age, comment or no comment.
  const rows = [{ number: 5, title: "old comment, old branch", labels: ["in-progress", "session:y"] }];
  const flagged = claimsNobodyIsWorking(rows, { hasOpenPr: new Map(),
    lastPushMinutes: new Map([[5, 900]]), claimedMinutes: new Map([[5, 1800]]),
    lastCommentMinutes: new Map([[5, 900]]) });
  assert.equal(flagged[0].minutes, 900, "the reported age is the branch's, never the comment's");
});

test("claimsNobodyIsWorking: NO BRANCH AT ALL is the strongest case, never read as fresh", async () => {
  const { claimsNobodyIsWorking } = await import("../../../../scripts/ready-label-audit.mjs");
  // #143 was claimed THIRTY HOURS before anyone noticed, with no branch ever pushed. An absent age read
  // as zero would have reported that row clean -- the worst case reported as the healthiest.
  const rows = [{ number: 143, title: "never started", labels: ["in-progress", "session:orchestrator"] }];
  const flagged = claimsNobodyIsWorking(rows,
    { hasOpenPr: new Map(), lastPushMinutes: new Map(), claimedMinutes: new Map([[143, 1800]]) });
  assert.deepEqual(flagged.map((f: { number: number }) => f.number), [143]);
  assert.equal(flagged[0].minutes, null, "an absent branch reports null, not 0 -- they are different facts");
});


test("claimsNobodyIsWorking: a claim made TEN MINUTES ago with no branch is NOT stale", async () => {
  const { claimsNobodyIsWorking } = await import("../../../../scripts/ready-label-audit.mjs");
  // THE FIRST LIVE RUN OF THIS CHECK FLAGGED FIVE ROWS CLAIMED WITHIN THE HOUR. "No branch at all" was
  // treated as the strongest evidence of an unworked claim -- true of a thirty-hour-old claim, false of a
  // ten-minute-old one, and the evidence is IDENTICAL in both. Only the claim's own age separates "not
  // started yet" from "never started".
  //
  // This is the regression test for that, and it is why the check was wired into a real run before it was
  // trusted: driven only by fixtures it would have looked correct.
  const rows = [{ number: 478, title: "just claimed", labels: ["in-progress", "session:worker-contracts"] }];
  const flagged = claimsNobodyIsWorking(rows,
    { hasOpenPr: new Map(), lastPushMinutes: new Map(), claimedMinutes: new Map([[478, 10]]) });
  assert.deepEqual(flagged, [], "a fresh claim with no branch yet is a session starting, not a dead claim");
});

test("#755 formatDeadClaimLine: the line names the criterion (#723), the same way the OK line already did", async () => {
  const { formatDeadClaimLine } = await import("../../../../scripts/ready-label-audit.mjs");
  // #755's own complaint: the clean-path line already said "the same three legs as `ceo`'s release rule
  // (#723)"; the flagged-path line said nothing, so a reader could not tell a criterion change from a
  // state change just by reading the report. This is the regression test for that gap, on #426's own shape.
  const line = formatDeadClaimLine({ number: 426, title: "commented, not pushed",
    sessions: ["session:worker-audit"], minutes: null });
  assert.match(line, /#723/, "the flagged line must cite the same rule the OK line cites");
  assert.match(line, /DEAD-CLAIM {2}#426 "commented, not pushed" -- held by session:worker-audit, /);
});

// --- runCheck: a check that could not ASK must not silence the ones after it ---
//
// Measured 2026-09-08: `main` ran six checks as six `try` blocks each ending in `return`, and the
// workflow supplied `github.token`, which cannot resolve a user-owned ProjectV2. So three scheduled
// runs answered NOTHING about closing PR references or dead claims -- two questions that need no
// board at all -- because the fourth check could not ask its own.

test("#527-adjacent: a throwing check with an UNEXPLAINED cause is recorded as REFUSED, never counted "
  + "as a clean zero", () => {
  const refused: string[] = [];
  const count = runCheck("board membership", () => { throw new Error("gh: not authenticated"); }, refused);
  assert.equal(count, 0, "a refusal contributes no findings");
  assert.deepEqual(refused, ["board membership"], "and it is named, so the zero cannot read as clean");
});

test("a check that answers normally is not recorded as refused", () => {
  const refused: string[] = [];
  assert.equal(runCheck("open issues", () => 3, refused), 3);
  assert.deepEqual(refused, []);
});

test("MUTATION: one refusing check does NOT stop the checks after it -- the whole defect", () => {
  const ran: string[] = [];
  const refused: string[] = [];
  const checks: [string, () => number][] = [
    ["first", () => { ran.push("first"); return 0; }],
    ["board membership", () => { throw new Error("gh: not authenticated"); }],
    ["closing PR references", () => { ran.push("closing PR references"); return 0; }],
    ["claim activity", () => { ran.push("claim activity"); return 0; }],
  ];
  for (const [what, check] of checks) runCheck(what, check, refused);
  assert.deepEqual(ran, ["first", "closing PR references", "claim activity"],
    "every askable check still ran");
  assert.deepEqual(refused, ["board membership"]);
});

// --- #546/ceo's ruling, 2026-09-09: the ONE named, ungrantable credential gap is NOT a generic refusal ---

// #849: THE VERBATIM MESSAGE, CAPTURED, NOT TYPED -- from the first real audit run after #849 merged
// (run 34386872582, 2026-09-09T18:05:19Z). #849's own test proved `isProjectsCredentialGap` true against
// a HAND-WRITTEN message ("Could not resolve to a ProjectV2") and merged; the very next live run hit
// GitHub's OTHER real wording -- the GraphQL field path, `user.projectV2` (lowercase p), inside a
// FORBIDDEN error -- which `.includes("ProjectV2")` does not match case-sensitively, and #849's audit
// exited 2 printing "1 refused for an unexplained reason: board membership", the exact sentence this
// ruling exists to end. ceo's own rule, now stated here because this is where the predicate gets edited
// next: a predicate over a message is verified against a captured real message, never a written one.
const REAL_PROJECTV2_FORBIDDEN_MESSAGE = "board-snapshot: could not read Project 2 items -- refusing to "
  + "snapshot a partial board. FORBIDDEN (user.projectV2): Resource not accessible by personal access token";

test("isProjectsCredentialGap: matches GitHub's own THREE measured wordings for the SAME cause -- the "
  + "GraphQL type name (\"ProjectV2\"), the field path (\"user.projectV2\", the one #849 missed), and "
  + "\"no permission to see it\" versus \"this does not exist\" all render as the identical text either way", () => {
  assert.ok(isProjectsCredentialGap("no ProjectV2"));
  assert.ok(isProjectsCredentialGap("gh: Could not resolve to a ProjectV2 with the number 2"));
  assert.ok(isProjectsCredentialGap(REAL_PROJECTV2_FORBIDDEN_MESSAGE),
    "the real, captured message from run 34386872582 -- lowercase p, inside FORBIDDEN -- must match");
  assert.ok(!isProjectsCredentialGap("gh: not authenticated"),
    "an unrelated failure must not be swept into the one named gap");
  assert.ok(!isProjectsCredentialGap("FORBIDDEN: Resource not accessible by personal access token"),
    "a FORBIDDEN token failure with NO mention of ProjectV2 at all is a genuinely different problem and "
    + "must not be misclassified as this one named gap -- widening to FORBIDDEN alone was considered and "
    + "rejected for exactly this reason");
});

test("#849 ACCEPTANCE, MUTATION TARGET: runCheck given the REAL captured message prints NOT RUN and "
  + "records it in `notRun` -- the OUTCOME, not merely that the predicate returns true. #849's own test "
  + "proved the predicate true and still merged a version that exited 2 on this exact message in "
  + "production, because nothing asserted what runCheck actually DOES with it", () => {
  const refused: string[] = [];
  const notRun: string[] = [];
  let stderr = "";
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string) => { stderr += chunk; return true; }) as typeof process.stderr.write;
  try {
    const count = runCheck("board membership",
      () => { throw new Error(REAL_PROJECTV2_FORBIDDEN_MESSAGE); }, refused, notRun);
    assert.equal(count, 0);
    assert.deepEqual(notRun, ["board membership"]);
    assert.deepEqual(refused, [], "the real message must not also land in refused");
    assert.match(stderr, /^NOT RUN board membership:/m);
    assert.doesNotMatch(stderr, /COULD NOT AUDIT/);
  } finally {
    process.stderr.write = original;
  }
});

test("#546 ACCEPTANCE, MUTATION TARGET: runCheck records a ProjectV2 throw in `notRun`, not `refused` "
  + "-- a job red on every commit for a capability nobody here can grant trains everyone to ignore it", () => {
  const refused: string[] = [];
  const notRun: string[] = [];
  const count = runCheck("board membership",
    () => { throw new Error("gh: Could not resolve to a ProjectV2 with the number 2"); }, refused, notRun);
  assert.equal(count, 0);
  assert.deepEqual(refused, [], "the named gap must not also count as an unexplained refusal");
  assert.deepEqual(notRun, ["board membership"]);
});

test("#546: an UNRELATED throw on the same check still lands in `refused`, never swallowed into "
  + "`notRun` just because the check happens to be board membership", () => {
  const refused: string[] = [];
  const notRun: string[] = [];
  runCheck("board membership", () => { throw new Error("ENOTFOUND api.github.com"); }, refused, notRun);
  assert.deepEqual(refused, ["board membership"]);
  assert.deepEqual(notRun, []);
});

test("#546: notRun defaults to a fresh array when the caller does not pass one -- callers written "
  + "before this ruling still work unchanged", () => {
  const refused: string[] = [];
  assert.doesNotThrow(() =>
    runCheck("board membership", () => { throw new Error("no ProjectV2"); }, refused));
  assert.deepEqual(refused, [], "with no notRun array supplied, the named gap still does not become a "
    + "refusal -- it is simply not recorded anywhere the caller can see, same as before this test existed");
});

test("CHECKS names all eleven, so the partial-audit sentence states a true denominator", () => {
  assert.equal(CHECKS.length, 11);
  assert.deepEqual(CHECKS.map(([what]) => what), [
    "open issues", "hand claims", "labelless rows", "declined rows", "closed issues",
    "board membership", "closing PR references", "claim activity", "closed-row provenance",
    "closing PR never merged", "coverage vs tracker",
  ]);
});

// --- #804: the four claim-label literals are declared in EXACTLY ONE place, scripts/claim-labels.mjs ---

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../scripts");
const CLAIM_LABEL_NAMES = ["READY_LABEL", "WAS_READY_LABEL", "CLAIM_LABEL", "STARTED_LABEL"];
/** A fresh declaration (`const X = "..."`), never an import or a re-export -- both of those name the
 * identifier too, and only a declaration is the drift risk this test exists to close off. */
const DECLARES_A_CLAIM_LABEL = new RegExp(
  `\\b(?:const|let|var)\\s+(?:${CLAIM_LABEL_NAMES.join("|")})\\s*=\\s*"`,
);

test("#804 ACCEPTANCE, MUTATION TARGET: no scripts/*.mjs file other than claim-labels.mjs declares any "
  + "of the four claim-label literals -- row-claim.mjs and ready-label-audit.mjs each own only an "
  + "import + re-export, close-rows-for-merged-pr.mjs only an import; a fresh `const X = \"...\"` "
  + "anywhere else is the exact fact-stated-twice shape this file exists to prevent recurring", () => {
  const offenders = [];
  for (const entry of readdirSync(SCRIPTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".mjs") || entry.name === "claim-labels.mjs") continue;
    const source = readFileSync(join(SCRIPTS_DIR, entry.name), "utf8");
    if (DECLARES_A_CLAIM_LABEL.test(source)) offenders.push(entry.name);
  }
  assert.deepEqual(offenders, [],
    `these scripts/*.mjs files declare a claim-label literal locally instead of importing it from `
    + `claim-labels.mjs: ${offenders.join(", ")}`);
});

test("#804: claim-labels.mjs itself is a real LEAF -- it imports nothing, so nothing depending on it "
  + "(directly or transitively) can form a cycle through it", () => {
  const source = readFileSync(join(SCRIPTS_DIR, "claim-labels.mjs"), "utf8");
  assert.doesNotMatch(source, /^import\s/m,
    "claim-labels.mjs must stay import-free -- an import here would reintroduce exactly the cycle risk "
    + "the leaf-module design exists to remove");
});

// --- #870: a closed row closed by a PR that never merged ---

function closingIssueRefsResponse(byPr: Record<string, { number: number; issues: number[] }>) {
  const repository: Record<string, unknown> = {};
  for (const [alias, { number, issues }] of Object.entries(byPr)) {
    repository[alias] = { number, closingIssuesReferences: { nodes: issues.map((n) => ({ number: n })) } };
  }
  return JSON.stringify({ data: { repository } });
}

test("fetchClosedUnmergedPrs: keeps only PRs with mergedAt null, never merge_commit_sha", () => {
  const run = () => JSON.stringify([
    { number: 1, mergedAt: null },
    { number: 2, mergedAt: "2026-09-01T00:00:00Z" },
    { number: 3, mergedAt: null },
  ]);
  assert.deepEqual(fetchClosedUnmergedPrs({ run }), [
    { number: 1, mergedAt: null }, { number: 3, mergedAt: null },
  ]);
});

test("fetchClosedUnmergedPrs throws, rather than returning an empty list, when gh itself fails", () => {
  const run = () => { throw new Error("gh: not authenticated"); };
  assert.throws(() => fetchClosedUnmergedPrs({ run }), /could not list closed PRs/);
});

test("fetchClosingIssueRefs: empty input makes no gh call at all", () => {
  let called = false;
  const run = () => { called = true; return "{}"; };
  assert.deepEqual(fetchClosingIssueRefs([], { run }), new Map());
  assert.equal(called, false);
});

test("fetchClosingIssueRefs: #89's real shape -- a closed-unmerged PR still names its closing issue "
  + "(#870's own finding: the ISSUE-side field cannot see this, so this reads the PR's OWN side)", () => {
  const run = () => closingIssueRefsResponse({ p0: { number: 89, issues: [79] } });
  assert.deepEqual(fetchClosingIssueRefs([89], { run }).get(89), [79]);
});

test("fetchClosingIssueRefs: a PR declaring no closing issue reads an empty array, not absent", () => {
  const run = () => closingIssueRefsResponse({ p0: { number: 1, issues: [] } });
  assert.deepEqual(fetchClosingIssueRefs([1], { run }).get(1), []);
});

test("fetchClosingIssueRefs throws, rather than returning an empty map, when gh itself fails", () => {
  const run = () => { throw new Error("gh: rate limited"); };
  assert.throws(() => fetchClosingIssueRefs([1], { run }), /could not resolve closing issue references/);
});

test("fetchClosingIssueRefs throws on a response missing an expected PR alias, rather than guessing", () => {
  const run = () => JSON.stringify({ data: { repository: {} } });
  assert.throws(() => fetchClosingIssueRefs([89], { run }), /missing from the closing-issue-references/);
});

test("soleUnmergedCloserRows: #79's real shape -- sole unmerged closer, GitHub recognises no merged "
  + "closer at all -- flagged", () => {
  const issues = [{ number: 79, title: "1.3.5 is a rule...", closedAt: "2026-09-07T02:08:29Z",
    stateReason: "COMPLETED" }];
  const unmergedRefs = new Map([[89, [79]]]);
  const mergedRefs = new Map([[79, []]]); // #870's own measurement: EMPTY, not the stale PR
  assert.deepEqual(soleUnmergedCloserRows(issues, unmergedRefs, mergedRefs),
    [{ number: 79, title: "1.3.5 is a rule...", closedAt: "2026-09-07T02:08:29Z", closedBy: 89 }]);
});

test("soleUnmergedCloserRows: #159's real shape -- an unmerged PR once claimed it, but GitHub currently "
  + "recognises a DIFFERENT, merged PR closing it -- NOT flagged", () => {
  const issues = [{ number: 159, title: "reported.json becomes a directory",
    closedAt: "2026-09-08T00:00:00Z", stateReason: "COMPLETED" }];
  const unmergedRefs = new Map([[172, [159]]]);
  const mergedRefs = new Map([[159, [{ number: 473, state: "MERGED", mergedAt: "2026-09-08T05:52:23Z" }]]]);
  assert.deepEqual(soleUnmergedCloserRows(issues, unmergedRefs, mergedRefs), []);
});

test("soleUnmergedCloserRows: an issue no closed-unmerged PR ever named is not this check's population", () => {
  const issues = [{ number: 1, title: "unrelated", closedAt: "2026-09-01T00:00:00Z",
    stateReason: "COMPLETED" }];
  assert.deepEqual(soleUnmergedCloserRows(issues, new Map(), new Map()), []);
});

test("soleUnmergedCloserRows: TWO different closed-unmerged PRs both naming the same issue is not "
  + "'sole' -- not flagged, so this check never guesses between two competing claims", () => {
  const issues = [{ number: 1, title: "two claimants", closedAt: "2026-09-01T00:00:00Z",
    stateReason: "COMPLETED" }];
  const unmergedRefs = new Map([[10, [1]], [11, [1]]]);
  assert.deepEqual(soleUnmergedCloserRows(issues, unmergedRefs, new Map()), []);
});

test("fetchClosedCompletedIssues: reads stateReason and closedAt, defaulting a missing reason to null", () => {
  const run = () => JSON.stringify([
    { number: 1, title: "a", closedAt: "2026-09-01T00:00:00Z", stateReason: "COMPLETED" },
    { number: 2, title: "b", closedAt: "2026-09-02T00:00:00Z" },
  ]);
  assert.deepEqual(fetchClosedCompletedIssues({ run }), [
    { number: 1, title: "a", closedAt: "2026-09-01T00:00:00Z", stateReason: "COMPLETED" },
    { number: 2, title: "b", closedAt: "2026-09-02T00:00:00Z", stateReason: null },
  ]);
});

// --- #870: criterion-coverage.ts vs a closed row, ceo's ruling -- the sharper, unambiguous check ---

test("criterionStatusesFromSource: extracts every criterion/status pair, comments before status skipped", () => {
  const source = `export const X = {
  "1.1.1": { status: "assessed", channels: ["x"], note: "n" },
  "1.3.5": {
    // a paragraph of reasoning
    // spanning several lines
    status: "partial", needs: ["dom"],
  },
};`;
  assert.deepEqual(criterionStatusesFromSource(source), new Map([["1.1.1", "assessed"], ["1.3.5", "partial"]]));
});

test("criterionStatusesFromSource: the real file yields all 55 WCAG 2.2 AA criteria", () => {
  const source = readFileSync(
    join(SCRIPTS_DIR, "..", "packages/judge/src/criterion-coverage.ts"), "utf8");
  const statuses = criterionStatusesFromSource(source);
  assert.ok(statuses.size >= 50, `only found ${statuses.size} -- the scan's own shape may have drifted`);
  assert.equal(statuses.get("1.3.5"), "partial", "#869's own fix -- re-read the file if this drifts");
});

test("criterionOwningRow: a row title beginning with the criterion number, #79's own convention", () => {
  const issues = [{ number: 79, title: "1.3.5 is a rule we could write today",
    closedAt: "2026-09-07T02:08:29Z", stateReason: "COMPLETED" }];
  assert.deepEqual(criterionOwningRow("1.3.5", issues), issues[0]);
});

test("criterionOwningRow: a criterion number appearing LATER in a title is not a match -- only a title "
  + "that BEGINS with it counts", () => {
  const issues = [{ number: 2, title: "something about 1.3.5 in passing",
    closedAt: "2026-09-01T00:00:00Z", stateReason: "COMPLETED" }];
  assert.equal(criterionOwningRow("1.3.5", issues), undefined);
});

test("criterionOwningRow: word-boundaried -- '1.3.5' must not match a title beginning '1.3.50'", () => {
  const issues = [{ number: 3, title: "1.3.50 is not a real criterion",
    closedAt: "2026-09-01T00:00:00Z", stateReason: "COMPLETED" }];
  assert.equal(criterionOwningRow("1.3.5", issues), undefined);
});

test("criterionOwningRow: no matching title at all returns undefined, not a guess", () => {
  assert.equal(criterionOwningRow("1.3.5", []), undefined);
});

test("coverageTrackerDisagreements: #79's real shape -- `reachable` and closed COMPLETED disagree", () => {
  const statuses = new Map([["1.3.5", "reachable"]]);
  const issues = [{ number: 79, title: "1.3.5 is a rule we could write today",
    closedAt: "2026-09-07T02:08:29Z", stateReason: "COMPLETED" }];
  assert.deepEqual(coverageTrackerDisagreements(statuses, issues),
    [{ criterion: "1.3.5", status: "reachable", row: issues[0] }]);
});

test("coverageTrackerDisagreements: `partial` is NOT a disagreement with a closed row -- it is ALREADY "
  + "this file's own definition of code existing, just incompletely (#869's own correction, #886)", () => {
  const statuses = new Map([["1.3.5", "partial"]]);
  const issues = [{ number: 79, title: "1.3.5 is a rule we could write today",
    closedAt: "2026-09-07T02:08:29Z", stateReason: "COMPLETED" }];
  assert.deepEqual(coverageTrackerDisagreements(statuses, issues), []);
});

test("coverageTrackerDisagreements: `assessed` and `out-of-scope` are likewise not disagreements", () => {
  const issues = [{ number: 1, title: "1.1.1 something", closedAt: "2026-09-01T00:00:00Z",
    stateReason: "COMPLETED" }];
  assert.deepEqual(coverageTrackerDisagreements(new Map([["1.1.1", "assessed"]]), issues), []);
  assert.deepEqual(coverageTrackerDisagreements(new Map([["1.1.1", "out-of-scope"]]), issues), []);
});

test("coverageTrackerDisagreements: a row closed NOT_PLANNED is not a disagreement -- it never claimed "
  + "the work was done", () => {
  const statuses = new Map([["1.3.5", "reachable"]]);
  const issues = [{ number: 79, title: "1.3.5 is a rule we could write today",
    closedAt: "2026-09-07T02:08:29Z", stateReason: "NOT_PLANNED" }];
  assert.deepEqual(coverageTrackerDisagreements(statuses, issues), []);
});

test("coverageTrackerDisagreements: no matching row at all is NOT reported as a disagreement -- see "
  + "reachableCriteriaWithoutRow for that third state", () => {
  assert.deepEqual(coverageTrackerDisagreements(new Map([["1.3.5", "reachable"]]), []), []);
});

test("reachableCriteriaWithoutRow: names a `reachable` criterion with no matching closed row, "
  + "distinct from both agreeing and disagreeing", () => {
  assert.deepEqual(reachableCriteriaWithoutRow(new Map([["1.3.5", "reachable"]]), []), ["1.3.5"]);
});

test("reachableCriteriaWithoutRow: a criterion WITH a row (agreeing or disagreeing) is not in this list", () => {
  const issues = [{ number: 79, title: "1.3.5 is a rule we could write today",
    closedAt: "2026-09-07T02:08:29Z", stateReason: "COMPLETED" }];
  assert.deepEqual(reachableCriteriaWithoutRow(new Map([["1.3.5", "reachable"]]), issues), []);
});

test("reachableCriteriaWithoutRow: a non-`reachable` criterion is never named here, row or no row", () => {
  assert.deepEqual(reachableCriteriaWithoutRow(new Map([["1.1.1", "assessed"]]), []), []);
});

test("MUTATION: giving #79's fixture a SECOND, merged closing PR stops the reopen check flagging it, "
  + "and states why", () => {
  const issues = [{ number: 79, title: "1.3.5 is a rule...", closedAt: "2026-09-07T02:08:29Z",
    stateReason: "COMPLETED" }];
  const unmergedRefs = new Map([[89, [79]]]);
  const stillFlagged = soleUnmergedCloserRows(issues, unmergedRefs, new Map([[79, []]]));
  assert.equal(stillFlagged.length, 1, "control: the unmutated fixture must still flag");
  const mergedRefs = new Map([[79, [{ number: 900, state: "MERGED", mergedAt: "2026-09-10T00:00:00Z" }]]]);
  assert.deepEqual(soleUnmergedCloserRows(issues, unmergedRefs, mergedRefs), [],
    "a later merged PR now recognised as closing #79 must stop the reopen recommendation");
});

test("MUTATION: moving 1.3.5 from `reachable` to any other status stops the coverage check flagging it", () => {
  const issues = [{ number: 79, title: "1.3.5 is a rule we could write today",
    closedAt: "2026-09-07T02:08:29Z", stateReason: "COMPLETED" }];
  assert.equal(coverageTrackerDisagreements(new Map([["1.3.5", "reachable"]]), issues).length, 1,
    "control: the unmutated fixture must still disagree");
  for (const status of ["partial", "assessed", "out-of-scope"]) {
    assert.deepEqual(coverageTrackerDisagreements(new Map([["1.3.5", status]]), issues), [],
      `status "${status}" must not be reported as a disagreement`);
  }
});
