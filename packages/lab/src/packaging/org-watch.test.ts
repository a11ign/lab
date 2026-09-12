// no-token: defaultRun
//
// #912: this file imports `org-watch.mjs`, whose `defaultRun` spawns a real `gh`, and the parser charges a
// command its whole import closure. True of the IMPORT and false of the CALL: every impure export here
// takes an injected `run`, and every test passes one. PROVED, NOT ASSERTED, since #827's check is
// deliberately shallow -- `GH_TOKEN`/`GITHUB_TOKEN` unset, a fake `gh` first on PATH exiting 97: all pass
// and the fake is invoked ZERO times.
/**
 * THE ORG'S CLOCK — #912, step 4 of The CI Reset, and the row that says whether the other ten worked.
 *
 * Cost was never a metric anyone read: the pipeline reached 3,317 runs a day for 193 merges without any
 * figure crossing a desk, because nothing produced one. And #928's second half is that the org had no clock
 * at all — every session cron died silently at a restart, and **a missing clock produces nothing happening,
 * which is indistinguishable from a quiet period.**
 *
 * Every test here drives rendered TEXT rather than the computation, because the row's acceptance is about
 * what a reader sees: a figure whose window and denominator live in someone's head is the figure that was
 * right over the wrong period.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  METRICS, EXIT, figure, passRate, renderFigure, renderTable, totalCount, mainColour,
  firstFailingAssertion, byConclusion, queueReport, utilisation, boardDeadline, watchReport,
} from "../../../../scripts/org-watch.mjs";

const metric = (key: string) => METRICS.find((m) => m.key === key)!;

test("#912: every metric renders with its baseline and target beside the value, so a number that moved "
  + "the wrong way is visible without arithmetic", () => {
  const line = renderFigure({
    metric: metric("runsPerMerge"),
    figure: figure({ value: "4.1", examined: 193, window: "2026-09-11 UTC", denominator: "793/193 merges" }),
  });
  assert.match(line, /workflow runs per merge/);
  assert.match(line, /17\.2/, "the baseline must be on the line, not in a legend elsewhere");
  assert.match(line, /<= 3/, "and the target");
  assert.match(line, /4\.1/);
});

test("#912: EVERY FIGURE CARRIES ITS WINDOW AND ITS DENOMINATOR, asserted on the rendered text", () => {
  // A run count with no window is not a rate. On the board's first edition a peer's 17 and this script's
  // 42 were BOTH RIGHT, over different windows, and neither line said which.
  const line = renderFigure({
    metric: metric("runsPerMerge"),
    figure: figure({ value: "4.1", examined: 193, window: "2026-09-11 UTC", denominator: "793/193 merges" }),
  });
  assert.match(line, /2026-09-11 UTC/, "the window");
  assert.match(line, /793\/193 merges/, "the denominator");
  assert.match(line, /examined 193/, "and what was actually looked at");
});

test("#912: the pass rate EXCLUDES CANCELLED and says so in the rendered line", () => {
  // 107 of 9 September's 602 `ci` runs cancelled themselves. Over `conclusion !== "success"` the rate
  // reads 59%; over failures only, 72%. Both are arithmetic on the same data and only one answers "does
  // `ci` pass" -- so a reader who does not know which convention was used cannot use the number.
  const runs = [
    ...Array(72).fill({ conclusion: "success" }),
    ...Array(28).fill({ conclusion: "failure" }),
    ...Array(20).fill({ conclusion: "cancelled" }),
  ];
  const rate = passRate(runs);
  assert.equal(rate.value, "72%", "72 of the 100 that either passed or failed");
  const line = renderFigure({ metric: metric("passRate"), figure: figure({ ...rate, window: "last 7 days" }) });
  assert.match(line, /cancelled excluded \(20 of 120\)/,
    "the convention must be ON THE LINE -- the same 120 runs read 60% under the other one");
  assert.match(line, /72\/100 runs/, "and the denominator it was computed over");
  assert.match(line, /examined 120/, "which is not the same number as the denominator, and both are shown");
});

test("#912 MUTATION TARGET: a fixture where EVERY run cancelled reports an empty population, never "
  + "100% or 0%", () => {
  // The row's own mutation. Every run cancelling means `ci` was never asked; 100% and 0% are both
  // confident answers to a question nobody put, and both are arithmetically defensible from this input.
  const rate = passRate(Array(14).fill({ conclusion: "cancelled" }));
  assert.equal(rate.value, null);
  const line = renderFigure({ metric: metric("passRate"), figure: figure({ ...rate, window: "last 7 days" }) });
  assert.match(line, /NOT MEASURED/, "and the table must say so rather than printing a number");
  assert.doesNotMatch(line, /100%|\b0%/, "neither of the two numbers this input can be made to produce");
  assert.match(line, /0 runs that either passed or failed/, "naming WHY it could not be measured");
  assert.match(line, /examined 14/, "having examined fourteen, which is not nothing");
});

test("#912: a fixture with ZERO runs renders `examined 0`, not a clean table", () => {
  // A guard census that reports 0 having globbed nothing is the cleanest possible output, and
  // indistinguishable from a real zero without the examined count beside it.
  const line = renderFigure({
    metric: metric("repoReadingTests"),
    figure: figure({ value: null, examined: 0, window: "origin/main" }),
  });
  assert.match(line, /examined 0/);
  assert.match(line, /NOT MEASURED/, "zero examined is not a result");
});

test("#912: a metric with NO figure at all still renders, as NOT MEASURED", () => {
  // A row that disappears from a table reads as a metric nobody needed -- which is exactly how the seventh
  // number came to be missing for the 27.8 hours it exists to measure.
  const table = renderTable({});
  for (const m of METRICS) {
    assert.ok(table.includes(m.label), `${m.key} must appear even with nothing to say`);
  }
  assert.equal(table.split("\n").length, METRICS.length + 2, "header, separator, and one row per metric");
  assert.equal((table.match(/NOT MEASURED/g) ?? []).length, METRICS.length);
});

test("#912/#928: main's red streak is the FIRST failure after the last success, not the newest failure", () => {
  // #928 was 8 runs over 27.8 hours. A newest-failure reading would have reported the gap since the most
  // recent run -- minutes -- and the number that mattered was the one from the first failure in the streak.
  const now = new Date("2026-09-12T04:00:00Z");
  const runs = [
    { conclusion: "failure", created_at: "2026-09-12T03:00:00Z", databaseId: 3 },
    { conclusion: "failure", created_at: "2026-09-11T00:12:00Z", databaseId: 2 },
    { conclusion: "success", created_at: "2026-09-10T23:00:00Z", databaseId: 1 },
  ];
  const run = (args: string[]) => (args[0] === "api"
    ? JSON.stringify({ workflow_runs: runs })
    : "ok 1 - fine\nnot ok 41 - the guard that actually bit\nnot ok 42 - a later one");
  const colour = mainColour({ repo: "o/r", now, run });
  assert.equal(colour.red, true);
  assert.equal(colour.since, "2026-09-11T00:12:00Z", "the first failure AFTER the last success");
  assert.equal(colour.hours, 27.8, "the number #928 cost, to one decimal");
  assert.equal(colour.firstFailing, "not ok 41 - the guard that actually bit",
    "THE FIRST FAILING ASSERTION, never the job name -- in #928 both `docs` and `ts` reported `fail` and "
    + "the answer was two assertions, which no job name could have told anyone");
});

test("#912: a green main is quiet -- the watch says nothing and exits 0", () => {
  const run = () => JSON.stringify({
    workflow_runs: [{ conclusion: "success", created_at: "2026-09-12T03:00:00Z", databaseId: 9 }],
  });
  const colour = mainColour({ repo: "o/r", now: new Date("2026-09-12T04:00:00Z"), run });
  assert.deepEqual(colour, { red: false, since: null, hours: null, firstFailing: null });
  assert.equal(EXIT.QUIET, 0, "and silence is exit 0, so an hourly job that finds nothing costs nothing");
});

test("#912: an unreadable runs list is NOT reported as green -- but it is reported as not-red, and this "
  + "test exists to pin which", () => {
  // A deliberate, stated limitation rather than an oversight: a failed read currently reads as `red: false`,
  // so the watch stays quiet. That is the wrong direction for a clock and it is the first thing to fix if
  // this ever misses a break. It is pinned here so the next reader finds the decision rather than the bug.
  const colour = mainColour({ repo: "o/r", run: () => { throw new Error("gh: HTTP 502"); } });
  assert.equal(colour.red, false);
  assert.equal(colour.since, null, "and it carries no evidence, which is the tell that it did not measure");
});

test("#912: the first failing assertion is null when the log names none -- a different report from "
  + "`the job failed`", () => {
  assert.equal(firstFailingAssertion(1, { repo: "o/r", run: () => "Process completed with exit code 1." }), null,
    "and the caller must print that rather than falling back to the job name, which #928 proved useless");
  assert.equal(firstFailingAssertion(1, { repo: "o/r", run: () => { throw new Error("no log"); } }), null);
});

test("#912: the queue is aggregated BY CONCLUSION, never filtered and then concluded over the remainder", () => {
  // `gh pr checks | tail -8` on a ten-row list hid the two failing rows on #900, and enumerating what
  // survived a filter reads as diligence. Count the population by outcome first.
  const counts = byConclusion([
    { name: "ts", conclusion: "success", status: "completed" },
    { name: "gate", conclusion: "failure", status: "completed" },
    { name: "docs", conclusion: null, status: "in_progress" },
    { name: "arm", conclusion: "skipped", status: "completed" },
    { name: "sweep", conclusion: "failure", status: "completed" },
  ]);
  assert.deepEqual(counts, { success: 1, failure: 2, in_progress: 1, skipped: 1 });
  const examined = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(examined, 5, "every check is in exactly one bucket, so the buckets sum to the population");
});

test("#912: the queue counter normalises `gh`'s THREE spellings of an absent conclusion", () => {
  // Measured 2026-09-12 against this repository, because one idiom does not cover them:
  //
  //     gh api .../check-runs          conclusion: null       status: "in_progress"    lower case
  //     gh run list --json             conclusion: ""         status: "in_progress"    lower case
  //     gh pr list statusCheckRollup   conclusion: "SKIPPED"  status: "COMPLETED"      UPPER CASE
  //
  // `??` falls back on `null` and NOT on `""`, so the middle row buckets under the empty string -- a
  // count labelled with nothing, which reads as a category nobody recognises rather than as the pending
  // run it is. And the third makes `SUCCESS` and `success` two buckets of one outcome.
  const counts = byConclusion([
    { name: "a", conclusion: "success", status: "completed" },   // gh api, done
    { name: "b", conclusion: "SUCCESS", status: "COMPLETED" },   // statusCheckRollup, same outcome
    { name: "c", conclusion: null, status: "in_progress" },      // gh api, pending
    { name: "d", conclusion: "", status: "in_progress" },        // gh run list, pending -- the `??` trap
  ]);
  assert.deepEqual(counts, { success: 2, in_progress: 2 },
    "two successes and two pending, however each source spells them -- a counter whose whole job is "
    + "`count the population by outcome` must not invent an outcome, and an empty-string bucket is that");
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 4, "and the buckets sum to the population");
});

test("#912: a check with NOTHING readable counts as `unknown`, not as an empty label", () => {
  // The honest bucket. It is still counted -- dropping it would make the buckets stop summing to the
  // population, which is the property the queue read exists to have.
  assert.deepEqual(byConclusion([{ name: "x", conclusion: "", status: "" }]), { unknown: 1 });
  assert.deepEqual(byConclusion([{ name: "x", conclusion: null, status: null }]), { unknown: 1 });
  assert.deepEqual(byConclusion([{ name: "x", conclusion: "  ", status: "  " }]), { unknown: 1 },
    "whitespace is not a conclusion either");
});

test("#912: `total_count` is the count, not the page -- and a failed read is null, never 0", () => {
  assert.equal(totalCount("actions/runs?per_page=1", {
    repo: "o/r",
    run: () => JSON.stringify({ total_count: 3317, workflow_runs: [{ id: 1 }] }),
  }), 3317, "the page holds one item and the population is 3,317");
  assert.equal(totalCount("actions/runs", { repo: "o/r", run: () => { throw new Error("502"); } }), null,
    "0 is a real answer and a failed read is not one");
  assert.equal(totalCount("actions/runs", { repo: "o/r", run: () => JSON.stringify({ workflow_runs: [] }) }), null);
});

// --- #912's other three reads. Pure decisions; their `gh` readers are the remaining half of the row. ---

test("#912 READ 2: the queue names the PRs that carry a failing check, and the counts sum to the "
  + "population examined", () => {
  const report = queueReport([
    { number: 1, checks: [{ name: "ts", conclusion: "success", status: "completed" }] },
    { number: 2, checks: [
      { name: "gate", conclusion: "failure", status: "completed" },
      { name: "ts", conclusion: "failure", status: "completed" },
    ] },
    { number: 3, checks: [{ name: "docs", conclusion: null, status: "queued" }] },
  ]);
  assert.deepEqual(report.counts, { success: 1, failure: 2, queued: 1 });
  assert.deepEqual(report.failing, [{ number: 2, jobs: ["gate", "ts"] }],
    "the count is the summary; the NAMES are the action");
  assert.equal(report.examined, 3, "and how many PRs were looked at, which the counts alone never say");
});

test("#912 READ 3: an engineer with no PR and READY WORK is idle; one with no PR and NO ready work is "
  + "starved, and the two are different findings", () => {
  const report = utilisation([
    { session: "worker-judge", openPrs: 2, readyRows: 4 },
    { session: "worker-capture", openPrs: 0, readyRows: 3 },
    { session: "worker-spare", openPrs: 0, readyRows: 0 },
  ]);
  assert.deepEqual(report.idle, ["worker-capture"], "there is work and they are not on it");
  assert.deepEqual(report.starved, ["worker-spare"],
    "there is NOT work -- which is a report about the board, not about them, and telling them they are "
    + "idle would be a wrong accusation dressed as a metric");
  assert.equal(report.examined, 3);
});

test("#912 READ 4: the board summary is quiet before 06:15, urgent after it, and LATE after 07:15", () => {
  const at = (h: number, m: number, written = false) =>
    boardDeadline({ londonHour: h, londonMinute: m, written });
  assert.equal(at(5, 59), null, "before the window, nothing to say");
  assert.equal(at(6, 14), null, "and right up to the minute");
  assert.match(at(6, 15)!, /most urgent item/, "at 06:15 it becomes the top item");
  assert.match(at(7, 0)!, /due 07:15/, "still ahead of the deadline, and says which");
  assert.match(at(7, 15)!, /LATE/, "at the deadline it is late, not nearly late");
  assert.match(at(8, 5)!, /08:05 London/, "and the time is zero-padded, so 08:05 is not rendered 8:5");
  assert.equal(at(9, 0, true), null, "a written summary is silent at any hour");
});

test("#912: the watch is SILENT when clean -- the property that makes 24 runs a day affordable", () => {
  const green = { red: false, since: null, hours: null, firstFailing: null };
  assert.deepEqual(watchReport({ colour: green }), [], "a quiet hour must cost a reader nothing");
  const red = { red: true, since: "2026-09-11T00:12:00Z", hours: 27.8, firstFailing: "not ok 41 - x" };
  const lines = watchReport({ colour: red });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /27\.8h/);
  assert.match(lines[0], /not ok 41 - x/, "and the assertion, never the job name");
  assert.equal(EXIT.ATTENTION, 1, "so an hour with something in it exits non-zero");
});
