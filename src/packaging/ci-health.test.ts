// no-token: ci-health.mjs -- every test drives pure functions over an injected run list; nothing here spawns `gh` or reaches the network.
/**
 * THE WEEKLY CI-HEALTH READING (#3212): the chairman's targets, per repository, read by a schedule and posted on #928.
 *
 * Every definition is a pure function over a run list, so no test touches the network. Each refusal has a test that
 * fails before the change, and each emptiness assertion sits beside the fixture that is its positive control.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AGGREGATE_JOB, ROLL_UP_ONLY, JOBS_NOT_READ, TARGETS_FILE, alreadyPosted, commentHeading, daySlices, failedJobBreakdown,
  firstRunPassRate, inWindow, mergeQueueFailureRate, parseInclude, pullRequestGroups, readRepository, renderComment,
  runsPerPullRequest, targetText, targetsFrom, verdictOf, weeklyWindow,
} from "../../../../scripts/ci-health.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const TARGETS = targetsFrom(JSON.parse(readFileSync(TARGETS_FILE, "utf8")));

let nextId = 1;
const at = (minute: number) => `2026-10-01T10:${String(minute).padStart(2, "0")}:00Z`;
/** One run. `pr` names the head branch, which is what a pull request IS here; the head repository is the same throughout. */
const run = (pr: string, conclusion: string | null, over: Record<string, unknown> = {}) => {
  const id = nextId++;
  return { id, event: "pull_request", conclusion, head_sha: `sha-${id}`, head_branch: pr, created_at: at(id % 60),
    head_repository: { full_name: "a11ign/a11ign" }, ...over };
};
/** A pull request's runs in order, each with its own head unless `sameHead`. */
const pr = (name: string, ...conclusions: (string | null)[]) => conclusions.map((c) => run(name, c));

/** Ten distinct pull requests, all green first: the fixture a rate needs to be a rate. */
const tenGreen = () => Array.from({ length: 10 }, (_, i) => pr(`green-${i}`, "success")).flat();

// ---- 1. first-run pass rate ----------------------------------------------------------------------------

test("first-run pass rate: cancelled-then-green is a PASS, only-cancelled is out of the denominator, red-then-green is a miss", () => {
  const runs = [
    ...pr("red-then-green", "failure", "success"),
    ...pr("green", "success"),
    ...pr("cancelled-then-green", "cancelled", "success"),
    ...pr("only-cancelled", "cancelled"),
  ];
  const reading = firstRunPassRate(runs);
  assert.equal(reading.counted, 3, "the only-cancelled pull request has no completed run, so it is not counted");
  assert.equal(reading.passed, 2, "green, and cancelled-then-green (the cancelled run is not completed)");
  assert.equal(reading.rate, 2 / 3);
});

test("first-run pass rate, POSITIVE CONTROL: an all-green fixture reads 100% (so a 0% above is not a reader that sees nothing)", () => {
  const reading = firstRunPassRate(tenGreen());
  assert.deepEqual([reading.passed, reading.counted, reading.rate], [10, 10, 1]);
});

test("first-run pass rate: a run list with no pull request has NO rate, which is null and never 0", () => {
  assert.equal(firstRunPassRate([]).rate, null);
});

test("a pull request is its head branch: the runs endpoint's empty `pull_requests` array does not hide it (585 of 649 were empty)", () => {
  const runs = pr("a", "failure", "success").map((r) => ({ ...r, pull_requests: [] }));
  assert.equal(pullRequestGroups(runs).length, 1);
  const forked = [run("patch-1", "success"), run("patch-1", "success", { head_repository: { full_name: "someone/a11ign" } })];
  assert.equal(pullRequestGroups(forked).length, 2, "two forks' `patch-1` are two pull requests");
});

// ---- 2. merge-queue failure rate -----------------------------------------------------------------------

test("merge-queue rate is over merge_group runs only: a pull_request failure never enters it", () => {
  const queue = (conclusion: string | null) => run("gh-readonly-queue/main/pr-1", conclusion, { event: "merge_group" });
  const runs = [queue("failure"), queue("success"), queue("success"), queue("success"), queue("cancelled"), queue(null),
    ...pr("noisy", "failure", "failure", "failure")];
  const reading = mergeQueueFailureRate(runs);
  assert.deepEqual([reading.failed, reading.completed, reading.rate], [1, 4, 0.25],
    "one of four COMPLETED merge_group runs; the cancelled and in-flight ones did not complete, the three pull_request failures are not its");
  assert.equal(mergeQueueFailureRate(pr("only-pull-request", "failure")).rate, null, "no merge_group run is no rate");
});

// ---- 3. runs per pull request --------------------------------------------------------------------------

test("runs per pull request counts CANCELLED runs: three cancelled and one success reads 4", () => {
  const reading = runsPerPullRequest(pr("one", "cancelled", "cancelled", "cancelled", "success"));
  assert.deepEqual([reading.runs, reading.pullRequests, reading.perPullRequest, reading.cancelled], [4, 1, 4, 3]);
});

test("runs per pull request: a run on a head an earlier run already tested is counted, and so are the cancelled ones among them", () => {
  const first = run("same", "failure");
  const retest = run("same", "cancelled", { head_sha: first.head_sha });
  const reading = runsPerPullRequest([first, retest, run("same", "success")]);
  assert.deepEqual([reading.alreadyTestedHead, reading.alreadyTestedHeadCancelled], [1, 1]);
});

// ---- 4. UNREAD, and the targets are the file's ---------------------------------------------------------

const readingOf = (runs: ReturnType<typeof run>[], targets = TARGETS) =>
  readRepository({ repository: "a11ign/a11ign", runs, failedRuns: [], targets });

test("UNREAD under 10 pull requests, with the count in the line", () => {
  const nine = Array.from({ length: 9 }, (_, i) => pr(`green-${i}`, "success")).flat();
  const reading = readingOf(nine);
  const [first, , perPr] = reading.rows;
  assert.equal(first.verdict, "UNREAD");
  assert.equal(perPr.verdict, "UNREAD");
  assert.match(first.count, /9 pull requests/, "the count is shown beside the verdict");
  const section = renderComment({ date: "2026-09-26", window: { since: "a", until: "b" }, commit: "c", rateLimit: "r", readings: [reading] });
  assert.match(section, /UNREAD above: 9 pull requests is under the 10 a rate needs\./);
});

test("UNREAD under 10, POSITIVE CONTROL: ten pull requests read, and read MET", () => {
  const [first, , perPr] = readingOf(tenGreen()).rows;
  assert.deepEqual([first.verdict, perPr.verdict], ["MET", "MET"]);
});

test("every target in the table is MET, MISSED or UNREAD, never blank, and the two the token row owns say 'not read here'", () => {
  const rows = readingOf(tenGreen()).rows;
  assert.equal(rows.length, Object.keys(TARGETS.targets).length, "the table is the whole target set");
  for (const row of rows) assert.ok(["MET", "MISSED", "UNREAD"].includes(row.verdict), `${row.measure} is ${row.verdict}`);
  assert.deepEqual(rows.slice(-2).map((r) => [r.reading, r.verdict]), [["not read here", "UNREAD"], ["not read here", "UNREAD"]]);
});

test("a target is READ FROM docs/ci-targets.json: a fixture with a changed target changes the verdict", () => {
  const runs = [...pr("a", "failure", "success"), ...tenGreen()]; // 10 of 11 first-run green: 90.9%
  assert.equal(readingOf(runs).rows[0].verdict, "MET", "against the file's 80%");
  const stricter = structuredClone(TARGETS);
  stricter.targets.firstRunPassRate.atLeast = 0.95;
  assert.equal(readingOf(runs, stricter).rows[0].verdict, "MISSED", "the same runs against a changed target");
});

test("the table's targets are the file's, by identity", () => {
  const readings = [readingOf(tenGreen())];
  const comment = renderComment({ date: "2026-09-26", window: { since: "a", until: "b" }, commit: "c", rateLimit: "r", readings });
  for (const target of Object.values(TARGETS.targets)) {
    const row = readings[0].rows.find((r) => r.measure === target.label);
    assert.ok(row, `${target.label} is a row`);
    assert.equal(row.target, targetText(target), "the row's target text is derived from the file's own fields");
    assert.ok(comment.includes(`| ${target.label} | ${targetText(target)} |`), `${target.label} reaches the comment unchanged`);
  }
  assert.deepEqual(TARGETS.targets.firstRunPassRate, { label: "First-run pass rate", unit: "ratio", atLeast: 0.8 }, "the chairman's 80%");
});

test("verdictOf: each bound, both sides of its edge, and a target with no bound is refused", () => {
  const atLeast = { label: "x", unit: "ratio", atLeast: 0.8 } as const;
  const below = { label: "x", unit: "ratio", below: 0.05 } as const;
  const atMost = { label: "x", unit: "count", atMost: 2 } as const;
  assert.deepEqual([0.8, 0.79].map((value) => verdictOf({ value, target: atLeast, enough: true })), ["MET", "MISSED"]);
  assert.deepEqual([0.049, 0.05].map((value) => verdictOf({ value, target: below, enough: true })), ["MET", "MISSED"], "below is strict");
  assert.deepEqual([2, 2.1].map((value) => verdictOf({ value, target: atMost, enough: true })), ["MET", "MISSED"]);
  assert.equal(verdictOf({ value: 0.99, target: atLeast, enough: false }), "UNREAD");
  assert.equal(verdictOf({ value: null, target: atLeast, enough: true }), "UNREAD");
  assert.throws(() => targetsFrom({ targets: { bad: { label: "bad", unit: "count" } } }), /names none of atLeast, atMost, below/);
});

// ---- 5. the failing-job breakdown ----------------------------------------------------------------------

test("the failed-job breakdown sums to the failed-run count it is printed beside", () => {
  const failed = [
    { id: 1, failedJobs: ["acceptance / run", AGGREGATE_JOB] },
    { id: 2, failedJobs: ["acceptance / run", "ts / run", AGGREGATE_JOB] },
    { id: 3, failedJobs: ["acceptance / run", AGGREGATE_JOB] },
    { id: 4, failedJobs: [AGGREGATE_JOB] },
    { id: 5, failedJobs: null },
    { id: 6, failedJobs: ["changeset", AGGREGATE_JOB] },
  ];
  const breakdown = failedJobBreakdown(failed);
  assert.equal(breakdown.failedRuns, 6);
  assert.equal(breakdown.summed, breakdown.failedRuns, "the combinations add up to the failed runs");
  const named = Object.fromEntries(breakdown.combinations.map((c) => [c.jobs, c.runs]));
  assert.deepEqual(named, { acceptance: 2, "acceptance + ts": 1, changeset: 1, [ROLL_UP_ONLY]: 1, [JOBS_NOT_READ]: 1 },
    "the reusable workflow's `acceptance / run` is `acceptance`, the roll-up is left out, an unread run is not an empty set");
  assert.deepEqual(Object.fromEntries(breakdown.byJob.map((j) => [j.jobs, j.runs])), { acceptance: 3, ts: 1, changeset: 1 },
    "per job a run can appear in several, which is why that line is printed as NOT summing");
});

test("the failed-job breakdown, POSITIVE CONTROL: no failed run sums to zero of zero, and a failed run is never dropped", () => {
  assert.deepEqual(failedJobBreakdown([]), { failedRuns: 0, combinations: [], byJob: [], summed: 0 });
  assert.equal(failedJobBreakdown([{ id: 1, failedJobs: [] }]).summed, 1, "a failed run with no failed job listed is still one failed run");
});

test("the comment's breakdown total is the failed-run count of the readings it came from", () => {
  const runs = [...tenGreen(), ...pr("red", "failure")];
  const failedRuns = runs.filter((r) => r.conclusion === "failure").map((r) => ({ id: r.id, event: r.event, failedJobs: ["ts / run", AGGREGATE_JOB] }));
  const reading = readRepository({ repository: "a11ign/a11ign", runs, failedRuns, targets: TARGETS });
  const comment = renderComment({ date: "2026-09-26", window: { since: "a", until: "b" }, commit: "c", rateLimit: "r", readings: [reading] });
  assert.match(comment, /\| \*\*Total\*\* \| \*\*1\*\* \(of 1 failed runs\) \|/);
  assert.equal(reading.per.failed, reading.breakdowns.pull_request.failedRuns, "the table's failed count and the breakdown's are one number");
});

// ---- the window, the paging and the posting ------------------------------------------------------------

test("the weekly window is the seven whole UTC days before today, so a Monday run reads Monday to Sunday", () => {
  assert.deepEqual(weeklyWindow(new Date("2026-10-05T06:43:00Z")), { since: "2026-09-28T00:00:00Z", until: "2026-10-05T00:00:00Z" });
});

test("a window is read one UTC day at a time (the endpoint returns at most 1,000 results per filter), and its edges are exact", () => {
  const slices = daySlices({ since: "2026-10-01T00:00:00Z", until: "2026-10-03T00:00:00Z" });
  assert.deepEqual(slices, ["2026-10-01T00:00:00Z..2026-10-01T23:59:59Z", "2026-10-02T00:00:00Z..2026-10-02T23:59:59Z"]);
  const runs = [run("a", "success", { created_at: "2026-10-01T00:00:00Z" }), run("b", "success", { created_at: "2026-10-02T08:14:00Z" })];
  assert.equal(inWindow(runs, { since: "2026-10-01T00:00:00Z", until: "2026-10-02T08:14:00Z" }).length, 1, "start inclusive, end exclusive");
});

test("the rate-limit header is parsed off a `gh api -i` response", () => {
  const text = "HTTP/2.0 200 OK\nX-Ratelimit-Remaining: 4897\nX-Ratelimit-Resource: core\n\n{\"total_count\":0,\"workflow_runs\":[]}";
  const { headers, body } = parseInclude(text);
  assert.equal(headers.get("x-ratelimit-remaining"), "4897");
  assert.equal(headers.get("x-ratelimit-resource"), "core");
  assert.deepEqual(body, { total_count: 0, workflow_runs: [] });
});

test("the comment is headed `## CI health, week of <date>`, names its window, commit and rate limit, and a second run posts nothing", () => {
  const comment = renderComment({ date: "2026-09-28", window: { since: "2026-09-28T00:00:00Z", until: "2026-10-05T00:00:00Z" },
    commit: "abc123def456", rateLimit: "X-Ratelimit-Remaining 4897 of 5000, resource core", readings: [readingOf(tenGreen())] });
  assert.ok(comment.startsWith("## CI health, week of 2026-09-28\n"));
  for (const part of ["2026-09-28T00:00:00Z", "2026-10-05T00:00:00Z", "abc123def456", "X-Ratelimit-Remaining 4897 of 5000"]) {
    assert.ok(comment.includes(part), `${part} is in the comment`);
  }
  assert.ok(alreadyPosted([comment], commentHeading({ date: "2026-09-28" })));
  assert.ok(!alreadyPosted(["## CI health, week of 2026-09-21\n..."], commentHeading({ date: "2026-09-28" })), "last week's does not count");
  assert.ok(!alreadyPosted([], commentHeading({ date: "2026-09-28" })), "no comment is not already posted");
});

// ---- 6. the workflow -----------------------------------------------------------------------------------

test("ci-health.yml: `schedule` and `workflow_dispatch` only, `issues: write` and nothing broader, no pull_request trigger", () => {
  const workflow = parseYaml(readFileSync(resolve(REPO, ".github/workflows/ci-health.yml"), "utf8"));
  assert.deepEqual(Object.keys(workflow.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { issues: "write" }, "the one comment, and nothing broader");
  for (const trigger of ["pull_request", "pull_request_target", "push", "merge_group"]) {
    assert.ok(!(trigger in workflow.on), `${trigger} would let a change trip this workflow`);
  }
  assert.ok(workflow.on.schedule.length >= 1, "POSITIVE CONTROL: the schedule is really there");
  assert.match(JSON.stringify(workflow.jobs), /scripts\/ci-health\.mjs --post/, "and it runs the script, posting");
});

/** The 5-field cron's day-of-week and hour fields, which are the two this pin reads. */
const cronFields = (cron: string) => {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.trim().split(/\s+/);
  return { minute, hour, dayOfMonth, month, dayOfWeek };
};

test("ci-health.yml: at least two schedule slots, every one on Monday and a distinct hour, because a dropped start has no second chance (#3678)", () => {
  const workflow = parseYaml(readFileSync(resolve(REPO, ".github/workflows/ci-health.yml"), "utf8"));
  const slots = workflow.on.schedule.map((entry: { cron: string }) => cronFields(entry.cron));
  assert.ok(slots.length >= 2, "one slot is one chance: GitHub drops or delays scheduled starts here (#965, #3678)");
  for (const slot of slots) {
    assert.equal(slot.dayOfWeek, "1", "a slot on another DAY reads a different `weeklyWindow` and posts under a different heading");
    assert.deepEqual([slot.dayOfMonth, slot.month], ["*", "*"]);
    assert.match(slot.hour, /^\d+$/, "a single hour, so the slot count is the chance count");
    assert.notEqual(slot.minute, "0", "OFF THE HOUR: the :00 starts were ~5 h late four days running (#965)");
  }
  assert.equal(new Set(slots.map((s: { hour: string }) => s.hour)).size, slots.length, "two slots in one hour are one chance");
});

test("weeklyWindow: every Monday instant reads the same window, so the extra slots post one heading and the second posts nothing (#3678)", () => {
  const monday = ["2026-10-05T00:00:00Z", "2026-10-05T06:43:00Z", "2026-10-05T16:43:00Z", "2026-10-05T23:59:59Z"];
  const windows = monday.map((instant) => JSON.stringify(weeklyWindow(new Date(instant))));
  assert.equal(new Set(windows).size, 1);
  assert.notEqual(JSON.stringify(weeklyWindow(new Date("2026-10-06T00:00:00Z"))), windows[0],
    "POSITIVE CONTROL: Tuesday reads another window, which is why no slot may run on another day");
});
