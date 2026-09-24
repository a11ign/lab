/**
 * #2199: A WHOLE-SUITE RUN MUST LEAVE A RECORD ON DISK, GREEN OR RED, AND A LATER RUN MUST NOT OVERWRITE IT.
 *
 * Measured 2026-09-23 while closing #2027: a first `npm run test:org` reported `failedFiles: 1, failedTests: 1,
 * passedTests: 5156`, four runs since were green at 5,157, and the failing test's name could not be recovered nine hours
 * later -- rstest prints the file, the test name and a repro command BELOW its summary block, into the terminal that ran
 * it, and `assert-glob-not-empty.mjs` spawns it with `stdio: "inherit"`. The runner was never silent. Nothing it said
 * was DURABLE.
 *
 * `scripts/rstest/rstest.config.mjs` now adds rstest's `json` reporter to every run. Four things are pinned here, each
 * with the control that shows the assertion can fail:
 *
 *   1. A RED run's record names the failing file AND the failing test. The control is the MUTATION: the same run
 *      through the same config with `reporters` stripped writes nothing, so a test that only read the config's shape
 *      would pass on a reporter that never wrote.
 *   2. A GREEN run writes one too -- a record kept only on failure cannot tell "green" from "never ran" (#2165).
 *   3. Two runs never share a path. The red run is written FIRST and two green runs follow it, which is the incident:
 *      last-run-wins would have left only the green one.
 *   4. The default location is already ignored by git (a scratch repo with this repo's `.gitignore`, in both shapes a
 *      checkout's `node_modules` takes), is bounded so a busy host does not fill its disk, and is not written by the
 *      many tests that spawn rstest themselves -- each would push a real record out of the bounded directory.
 *
 * Also pinned, because setting `reporters` costs it: an AGENT session keeps rstest's markdown report. rstest sets that
 * one only when the config names no reporter, so without `agentReporterFor` this change would have silently swapped
 * what every session in this org reads (`rstest-report-is-not-the-verdict.test.ts` pins that report's Summary).
 *
 * THE PROBE IS A TEMPORARY DIRECTORY, not a file under `packages/`: a fixture written into the tree would be untracked
 * for as long as the run lasts, and (4) reads `git status`. A one-line wrapper config imports the repo's OWN config and
 * points `root` and `include` at the probe, so what is measured is the reporter setting the repo ships.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative as relativePath, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { RSTEST_CONFIG } from "../../../guards/src/assert-glob-not-empty.mjs";
// #492: every npx call site resolves npm's own CLI script through this helper (`npm-cli-windows-spawn.test.ts`).
import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
/** The number of one worktree's records the config keeps. Written out, so changing it in the config is a red here. */
const RECORDS_KEPT = 50;
/** More seeded records than the bound, so the oldest ones have to go. */
const SEEDED_OVER_THE_BOUND = 10;
/** The four runs of the reporter-mode test, and the three of the survival test. */
const MODE_RUNS = 4;
const SURVIVAL_RUNS = 3;

const FAILING_FILE = "boom.test.ts";
const FAILING_TEST = "the one that failed";
const PASSING_FILE = "fine.test.ts";

const PROBE_FILES: Record<string, string> = {
  [FAILING_FILE]: `import { test } from "node:test";
import assert from "node:assert/strict";
test("${FAILING_TEST}", () => { assert.equal(1, 2); });
test("the one that passed", () => { assert.equal(1, 1); });
`,
  [PASSING_FILE]: `import { test } from "node:test";
import assert from "node:assert/strict";
test("a green test", () => { assert.equal(1, 1); });
`,
};

type Run = { status: number | null; output: string };
type RecordFile = { status: string; summary: { failedTests: number; passedTests: number };
  files: { testPath: string; status: string; results: { name: string; status: string }[] }[] };

/** A probe directory holding `files` and one wrapper config. `withReporters: false` is the mutation. */
function probe(files: string[], options: { withReporters: boolean }): { dir: string; config: string } {
  const dir = mkdtempSync(join(tmpdir(), "rstest-run-record-"));
  for (const name of files) writeFileSync(join(dir, name), PROBE_FILES[name]);
  const config = join(dir, "wrap.config.mjs");
  writeFileSync(config, `import base from ${JSON.stringify(pathToFileURL(RSTEST_CONFIG).href)};
const { reporters, ...rest } = base;
export default { ...rest, ${options.withReporters ? "reporters, " : ""}root: ${JSON.stringify(dir)}, include: ["*.test.ts"] };
`);
  return { dir, config };
}

/**
 * A real `npx rstest run` through the wrapper. The parent's agent variables are removed first, so the mode is DECLARED
 * by the caller rather than inherited (`rstest-report-is-not-the-verdict.test.ts` was caught measuring its own parent).
 * `NODE_TEST_CONTEXT` is stripped for the reason `assert-glob-not-empty.mjs` strips it.
 */
function rstest(config: string, env: Record<string, string>): Run {
  const cacheRoot = mkdtempSync(join(tmpdir(), "rstest-run-record-cache-"));
  const childEnv: NodeJS.ProcessEnv = { ...process.env, A11Y_RSTEST_CACHE_DIR: cacheRoot };
  for (const name of ["AI_AGENT", "CLAUDECODE", "CLAUDE_CODE", "RSTEST_NO_AGENT", "A11Y_RSTEST_RECORD_DIR",
    "NODE_TEST_CONTEXT"]) delete childEnv[name];
  Object.assign(childEnv, env);
  try {
    const npx = npmCliInvocation("npx", ["rstest", "run", "--config", config]);
    const result = spawnSync("sh", ["-c", `${[npx.command, ...npx.args].map((arg) => `'${arg}'`).join(" ")} 2>&1`],
      { cwd: REPO, encoding: "utf8", env: childEnv });
    return { status: result.status, output: result.stdout };
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
}

/** The record files in `dir`, oldest name first, parsed. */
function records(dir: string): { name: string; record: RecordFile }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort()
    .map((name) => ({ name, record: JSON.parse(readFileSync(join(dir, name), "utf8")) as RecordFile }));
}

/** Run `fn` with a fresh record directory and probe, and clean both up. */
function inSandbox<T>(files: string[], options: { withReporters: boolean },
  fn: (sandbox: { dir: string; config: string; recordDir: string }) => T): T {
  const { dir, config } = probe(files, options);
  const recordDir = join(dir, "records");
  try {
    return fn({ dir, config, recordDir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a FAILING run's record names the failing test file and the failing test (1)", () => {
  inSandbox([FAILING_FILE], { withReporters: true }, ({ config, recordDir }) => {
    const run = rstest(config, { A11Y_RSTEST_RECORD_DIR: recordDir });
    assert.equal(run.status, 1, `the probe is red, so the run exits 1:\n${run.output}`);
    const [only, ...rest] = records(recordDir);
    assert.ok(only && rest.length === 0, `one run leaves exactly one record, got ${records(recordDir).length}:\n${run.output}`);
    assert.equal(only.record.status, "fail");
    const file = only.record.files.find((entry) => entry.testPath === FAILING_FILE);
    assert.ok(file, `the record names ${FAILING_FILE}: ${JSON.stringify(only.record.files.map((entry) => entry.testPath))}`);
    const failed = file.results.filter((result) => result.status === "fail").map((result) => result.name);
    assert.deepEqual(failed, [FAILING_TEST], "and names the ONE test that failed, not the file alone");
  });
});

test("CONTROL for (1): the same run with the reporter removed from the config writes NO record", () => {
  inSandbox([FAILING_FILE], { withReporters: false }, ({ config, recordDir }) => {
    const run = rstest(config, { A11Y_RSTEST_RECORD_DIR: recordDir });
    assert.equal(run.status, 1, `the mutant still runs and still fails:\n${run.output}`);
    assert.deepEqual(records(recordDir), [],
      "no reporter, no record -- so the test above goes red on a config that never writes, not only on one that lies");
  });
});

test("a PASSING run writes a record too, and says it passed (2)", () => {
  inSandbox([PASSING_FILE], { withReporters: true }, ({ config, recordDir }) => {
    const run = rstest(config, { A11Y_RSTEST_RECORD_DIR: recordDir });
    assert.equal(run.status, 0, `the probe is green:\n${run.output}`);
    const [only] = records(recordDir);
    assert.ok(only, `a green run leaves a record:\n${run.output}`);
    assert.equal(only.record.status, "pass");
    assert.deepEqual([only.record.summary.failedTests, only.record.summary.passedTests], [0, 1]);
  });
});

test("a red run's record SURVIVES the green runs that follow it, because no two runs share a path (3)", () => {
  inSandbox([FAILING_FILE], { withReporters: true }, (red) => {
    inSandbox([PASSING_FILE], { withReporters: true }, (green) => {
      const shared = red.recordDir;
      assert.equal(rstest(red.config, { A11Y_RSTEST_RECORD_DIR: shared }).status, 1);
      assert.equal(rstest(green.config, { A11Y_RSTEST_RECORD_DIR: shared }).status, 0);
      assert.equal(rstest(green.config, { A11Y_RSTEST_RECORD_DIR: shared }).status, 0);
      const found = records(shared);
      assert.equal(new Set(found.map((entry) => entry.name)).size, SURVIVAL_RUNS, `three runs, three files: ${found.map((entry) => entry.name)}`);
      assert.deepEqual(found.map((entry) => entry.record.status).sort(), ["fail", "pass", "pass"],
        "the red run is still on disk after two green ones -- last-run-wins would have left only green");
    });
  });
});

/** The reporters the shipped config would give a run started with `env`, read in a fresh node process. */
function shippedReporters(env: Record<string, string>): unknown[] {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["RSTEST_WORKER_ID", "A11Y_RSTEST_RECORD_DIR", "NODE_TEST_CONTEXT"]) delete childEnv[name];
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const c = (await import(${JSON.stringify(pathToFileURL(RSTEST_CONFIG).href)})).default; console.log(JSON.stringify(c.reporters));`],
    { cwd: REPO, encoding: "utf8", env: { ...childEnv, ...env } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as unknown[];
}

const recordPath = (reporters: unknown[]): string | undefined =>
  (reporters.find((entry) => Array.isArray(entry) && entry[0] === "json") as [string, { outputPath: string }] | undefined)?.[1].outputPath;

test("a run started INSIDE an rstest worker writes no record unless told where, so nested runs cannot evict real ones (4)", () => {
  const ordinary = recordPath(shippedReporters({}));
  assert.ok(ordinary, "CONTROL: an ordinary run has a record path");
  assert.equal(recordPath(shippedReporters({ RSTEST_WORKER_ID: "1" })), undefined, "a worker's child does not");
  assert.equal(recordPath(shippedReporters({ RSTEST_WORKER_ID: "1", A11Y_RSTEST_RECORD_DIR: "/somewhere" }))?.startsWith("/somewhere"), true,
    "unless a directory is named, which is how this file's own runs are recorded");
});

test("the DEFAULT location is under node_modules/.cache, and git ignores it, symlinked or not (4)", () => {
  const outputPath = recordPath(shippedReporters({}));
  assert.ok(outputPath !== undefined && outputPath.startsWith(join(REPO, "node_modules", ".cache") + sep),
    `the default path is under node_modules/.cache: ${outputPath}`);
  // The same relative path in a scratch repo that carries THIS repo's `.gitignore`, in both shapes the checkout takes:
  // a real `node_modules` and the symlink onto the primary's that a fresh worktree gets (#1983).
  const relative = relativePath(REPO, outputPath);
  for (const shape of ["directory", "symlink"] as const) {
    const scratch = mkdtempSync(join(tmpdir(), "rstest-run-record-git-"));
    const primary = `${scratch}-primary`;
    try {
      const git = (args: string[]) => spawnSync("git", args, { cwd: scratch, encoding: "utf8", env: sandboxGitEnv() });
      assert.equal(git(["init", "-q"]).status, 0);
      writeFileSync(join(scratch, ".gitignore"), readFileSync(join(REPO, ".gitignore")));
      const modules = shape === "directory" ? join(scratch, "node_modules") : primary;
      mkdirSync(join(modules, ".cache", "rstest-run-records"), { recursive: true });
      if (shape === "symlink") symlinkSync(primary, join(scratch, "node_modules"));
      writeFileSync(join(scratch, relative), "{}");
      assert.equal(existsSync(join(scratch, relative)), true, "CONTROL: the record file exists, so an empty status means ignored");
      assert.equal(git(["status", "--porcelain"]).stdout.includes("rstest-run-records"), false, `${shape}: git sees the record`);
      writeFileSync(join(scratch, "untracked.txt"), "x");
      assert.match(git(["status", "--porcelain"]).stdout, /untracked\.txt/, "CONTROL: the same status DOES list a file that is not ignored");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      rmSync(primary, { recursive: true, force: true });
    }
  }
});

test("the directory is BOUNDED: one worktree keeps its newest records and no one else's are touched (4)", () => {
  inSandbox([PASSING_FILE], { withReporters: true }, ({ config, recordDir }) => {
    mkdirSync(recordDir, { recursive: true });
    const mine = basename(REPO);
    const seeded = Array.from({ length: RECORDS_KEPT + SEEDED_OVER_THE_BOUND }, (_, index) =>
      `${mine}-2020-01-01T00-00-${String(index).padStart(2, "0")}-000Z-1.json`);
    for (const name of [...seeded, "another-worktree-2020-01-01T00-00-00-000Z-1.json"]) writeFileSync(join(recordDir, name), "{}");
    assert.equal(rstest(config, { A11Y_RSTEST_RECORD_DIR: recordDir }).status, 0);
    const left = readdirSync(recordDir);
    assert.equal(left.filter((name) => name.startsWith(`${mine}-`)).length, RECORDS_KEPT, "this worktree's records are capped");
    assert.ok(!left.includes(seeded[0]), "and the OLDEST went first");
    assert.ok(left.includes(seeded.at(-1)!), "while the newest seeded one stayed");
    assert.ok(left.includes("another-worktree-2020-01-01T00-00-00-000Z-1.json"), "and another worktree's record is never pruned");
  });
});

test("an AGENT session still gets rstest's markdown report, and a plain one the default (setting reporters costs it)", () => {
  inSandbox([PASSING_FILE], { withReporters: true }, ({ config, recordDir }) => {
    const agent = rstest(config, { CLAUDECODE: "1", A11Y_RSTEST_RECORD_DIR: recordDir });
    assert.match(agent.output, /# Rstest Test Execution Report/, "CLAUDECODE alone -- what every session here has -- selects the report");
    const named = rstest(config, { AI_AGENT: "claude", A11Y_RSTEST_RECORD_DIR: recordDir });
    assert.match(named.output, /# Rstest Test Execution Report/, "AI_AGENT does too");
    const optedOut = rstest(config, { CLAUDECODE: "1", RSTEST_NO_AGENT: "1", A11Y_RSTEST_RECORD_DIR: recordDir });
    assert.doesNotMatch(optedOut.output, /# Rstest Test Execution Report/, "RSTEST_NO_AGENT=1 switches it off, as rstest does");
    const plain = rstest(config, { A11Y_RSTEST_RECORD_DIR: recordDir });
    assert.doesNotMatch(plain.output, /# Rstest Test Execution Report/, "no agent variable, the default reporter -- the CI shape");
    assert.equal(records(recordDir).length, MODE_RUNS, "and every one of the four wrote its record beside whichever report it printed");
  });
});
