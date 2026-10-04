// no-token: gh -- reads the tree, scripts/verify.mjs and the rstest config and calls pure functions; one test spawns rstest and no `gh` or network is reached
/**
 * #3572: LOCAL `pnpm run verify` RUNS THE MODULE-GRAPH-AFFECTED SET, AND SAYS SO.
 *
 * `rstest run --changed=<base>` runs the test files whose module graph reaches a changed file. That is a SUBSET, so what the
 * stamp claims must be "the affected set passed at this head" and never "the suite passed" (#3215's misreading), and what the
 * subset cannot see must widen it: `forceRerunTriggers` in `scripts/rstest/rstest.config.mjs`.
 *
 * WHAT IS DERIVED AND WHAT IS TYPED. The config's trigger list is typed once. The population it must cover is DERIVED here from
 * the tree: every non-source file and every data directory that a non-tree-wide test names in a string literal, outside the
 * test's own import closure. A test added tomorrow that reads a new file fails `every path a test reads is a trigger` until
 * the config names it, so this file is the list's maintainer.
 *
 * KNOWN RESIDUALS, named so nobody reads them as covered: (1) a test that reads a `.ts`/`.mjs` file BY PATH, as text or by
 * spawning it, is not in the population (206 targets at `040c643ba`, mostly sources: widening on them would be the whole suite on
 * any code change), so a change to such a file does not select that test locally; (2) a test that builds a path with `join`
 * from parts names no literal. CI stays the authority for both, and the rule for widening is the next row's (c).
 *
 * POSITIVE CONTROLS, named where each absence is asserted: the derived population is non-empty and holds a known directory and
 * a known file (1); the real include matches at least the floor (2); the zero-file verdict is shown on BOTH sides, a diff that
 * reaches no test (passes) and an include that matches nothing (REFUSED), from the same exit code and the same record (3); and a
 * trigger list with one directory, or one file, removed is RED (1).
 *
 * This file's population is the whole tracked tree, declared by a call so `guards:sweep` runs it in CI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { declareTreeWideGuard } from "../../../guards/src/tree-wide-guard.mjs";
import { treeWideGuardFiles } from "../../../guards/src/tree-wide-guards.mjs";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";
import { underFloor } from "../../../guards/src/assert-glob-not-empty.mjs";
import { knownPackages } from "../../../../scripts/ci-changed.mjs";
import { packageIndex, sourceClosure } from "../../../../scripts/select-changed-tests.mjs";
import { pnpmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";
import {
  AFFECTED_INCLUDE, AFFECTED_MIN_FILES, CI_ONLY, STEPS, affectedVerdict, jobsGateNeeds, readRunSummary, runAffectedSet, runTs,
  stampWording, unaccountedJobs,
} from "../../../../scripts/verify.mjs";

declareTreeWideGuard();

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const SOURCE = /\.(ts|mjs|cjs|js|tsx)$/;
const SELF = "packages/lab/src/packaging/verify-affected-set.test.ts";

const DIRECTORY_TAIL = "/**";
const GIT_LS_FILES_BUFFER = 2 ** 26;

/** The config's trigger list, from the file on disk: the specifier is computed so rstest does not bundle its own config. */
async function configTriggers(): Promise<string[]> {
  const href = new URL("../../../../scripts/rstest/rstest.config.mjs", import.meta.url).href;
  return (await import(/* webpackIgnore: true */ href)).default.forceRerunTriggers ?? [];
}

/**
 * Does any pattern cover `path`? `matchesGlob` is minimatch's, and rstest's `picomatch` differs in one respect that matters
 * here: `dir/**` also matches `dir` itself, so that is added. Every file of a directory is asked about, never the directory.
 */
function covers(patterns: readonly string[], path: string): boolean {
  const withoutTail = (pattern: string) => pattern.slice(0, -DIRECTORY_TAIL.length);
  return patterns.some((pattern) => matchesGlob(path, pattern)
    || (pattern.endsWith(DIRECTORY_TAIL) && matchesGlob(path, withoutTail(pattern))));
}

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", env: sandboxGitEnv(), maxBuffer: GIT_LS_FILES_BUFFER })
  .split("\n").filter(Boolean);
const trackedSet = new Set(tracked);
const directories = new Set(tracked.flatMap((file) => {
  const parents: string[] = [];
  for (let dir = dirname(file); dir !== "."; dir = dirname(dir)) parents.push(dir);
  return parents;
}));
const hasSourceUnder = (dir: string) => tracked.some((file) => file.startsWith(`${dir}/`) && SOURCE.test(file));

const literalsOf = (source: string) => [...source.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
  .map((match) => match[1] ?? match[2] ?? match[3] ?? "");

/** The tracked paths a literal names, as written from the repo root or relative to the test that holds it. */
function namedPaths(literal: string, testFile: string): string[] {
  if (literal.length < 3 || literal.includes("\n")) return [];
  const candidates = [literal.replace(/^\.\//, ""), ...(/^\.\.?\//.test(literal) ? [normalize(join(dirname(testFile), literal))] : [])];
  return candidates.map((path) => path.replace(/\/$/, "")).filter((path) => trackedSet.has(path) || (directories.has(path) && path.includes("/")));
}

/** The by-path targets one test names that its own import closure does not contain. */
function targetsOf(testFile: string, packages: ReturnType<typeof packageIndex>): string[] {
  const closure = new Set([...sourceClosure(join(ROOT, testFile), ROOT, packages)].map((path) => relative(ROOT, path)));
  const named = literalsOf(stripComments(read(testFile))).flatMap((literal) => namedPaths(literal, testFile));
  const isTarget = (path: string) => (trackedSet.has(path) ? !SOURCE.test(path) : !hasSourceUnder(path));
  return [...new Set(named)].filter((path) => isTarget(path) && !closure.has(path) && path !== testFile);
}

/**
 * The population: target -> the non-tree-wide tests that name it, where a target is a tracked NON-SOURCE file or a data
 * directory (no source file under it) that the test's import closure does not contain. A directory holding source is a path
 * being assembled, not a fixture being read, so it is not a target.
 */
function readsByPath(): Map<string, string[]> {
  const treeWide = new Set(treeWideGuardFiles());
  const tests = tracked.filter((file) => /^packages\/[^/]+\/src\/.*\.test\.ts$/.test(file) && !treeWide.has(file) && file !== SELF);
  const packages = packageIndex(ROOT, knownPackages(ROOT));
  const reads = new Map<string, string[]>();
  for (const testFile of tests) {
    for (const path of targetsOf(testFile, packages)) reads.set(path, [...(reads.get(path) ?? []), testFile]);
  }
  return reads;
}

/**
 * The files of the population that no pattern covers; a directory target is covered when every tracked file under it is.
 * A DOTFILE UNDER A DIRECTORY IS NOT ASKED ABOUT: `dir/**` does not match `dir/.gitignore` in picomatch or minimatch (`dot: false`),
 * so no pattern could cover it, and a test reading a directory means its content and not its ignore file.
 */
function uncovered(patterns: readonly string[], reads: Map<string, string[]>): string[] {
  const under = (target: string) => tracked.filter((file) => file.startsWith(`${target}/`) && !/(^|\/)\./.test(file.slice(target.length + 1)));
  const files = [...reads.keys()].flatMap((target) => (trackedSet.has(target) ? [target] : under(target)));
  return [...new Set(files)].filter((file) => !covers(patterns, file)).sort();
}

const READS = readsByPath();
const TSCONFIG_FLOOR = 3;
/** The derived population was 263 targets at `040c643ba`; half of that is a floor a broken walk cannot reach. */
const POPULATION_FLOOR = 100;

// 1. EVERY INPUT THE GRAPH CANNOT SEE IS A TRIGGER, AND THE BY-PATH HALF IS DERIVED.
test("the derived population holds a known data directory and a known doc file (the positive control)", () => {
  assert.ok(READS.size > POPULATION_FLOOR, `only ${READS.size} by-path targets were derived, so every coverage assertion below could pass on nothing`);
  const filesUnder = (dir: string) => tracked.filter((file) => file.startsWith(`${dir}/`));
  const covered = [...READS.keys()].flatMap((target) => (trackedSet.has(target) ? [target] : filesUnder(target)));
  assert.ok(covered.some((file) => file.startsWith("packages/control/ansible/")), "no ansible file is in the population");
  assert.ok(covered.includes("CONTRIBUTING.md"), "CONTRIBUTING.md, which verify-matches-ci.test.ts reads, is not in the population");
});

test("every path a non-tree-wide test reads by name is covered by a forceRerunTriggers entry", async () => {
  assert.deepEqual(uncovered(await configTriggers(), READS), [],
    "each path above is read by a test whose module graph cannot see it: add a pattern to scripts/rstest/rstest.config.mjs");
});

test("control: the trigger list with one directory removed is RED, and so is one with one file removed", async () => {
  const triggers = await configTriggers();
  const withoutDirectory = triggers.filter((pattern) => pattern !== "packages/control/ansible/**");
  assert.notEqual(withoutDirectory.length, triggers.length, "the directory pattern is not in the config, so the control removed nothing");
  assert.ok(uncovered(withoutDirectory, READS).some((file) => file.startsWith("packages/control/ansible/")));
  const withoutFile = triggers.filter((pattern) => pattern !== "CONTRIBUTING.md");
  assert.notEqual(withoutFile.length, triggers.length, "CONTRIBUTING.md is not a pattern of its own in the config");
  assert.deepEqual(uncovered(withoutFile, READS), ["CONTRIBUTING.md"]);
});

test("the lockfile, every tsconfig and .npmrc, and rstest's default patterns are triggers", async () => {
  const triggers = await configTriggers();
  const configs = tracked.filter((file) => /(^|\/)tsconfig[^/]*\.json$/.test(file));
  assert.ok(configs.length > TSCONFIG_FLOOR, "the tree has fewer tsconfig files than it has packages, so the walk is wrong");
  for (const file of [...configs, "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "packages/lab/.npmrc", "tsconfig.base.json"]) {
    assert.ok(trackedSet.has(file), `${file} is not tracked, so asking whether it triggers proves nothing`);
    assert.ok(covers(triggers, file), `${file} changes what every test sees and is no trigger`);
  }
  assert.ok(triggers.includes("**/package.json/**") && triggers.includes("**/rstest.config.*"),
    "naming forceRerunTriggers replaces rstest's default, so the two default patterns must be repeated");
});

/** The relative files `file` imports by an import statement at the start of a line, transitively; prose that says "import" is not one. */
function relativeImportClosure(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const [, spec] of read(file).matchAll(/^import\s+(?:[^;'"]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gm)) {
    relativeImportClosure(normalize(join(dirname(file), spec)), seen);
  }
  return seen;
}

test("the rstest config, what it loads and what every worker preloads are triggers, none of them in any test's graph", async () => {
  const triggers = await configTriggers();
  const entries = ["scripts/rstest/rstest.config.mjs", "scripts/rstest/register-node-test-alias.mjs", "packages/guards/src/walk-scope.mjs"];
  const loaded = [...new Set(entries.flatMap((entry) => [...relativeImportClosure(entry)]))];
  assert.ok(loaded.includes("scripts/rstest/verdict-reporter.mjs") && loaded.includes("packages/guards/src/walk-scope-declaration.mjs"),
    `the walk found ${loaded.join(", ")}, so it did not follow the config's and the preload's own imports`);
  assert.deepEqual(loaded.filter((file) => !covers(triggers, file)), []);
});

// 2. THE FLOOR UNDER THE `--changed` RUN.
test("the affected run's include matches at least its floor in the real tree (the positive control for the refusal below)", () => {
  assert.deepEqual(underFloor([AFFECTED_INCLUDE], AFFECTED_MIN_FILES), []);
  assert.ok(globSync(AFFECTED_INCLUDE, { cwd: ROOT }).length >= AFFECTED_MIN_FILES);
});

// 3. A DIFF NO TEST REACHES IS NOT A BROKEN INCLUDE, AND THE TWO MUST BE TOLD APART.
const NOTHING = { testFiles: 0, tests: 0, failedFiles: 0, failedTests: 0 };

test("an affected set of zero files reads as 'no test reaches this diff' and passes", () => {
  const verdict = affectedVerdict({ short: [], exit: 0, summary: NOTHING, base: "origin/main" });
  assert.equal(verdict.status, "pass");
  assert.match(verdict.line, /no test reaches this diff/);
});

test("a run that matches zero files because its include is wrong stays REFUSED, from the same exit code and the same record", () => {
  const short = underFloor(["nothing-here/**/*.test.ts"], AFFECTED_MIN_FILES);
  assert.equal(short.length, 1, "the wrong include matched enough files, so the control is not a wrong include");
  const verdict = affectedVerdict({ short, exit: 0, summary: NOTHING, base: "origin/main" });
  assert.equal(verdict.status, "fail");
  assert.match(verdict.line, /REFUSED/);
});

test("a run with no record, a non-zero exit, or a failed test is not a pass", () => {
  const ran = { ...NOTHING, testFiles: 3, tests: 9 };
  assert.equal(affectedVerdict({ short: [], exit: 0, summary: ran, base: "b" }).status, "pass", "the positive control: a clean run passes");
  assert.equal(affectedVerdict({ short: [], exit: 0, summary: null, base: "b" }).status, "fail");
  assert.equal(affectedVerdict({ short: [], exit: 1, summary: ran, base: "b" }).status, "fail");
  assert.equal(affectedVerdict({ short: [], exit: null, summary: ran, base: "b" }).status, "fail");
  assert.equal(affectedVerdict({ short: [], exit: 0, summary: { ...ran, failedTests: 1 }, base: "b" }).status, "fail");
});

// THE PREMISE OF THE FLOOR, MEASURED ON THE REAL RSTEST: a broken include under `--changed` exits 0 with no files.
test("rstest itself exits 0 with zero files for a broken include under --changed, which is why the floor is separate", () => {
  const dir = mkdtempSync(join(tmpdir(), "affected-premise-"));
  try {
    const { command, args } = pnpmCliInvocation(["exec", "rstest", "run", "--config", "scripts/rstest/rstest.config.mjs",
      "--include", "nothing-here/**/*.test.ts", "--changed=HEAD~1"]);
    const env = { ...sandboxGitEnv({ A11Y_RSTEST_RECORD_DIR: dir }) } as Record<string, string | undefined>;
    delete env.RSTEST_WORKER_ID;
    execFileSync(command, args, { cwd: ROOT, env: env as NodeJS.ProcessEnv, stdio: "pipe" });
    assert.equal(readdirSync(dir).length, 1, "rstest left no run record, so the reading below is of nothing");
    assert.deepEqual(readRunSummary(dir)?.testFiles, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 4. THE `ts` STEP'S TEST COMMAND IS THE `--changed` RUN.
const fakeRun = (seen: string[], status: number | null = 0) => async (command: string, args: string[]) => {
  seen.push([command, ...args].join(" "));
  return { status };
};

test("the ts step's test command is `rstest run --changed=<base>` over the shared include, and not test-changed.mjs", async () => {
  const seen: string[] = [];
  const reaches = () => ({ testFiles: 2, tests: 5, failedFiles: 0, failedTests: 0 });
  assert.equal(await runTs({ base: "origin/main" }, fakeRun(seen), reaches), "pass");
  const last = seen.at(-1) ?? "";
  assert.match(last, / rstest run --config scripts\/rstest\/rstest\.config\.mjs --include packages\/\*\/src\/\*\*\/\*\.test\.ts --changed=origin\/main$/);
  assert.ok(last.includes(`--include ${AFFECTED_INCLUDE} `), "the include is not the constant the floor checks");
  assert.ok(!seen.some((command) => command.includes("test-changed")), "test-changed.mjs is still run");
});

test("runAffectedSet passes a diff that reaches no test, and fails when the run left no record", async () => {
  const seen: string[] = [];
  assert.deepEqual(await runAffectedSet({ base: "origin/main" }, fakeRun(seen), () => NOTHING), { status: 0 });
  assert.equal(seen.length, 1, "the positive control: the run was started");
  assert.deepEqual(await runAffectedSet({ base: "origin/main" }, fakeRun(seen), () => null), { status: 1 });
  assert.deepEqual(await runAffectedSet({ base: "origin/main" }, fakeRun(seen, 1), () => NOTHING), { status: 1 });
});

test("--base and A11Y_TEST_BASE are both still honoured: each names its ref in the diff verify takes", () => {
  const verify = (args: string[], env: Record<string, string>) => {
    try {
      execFileSync("node", ["scripts/verify.mjs", ...args], { cwd: ROOT, env: sandboxGitEnv(env), stdio: "pipe", encoding: "utf8" });
      return "";
    } catch (cause) {
      return String((cause as { stderr?: string }).stderr ?? "");
    }
  };
  assert.match(verify(["--base=no-such-ref-flag"], {}), /no-such-ref-flag\.\.\.HEAD/);
  assert.match(verify([], { A11Y_TEST_BASE: "no-such-ref-env" }), /no-such-ref-env\.\.\.HEAD/);
});

// 5. THE TREE-WIDE POPULATION LEAVES LOCAL VERIFY, WITH ITS REASON.
test("guardSweep is CI-only with a reason, is no longer a verify step, and every job gate needs is still accounted for", () => {
  assert.ok(typeof CI_ONLY.guardSweep === "string" && CI_ONLY.guardSweep.trim() !== "", "guardSweep has no reason in CI_ONLY");
  assert.ok(!STEPS.some((step: { id: string }) => step.id === "guardSweep"), "guardSweep is still a step of verify");
  assert.ok(jobsGateNeeds(read(".github/workflows/ci.yml")).includes("guardSweep"), "gate no longer needs guardSweep, so CI_ONLY names a ghost");
  assert.deepEqual(unaccountedJobs(jobsGateNeeds(read(".github/workflows/ci.yml"))), []);
});

// 6. THE STAMP'S WORDING.
test("the stamp says the affected set passed, names the base, and never says the suite passed", () => {
  const wording = stampWording("origin/main");
  assert.match(wording, /affected set/);
  assert.match(wording, /origin\/main/);
  assert.doesNotMatch(wording, /suite passed/);
  assert.match(stampWording("release/x"), /release\/x/, "the base is not read from the argument");
});

test("verify prints the wording in its GREEN line, and CONTRIBUTING.md and the engineer brief say it in the same words", () => {
  assert.match(read("scripts/verify.mjs"), /GREEN for this head and body -- \$\{stampWording\(base\)\}/);
  for (const file of ["CONTRIBUTING.md", ".agent-org/roles/engineer.md"]) {
    assert.match(read(file), /the affected set passed at this head/, `${file} does not carry the stamp's sentence`);
    assert.match(read(file), /a partial local run is not "passing"/, `${file} dropped the sentence verify-matches-ci.test.ts pins`);
  }
});
