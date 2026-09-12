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
  redWindows, redHoursFigure,
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

test("#912: the red-hours metric does NOT claim the attendance half in its label", () => {
  // worker-capture's finding. The value is raw red-hours from `mainColour`, which reads `trunk`
  // conclusions and knows nothing about who was looking -- and the separating case is 2026-09-12's own
  // incident: 03:52Z-04:15Z with nobody knowing, then minutes with two sessions on it. `redHours` scores
  // those two stretches IDENTICALLY, so the word must not be in the name.
  //
  // This asserts the LABEL, which is the text a reader of the table sees -- not a comment explaining it.
  // That distinction is #1027's whole subject and it is why this assertion is legitimate where a pin on a
  // comment would not be: the label IS the deliverable, and its wrongness is the defect rather than a
  // description of one.
  const redHours = metric("redHours");
  assert.doesNotMatch(redHours.label, /unattended/i,
    "a metric that cannot separate attended from unattended must not carry the word");
  assert.equal(redHours.baseline, "27.8",
    "and the baseline STAYS -- 27.8 is the same measurement, so dropping it would lose the comparison "
    + "rather than correct the claim");
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
  assert.deepEqual(colour, { readable: true, red: false, since: null, hours: null, atLeast: false,
    firstFailing: null, why: null, windows: [], examined: 1, pageBeginsMidRed: false });
  assert.equal(EXIT.QUIET, 0, "and silence is exit 0, so an hourly job that finds nothing costs nothing");
});

test("#912: AN UNREADABLE MAIN AND A GREEN MAIN ARE NOT THE SAME OBJECT -- the one line that would have "
  + "caught the worst defect in this file", () => {
  // worker-capture's finding. This test previously asserted `red === false` and `since === null` and called
  // the missing evidence "the tell that it did not measure". **There was no tell:** a green main returns
  // those same two values, so the assertion was satisfied by a green main too. Composed with
  // `watchReport`'s silence-when-clean, six hours of `gh` failing were six quiet hours at exit 0 --
  // **the clock's only failure mode looked exactly like its success.**
  const unreadable = mainColour({ repo: "o/r", run: () => { throw new Error("gh: HTTP 502"); } });
  const green = mainColour({ repo: "o/r", now: new Date("2026-09-12T04:00:00Z"),
    run: () => JSON.stringify({ workflow_runs: [{ conclusion: "success", created_at: "2026-09-12T03:00:00Z" }] }) });
  assert.notDeepEqual(unreadable, green,
    "field for field, these used to be identical -- and this is the assertion that separates them");
  assert.equal(unreadable.readable, false);
  assert.equal(green.readable, true);
  assert.match(unreadable.why ?? "", /HTTP 502/, "and it carries WHY, so the line can say what failed");
});

test("#912: an EMPTY runs list is unreadable too -- a workflow with no runs answers the question no more "
  + "than a 502 does", () => {
  const empty = mainColour({ repo: "o/r", run: () => JSON.stringify({ workflow_runs: [] }) });
  assert.equal(empty.readable, false);
  assert.match(empty.why ?? "", /no runs on main at all/,
    "renamed, never triggered, or a branch filter matching nothing -- all of them are `could not ask`");
});

test("#912: the watch is LOUD when it cannot ask -- silence is reserved for a main that is genuinely "
  + "green", () => {
  const unreadable = mainColour({ repo: "o/r", run: () => { throw new Error("gh: HTTP 502"); } });
  const lines = watchReport({ colour: unreadable });
  assert.equal(lines.length, 1, "an unreadable clock must not be quiet");
  assert.match(lines[0], /^CANNOT ASK/);
  assert.match(lines[0], /HTTP 502/, "naming what failed, so a reader can act rather than investigate");
  assert.match(lines[0], /treat its silence elsewhere as unverified/,
    "and saying what the silence is worth -- nothing else in the org is looking");
});

test("#912: a streak longer than the page is reported as a LOWER BOUND, not as an exact number", () => {
  // worker-capture's third finding: `per_page=20`, so a streak with no success in the page takes its
  // oldest run from the PAGE BOUNDARY. #928's own table is about a number read as exact when it was not.
  const failures = Array.from({ length: 3 }, (_, i) => ({
    conclusion: "failure", created_at: `2026-09-1${i + 1}T00:00:00Z`, databaseId: i + 1,
  }));
  const run = (args: string[]) => (args[0] === "api"
    ? JSON.stringify({ workflow_runs: failures })
    : "not ok 7 - something");
  const colour = mainColour({ repo: "o/r", now: new Date("2026-09-14T00:00:00Z"), run });
  assert.equal(colour.atLeast, true, "no success in the page means the streak may be older than it looks");
  assert.match(watchReport({ colour })[0], /at least/,
    "and the LINE must say so -- a bound printed as an exact number is the shape #928 is about");
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
  const green = { readable: true, red: false, since: null, hours: null, atLeast: false,
    firstFailing: null, why: null, windows: [], examined: 0, pageBeginsMidRed: false };
  assert.deepEqual(watchReport({ colour: green }), [], "a quiet hour must cost a reader nothing");
  const red = { readable: true, red: true, since: "2026-09-11T00:12:00Z", hours: 27.8, atLeast: false,
    firstFailing: "not ok 41 - x", why: null, windows: [], examined: 0, pageBeginsMidRed: false };
  const lines = watchReport({ colour: red });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /27\.8h/);
  assert.match(lines[0], /not ok 41 - x/, "and the assertion, never the job name");
  assert.equal(EXIT.ATTENTION, 1, "so an hour with something in it exits non-zero");
});

// --- #1047: MAIN'S COLOUR IS A SEQUENCE, NOT A SAMPLE ---
//
// Tonight's red lasted 19.9 minutes against a first read specified as HOURLY -- roughly a 1-in-3 chance of
// overlapping any given sample. product-manager's own 30-minute clock read green at 03:43Z, the red became
// knowable at 03:59:19Z, and their 04:13Z reading reported it three minutes AFTER a person had found it by
// hand. A sampling watch that misses produces a GREEN RECORD across a window in which main was broken, and
// "silent when clean" and "silent because it did not look" render identically in a log.

test("#1047 ACCEPTANCE: a red that opened and closed entirely BETWEEN two reads is still reported", () => {
  // The case a sampling read returns green for, and the reason this row exists. `mainColour.red` is false
  // here and correct -- main IS green now -- and the window is still the thing the reader needs.
  const runs = [
    { conclusion: "success", created_at: "2026-09-12T04:19:00Z" },
    { conclusion: "failure", created_at: "2026-09-12T03:52:00Z" },
    { conclusion: "success", created_at: "2026-09-12T03:16:00Z" },
  ];
  const colour = mainColour({ repo: "o/r", now: new Date("2026-09-12T05:00:00Z"),
    run: () => JSON.stringify({ workflow_runs: runs }) });
  assert.equal(colour.red, false, "main IS green now -- and that was never the whole question");
  assert.deepEqual(colour.windows, [{ since: "2026-09-12T03:52:00Z", until: "2026-09-12T04:19:00Z",
    hours: 0.5, open: false }]);
  assert.equal(colour.examined, 3, "and how many settled runs it read, since a quiet week is not a clean one");
});

test("#1047: TWO breaks in one interval are two windows, not one", () => {
  const runs = [
    { conclusion: "success", created_at: "2026-09-12T06:00:00Z" },
    { conclusion: "failure", created_at: "2026-09-12T05:00:00Z" },
    { conclusion: "success", created_at: "2026-09-12T04:00:00Z" },
    { conclusion: "failure", created_at: "2026-09-12T03:00:00Z" },
    { conclusion: "success", created_at: "2026-09-12T02:00:00Z" },
  ];
  const { windows, examined } = redWindows(runs, new Date("2026-09-12T07:00:00Z"));
  assert.equal(windows.length, 2, "a reader told `1 window` would go looking for one cause");
  assert.deepEqual(windows.map((w) => w.hours), [1, 1]);
  assert.equal(examined, 5);
});

test("#1047: a window STILL OPEN at the read counts to now and SAYS SO -- the worst state must not "
  + "report as the best", () => {
  // product-manager's edge. Summed naively an unclosed window contributes zero, or is dropped for having
  // no close; either way main being red RIGHT NOW reads as a clean sheet.
  const runs = [
    { conclusion: "failure", created_at: "2026-09-12T04:00:00Z" },
    { conclusion: "success", created_at: "2026-09-12T03:00:00Z" },
  ];
  const read = redWindows(runs, new Date("2026-09-12T05:30:00Z"));
  assert.deepEqual(read.windows, [{ since: "2026-09-12T04:00:00Z", until: null, hours: 1.5, open: true }]);
  const figure = redHoursFigure(read);
  assert.equal(figure.value, "1.5", "counted to the read time, not dropped");
  assert.match(figure.note, /STILL OPEN at the read/,
    "and the LINE says it -- `3 windows, 0.9 hours` and `… the last still open` are different instructions");
});

test("#1047: an IN-FLIGHT run neither opens nor closes a window", () => {
  const runs = [
    { conclusion: null, created_at: "2026-09-12T04:30:00Z" },
    { conclusion: "failure", created_at: "2026-09-12T04:00:00Z" },
    { conclusion: "success", created_at: "2026-09-12T03:00:00Z" },
  ];
  const read = redWindows(runs, new Date("2026-09-12T05:00:00Z"));
  assert.equal(read.windows.length, 1);
  assert.equal(read.windows[0].open, true, "the in-flight run does not close it -- it is not a success");
  assert.equal(read.examined, 2, "and it is not counted as examined, because it settled nothing");
});

test("#1047: the weekly figure is the SUM of the windows and names its denominator -- a single current "
  + "window is the sampling assumption one layer up", () => {
  // It would report 0 for a night with three breaks all fixed before the weekly read.
  const runs = [
    { conclusion: "success", created_at: "2026-09-12T06:00:00Z" },
    { conclusion: "failure", created_at: "2026-09-12T05:00:00Z" },
    { conclusion: "success", created_at: "2026-09-12T04:00:00Z" },
    { conclusion: "failure", created_at: "2026-09-12T03:30:00Z" },
    { conclusion: "success", created_at: "2026-09-12T03:00:00Z" },
  ];
  const figure = redHoursFigure(redWindows(runs, new Date("2026-09-12T07:00:00Z")));
  assert.equal(figure.value, "1.5", "1 hour plus 0.5, not the current window and not the newest");
  assert.match(figure.note, /2 window\(s\) across 5 settled run\(s\) examined/,
    "A GAP IN THE RUNS IS NOT GREEN -- trunk runs on merges, so a week with few merges has few "
    + "conclusions to read and must say so rather than presenting a quiet sheet as a clean one");
  assert.doesNotMatch(figure.note, /STILL OPEN/);
});

test("#1047: no settled runs at all is zero windows over zero examined, and the note says the zero", () => {
  // The clean output of a question nobody could ask. `0 windows across 0 runs` is a different report from
  // `0 windows across 500 runs`, and only the second is a clean sheet.
  const figure = redHoursFigure(redWindows([{ conclusion: null, created_at: "2026-09-12T04:00:00Z" }],
    new Date("2026-09-12T05:00:00Z")));
  assert.equal(figure.value, "0");
  assert.match(figure.note, /0 window\(s\) across 0 settled run\(s\) examined/);
});

test("#1049 ACCEPTANCE: a page that BEGINS MID-RED reports a lower bound, in the VALUE and not only the "
  + "note -- the clip understates threefold in the direction that looks better", () => {
  // worker-capture's finding, and the fixture is theirs: the same history read two ways. `redWindows`
  // opens at the first `failure` it can SEE, so when the run that actually opened the window is off the
  // end of `per_page=20` the window starts at the page edge instead.
  const whole = [
    { conclusion: "success", created_at: "2026-09-12T05:00:00Z" },
    { conclusion: "failure", created_at: "2026-09-12T00:00:00Z" },
    { conclusion: "failure", created_at: "2026-09-11T14:00:00Z" },
    { conclusion: "success", created_at: "2026-09-11T13:00:00Z" },
  ];
  const truncated = whole.slice(0, 2); // the page edge falls mid-red
  const now = new Date("2026-09-12T06:00:00Z");

  const full = redHoursFigure(redWindows(whole, now));
  assert.equal(full.value, "15", "the whole history: red from 14:00 to 05:00");
  assert.doesNotMatch(full.note, /MID-RED/, "a page that starts on a success is not a bound");

  const clipped = redHoursFigure(redWindows(truncated, now));
  assert.equal(clipped.value, "at least 5",
    "THREE TIMES understated, on a metric whose target is 0 -- so the NUMBER says it is a bound, because "
    + "the number is what gets quoted");
  assert.match(clipped.note, /BEGINS MID-RED/);
  // AND THE DENOMINATOR IS NOT THE WARNING. "1 window across 2 settled runs" is exactly what a quiet week
  // looks like, which is why the bound cannot be left to a reader comparing counts.
  assert.match(clipped.note, /1 window\(s\) across 2 settled run\(s\)/);
});

test("#1049: the bound is named `pageBeginsMidRed`, not `atLeast` -- same cause, different claim", () => {
  // `mainColour.atLeast` already means "no success in the page, so the STREAK may be older than it looks".
  // One object cannot carry both under one name, and typescript said so the moment they met.
  const read = redWindows([{ conclusion: "failure", created_at: "2026-09-12T00:00:00Z" }],
    new Date("2026-09-12T01:00:00Z"));
  assert.equal(read.pageBeginsMidRed, true);
  assert.equal("atLeast" in read, false, "the streak's word must not be borrowed for a different claim");
});

// #909 (2026-09-12): the trunk workflow file was renamed trunk-guard.yml -> trunk.yml. A default that still named
// the old file would 404, and `mainColour` reads a 404 as "no runs on main at all" -- a CANNOT_ASK on every hourly
// watch, which posts ATTENTION for a red that is not there. Pinned on the URL the default actually asks for.
test("#909: mainColour asks for trunk.yml's runs by default, the file's name since the rename", () => {
  const asked: string[][] = [];
  const run = (args: string[]) => { asked.push(args); return JSON.stringify({ workflow_runs: [] }); };
  mainColour({ repo: "o/r", run });
  const url = asked.flat().find((a) => a.includes("/actions/workflows/"));
  assert.ok(url, "mainColour reads the workflow runs endpoint");
  assert.match(url, /\/actions\/workflows\/trunk\.yml\/runs/, "the file on main today, not trunk-guard.yml");
});
