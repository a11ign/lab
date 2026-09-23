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
 *   2. rstest prints `"status": "pass"` into the same run as `error No test files found, exiting with code 1`;
 *   3. the reader pipes -- `npx rstest ... 2>&1 | tail -20`. A pipe discards the exit code (`$?` is the tail's; zsh
 *      needs `${pipestatus[1]}`), and the `error` line prints ABOVE the report, where a tail never reaches it. What
 *      survives on screen is `## Failures` / `No test failures reported.`
 *
 * TWO REPORTERS, AND THE ROW WAS MEASURED UNDER ONE OF THEM. This was found by THIS FILE going red in CI while green
 * locally, and it is the sharper statement of the row's own finding. rstest picks its reporter from
 * `determineAgent()`, which reads `AI_AGENT`, then `CLAUDECODE`/`CLAUDE_CODE`, `CURSOR_AGENT` and the rest, and is
 * switched off by `RSTEST_NO_AGENT=1`:
 *
 *   - AN AGENT SESSION -- every session in this org -- gets the markdown report, whose Summary says `"status":
 *     "pass"` over zero files. That is the population the row is about, and it is where a false "the mutant survived"
 *     is written.
 *   - A GITHUB RUNNER has none of those variables and gets the default reporter, which prints `Test Files no tests`
 *     and no verdict word at all.
 *
 * So the mode is DECLARED here, never inherited. A test that read whichever reporter its parent process happened to
 * summon would pass or fail on the environment rather than on rstest, which is the defect one level up -- and is the
 * second time this file has been caught measuring its own instrument (see `merged` below for the first).
 *
 * WHAT DOES NOT DEPEND ON THE REPORTER IS THE EXIT CODE: 1, 1, 1, 0 for the four forms under BOTH modes. That is the
 * whole of the remedy, and is why `docs/proving-a-gate.md` §3b says the report is not the verdict, the exit code is.
 *
 * CI IS NOT EXPOSED AND THIS FILE IS NOT ABOUT CI: the exit code is 1, so `ts / run` and `acceptance / run` go red on
 * a zero-match. What has no exit-code check is the HAND-RUN that produces a session's claim -- the review round, the
 * completion report, the "I mutated it and it survived" sentence -- because a person read the output.
 *
 * WHY THIS IS A TEST AND NOT ONLY THE PROSE IN `docs/proving-a-gate.md`: a line alone decays (#1157). If rstest ever
 * fixes the report, this file goes red and the prose is retired deliberately, rather than standing after it stopped
 * being true. The runs go through the repo's OWN `scripts/rstest/rstest.config.mjs`, because a finding about what a
 * session sees when it types the command is worth nothing measured against a different config.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RSTEST_CONFIG } from "../../../guards/src/assert-glob-not-empty.mjs";
// #492: a bare `spawnSync("npx", ...)` is ENOENT on Windows and EINVAL since CVE-2024-27980, so every
// npx/npm call site in this repo resolves npm's own CLI script through this helper and spawns `node`.
// `npm-cli-windows-spawn.test.ts` discovers the population by shape and refuses a bare one -- it caught
// this file's first draft, in CI.
import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";

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

/** Forces rstest's agent reporter, whatever summoned this process. `AI_AGENT` is the first thing `determineAgent` reads. */
const AGENT_MODE = { AI_AGENT: "claude" };
/** Forces the default reporter -- `RSTEST_NO_AGENT` short-circuits `determineAgent` before it looks at anything else. */
const PLAIN_MODE = { RSTEST_NO_AGENT: "1" };

type Run = { status: number | null; stdout: string; stderr: string };
type Summary = { status: string; counts: Record<string, number> };

/**
 * The environment every run below gets: the caller's, plus the declared reporter mode.
 *
 * `A11Y_RSTEST_CACHE_DIR` points at a temporary root so an enabled build cache can never be written into the shared
 * checkout's node_modules (#1319) -- forms A, B and C never reach the build, but the control does, and CI is where the
 * cache is on. `NODE_TEST_CONTEXT` is stripped for the reason `assert-glob-not-empty.mjs` strips it: inherited, it
 * makes the child believe it is a subtest reporting to a parent harness and stops it setting its own exit code, which
 * is the very thing measured here.
 */
function childEnv(mode: Record<string, string>, cacheRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...mode, A11Y_RSTEST_CACHE_DIR: cacheRoot };
  delete env.NODE_TEST_CONTEXT;
  if (mode.AI_AGENT) delete env.RSTEST_NO_AGENT;
  return env;
}

/**
 * ANSI escapes removed, because they land BETWEEN the words an assertion reads. rstest's default reporter prints
 * `Test Files` and `no tests` in two different colours, so the raw stream carries
 * `Test Files\x1b[39m \x1b[2mno tests` and `/Test Files\s+no tests/` does not match it -- measured here, under a
 * parent stripped of every agent variable. Nothing below asserts on an escape code, so this makes the READING robust
 * without changing what the run printed. The agent report is uncoloured and is unaffected either way.
 */
function withoutAnsi(stream: string): string {
  // eslint-disable-next-line no-control-regex -- the escapes are the thing being removed
  return stream.replaceAll(/\u001b\[[0-9;]*m/g, "");
}

/** The `npx rstest run --config <ours> <args>` a session types, in the shape Windows can actually launch. */
function invocation(args: string[]): { command: string; args: string[] } {
  return npmCliInvocation("npx", ["rstest", "run", "--config", RSTEST_CONFIG, ...args]);
}

/** A real `npx rstest run` through the repo's own config, with the two streams kept apart. */
function rstest(args: string[], mode: Record<string, string>): Run {
  const cacheRoot = mkdtempSync(join(tmpdir(), "rstest-report-verdict-"));
  try {
    const npx = invocation(args);
    const result = spawnSync(npx.command, npx.args,
      { cwd: REPO, encoding: "utf8", env: childEnv(mode, cacheRoot) });
    return { status: result.status, stdout: withoutAnsi(result.stdout), stderr: withoutAnsi(result.stderr) };
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
function merged(args: string[], mode: Record<string, string>): string {
  const cacheRoot = mkdtempSync(join(tmpdir(), "rstest-report-verdict-"));
  try {
    const npx = invocation(args);
    const quoted = [npx.command, ...npx.args].map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
    const result = spawnSync("sh", ["-c", `${quoted} 2>&1`],
      { cwd: REPO, encoding: "utf8", env: childEnv(mode, cacheRoot) });
    return withoutAnsi(result.stdout);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
}

/** Each form runs once per mode, because nine real rstest processes are the cost of this file and eighteen would be waste. */
const RUNS = new Map<string, Run>();
function run(args: string[], mode: Record<string, string>): Run {
  const key = `${JSON.stringify(mode)} ${args.join(" ")}`;
  const cached = RUNS.get(key);
  if (cached) return cached;
  const fresh = rstest(args, mode);
  RUNS.set(key, fresh);
  return fresh;
}

const ARGS_A = ["--include", EMPTY_GLOB];
const ARGS_B = ["--include", ABSENT_LITERAL];
const ARGS_C = [UNSPLIT_FILTER];
const ARGS_D = ["--include", CONTROL_TEST];

const agentA = (): Run => run(ARGS_A, AGENT_MODE);
const agentB = (): Run => run(ARGS_B, AGENT_MODE);
const agentC = (): Run => run(ARGS_C, AGENT_MODE);
const agentD = (): Run => run(ARGS_D, AGENT_MODE);

/** The report's own Summary block, parsed. The literal-substring assertions stay beside these: #2165 is about what a reader SEES. */
function summary(output: string): Summary {
  const start = output.indexOf("## Summary");
  assert.ok(start >= 0, `the agent report has a Summary section:\n${output}`);
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

// --- the finding, under the reporter an agent session gets -----------------------------------------------------------

test("#2165 ACCEPTANCE: form C -- one unsplit positional filter matching nothing -- exits NON-ZERO while its own report says pass over zero files", () => {
  const { status, stdout } = agentC();
  assert.notEqual(status, 0, `the exit code is the verdict, and it must be non-zero:\n${stdout}`);
  // The contradiction is the fact being pinned, not an incidental of the fixture: one captured output, both readings.
  assert.ok(stdout.includes('"status": "pass"'), `the SAME output says pass:\n${stdout}`);
  assert.ok(stdout.includes('"testFiles": 0'), `the SAME output says nothing ran:\n${stdout}`);
  assert.equal(summary(stdout).status, "pass");
  assert.equal(summary(stdout).counts.testFiles, 0);
});

test("#2165 ACCEPTANCE: form A -- a glob --include narrowed past its last match -- pins the identical contradiction", () => {
  const { status, stdout } = agentA();
  assert.notEqual(status, 0, `the exit code is the verdict, and it must be non-zero:\n${stdout}`);
  assert.ok(stdout.includes('"status": "pass"'), `the SAME output says pass:\n${stdout}`);
  assert.ok(stdout.includes('"testFiles": 0'), `the SAME output says nothing ran:\n${stdout}`);
  assert.equal(summary(stdout).status, "pass");
  assert.equal(summary(stdout).counts.testFiles, 0);
});

test("#2165 ACCEPTANCE: form B -- a LITERAL absent path -- is the only empty form reported as a failure, and it is the form nobody types", () => {
  // rstest tries to load a literal path as a file and the load throws, so `testFiles` is 1 and `failedFiles` is 1.
  // Naming several files is what produces forms A and C, so the one form that tells the truth is the one a session
  // reaches for least. Without this row the file would state "rstest reports empty runs as pass", which is not the
  // finding: the finding is that the VERDICT DEPENDS ON THE ARGUMENT FORM.
  const { status, stdout } = agentB();
  assert.notEqual(status, 0, stdout);
  assert.ok(stdout.includes('"status": "fail"'), `the report says fail:\n${stdout}`);
  assert.equal(summary(stdout).status, "fail");
  assert.equal(summary(stdout).counts.failedFiles, 1);
});

test("#2165 ACCEPTANCE: the control -- a pattern that DOES match -- exits 0 with a non-zero testFiles", () => {
  // THE CLAUSE THAT MAKES THE THREE ABOVE ASSERTIONS ABOUT THE EMPTY CASE. Delete it and they pass just as well
  // against a runner that reported `"status": "pass"` for every run there is.
  const { status, stdout } = agentD();
  const counts = summary(stdout).counts;
  assert.equal(status, 0, `the control must pass:\n${stdout}`);
  assert.equal(summary(stdout).status, "pass");
  assert.ok(counts.testFiles >= 1, `the control executed files: ${JSON.stringify(counts)}`);
  assert.ok(counts.passedTests >= 1, `the control executed tests: ${JSON.stringify(counts)}`);
});

test("#2165: a zero-file run and the control are IDENTICAL on every field a reader greps to ask 'did anything fail?'", () => {
  // This is the defect stated directly. `status`, `failedFiles`, `failedTests` and the report's own closing section
  // are the same three ways over; the ONLY fields that separate them are counts of work DONE, and a count is wrong
  // only to a reader who already knows what it should have been.
  for (const { stdout } of [agentA(), agentC(), agentD()]) {
    assert.equal(summary(stdout).status, "pass", stdout);
    assert.equal(summary(stdout).counts.failedFiles, 0, stdout);
    assert.equal(summary(stdout).counts.failedTests, 0, stdout);
    assert.ok(stdout.includes("No test failures reported."), `the closing section is identical too:\n${stdout}`);
  }
  // And the control is what stops that being a statement about a runner which always says pass.
  assert.ok(summary(agentD().stdout).counts.testFiles > summary(agentA().stdout).counts.testFiles,
    "only the counts of work done separate the control from the empty run");
});

test("#2165: the line that tells the truth is on STDERR, so a `| tail` of stdout alone cannot show it at all", () => {
  // Clause 3 of the three that have to line up, and the half of it that needs no ordering argument: the report and
  // the truth go to different streams. A reader who pipes without `2>&1` is looking at the stream that says `pass`.
  for (const run_ of [agentA(), agentC()]) {
    assert.match(run_.stderr, /No test files found, exiting with code 1/, "rstest does say it plainly -- on stderr");
    assert.equal(run_.stdout.includes("No test files found"), false, `and never on stdout:\n${run_.stdout}`);
    assert.ok(run_.stdout.includes("# Rstest Test Execution Report"), "while the report that says `pass` is on stdout");
  }
});

test("#2165: and with `2>&1` the truth prints ABOVE the report, so a `| tail` still never reaches it", () => {
  // The other half, measured on the merged stream rather than on a concatenation this file chose the order of.
  // A pipe also discards the exit code -- `$?` is the tail's, and zsh needs `${pipestatus[1]}` -- so what survives on
  // screen is `## Failures` / `No test failures reported.` and nothing else.
  const stream = merged(ARGS_C, AGENT_MODE);
  const truth = stream.indexOf("No test files found, exiting with code 1");
  const report = stream.indexOf("# Rstest Test Execution Report");
  assert.ok(truth >= 0, `the merged stream carries the truth:\n${stream}`);
  assert.ok(report > truth, `and carries it ABOVE the report a tail shows:\n${stream}`);
  assert.ok(stream.slice(report).includes("No test failures reported."), "which is what the tail shows instead");
});

// --- and which reporter you get depends on WHO IS READING ------------------------------------------------------------

test("#2165: a GitHub runner gets a different reporter, which says `no tests` and no verdict word at all", () => {
  // Found by this file going red in CI while green locally, which is the only way it could have been found. The
  // agent report's `"status"` does not exist here, so a check written against the strings above would be asserting
  // that CI's runner is not an agent. The DEFECT survives the change of reporter in its own form: the empty run says
  // `no tests` and names no failure, so a reader greping for one finds nothing.
  const empty = run(ARGS_C, PLAIN_MODE);
  assert.equal(empty.stdout.includes('"status"'), false, `no agent report here:\n${empty.stdout}`);
  assert.match(empty.stdout, /Test Files\s+no tests/);
  assert.equal(/\bfailed\b/.test(empty.stdout), false, `and nothing a reader would grep for:\n${empty.stdout}`);
  // The same two controls as above, so this is a statement about the EMPTY case rather than about the reporter.
  assert.match(run(ARGS_D, PLAIN_MODE).stdout, /Test Files\s+1 passed/);
  assert.match(run(ARGS_B, PLAIN_MODE).stdout, /Test Files\s+1 failed/);
});

test("#2165: THE EXIT CODE IS THE ONE READING THAT DOES NOT DEPEND ON THE REPORTER -- 1, 1, 1, 0 under both", () => {
  // This is the whole remedy, and it is why `docs/proving-a-gate.md` §3b tells a reader to read the exit code rather
  // than the report. Asserted as a pair per form so a mode that silently stopped running would not read as agreement.
  for (const args of [ARGS_A, ARGS_B, ARGS_C]) {
    assert.notEqual(run(args, AGENT_MODE).status, 0, `agent mode, ${args.join(" ")}`);
    assert.notEqual(run(args, PLAIN_MODE).status, 0, `plain mode, ${args.join(" ")}`);
  }
  assert.equal(agentD().status, 0, "the control passes under the agent reporter");
  assert.equal(run(ARGS_D, PLAIN_MODE).status, 0, "and under the default one");
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
  assert.match(trap, /agent/i, "and it says which reporter the table was measured under");
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
