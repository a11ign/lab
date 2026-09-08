/**
 * `ready` must be mutually exclusive with every label that already means "not actually pickable" (#121).
 * See `scripts/ready-label-audit.mjs`'s own header for the incident: `dispatcher` labelled #13 and #75
 * `ready` to hit a floor, while one was disputed and the other had no Region or Acceptance at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  READY_LABEL, MUTEX_LABELS, mutexViolations, fetchOpenIssues,
  fetchAllIssues, closedDebris, isClosedDebrisLabel, readyRowsAbsentFromBoard,
  readyRowsAlreadyMerged, fetchClosingPrRefs,
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

test("#246: ready + in-progress + session:* is caught -- exactly what row-claim.mjs's own comment " +
  "says this audit exists to catch, and the real state three real rows sat in", () => {
  const issues = [
    { number: 230, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-judge"] },
    { number: 223, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-capture"] },
    { number: 222, title: "t", labels: ["backlog", READY_LABEL, "in-progress", "session:worker-audit"] },
  ];
  const violations = mutexViolations(issues);
  assert.equal(violations.length, 3, "all three of #246's real rows must be caught, not a subset");
  for (const v of violations) assert.deepEqual(v.conflicting, ["in-progress"]);
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

test("MUTATION: in-progress is genuinely in MUTEX_LABELS, not just described as such", () => {
  // #246's own shape -- the state row-claim.mjs's own comment says this audit exists to catch. If this
  // list ever drops `in-progress` again, the rule keeps working for the other six and goes silent for
  // exactly the case that motivated the row.
  assert.ok(MUTEX_LABELS.includes("in-progress"),
    "in-progress must be in MUTEX_LABELS -- claimed and started rows are not pickable, #246");
});

test("MUTATION: review-only is genuinely in MUTEX_LABELS, not just described as such", () => {
  // #27's own shape -- a row that solicits review and should never be started as work. If this list ever
  // drops the label the row was filed to add, the rule keeps working for the other five and goes silent
  // for exactly the case that motivated it.
  assert.ok(MUTEX_LABELS.includes("review-only"),
    "review-only must be in MUTEX_LABELS -- it is #27's own shape, the reason this label exists at all");
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
  const openRow = { number: 4, title: "t", labels: [READY_LABEL, "in-progress"], state: "OPEN" as const };
  const closedRow = { number: 5, title: "t", labels: [READY_LABEL, "in-progress"], state: "CLOSED" as const };
  assert.equal(mutexViolations([openRow]).length, 1, "open: a contradiction to resolve");
  assert.equal(closedDebris([openRow]).length, 0, "open: never reported as debris");
  assert.equal(closedDebris([closedRow]).length, 1, "closed: debris");
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

// --- readyRowsAlreadyMerged: pure, no I/O -- #443's fourth population ---

test("readyRowsAlreadyMerged: a ready row a MERGED PR declares Closes on is flagged", () => {
  const issues = [{ number: 438, title: "shipped already", labels: [READY_LABEL] }];
  const refs = new Map([[438, [{ number: 440, state: "MERGED" }]]]);
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs), [{ number: 438, title: "shipped already", closedBy: 440 }]);
});

test("readyRowsAlreadyMerged: a ready row whose closing PR is still OPEN is NOT flagged -- the fix has "
  + "not landed yet, which is worth knowing but is not this row's shape", () => {
  const issues = [{ number: 1, title: "in flight", labels: [READY_LABEL] }];
  const refs = new Map([[1, [{ number: 2, state: "OPEN" }]]]);
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
  const refs = new Map([[438, [{ number: 440, state: "MERGED" }]]]);
  assert.equal(readyRowsAlreadyMerged(openReady, refs).length, 1);
  // After: the issue is closed, so `fetchOpenIssues` never returns it and it never reaches this function --
  // the flag clears not because the predicate changed, but because the population the caller builds did.
  assert.equal(readyRowsAlreadyMerged([], refs).length, 0);
});

test("readyRowsAlreadyMerged: multiple closing PRs, only one merged, is still flagged by the merged one", () => {
  const issues = [{ number: 1, title: "row", labels: [READY_LABEL] }];
  const refs = new Map([[1, [{ number: 2, state: "CLOSED" }, { number: 3, state: "MERGED" }]]]);
  assert.deepEqual(readyRowsAlreadyMerged(issues, refs), [{ number: 1, title: "row", closedBy: 3 }]);
});

// --- fetchClosingPrRefs: the gh-calling half, shaped exactly like the live GraphQL schema returns it ---

/** One aliased issue node, shaped like `closedByPullRequestsReferences` really returns it. */
function closingRefsResponse(byIssue: Record<string, { number: number; refs: Array<{ number: number; state: string }> }>) {
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

test("fetchClosingPrRefs: one issue, one merged closing PR", () => {
  const run = () => closingRefsResponse({ i0: { number: 438, refs: [{ number: 440, state: "MERGED" }] } });
  const map = fetchClosingPrRefs([438], { run });
  assert.deepEqual(map.get(438), [{ number: 440, state: "MERGED" }]);
});

test("fetchClosingPrRefs: several issues resolve by their own alias, never mixed up with a neighbour's", () => {
  const run = () => closingRefsResponse({
    i0: { number: 1, refs: [] },
    i1: { number: 2, refs: [{ number: 20, state: "OPEN" }] },
  });
  const map = fetchClosingPrRefs([1, 2], { run });
  assert.deepEqual(map.get(1), []);
  assert.deepEqual(map.get(2), [{ number: 20, state: "OPEN" }]);
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
