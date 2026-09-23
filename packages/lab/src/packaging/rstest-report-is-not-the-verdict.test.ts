/**
 * #2165: AN RSTEST RUN THAT EXECUTED NOTHING PRINTS `"status": "pass"`, AND WHICH VERDICT YOU GET DEPENDS ON THE
 * ARGUMENT FORM RATHER THAN ON WHETHER ANYTHING RAN.
 *
 * The conclusion this corrupts is "the mutant survived" -- the sentence `docs/proving-a-gate.md` §6 makes the evidence
 * that a guard is real. A zero-file run reads exactly like a surviving mutant: you broke the code, you ran the test,
 * and nothing failed. `orchestrator` caught it during #2060's fourth refusal round only by re-reading `testFiles`
 * against a baseline, and reports it came close to putting a false claim into a reviewer reply.
 *
 * Three defaults have to line up, and all three are this org's:
 *
 *   1. a pattern matches nothing -- zsh not word-splitting an unquoted variable of several paths, a rename, a stale
 *      path copied from an older row, or a glob narrowed past its last match;
 *   2. rstest prints `"status": "pass"` into the same stdout as `error No test files found, exiting with code 1`;
 *   3. the reader pipes -- `npx rstest ... 2>&1 | tail -20`. A pipe discards the exit code (`$?` is the tail's; zsh
 *      needs `${pipestatus[1]}`), and the `error` line prints ABOVE the report, where a tail never reaches it. What
 *      survives on screen is `## Failures` / `No test failures reported.`
 *
 * CI IS NOT EXPOSED AND THIS FILE IS NOT ABOUT CI: the exit code is 1, so `ts / run` and `acceptance / run` go red on
 * a zero-match. What has no exit-code check is the HAND-RUN that produces a session's claim -- the review round, the
 * completion report, the "I mutated it and it survived" sentence -- because a person read the output.
 *
 * WHY THIS IS A TEST AND NOT ONLY THE PROSE IN `docs/proving-a-gate.md`: a line alone decays (#1157). If rstest ever
 * fixes the report, this file goes red and the prose is retired deliberately, rather than standing after it stopped
 * being true. The four runs go through the repo's OWN `scripts/rstest/rstest.config.mjs`, because a finding about what
 * a session sees when it types the command is worth nothing measured against a different config.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RSTEST_CONFIG } from "../../../guards/src/assert-glob-not-empty.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const PACKAGING = "packages/lab/src/packaging";

/**
 * Form D's control, named rather than discovered. A control picked by walking the directory would run whatever
 * happened to sort first -- several files here spend the GitHub API budget -- so the file is named, and
 * `existsSync` below turns a rename into one legible failure instead of a run that quietly proves nothing.
 */
const CONTROL_TEST = `${PACKAGING}/a-hold-means-cannot-merge.test.ts`;

/** A glob over a directory that DOES exist, narrowed past its last match. Row A of #2165's table. */
const EMPTY_GLOB = `${PACKAGING}/*.no-such-suffix-2165.test.ts`;
/** A literal path that does not exist -- rstest tries to LOAD it and the load throws. Row B, the only form that fails. */
const ABSENT_LITERAL = `${PACKAGING}/no-such-file-xyz.test.ts`;
/** ONE positional argument holding two paths, which is what zsh hands `$ACC` when the variable is unquoted. Row C. */
const UNSPLIT_FILTER = "packages/lab/src/a.test.ts packages/lab/src/b.test.ts";

type Run = { status: number | null; stdout: string; stderr: string };
type Summary = { status: string; counts: Record<string, number> };

/**
 * A real `npx rstest run` through the repo's own config, capturing both streams as one string the way a session
 * reading its terminal sees them.
 *
 * `A11Y_RSTEST_CACHE_DIR` points at a temporary root so an enabled build cache can never be written into the shared
 * checkout's node_modules (#1319). Forms A, B and C never reach the build; the control does. `NODE_TEST_CONTEXT` is
 * stripped for the reason `assert-glob-not-empty.mjs` strips it: inherited, it makes the child believe it is a subtest
 * reporting to a parent harness and stops it setting its own exit code -- which is the very thing measured here.
 */
function rstest(args: string[]): Run {
  const cacheRoot = mkdtempSync(join(tmpdir(), "rstest-report-verdict-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, A11Y_RSTEST_CACHE_DIR: cacheRoot };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync("npx", ["rstest", "run", "--config", RSTEST_CONFIG, ...args],
      { cwd: REPO, encoding: "utf8", env });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
}

/**
 * The same run with the two streams MERGED IN THE ORDER THEY WERE WRITTEN, which is the only way to see what the
 * reader sees. `spawnSync` hands back two separate buffers, so concatenating them states the order of the
 * concatenation rather than the order of the output -- the first draft of this file asserted exactly that, and it was
 * the instrument talking. A shell doing `2>&1` into one pipe is what a session types, so it is what is measured.
 */
function merged(args: string[]): string {
  const cacheRoot = mkdtempSync(join(tmpdir(), "rstest-report-verdict-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, A11Y_RSTEST_CACHE_DIR: cacheRoot };
    delete env.NODE_TEST_CONTEXT;
    const quoted = [RSTEST_CONFIG, ...args].map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
    const result = spawnSync("sh", ["-c", `npx rstest run --config ${quoted} 2>&1`],
      { cwd: REPO, encoding: "utf8", env });
    return result.stdout;
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
}

/** Each form run once, because four real rstest processes are the cost of this file and seven would be waste. */
const RUNS = new Map<string, Run>();
function run(args: string[]): Run {
  const key = args.join(" ");
  const cached = RUNS.get(key);
  if (cached) return cached;
  const fresh = rstest(args);
  RUNS.set(key, fresh);
  return fresh;
}

const formA = (): Run => run(["--include", EMPTY_GLOB]);
const formB = (): Run => run(["--include", ABSENT_LITERAL]);
const formC = (): Run => run([UNSPLIT_FILTER]);
const formD = (): Run => run(["--include", CONTROL_TEST]);

/** The report's own Summary block, parsed. The literal-substring assertions stay beside these: #2165 is about what a reader SEES. */
function summary(output: string): Summary {
  const start = output.indexOf("## Summary");
  assert.ok(start >= 0, `the report has a Summary section:\n${output}`);
  const fenced = /```json\n([\s\S]*?)\n```/.exec(output.slice(start));
  assert.ok(fenced, `the Summary section has a json fence:\n${output}`);
  return JSON.parse(fenced[1]) as Summary;
}

// --- the fixtures are what they claim to be ------------------------------------------------------------------------

test("#2165: the three empty forms really are empty, and the control really does exist", () => {
  // Without this the file could pass by asserting that rstest says `pass` over patterns that in fact match -- which is
  // the same shape of vacuity it exists to catch, one level up.
  const suffix = ".no-such-suffix-2165.test.ts";
  assert.deepEqual(readdirSync(join(REPO, PACKAGING)).filter((name) => name.endsWith(suffix)), [],
    `${EMPTY_GLOB} must match nothing; a file now matches it, so pick another unused suffix`);
  assert.equal(existsSync(join(REPO, ABSENT_LITERAL)), false, `${ABSENT_LITERAL} must not exist`);
  for (const path of UNSPLIT_FILTER.split(" ")) {
    assert.equal(existsSync(join(REPO, path)), false, `${path} must not exist`);
  }
  assert.ok(existsSync(join(REPO, CONTROL_TEST)),
    `form D's control ${CONTROL_TEST} has been moved or renamed -- point CONTROL_TEST at another cheap, offline test `
    + "file in this directory. Without a control, every assertion below is satisfied by a runner that reports `pass` "
    + "for every run, failing ones included.");
});

// --- the finding ---------------------------------------------------------------------------------------------------

test("#2165 ACCEPTANCE: form C -- one unsplit positional filter matching nothing -- exits NON-ZERO while its own report says pass over zero files", () => {
  const { status, stdout: output } = formC();
  assert.notEqual(status, 0, `the exit code is the verdict, and it must be non-zero:\n${output}`);
  // The contradiction is the fact being pinned, not an incidental of the fixture: one captured output, both readings.
  assert.ok(output.includes('"status": "pass"'), `the SAME output says pass:\n${output}`);
  assert.ok(output.includes('"testFiles": 0'), `the SAME output says nothing ran:\n${output}`);
  assert.equal(summary(output).status, "pass");
  assert.equal(summary(output).counts.testFiles, 0);
});

test("#2165 ACCEPTANCE: form A -- a glob --include narrowed past its last match -- pins the identical contradiction", () => {
  const { status, stdout: output } = formA();
  assert.notEqual(status, 0, `the exit code is the verdict, and it must be non-zero:\n${output}`);
  assert.ok(output.includes('"status": "pass"'), `the SAME output says pass:\n${output}`);
  assert.ok(output.includes('"testFiles": 0'), `the SAME output says nothing ran:\n${output}`);
  assert.equal(summary(output).status, "pass");
  assert.equal(summary(output).counts.testFiles, 0);
});

test("#2165 ACCEPTANCE: form B -- a LITERAL absent path -- is the only empty form reported as a failure, and it is the form nobody types", () => {
  // rstest tries to load a literal path as a file and the load throws, so `testFiles` is 1 and `failedFiles` is 1.
  // Naming several files is what produces forms A and C, so the one form that tells the truth is the one a session
  // reaches for least. Without this row the file would state "rstest reports empty runs as pass", which is not the
  // finding: the finding is that the VERDICT DEPENDS ON THE ARGUMENT FORM.
  const { status, stdout: output } = formB();
  assert.notEqual(status, 0, output);
  assert.ok(output.includes('"status": "fail"'), `the report says fail:\n${output}`);
  assert.equal(summary(output).status, "fail");
  assert.equal(summary(output).counts.failedFiles, 1);
});

test("#2165 ACCEPTANCE: the control -- a pattern that DOES match -- exits 0 with a non-zero testFiles", () => {
  // THE CLAUSE THAT MAKES THE THREE ABOVE ASSERTIONS ABOUT THE EMPTY CASE. Delete it and they pass just as well
  // against a runner that reported `"status": "pass"` for every run there is.
  const { status, stdout: output } = formD();
  assert.equal(status, 0, `the control must pass:\n${output}`);
  const counts = summary(output).counts;
  assert.equal(summary(output).status, "pass");
  assert.ok(counts.testFiles >= 1, `the control executed files: ${JSON.stringify(counts)}`);
  assert.ok(counts.passedTests >= 1, `the control executed tests: ${JSON.stringify(counts)}`);
});

test("#2165: a zero-file run and the control are IDENTICAL on every field a reader greps to ask 'did anything fail?'", () => {
  // This is the defect stated directly. `status`, `failedFiles`, `failedTests` and the report's own closing section
  // are the same three ways over; the ONLY fields that separate them are counts of work DONE, and a count is wrong
  // only to a reader who already knows what it should have been.
  const outputs = [formA().stdout, formC().stdout, formD().stdout];
  for (const output of outputs) {
    assert.equal(summary(output).status, "pass", output);
    assert.equal(summary(output).counts.failedFiles, 0, output);
    assert.equal(summary(output).counts.failedTests, 0, output);
    assert.ok(output.includes("No test failures reported."), `the closing section is identical too:\n${output}`);
  }
  // And the control is what stops that being a statement about a runner which always says pass.
  assert.ok(summary(formD().stdout).counts.testFiles > summary(formA().stdout).counts.testFiles,
    "only the counts of work done separate the control from the empty run");
});

test("#2165: the line that tells the truth is on STDERR, so a `| tail` of stdout alone cannot show it at all", () => {
  // Clause 3 of the three that have to line up, and the half of it that needs no ordering argument: the report and
  // the truth go to different streams. A reader who pipes without `2>&1` is looking at the stream that says `pass`.
  for (const run of [formA(), formC()]) {
    assert.match(run.stderr, /No test files found, exiting with code 1/, "rstest does say it plainly -- on stderr");
    assert.equal(run.stdout.includes("No test files found"), false, `and never on stdout:\n${run.stdout}`);
    assert.ok(run.stdout.includes("# Rstest Test Execution Report"), "while the report that says `pass` is on stdout");
  }
});

test("#2165: and with `2>&1` the truth prints ABOVE the report, so a `| tail` still never reaches it", () => {
  // The other half, measured on the merged stream rather than on a concatenation this file chose the order of.
  // A pipe also discards the exit code -- `$?` is the tail's, and zsh needs `${pipestatus[1]}` -- so what survives on
  // screen is `## Failures` / `No test failures reported.` and nothing else.
  const stream = merged([UNSPLIT_FILTER]);
  const truth = stream.indexOf("No test files found, exiting with code 1");
  const report = stream.indexOf("# Rstest Test Execution Report");
  assert.ok(truth >= 0, `the merged stream carries the truth:\n${stream}`);
  assert.ok(report > truth, `and carries it ABOVE the report a tail shows:\n${stream}`);
  assert.ok(stream.slice(report).includes("No test failures reported."), "which is what the tail shows instead");
});

// --- the two documents that carry the same fact in prose -------------------------------------------------------------

test("#2165 ACCEPTANCE: docs/proving-a-gate.md carries the trap beside the one tier 2 already names", () => {
  const doc = readFileSync(join(REPO, "docs/proving-a-gate.md"), "utf8");
  const trap = doc.slice(doc.indexOf("### 3b."), doc.indexOf("### 4."));
  assert.ok(doc.includes("### 3a."), "the sibling trap this one sits beside is still there");
  assert.ok(trap.length > 0, "docs/proving-a-gate.md has a `### 3b.` section");
  assert.match(trap, /exit code/i);
  assert.match(trap, /pipe/i);
  assert.match(trap, /testFiles/);
});

test("#2165 ACCEPTANCE: the glob floor's refusal no longer says `tsx --test` is the only place a zero-match can be caught", () => {
  // True while `tsx --test` was the runner and wrong under rstest in the half that tells you where to look: rstest DOES
  // exit non-zero, so the floor is no longer the only place -- while its REPORT still says pass, which that sentence
  // never mentioned. The same fact, one file over.
  const floor = readFileSync(join(REPO, "packages/guards/src/assert-glob-not-empty.mjs"), "utf8");
  const refusal = floor.slice(floor.indexOf("REFUSING: a test glob matched too few files"));
  assert.ok(refusal.length > 0, "the floor still refuses a zero-match -- this row does not touch its behaviour");
  assert.equal(floor.includes("the only place that failure can be caught"), false,
    "the refusal no longer claims to be the only place a zero-match can be caught");
  assert.match(refusal, /rstest/,
    "and it says what rstest actually does instead: a non-zero exit under a report that reads `pass`");
});
