/**
 * `ready` must be mutually exclusive with every label that already means "not actually pickable" (#121).
 * See `scripts/ready-label-audit.mjs`'s own header for the incident: `dispatcher` labelled #13 and #75
 * `ready` to hit a floor, while one was disputed and the other had no Region or Acceptance at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  READY_LABEL, WAS_READY_LABEL, MUTEX_LABELS, mutexViolations, handClaims, strandedByIncompleteDecline,
  fetchOpenIssues, fetchAllIssues, closedDebris, isClosedDebrisLabel, readyRowsAbsentFromBoard,
  readyRowsAlreadyMerged, fetchClosingPrRefs, fetchLatestReopenedAt, CHECKS, runCheck,
} from "../../../../scripts/ready-label-audit.mjs";

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

// --- readyRowsAbsentFromBoard: pure, no I/O -- #399's third population ---

test("readyRowsAbsentFromBoard: a ready row whose number is on the board is not reported", () => {
  const issues = [{ number: 1, title: "on the board", labels: [READY_LABEL] }];
  assert.deepEqual(readyRowsAbsentFromBoard(issues, new Set([1])), []);
});

test("readyRowsAbsentFromBoard: a ready row absent from the board's item numbers is reported", () => {
  const issues = [{ number: 1, title: "off the board", labels: [READY_LABEL] }];
  assert.deepEqual(readyRowsAbsentFromBoard(issues, new Set([2, 3])), issues);
});

test("readyRowsAbsentFromBoard: a non-ready row absent from the board is not this population's business", () => {
  const issues = [{ number: 1, title: "no ready label", labels: ["blocked"] }];
  assert.deepEqual(readyRowsAbsentFromBoard(issues, new Set()), []);
});

test("readyRowsAbsentFromBoard: neither a label check nor a Status check alone would see this -- only the "
  + "comparison does", () => {
  // Two rows both carry `ready` (the label is correct, so a label-only check sees nothing wrong) and
  // neither has an item on the board at all (so there is no Status to read either) -- #399's own measured
  // shape, four such rows existing while the Ready lane read empty.
  const issues = [
    { number: 10, title: "row A", labels: [READY_LABEL] },
    { number: 11, title: "row B", labels: [READY_LABEL] },
    { number: 12, title: "row C, genuinely on the board", labels: [READY_LABEL] },
  ];
  const boardNumbers = new Set([12]);
  const missing = readyRowsAbsentFromBoard(issues, boardNumbers);
  assert.deepEqual(missing.map((i) => i.number), [10, 11]);
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

// --- runCheck: a check that could not ASK must not silence the ones after it ---
//
// Measured 2026-09-08: `main` ran six checks as six `try` blocks each ending in `return`, and the
// workflow supplied `github.token`, which cannot resolve a user-owned ProjectV2. So three scheduled
// runs answered NOTHING about closing PR references or dead claims -- two questions that need no
// board at all -- because the fourth check could not ask its own.

test("#527-adjacent: a throwing check is recorded as REFUSED, never counted as a clean zero", () => {
  const refused: string[] = [];
  const count = runCheck("board membership", () => { throw new Error("no ProjectV2"); }, refused);
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
    ["board membership", () => { throw new Error("Could not resolve to a ProjectV2"); }],
    ["closing PR references", () => { ran.push("closing PR references"); return 0; }],
    ["claim activity", () => { ran.push("claim activity"); return 0; }],
  ];
  for (const [what, check] of checks) runCheck(what, check, refused);
  assert.deepEqual(ran, ["first", "closing PR references", "claim activity"],
    "every askable check still ran");
  assert.deepEqual(refused, ["board membership"]);
});

test("CHECKS names all eight, so the partial-audit sentence states a true denominator", () => {
  assert.equal(CHECKS.length, 8);
  assert.deepEqual(CHECKS.map(([what]) => what), [
    "open issues", "hand claims", "declined rows", "closed issues",
    "board membership", "closing PR references", "claim activity", "closed-row provenance",
  ]);
});
