// no-token: gh
//
// #913: this file imports `LIVE_SESSIONS`/`RETIRED_SESSIONS`/`unknownSessionLabels` from `arm-pr.mjs`,
// and that module spawns `gh` at line 30 for the PR read its own CLI does -- a path nothing here takes:
// every assertion below is a pure function of a data file and a label array. The roster is imported rather
// than retyped deliberately (a second copy drifts from the one the guards read), and importing it is what
// charges this file for the token.
//
// DECLARED AND THEN PROVED: run with `GH_TOKEN`/`GITHUB_TOKEN` unset and a fake `gh` first on `PATH`
// that exits 97 and announces itself -- 20 pass / 0 fail, and the fake is never called.
/**
 * A LANE IS WHO MAY CHANGE A PATH -- ceo's ruling, 2026-09-08, and these pin the mechanism.
 *
 * The incident is in the script's own header. What these assert is the part that decides whether the
 * check survives contact: that it REFUSES the crossing, that a deliberate crossing can be RECORDED rather
 * than only permitted, and that it cannot pass by examining nothing.
 *
 * The third is the one that matters most. Every refusal here is "this lane was crossed", so a lane list
 * that failed to load satisfies the whole file vacuously -- and a check reporting CLEAR because it could
 * not find its own rules is worse than no check, because it is believed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { laneVerdict, loadLanes, inLane, exceptionFor } from "../../../../scripts/workflow-lane-check.mjs";
import { LIVE_SESSIONS, RETIRED_SESSIONS, unknownSessionLabels } from "../../../../scripts/arm-pr.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const LANES = loadLanes();
const EXIT = { CLEAR: 0, REFUSED: 1, CANNOT_ASK: 2 };

const verdict = (branch: string, changed: string[], body = "nothing here") =>
  laneVerdict({ changed, branch, body, lanes: LANES });

test("the real lane file loads and names the pipeline -- a rename must fail this, never empty it", () => {
  assert.ok(LANES, "docs/lane-ownership.json must load: absent or malformed is CANNOT_ASK, not 'no lanes'");
  const pipeline = LANES!.lanes.find((l) => l.paths.includes(".github/workflows/"));
  assert.ok(pipeline, "the pipeline lane must still cover .github/workflows/");
  assert.equal(pipeline!.owner, "ceo"); // moved from dispatcher 2026-09-11 (#913): the retired session cannot own a lane
  assert.ok(pipeline!.branchPrefixes.includes("ceo/"));
  assert.ok(pipeline!.why.length > 80, "a lane states WHY it is a lane; a bare assertion of ownership is "
    + "the thing a reader cannot argue with or correct");
});

test("THE INCIDENT: a pm/ branch changing a workflow is REFUSED, and the refusal names the lane", () => {
  const v = verdict("pm/board-records", [".github/workflows/ready-label-audit.yml"]);
  assert.equal(v.code, EXIT.REFUSED);
  assert.match(v.reasons[0], /the pipeline/);
  assert.match(v.reasons[0], /ceo owns/);
  assert.match(v.reasons[0], /pm\/board-records/, "and it names the branch, so the reader knows why it fired");
  assert.match(v.reasons[0], /Lane-exception:/, "and it names the way out, or it is a wall people route around");
});

test("every non-owner prefix is refused, not just pm/ -- 137 branches on origin are agent/", () => {
  for (const branch of ["agent/x", "lead/x", "dispatcher/x", "pm/x", "marketing/x", "x"]) {
    assert.equal(verdict(branch, [".github/workflows/ci.yml"]).code, EXIT.REFUSED, `${branch} must refuse`);
  }
});

test("the lane's own branches pass, including revert/ -- decideRevert opens those itself", () => {
  for (const branch of ["ceo/lane-owner-913", "revert/4e87c87565-316"]) {
    assert.equal(verdict(branch, [".github/workflows/trunk-guard.yml"]).code, EXIT.CLEAR, branch);
  }
});

test("A LANE IS NOT A WALL: a well-formed exception passes AND is echoed, so the crossing is on the record", () => {
  const body = "Lane-exception: the pipeline -- assigned by ceo -- the trigger list was in ceo's own words\n";
  const v = laneVerdict({ changed: [".github/workflows/ci.yml"], branch: "pm/x", body, lanes: LANES });
  assert.equal(v.code, EXIT.CLEAR);
  assert.match(v.reasons[0], /LANE CROSSED DELIBERATELY, and recorded/);
  assert.match(v.reasons[0], /assigned by ceo/, "the line itself is echoed, not a summary of it");
});

test("MUTATION TARGET: an exception missing its REASON is refused -- 'I was told to' with extra steps", () => {
  // #197 measured what an agreement existing only as a sentence is worth: three double-dispatches, each
  // caught by a worker's caution and never by the tool. The reason is the part a later reader can weigh.
  const v = laneVerdict({
    changed: [".github/workflows/ci.yml"], branch: "pm/x",
    body: "Lane-exception: the pipeline -- assigned by ceo\n", lanes: LANES,
  });
  assert.equal(v.code, EXIT.REFUSED);
});

test("an exception for a DIFFERENT lane does not open this one", () => {
  const v = laneVerdict({
    changed: [".github/workflows/ci.yml"], branch: "pm/x",
    body: "Lane-exception: the corpus -- assigned by ceo -- unrelated\n", lanes: LANES,
  });
  assert.equal(v.code, EXIT.REFUSED);
});

test("A GENERATED FILE IS NOT THE LANE'S: consumer-gate.yml passes from any branch", () => {
  // `consumer-gate.yml` is regenerated from README.md by a script another session owns, so its content is
  // contract work that happens to land in this directory. The pipeline does not decide what it says, and
  // the cost of changing it is visible from the generator's seat rather than from the merge queue -- which
  // is the whole test for whether a path belongs to a lane.
  //
  // Added after the flat prefix would have refused #558 and forced its author to write a Lane-exception
  // for a rule that was mis-stated. Making somebody paper over a wrong rule with a body line is the
  // guard-people-route-around failure the exception was designed to prevent, one door along.
  assert.equal(verdict("agent/consumer-gate-pin-selfcheck-558",
    [".github/workflows/consumer-gate.yml"]).code, EXIT.CLEAR);
});

test("but a generated file does not launder its NEIGHBOURS -- release.yml in the same PR still refuses", () => {
  // The except list subtracts one path, never opens the lane. A PR touching both must still be refused,
  // or the exception becomes a way in.
  const v = verdict("agent/consumer-gate-pin-selfcheck-558",
    [".github/workflows/consumer-gate.yml", ".github/workflows/release.yml"]);
  assert.equal(v.code, EXIT.REFUSED);
  assert.match(v.reasons[0], /release\.yml/);
  assert.doesNotMatch(v.reasons[0], /consumer-gate\.yml/,
    "and the excepted path must not appear in the refusal's own list of touched paths -- one answer to "
    + "'is this path in the lane at all', not two");
});

test("the except list states its reason in the data file, like the lane itself", () => {
  const pipeline = LANES!.lanes.find((l) => l.paths.includes(".github/workflows/"))!;
  assert.deepEqual(pipeline.except, [".github/workflows/consumer-gate.yml"]);
  assert.ok((pipeline.exceptWhy ?? "").length > 120,
    "an exception with no stated reason is a hole; the next reader must be able to argue with it");
});

test("a PR touching nothing in the lane is clear from any branch", () => {
  assert.equal(verdict("pm/x", ["docs/pipeline.md", "packages/lab/src/x.ts"]).code, EXIT.CLEAR);
});

test("the prefix matches on a directory boundary -- .github/workflows-notes/ is not the lane", () => {
  assert.equal(inLane(".github/workflows-notes/x.md", [".github/workflows/"]), false);
  assert.equal(inLane(".github/workflows/ci.yml", [".github/workflows/"]), true);
});

test("ANTI-VACUITY: each unreadable input is CANNOT_ASK, never CLEAR", () => {
  const base = { changed: [".github/workflows/ci.yml"], branch: "pm/x", body: "x", lanes: LANES };
  for (const [field, value] of [["changed", null], ["branch", null], ["body", null], ["lanes", null]] as const) {
    const v = laneVerdict({ ...base, [field]: value });
    assert.equal(v.code, EXIT.CANNOT_ASK, `${field} missing must be CANNOT_ASK, got ${v.code}`);
    assert.match(v.reasons[0], /INCONCLUSIVE, never clear/);
  }
});

test("an EMPTY lanes array is CANNOT_ASK, not 'no path has a lane' -- the vacuous pass this file exists for", () => {
  assert.equal(loadLanes(path.join(REPO, "package.json")), null,
    "a file with no `lanes` array must load as null rather than as an empty rule set");
  assert.equal(laneVerdict({ changed: [".github/workflows/ci.yml"], branch: "pm/x", body: "x",
    lanes: { lanes: [] } }).code, EXIT.CLEAR,
    "NOTE: an empty array reaching the verdict IS vacuously clear -- which is precisely why loadLanes "
    + "refuses to produce one, and why that refusal is the assertion above rather than a defensive check");
});

test("MUTATION TARGET: a lanes array of MALFORMED entries loads as null, never as an empty rule set", () => {
  // Found by mutation, not by reading: making `loadLanes` return `{lanes: []}` instead of `null` for a
  // malformed file left this whole file passing. The earlier assertion (`package.json` -> null) exercises
  // a DIFFERENT branch -- there `lanes` is not an array at all, so it returns before the well-formedness
  // check is reached. A test that covers a function's early return and calls the function covered is the
  // vacuous pass this file was written to prevent, one level in.
  const dir = mkdtempSync(path.join(tmpdir(), "lane-"));
  const junk = path.join(dir, "lanes.json");
  writeFileSync(junk, JSON.stringify({ lanes: [{ lane: "x" }, "not even an object"] }));
  try {
    assert.equal(loadLanes(junk), null,
      "an array of entries missing owner/branchPrefixes/paths must be CANNOT_ASK, not zero lanes -- "
      + "every refusal here is 'this lane was crossed', so an empty list satisfies all of them");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exceptionFor accepts an em-dash as well as a double hyphen -- both are written by hand", () => {
  assert.ok(exceptionFor("Lane-exception: the pipeline — assigned by ceo — because x\n", "the pipeline"));
  assert.ok(exceptionFor("Lane-exception: the pipeline -- assigned by ceo -- because x\n", "the pipeline"));
});

test("THE WIRING, not just the logic: the job running this check checks out FULL depth", () => {
  // Measured 2026-09-09, and it cost this check its own first PR. The step diffs `origin/<base>...HEAD`,
  // and a three-dot diff needs a MERGE BASE. On the default shallow checkout there is none, and git does
  // not degrade -- reproduced in a `--depth=1` clone:
  //
  //     $ git diff --name-only FETCH_HEAD...HEAD
  //     fatal: FETCH_HEAD...HEAD: no merge base          (exit 128)
  //
  // Under `bash -e` that fails the step BEFORE node runs, so the check reported a real-sounding refusal
  // with nothing to do with lanes. Every assertion above drives the VERDICT and none of them could see
  // this: a pure function tested exhaustively, wired to an input it never receives. That is this
  // repository's own rule -- test a check in the direction it will actually run.
  const ci = readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8");
  const job = ci.split(/^ {2}deliberateRefusals:$/m)[1]?.split(/^ {2}\S/m)[0] ?? "";
  assert.ok(job.includes("workflow-lane-check.mjs"),
    "this test is pinned to deliberateRefusals; if the step moved, move this with it rather than deleting it");
  assert.match(job, /fetch-depth:\s*0/,
    "the job must check out full depth, or the three-dot diff has no merge base and exits 128");
  // #939 moved the diff itself behind `scripts/changed-files.mjs`, so that the SOURCE side of a rename is
  // listed too -- a bare `git diff --name-only` prints only the destination, and a PR moving a file OUT of
  // another session's lane was invisible to the check that owns it. The RANGE is what this test pins, and
  // it is unchanged by that move: whatever produces the list must ask for `origin/<base>...HEAD` by name.
  assert.match(job, /changed-files\.mjs origin\/\$\{\{ github\.base_ref \}\}\.\.\.HEAD/,
    "and it must diff against the base ref by name -- FETCH_HEAD after a shallow fetch is the fault above");
  assert.ok(!job.includes("FETCH_HEAD"),
    "FETCH_HEAD is the fault itself: after a shallow fetch it has no merge base with HEAD and git exits 128");
});

test("the lane file is DATA with a named owner, so the mechanism cannot quietly decide who owns what", () => {
  const raw = JSON.parse(readFileSync(path.join(REPO, "docs/lane-ownership.json"), "utf8"));
  assert.equal(raw._owner, "ceo", "ceo assigns lanes and, since 2026-09-11, owns the pipeline lane itself");
  assert.ok(String(raw._why).includes("2026-09-08"), "the file cites the ruling that created it");
  assert.ok(String(raw._exception).length > 100, "and states that a lane is not a wall, in the file itself");
});

// --- #913: every lane owner DERIVES to a live session, rather than being pinned by name ---

test("#913: every lane's owner is one of the five live sessions, derived and not spelled", () => {
  // `:31` above pins the pipeline lane's owner as `ceo` BY NAME, which is right for that lane and says
  // nothing about a lane added next month. This asserts the PROPERTY: `lane:<owner>` is read by the merge
  // guard and now by `row-claim` (#1039), so an owner that is not a live session is a reservation nobody
  // can satisfy -- the row-nobody-can-take shape, arriving through a data file.
  //
  // DERIVED AGAINST `LIVE_SESSIONS`, never a list retyped here: a second copy of the roster would drift
  // from the one the guards read, and drift in this direction produces a lane owned by nobody.
  const lanes = LANES?.lanes ?? [];
  assert.ok(lanes.length > 0, "the file must load -- absent or malformed is CANNOT_ASK, not 'no lanes'");
  const strays = lanes.filter((lane) => !LIVE_SESSIONS.includes(lane.owner));
  assert.deepEqual(strays.map((l) => `${l.lane} -> ${l.owner}`), [],
    `these lanes name an owner that is not a live session (${LIVE_SESSIONS.join(", ")}). A lane owned by a `
    + "session that cannot claim is a lane nobody can be routed to");
});

test("#913: a RETIRED session is named as retired, and an unknown one is not", () => {
  // The four labels are retired BY DESCRIPTION and kept, because merged PRs carry them and a record of the
  // past is never renamed. Measured through the REST API 2026-09-12, at the moment of retirement:
  //
  //                               closed ISSUES   closed PULL REQUESTS   open (either)
  //     session:dispatcher              0                 4                   0
  //     session:worker-audit            0                 2                   0
  //     session:worker-contracts        0                 3                   0
  //     session:worker-config           0                 4                   0
  //
  // The population is PULL REQUESTS and no issue carries one, so the precondition holds in its strongest
  // form. `gh issue list --state closed --label <name>` reports 0 and `gh pr list` reports 4: **neither is
  // wrong, they count different denominators, and nothing in either output says which.** A tracker count
  // is a fact at a time and does not belong in an assertion; the MECHANISM does, and this is it.
  for (const retired of RETIRED_SESSIONS) {
    assert.deepEqual(unknownSessionLabels([`session:${retired}`]),
      [{ label: `session:${retired}`, retired: true }],
      `${retired} is retired by the Org Reset and must be named as retired -- a typo and a retirement need `
      + "different sentences, and telling a reader their typo was retired sends them to the wrong row");
  }
  assert.deepEqual(unknownSessionLabels(["session:brand-new-role"]),
    [{ label: "session:brand-new-role", retired: false }],
    "and a session this repository has never heard of is refused WITHOUT being called retired");
  for (const live of LIVE_SESSIONS) {
    assert.deepEqual(unknownSessionLabels([`session:${live}`]), [],
      `${live} is live and must pass -- the control, without which 'flags everything' satisfies the above`);
  }
});
