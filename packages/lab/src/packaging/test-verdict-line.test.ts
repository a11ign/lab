// no-token: gh -- nothing here reaches `gh`: every run is a local `npx rstest` over a probe directory in the OS temp root
/**
 * #2541: AN AGENT SESSION'S RSTEST REPORT ENDS IN A LINE THAT NAMES WHAT RAN, AND REFUSES ZERO.
 *
 * Measured 2026-09-25: `npx rstest run --config scripts/rstest/rstest.config.mjs --include 'nothing-*.test.ts'` exits 1
 * and its markdown report says `"status": "pass"` over `"tests": 0`. `assert-glob-not-empty.mjs` refuses an empty glob
 * before the runner starts, but the direct form every Acceptance and every hand run uses does not go through it, so a
 * session read "pass" where nothing ran (#2165's false "the mutant survived"). `scripts/rstest/verdict-reporter.mjs` is
 * the last reporter, and this file pins what it and the config around it promise:
 *
 *   1. THE POSITIVE CONTROL. A run that matches no test prints `VERDICT REFUSED: 0 tests run`, and a run that matches one
 *      prints `VERDICT pass: 1 test in 1 file`. Both are REAL rstest runs through the shipped config -- a fixture that
 *      minted the report by hand would test the string -- and the two last lines differ in exactly that way. A run of
 *      nothing but skipped tests is refused as well: skipped is not run.
 *   2. THE VERDICT IS THE LAST LINE, after the report and after the json reporter's "JSON report written to".
 *   3. A FAILING RUN carries the failing test and its message and NOT the passing test, and no code frame; the verdict line
 *      names the flag that gives the full report back, and that flag does.
 *   4. CI IS NOT TRIMMED. Under `CI=true` the report is what it was before this row -- the same text the full-report flag
 *      gives, code frame included -- and the `json` run record is written on every run either way
 *      (`rstest-run-record-on-disk.test.ts`). A plain run (no agent variable) prints no verdict line at all.
 *
 * THE MODE IS DECLARED, never inherited: every agent variable of the parent is removed first
 * (`rstest-run-record-on-disk.test.ts` was caught measuring its own parent), and the probe is a temporary directory so
 * nothing is written into the tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RSTEST_CONFIG } from "../../../guards/src/assert-glob-not-empty.mjs";
import { verdictLine } from "../../../../scripts/rstest/verdict-reporter.mjs";
// #492: every npx call site resolves npm's own CLI script through this helper (`npm-cli-windows-spawn.test.ts`).
import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

const FAILING_NAME = "the one that failed";
const PASSING_NAME = "the one that passed";
const FAILING_MESSAGE = "Expected values to be strictly equal";

const PROBE_FILES: Record<string, string> = {
  "boom.test.ts": `import { test } from "node:test";
import assert from "node:assert/strict";
test("${FAILING_NAME}", () => { assert.equal(1, 2); });
test("${PASSING_NAME}", () => { assert.equal(1, 1); });
`,
  "fine.test.ts": `import { test } from "node:test";
import assert from "node:assert/strict";
test("a green test", () => { assert.equal(1, 1); });
`,
  "skipped.test.ts": `import { test } from "node:test";
test("a skipped test", { skip: true }, () => {});
`,
};

/** The include each probe run uses, read by the wrapper config from the environment. */
const NOTHING = "no-such-file-*.test.ts";

/** EVERY variable the shipped config's `agentReporterFor` reads, so a run's mode is the caller's and not the parent's. */
const AGENT_ENV = ["AI_AGENT", "CLAUDECODE", "CLAUDE_CODE", "REPL_ID", "GEMINI_CLI", "CODEX_SANDBOX", "CODEX_THREAD_ID",
  "OPENCODE", "AUGMENT_AGENT", "GOOSE_PROVIDER", "JUNIE_DATA", "JUNIE_SHIM_PATH", "CURSOR_AGENT"];
const AGENT = { AI_AGENT: "claude" };

type Probe = { dir: string; config: string; recordDir: string };
type Run = { status: number | null; output: string; lines: string[]; records: number };

/** A probe directory with every fixture and one wrapper config that imports the SHIPPED config and re-roots it. */
function makeProbe(): Probe {
  const dir = mkdtempSync(join(tmpdir(), "test-verdict-line-"));
  for (const [name, source] of Object.entries(PROBE_FILES)) writeFileSync(join(dir, name), source);
  const config = join(dir, "wrap.config.mjs");
  writeFileSync(config, `import base from ${JSON.stringify(pathToFileURL(RSTEST_CONFIG).href)};
export default { ...base, root: ${JSON.stringify(dir)}, include: [process.env.PROBE_INCLUDE] };
`);
  return { dir, config, recordDir: join(dir, "records") };
}

/** A real `npx rstest run` over `include`, `2>&1` into one stream, in the mode `env` declares. */
function rstest(probe: Probe, include: string, env: Record<string, string>): Run {
  const cacheRoot = mkdtempSync(join(tmpdir(), "test-verdict-line-cache-"));
  const childEnv: NodeJS.ProcessEnv = { ...process.env, A11Y_RSTEST_CACHE_DIR: cacheRoot, A11Y_RSTEST_RECORD_DIR: probe.recordDir,
    PROBE_INCLUDE: include };
  for (const name of [...AGENT_ENV, "RSTEST_NO_AGENT", "CI", "A11Y_RSTEST_FULL_REPORT", "NODE_TEST_CONTEXT"]) delete childEnv[name];
  Object.assign(childEnv, env);
  try {
    const npx = npmCliInvocation("npx", ["rstest", "run", "--config", probe.config]);
    const command = [npx.command, ...npx.args].map((arg) => `'${arg}'`).join(" ");
    const result = spawnSync("sh", ["-c", `${command} 2>&1`], { cwd: REPO, encoding: "utf8", env: childEnv });
    const output = result.stdout;
    const records = existsSync(probe.recordDir) ? readdirSync(probe.recordDir).filter((name) => name.endsWith(".json")).length : 0;
    return { status: result.status, output, lines: output.split("\n").filter((line) => line.trim() !== ""), records };
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
}

/** Run `fn` with a fresh probe and remove it afterwards. */
function withProbe<T>(fn: (probe: Probe) => T): T {
  const probe = makeProbe();
  try {
    return fn(probe);
  } finally {
    rmSync(probe.dir, { recursive: true, force: true });
  }
}

const last = (run: Run): string => run.lines.at(-1) ?? "";
/** The line before the last: the json reporter's, when the verdict is the last. */
const beforeLast = (run: Run): string | undefined => run.lines.at(run.lines.length - 2);
/** How many runs share the probe's record directory in the CI test, and how many tests the multi-file verdict counts. */
const SHARED_RUNS = 3;
const THREE_TESTS = 3;

test("POSITIVE CONTROL: a run that matches no test is REFUSED, and a run that matches one passes (1)", () => {
  withProbe((probe) => {
    const none = rstest(probe, NOTHING, AGENT);
    const one = rstest(probe, "fine.test.ts", AGENT);
    assert.equal(one.status, 0, `CONTROL: the one-test run is green:\n${one.output}`);
    assert.match(last(one), /^VERDICT pass: 1 test in 1 file\b/, `a run that ran one test says so:\n${one.output}`);
    assert.match(last(none), /^VERDICT REFUSED: 0 tests run\b/, `a run that ran none refuses:\n${none.output}`);
    assert.doesNotMatch(none.output, /VERDICT pass/, "and NEVER prints a pass, whatever the JSON body above it says");
    assert.match(none.output, /"status": "pass"/, "CONTROL: the body above STILL says pass over zero tests -- rstest's lie, which this line outranks");
    assert.notEqual(last(none).split(":")[0], last(one).split(":")[0], "the two verdicts differ in kind, not only in the count");
  });
});

test("a run of nothing but skipped tests is refused too: skipped is not run (1)", () => {
  withProbe((probe) => {
    const skipped = rstest(probe, "skipped.test.ts", AGENT);
    assert.match(last(skipped), /^VERDICT REFUSED: 0 tests run \(1 skipped\)/, skipped.output);
  });
});

test("the verdict is the LAST line of the report, after the json reporter's own (2)", () => {
  withProbe((probe) => {
    const red = rstest(probe, "boom.test.ts", AGENT);
    assert.match(last(red), /^VERDICT fail: 1 of 2 tests failed in 1 file\b/, red.output);
    assert.ok(beforeLast(red)?.startsWith("JSON report written to:"),
      `the line before the verdict is the record's, so nothing follows the verdict:\n${red.lines.slice(-SHARED_RUNS).join("\n")}`);
    assert.equal(red.lines.filter((line) => line.startsWith("VERDICT")).length, 1, "and there is exactly one");
  });
});

test("a FAILING run carries the failing test and its message, not the passing one, and names the flag (3)", () => {
  withProbe((probe) => {
    const red = rstest(probe, "boom.test.ts", AGENT);
    assert.equal(red.status, 1, red.output);
    assert.ok(red.output.includes(FAILING_NAME), `the failing test is named:\n${red.output}`);
    assert.ok(red.output.includes(FAILING_MESSAGE), "with its message");
    assert.ok(!red.output.includes(PASSING_NAME), "and the test that passed beside it is not");
    assert.doesNotMatch(red.output, /codeFrame/, "no code frame: the session's context does not pay for it");
    assert.ok(last(red).endsWith("-- full report: A11Y_RSTEST_FULL_REPORT=1"), `the last line says which flag gives the rest:\n${last(red)}`);
    const full = rstest(probe, "boom.test.ts", { ...AGENT, A11Y_RSTEST_FULL_REPORT: "1" });
    assert.match(full.output, /codeFrame/, "CONTROL: the flag it names DOES give the code frame back");
    assert.doesNotMatch(last(full), /full report/, "and a report that is already whole has no flag to name");
    assert.match(last(full), /^VERDICT fail: 1 of 2 tests failed/, "yet still ends in the verdict");
  });
});

/** The text of a run with what differs between two runs of one probe replaced: the timestamp, the timings, the paths. */
function stable(run: Run, probe: Probe): string {
  return run.output.replaceAll(probe.recordDir, "<records>").replaceAll(/<records>\/\S+\.json/g, "<record>")
    .replaceAll(/"timestamp": ?"[^"]*"|timestamp: "[^"]*"/g, "timestamp").replaceAll(/"(total|build|tests|duration)": \d+/g, '"$1": 0');
}

test("CI is NOT trimmed: the report is the full one, and the record is written on every run (4)", () => {
  withProbe((probe) => {
    const ci = rstest(probe, "boom.test.ts", { ...AGENT, CI: "true" });
    const full = rstest(probe, "boom.test.ts", { ...AGENT, A11Y_RSTEST_FULL_REPORT: "1" });
    const trimmed = rstest(probe, "boom.test.ts", AGENT);
    assert.match(ci.output, /codeFrame/, `CI keeps the code frame:\n${ci.output}`);
    assert.equal(stable(ci, probe), stable(full, probe), "and CI's report is the same text as the full report, whole");
    assert.notEqual(stable(trimmed, probe), stable(full, probe), "CONTROL: the trimmed report is NOT the same text, so the comparison can fail");
    assert.equal(ci.records, 1, "CI's run wrote its json record");
    assert.equal(trimmed.records, SHARED_RUNS, "and so did each of the two after it: one file per run in the shared directory, none overwritten");
  });
});

test("a plain run -- no agent variable -- prints no verdict line and still records (4)", () => {
  withProbe((probe) => {
    const plain = rstest(probe, "fine.test.ts", {});
    assert.equal(plain.status, 0, plain.output);
    assert.doesNotMatch(plain.output, /VERDICT/, "the default reporter is rstest's own, untouched");
    assert.equal(plain.records, 1, "and the run record is still written");
  });
});

/** The reporter kinds the shipped config lists for a run started with `env`, read in a fresh node process. */
function shippedReporterKinds(env: Record<string, string>): string[] {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [...AGENT_ENV, "RSTEST_NO_AGENT", "CI", "A11Y_RSTEST_FULL_REPORT", "NODE_TEST_CONTEXT"]) delete childEnv[name];
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const c = (await import(${JSON.stringify(pathToFileURL(RSTEST_CONFIG).href)})).default;
console.log(JSON.stringify(c.reporters.map((r) => Array.isArray(r) ? r[0] : typeof r === "string" ? r : "verdict")));`],
    { cwd: REPO, encoding: "utf8", env: { ...childEnv, A11Y_RSTEST_RECORD_DIR: mkdtempSync(join(tmpdir(), "test-verdict-line-rec-")), ...env } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as string[];
}

test("the verdict reporter is LAST for an agent, and absent otherwise, wherever a run is started (1, 2)", () => {
  assert.deepEqual(shippedReporterKinds(AGENT), ["md", "json", "verdict"]);
  assert.deepEqual(shippedReporterKinds({ ...AGENT, RSTEST_WORKER_ID: "1" }).at(-1), "verdict", "a nested run keeps it, without the record it does not write");
  assert.deepEqual(shippedReporterKinds({}), ["default", "json"], "CONTROL: a plain run has none");
});

test("verdictLine reads a run the way the report does not (1)", () => {
  const pass = (count: number) => Array.from({ length: count }, () => ({ status: "pass" }));
  const file = (status: string) => ({ status });
  assert.equal(verdictLine({ results: [file("pass"), file("pass")], testResults: pass(THREE_TESTS) }), "VERDICT pass: 3 tests in 2 files");
  assert.equal(verdictLine({ results: [], testResults: [] }), "VERDICT REFUSED: 0 tests run");
  assert.equal(verdictLine({ results: [file("skip")], testResults: [{ status: "skip" }, { status: "todo" }] }),
    "VERDICT REFUSED: 0 tests run (2 skipped)");
  assert.equal(verdictLine({ results: [file("fail")], testResults: [{ status: "fail" }, { status: "pass" }] }),
    "VERDICT fail: 1 of 2 tests failed in 1 file");
  assert.equal(verdictLine({ results: [file("fail")], testResults: [] }), "VERDICT fail: 0 of 0 tests failed in 1 file, 1 file failed",
    "a file that failed to load has no failing test, and is still not a pass and not a refusal for emptiness");
  assert.equal(verdictLine({ results: [file("pass")], testResults: pass(1), unhandledErrors: [new Error("x")] }),
    "VERDICT fail: 0 of 1 test failed in 1 file, 1 unhandled error", "an error outside any test fails the run");
});

const MUTATE = join(REPO, "packages/guards/src/mutation-check.mjs");

/**
 * `mutation-check.mjs` over a probe, its `--test` a REAL rstest run through the wrapper config. The mutation flips the
 * assertion in `fine.test.ts`, the file it is asked to mutate, so a bite is a real red naming a real test.
 */
function mutate(probe: Probe, include: string, mutation: string): { status: number | null; output: string } {
  const npx = npmCliInvocation("npx", ["rstest", "run", "--config", probe.config]);
  const test = [npx.command, ...npx.args].map((arg) => `'${arg}'`).join(" ");
  const env: NodeJS.ProcessEnv = { ...process.env, ...AGENT, A11Y_RSTEST_RECORD_DIR: probe.recordDir, PROBE_INCLUDE: include,
    A11Y_RSTEST_CACHE_DIR: join(probe.dir, "cache") };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [MUTATE, `--file=${join(probe.dir, "fine.test.ts")}`,
    `--mutate=${mutation}`, `--test=${test}`], { cwd: REPO, encoding: "utf8", env });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("mutate names the count the clean run ran and the test that failed under the mutant (5)", () => {
  withProbe((probe) => {
    const flip = `perl -pi -e 's/assert.equal\\(1, 1\\)/assert.equal(1, 2)/' ${join(probe.dir, "fine.test.ts")}`;
    const bit = mutate(probe, "fine.test.ts", flip);
    assert.equal(bit.status, 0, bit.output);
    assert.match(bit.output, /clean: {4}test PASSES \(VERDICT pass: 1 test in 1 file\)/, "the clean line says how many tests it ran");
    assert.match(bit.output, /VERDICT fail: 1 of 1 test failed in 1 file/, "the mutated line names what ran");
    assert.match(bit.output, /failed: fine\.test\.ts :: a green test/, "and which test caught the mutant");
    assert.match(bit.output.trim().split("\n").at(-1) ?? "", /^THE GUARD BITES\.$/, "the last line is the sentence the callers read, unchanged");
  });
});

test("mutate REFUSES a clean run that ran zero tests instead of calling every mutant a survivor (5)", () => {
  withProbe((probe) => {
    const flip = `perl -pi -e 's/assert.equal\\(1, 1\\)/assert.equal(1, 2)/' ${join(probe.dir, "fine.test.ts")}`;
    const refused = mutate(probe, "skipped.test.ts", flip);
    assert.equal(refused.status, 2, `refused before touching the file:\n${refused.output}`);
    assert.match(refused.output, /RAN NOTHING \(VERDICT REFUSED: 0 tests run \(1 skipped\)\)/);
    assert.doesNotMatch(refused.output, /THE GUARD/, "and reaches no verdict about the guard");
  });
});
