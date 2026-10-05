// no-token: selection-skipped.mjs -- every test drives pure functions over fixture runs and logs, or a throwaway git repository with `rstest list` injected; nothing here spawns `gh` or reaches the network.
/**
 * #3576: THE REGRESSION GUARD FOR #3215. A red CI run is traced by a command to whether local `--changed` skipped the test
 * that failed it, and the first-run pass rate either side of the merge is `ci-health`'s own function over an explicit window.
 *
 * POSITIVE CONTROLS, named where each absence is asserted: a log with no FAIL line reads no files, and one with a FAIL line
 * reads it (1); the rate of a window is `firstRunPassRate` and a local reimplementation disagrees with it on the SAME fixture
 * (4); the red list and the rate's own counts agree on a fixture that holds a red, a cancelled-then-red and an only-cancelled
 * pull request (5); and the merge-base test is a repository whose head IS an ancestor of today's `main`, which is the case a
 * merge-base against `main` as it is now would get wrong (3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { firstRunPassRate, inWindow } from "../../../../scripts/ci-health.mjs";
import {
  affectedAt, cleanLine, containsCommit, countAnswers, failingFiles, firstRunReds, lineFor, renderReport, runAnswer, siblingRunId,
  skippedByChanged, traceRed, windowReading, windowsAround,
} from "../../../../scripts/selection-skipped.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const ESC = String.fromCharCode(27);

// ---- fixtures -------------------------------------------------------------------------------------------

let nextId = 1;
const at = (minute: number) => `2026-10-05T10:${String(minute).padStart(2, "0")}:00Z`;
const run = (pr: string, conclusion: string | null, over: Record<string, unknown> = {}) => {
  const id = nextId++;
  return { id, event: "pull_request", conclusion, head_sha: `${String(id).padStart(40, "a")}`, head_branch: pr, created_at: at(id % 60),
    head_repository: { full_name: "a11ign/a11ign" }, ...over };
};
const pr = (name: string, ...conclusions: (string | null)[]) => conclusions.map((c) => run(name, c));

/** One line of a job log as the API serves it: a runner timestamp, then rstest's coloured text. */
const logLine = (text: string) => `2026-10-04T18:43:33.9211693Z ${text}`;
const failLine = (file: string, name = "a test") =>
  logLine(`${ESC}[41m${ESC}[37m${ESC}[1m FAIL ${ESC}[22m${ESC}[39m${ESC}[49m ${ESC}[90m${file.replace(/[^/]*$/, "")}${ESC}[39m${ESC}[36m${file.replace(/^.*\//, "")}${ESC}[39m ${ESC}[2m>${ESC}[22m ${name}`);
const FILE = "packages/lab/src/packaging/row-claim.test.ts";

type Job = { id: number; name: string };
/** A reader over fixture data: jobs by run id, logs by job id, the affected set, and which files the head holds. */
function reader(over: Partial<Parameters<typeof traceRed>[1]> & { jobs?: Record<number, Job[] | null>; logs?: Record<number, string> } = {}) {
  const { jobs = {}, logs = {}, ...rest } = over;
  return {
    failedJobs: (id: number) => (id in jobs ? jobs[id] : []),
    log: (id: number) => logs[id] ?? "",
    affected: () => ({ set: ["packages/lab/src/packaging/other.test.ts"], changed: ["pnpm-lock.yaml"], treeWide: [] as string[] }),
    exists: () => true,
    hasPolicy: () => true,
    ...rest,
  };
}

// ---- 1. the failing file, read out of a log ---------------------------------------------------------------

test("a coloured, timestamped FAIL line names its test file; a log with no FAIL line names none (POSITIVE CONTROL: the same reader finds the one that has it)", () => {
  assert.deepEqual(failingFiles(failLine(FILE, "#987: a claim")), [FILE]);
  const passing = [logLine("  ✓ a FAILING run carries the failing test (3)"), logLine(" Test Files  689 passed (689)")].join("\n");
  assert.deepEqual(failingFiles(passing), [], "a passing test whose TITLE says FAILING is not a failure");
  assert.equal(cleanLine(failLine(FILE)), ` FAIL  ${FILE} > a test`, "timestamp and colour are gone, and nothing else");
});

test("a file with several failing tests is one file, and two files are two, in order", () => {
  const log = [failLine(FILE, "one"), failLine(FILE, "two"), failLine("packages/lab/src/packaging/b.test.ts")].join("\n");
  assert.deepEqual(failingFiles(log), [FILE, "packages/lab/src/packaging/b.test.ts"]);
});

test("`gate` names the other run that failed, and a gate log that names none reads null", () => {
  assert.equal(siblingRunId(logLine("##[error]the other kind of run on abc (37225230594) concluded 'failure', so this run cannot report")), 37225230594);
  assert.equal(siblingRunId(logLine("##[error]a job reported 'failure', which is neither success nor skipped")), null);
});

// ---- 2. one failing file: yes, no, gone -------------------------------------------------------------------

test("a failing file the affected set did NOT contain reads yes, one it did contain reads no, one the head lacks reads gone", () => {
  const set = ["packages/a/src/in.test.ts"];
  const exists = (file: string) => file !== "packages/a/src/renamed.test.ts";
  assert.equal(skippedByChanged({ file: "packages/a/src/out.test.ts", affectedSet: set, existsAtHead: exists }), "yes");
  assert.equal(skippedByChanged({ file: "packages/a/src/in.test.ts", affectedSet: set, existsAtHead: exists }), "no");
  assert.equal(skippedByChanged({ file: "packages/a/src/renamed.test.ts", affectedSet: set, existsAtHead: exists }), "gone");
  assert.equal(skippedByChanged({ file: "packages/a/src/renamed.test.ts", affectedSet: ["packages/a/src/renamed.test.ts"], existsAtHead: exists }), "gone",
    "a missing file is gone even when the set lists it: the head is the authority on what exists");
});

test("a run that failed in several files answers yes if any was skipped, else no, else gone", () => {
  assert.equal(runAnswer([{ file: "a", answer: "no" }, { file: "b", answer: "yes" }]), "yes");
  assert.equal(runAnswer([{ file: "a", answer: "gone" }, { file: "b", answer: "no" }]), "no");
  assert.equal(runAnswer([{ file: "a", answer: "gone" }, { file: "b", answer: "ci-only" }]), "ci-only");
  assert.equal(runAnswer([{ file: "a", answer: "gone" }]), "gone");
});

// ---- 3. a red run, traced ---------------------------------------------------------------------------------

const red = run("agent/x-1", "failure");

test("a red whose failing file the affected set lacks reads yes, carries the diff, and the line says the file", () => {
  const trace = traceRed(red, reader({ jobs: { [red.id]: [{ id: 9, name: "ts / run" }, { id: 10, name: "gate" }] }, logs: { 9: failLine(FILE) } }));
  assert.equal(trace.answer, "yes");
  assert.deepEqual(trace.changed, ["pnpm-lock.yaml"]);
  assert.equal(lineFor(trace), `skipped-by-changed: yes -- ${FILE}`);
});

test("a red whose failing file the set contained reads no, and carries no diff to widen from", () => {
  const trace = traceRed(red, reader({
    jobs: { [red.id]: [{ id: 9, name: "ts / run" }] }, logs: { 9: failLine(FILE) },
    affected: () => ({ set: [FILE], changed: ["packages/lab/src/packaging/row-claim.mjs"], treeWide: [] }),
  }));
  assert.equal(trace.answer, "no");
  assert.deepEqual(trace.changed, []);
});

test("a failing file that no longer exists is reported gone and counted in neither yes nor no", () => {
  const trace = traceRed(red, reader({ jobs: { [red.id]: [{ id: 9, name: "ts / run" }] }, logs: { 9: failLine(FILE) }, exists: () => false }));
  assert.equal(trace.answer, "gone");
  assert.match(lineFor(trace), /^skipped-by-changed: gone -- /);
  const counts = countAnswers([trace]);
  assert.deepEqual([counts.yes, counts.no, counts.gone], [0, 0, 1]);
});

test("a tree-wide guard that failed inside `ts` reads ci-only and is not a `--changed` miss; a plain test beside it still reads yes (POSITIVE CONTROL)", () => {
  const guard = "packages/lab/src/packaging/control-plane-checkout-is-one-fact.test.ts";
  const jobs = { [red.id]: [{ id: 9, name: "ts / run" }] };
  const only = traceRed(red, reader({ jobs, logs: { 9: failLine(guard) }, affected: () => ({ set: [], changed: ["scripts/verify.mjs"], treeWide: [guard] }) }));
  assert.equal(only.answer, "ci-only");
  assert.deepEqual(only.files, [{ file: guard, answer: "ci-only" }]);
  const both = traceRed(red, reader({ jobs, logs: { 9: [failLine(guard), failLine(FILE)].join("\n") }, affected: () => ({ set: [], changed: ["scripts/verify.mjs"], treeWide: [guard] }) }));
  assert.equal(both.answer, "yes", "the plain test the graph missed decides the run");
  assert.deepEqual(both.files.map((f) => f.answer), ["ci-only", "yes"]);
  assert.equal(lineFor(both), `skipped-by-changed: yes -- ${guard} (ci-only), ${FILE}`, "the line says which file each answer is for");
  const inSet = traceRed(red, reader({ jobs, logs: { 9: failLine(guard) }, affected: () => ({ set: [guard], changed: [], treeWide: [guard] }) }));
  assert.equal(inSet.answer, "no", "a tree-wide guard that DID ride on the set and failed is not the policy's either");
});

test("only `gate` failed: the red is traced through the run it names, and says so", () => {
  const sibling = 9001;
  const gateLog = logLine(`##[error]the other kind of run on ${red.head_sha} (${sibling}) concluded 'failure', so this run cannot report`);
  const trace = traceRed(red, reader({
    jobs: { [red.id]: [{ id: 5, name: "gate" }], [sibling]: [{ id: 6, name: "ts / run" }] }, logs: { 5: gateLog, 6: failLine(FILE) },
  }));
  assert.equal(trace.answer, "yes");
  assert.equal(trace.runId, red.id, "the answer is for the run asked about");
  assert.match(trace.why, /through run 9001/);
});

test("only `gate` failed and it names no run, or a run already followed, is unread and not a guess", () => {
  const none = traceRed(red, reader({ jobs: { [red.id]: [{ id: 5, name: "gate" }] }, logs: { 5: logLine("##[error]a job reported 'failure'") } }));
  assert.equal(none.answer, "unread");
  const loop = traceRed(red, reader({ jobs: { [red.id]: [{ id: 5, name: "gate" }] }, logs: { 5: logLine(`(${red.id}) concluded 'failure'`) } }));
  assert.equal(loop.answer, "unread", "a run that names itself is not followed again");
});

test("the non-test reds are counted in neither: a CI-only job, a job with no FAIL line, a head before the policy, an unread run", () => {
  const ciOnly = traceRed(red, reader({ jobs: { [red.id]: [{ id: 3, name: "guardSweep" }] } }));
  const lint = traceRed(red, reader({ jobs: { [red.id]: [{ id: 4, name: "ts / run" }] }, logs: { 4: logLine("✖ 4097 problems (3 errors)") } }));
  const old = traceRed(red, reader({ jobs: { [red.id]: [{ id: 9, name: "ts / run" }] }, logs: { 9: failLine(FILE) }, hasPolicy: () => false }));
  const unread = traceRed(red, reader({ jobs: { [red.id]: null } }));
  const noList = traceRed(red, reader({ jobs: { [red.id]: [{ id: 9, name: "ts / run" }] }, logs: { 9: failLine(FILE) }, affected: () => null }));
  assert.deepEqual([ciOnly.answer, lint.answer, old.answer, unread.answer, noList.answer], ["ci-only", "no-test-file", "predates-policy", "unread", "unread"]);
  const counts = countAnswers([ciOnly, lint, old, unread, noList]);
  assert.equal(counts.yes + counts.no, 0);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 5, "the answers sum to the reds");
});

// ---- 3b. the merge-base, against a real repository with `rstest list` injected -------------------------------

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: sandboxGitEnv() }).trim();
const commit = (cwd: string, file: string, date: string) => {
  writeFileSync(join(cwd, file), `${file} ${date}\n`);
  git(cwd, "add", file);
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", file], {
    cwd, env: sandboxGitEnv({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
  });
  return git(cwd, "rev-parse", "HEAD");
};

test("the merge-base is taken against main AS IT STOOD when the run was created, so a head since merged into main is not its own base", () => {
  const dir = mkdtempSync(join(tmpdir(), "selection-skipped-test-"));
  try {
    git(dir, "init", "-q", "--bare", "origin.git");
    git(dir, "clone", "-q", "origin.git", "work");
    const work = join(dir, "work");
    git(work, "checkout", "-q", "-b", "main");
    const base = commit(work, "base.txt", "2026-10-05T09:00:00Z");
    git(work, "checkout", "-q", "-b", "feature");
    const head = commit(work, "feature.txt", "2026-10-05T09:30:00Z");
    git(work, "checkout", "-q", "main");
    commit(work, "later.txt", "2026-10-05T12:00:00Z"); // main moves on AFTER the run
    // dated explicitly: the merge commit would otherwise carry THIS machine's clock, which may be before the run's `created_at`
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "merge", "-q", "--no-ff", "-m", "merge feature", "feature"], {
      cwd: work, env: sandboxGitEnv({ GIT_AUTHOR_DATE: "2026-10-05T12:30:00Z", GIT_COMMITTER_DATE: "2026-10-05T12:30:00Z" }),
    });
    git(work, "push", "-q", "origin", "main", "feature");
    git(work, "fetch", "-q", "origin");

    assert.ok(containsCommit({ head, commit: base, cwd: work }), "positive control: the head holds its base");
    assert.ok(!containsCommit({ head: base, commit: head, cwd: work }), "and the base does not hold the head");
    assert.equal(git(work, "merge-base", head, "origin/main"), head, "POSITIVE CONTROL: against main as it is NOW, the head is its own merge-base");

    const seen: { mergeBase: string; tree: string }[] = [];
    const red = { ...run("feature", "failure"), head_sha: head, created_at: "2026-10-05T10:00:00Z" };
    const found = affectedAt({ red, cwd: work, list: (where) => { seen.push(where); return [FILE]; }, treeWide: () => ["packages/lab/src/gates/some-guard.test.ts"] });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].mergeBase, base, "the list is asked against main at the run's time");
    assert.deepEqual(found?.set, [FILE], "what the injected list returns is the affected set");
    assert.deepEqual(found?.treeWide, ["packages/lab/src/gates/some-guard.test.ts"], "and the injected tree-wide read is carried through");
    assert.deepEqual(found?.changed, ["feature.txt"], "and the diff is the head's own change, not an empty one");
    assert.equal(git(work, "worktree", "list").split("\n").length, 1, "the head's worktree is removed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a head that cannot be fetched reads null, not an empty set", () => {
  const dir = mkdtempSync(join(tmpdir(), "selection-skipped-test-"));
  try {
    git(dir, "init", "-q", "--bare", "origin.git");
    git(dir, "clone", "-q", "origin.git", "work");
    const lost = { ...run("gone", "failure"), head_sha: "f".repeat(40) };
    assert.equal(affectedAt({ red: lost, cwd: join(dir, "work"), list: () => ["never"], treeWide: () => [] }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 4. the pass rate is firstRunPassRate over inWindow's window, not a copy ----------------------------------

const windowRuns = () => [
  ...pr("red-then-green", "failure", "success"),
  ...pr("green", "success"),
  ...pr("cancelled-then-red", "cancelled", "failure"),
  ...pr("only-cancelled", "cancelled"),
  ...pr("green-too", "success", "failure"),
  ...pr("outside", "failure").map((r) => ({ ...r, created_at: "2026-09-01T10:00:00Z" })),
];
const WINDOW = { since: "2026-10-05T10:00:00Z", until: "2026-10-05T11:00:00Z" };

/** What a local reimplementation would plausibly do: the share of ALL runs that were green. */
const naiveRate = (runs: Parameters<typeof firstRunPassRate>[0]) => runs.filter((r) => r.conclusion === "success").length / runs.length;

test("the rate of a window IS firstRunPassRate over inWindow's slice: the same passed, counted and rate", () => {
  const runs = windowRuns();
  const reading = windowReading(runs, WINDOW);
  const direct = firstRunPassRate(inWindow(runs, WINDOW));
  assert.deepEqual({ passed: reading.passed, counted: reading.counted, rate: reading.rate }, direct);
  assert.equal(reading.counted, 4, "the run outside the window is not read, and the only-cancelled pull request is not in the denominator");
  assert.equal(reading.pullRequests, 5, "but it IS a pull request the window held");
});

test("POSITIVE CONTROL: a local reimplementation disagrees with the real rate on this fixture, so a copy would be RED", () => {
  const runs = windowRuns();
  const real = windowReading(runs, WINDOW).rate;
  assert.notEqual(naiveRate(inWindow(runs, WINDOW)), real, "the fixture can tell a copy from the original");
  assert.equal(real, 2 / 4, "red-then-green and cancelled-then-red are misses; green and green-too are passes");
});

test("the red list is the first completed run of each pull request that failed, and its count is the rate's own (counted - passed)", () => {
  const runs = windowRuns();
  const reds = firstRunReds(inWindow(runs, WINDOW));
  const { counted, passed } = firstRunPassRate(inWindow(runs, WINDOW));
  assert.equal(reds.length, counted - passed);
  assert.equal(reds.length, 2, "POSITIVE CONTROL: the fixture holds reds");
  assert.deepEqual(reds.map((r) => r.head_branch).sort(), ["cancelled-then-red", "red-then-green"]);
  assert.ok(reds.every((r) => r.conclusion === "failure"));
});

test("the two windows meet at the merge and neither overlaps the other: 14 days each", () => {
  const { before, after } = windowsAround("2026-10-04T23:51:47Z");
  assert.deepEqual(before, { since: "2026-09-20T23:51:47Z", until: "2026-10-04T23:51:47Z" });
  assert.deepEqual(after, { since: "2026-10-04T23:51:47Z", until: "2026-10-18T23:51:47Z" });
});

// ---- 5. the report, and the written rule ---------------------------------------------------------------------------

const report = (over: Record<string, unknown> = {}) => {
  const runs = windowRuns();
  const traces = [traceRed(red, reader({ jobs: { [red.id]: [{ id: 9, name: "ts / run" }] }, logs: { 9: failLine(FILE) } }))];
  return renderReport({ merged: "2026-10-05T10:00:00Z", before: windowReading(runs, WINDOW), after: windowReading(runs, WINDOW), traces, asOf: "2026-12-01T00:00:00Z", ...over });
};

test("the report prints both rates with their counts, the yes/no headline, and the widening instruction only when a red answered yes", () => {
  const withYes = report();
  assert.match(withYes, /\*\*50\.0%\*\* -- 2 of 4 pull requests/);
  assert.match(withYes, /\*\*1 yes, 0 no\*\*/);
  assert.match(withYes, /forceRerunTriggers/);
  assert.match(withYes, /cites the run id/);
  const noYes = report({ traces: [] });
  assert.doesNotMatch(noYes, /goes into `forceRerunTriggers`/);
  assert.match(noYes, /Nothing answered yes, so nothing is widened/);
});

test("the report says when #3573 merged, and says the window is still open when it is", () => {
  assert.match(report({ deleted: "2026-10-05T10:30:00Z" }), /deletion of the old selectors \(#3573\), merged 2026-10-05T10:30:00Z: the two changes are not separable/);
  assert.match(report({ deleted: "2026-09-01T00:00:00Z" }), /outside the after window/);
  assert.match(report(), /may ALSO contain the deletion of the old selectors/);
  assert.match(report({ asOf: "2026-10-05T10:30:00Z" }), /after window is still open/);
  assert.doesNotMatch(report(), /after window is still open/);
});

test("CONTRIBUTING.md states the rule beside the stamp's wording", () => {
  const contributing = readFileSync(join(REPO, "CONTRIBUTING.md"), "utf8");
  const stamp = contributing.split("\n").find((line) => line.includes("the affected set passed at this head")) ?? "";
  assert.ok(stamp.length > 0, "POSITIVE CONTROL: the paragraph carrying the stamp's wording is found");
  assert.match(stamp, /scripts\/selection-skipped\.mjs/);
  assert.match(stamp, /forceRerunTriggers/);
  assert.match(stamp, /cites? the run id/);
});
