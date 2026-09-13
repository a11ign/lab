/**
 * #1319, STEP 3 OF THE RSTEST ADOPTION (#1317): CI's `ts` job and trunk's unscoped step run rstest, not `tsx --test`.
 *
 * Both jobs run through `reusable-build-test.yml`. Its scoped step ran `npx tsx --test` on the files
 * `select-changed-tests.mjs` picked, and its unscoped step runs `npm run test:ts`, which reaches the runner through
 * `assert-glob-not-empty.mjs --run`. So the switch lives in those files, and this one pins it with comments stripped,
 * because a runner named only in a comment runs nothing.
 *
 * The floor `assert-glob-not-empty.mjs` exists for (#355) must still hold under the new runner: a glob or a selected
 * path that matches nothing is refused before any runner starts.
 *
 * The chairman's cache requirement (ceo on #1319, comment 5654249176, ruled at 22:2xZ): rstest's build cache is
 * switched on in CI, persisted by `actions/cache`, its HIT or MISS is printed, and an empty cache after a run FAILS the
 * job, so the cache's non-emptiness is an assertion rather than a hope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { RSTEST_CONFIG, runnerInvocation } from "../../../../scripts/assert-glob-not-empty.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const FLOOR = fileURLToPath(new URL("../../../../scripts/assert-glob-not-empty.mjs", import.meta.url));
const CONFIG_URL = new URL("../../../../scripts/rstest/rstest.config.mjs", import.meta.url).href;
const SCRIPTS = (JSON.parse(readFileSync(`${REPO}package.json`, "utf8")) as { scripts: Record<string, string> }).scripts;

type Step = { name?: string; id?: string; if?: string; uses?: string; run?: string; with?: Record<string, string> };
const STEPS = (parseYaml(readFileSync(`${REPO}.github/workflows/reusable-build-test.yml`, "utf8")) as
  { jobs: { run: { steps: Step[] } } }).jobs.run.steps;

/** A shell script's lines with blank and comment lines removed, so a runner named only in prose never counts. */
function codeLines(script: string): string[] {
  return script.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
}

/** The code lines that invoke node:test through tsx. */
function tsxTestLines(script: string): string[] {
  return codeLines(script).filter((line) => /\btsx\s+--test\b/.test(line));
}

/** The index of the one step whose name contains `fragment`. */
function stepNamed(fragment: string): number {
  const found = STEPS.flatMap((step, index) => ((step.name ?? "").includes(fragment) ? [index] : []));
  assert.equal(found.length, 1, `exactly one step is named like "${fragment}", found ${found.length}`);
  return found[0];
}

/** Runs the floor's CLI from the repo root, capturing both streams, outside any parent test harness. */
function floor(args: string[]): { status: number | null; output: string } {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync("node", [FLOOR, ...args], { cwd: REPO, encoding: "utf8", env });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const SCOPED = "Unit tests of the changed test files";
const UNSCOPED = "Unit tests, unscoped";
const CACHE_ASSERTION = "rstest build cache must hold files";

// --- the runner --------------------------------------------------------------------------------------------------

test("#1319 ACCEPTANCE: no step of reusable-build-test.yml runs `tsx --test`, comments stripped", () => {
  const runSteps = STEPS.filter((step) => typeof step.run === "string");
  assert.ok(runSteps.length > 0, "POSITIVE CONTROL for the emptiness below: the workflow's run steps were read");
  assert.deepEqual(runSteps.flatMap((step) => tsxTestLines(step.run ?? "")), []);
  // POSITIVE CONTROL for the predicate: the two lines the scoped step carried before this row are found, and the same
  // words in a comment are not.
  const before = '            npx tsx --test "${globs[@]}"\n            # npx tsx --test in prose\n'
    + '            npx tsx --test "${files[@]}"';
  assert.equal(tsxTestLines(before).length, 2);
});

test("#1319: both branches of the scoped step go through the floor to rstest", () => {
  const lines = codeLines(STEPS[stepNamed(SCOPED)].run ?? "");
  const throughFloor = lines.filter((line) =>
    /\bnode scripts\/assert-glob-not-empty\.mjs\s+"\$\{(globs|files)\[@\]\}"\s+--min=1\s+--run\s+--runner=rstest\s*$/.test(line));
  assert.equal(throughFloor.length, 2, `the broad-glob branch and the selected-files branch:\n${lines.join("\n")}`);
});

test("#1319: the unscoped step runs `npm run test:ts`, and `test:ts` asks the floor for rstest over the whole glob", () => {
  assert.deepEqual(codeLines(STEPS[stepNamed(UNSCOPED)].run ?? "").map((line) => line.trim()), ["npm run test:ts"]);
  assert.match(SCRIPTS["test:ts"],
    /assert-glob-not-empty\.mjs "packages\/\*\/src\/\*\*\/\*\.test\.ts" --min=300 --run --runner=rstest /);
});

test("#1319: `test:nightly` and `coverage` stay on tsx until step 4 (#1320), by ceo's ruling", () => {
  for (const name of ["test:nightly", "coverage"]) {
    assert.match(SCRIPTS[name], /assert-glob-not-empty\.mjs .*--run\b/, `${name} still runs through the floor`);
    assert.doesNotMatch(SCRIPTS[name], /--runner=/, `${name} must not choose a runner in this row`);
  }
});

test("#1319: the command `--run` executes, per runner -- tsx unchanged, rstest with one --include per pattern", () => {
  assert.deepEqual(runnerInvocation({ runner: "tsx", patterns: ["a.test.ts"] }), ["tsx", "--test", "a.test.ts"]);
  assert.deepEqual(runnerInvocation({ runner: "tsx", patterns: ["a.test.ts"], concurrency: "4" }),
    ["tsx", "--test", "--test-concurrency=4", "a.test.ts"]);
  assert.deepEqual(runnerInvocation({ runner: "rstest", patterns: ["a.test.ts", "b/**/*.test.ts"] }),
    ["rstest", "run", "--config", RSTEST_CONFIG, "--include", "a.test.ts", "--include", "b/**/*.test.ts"]);
  assert.deepEqual(runnerInvocation({ runner: "rstest", patterns: ["a.test.ts"], concurrency: "4" }),
    ["rstest", "run", "--config", RSTEST_CONFIG, "--pool.maxWorkers=4", "--include", "a.test.ts"]);
  assert.ok(RSTEST_CONFIG.endsWith("scripts/rstest/rstest.config.mjs"), RSTEST_CONFIG);
  assert.throws(() => runnerInvocation({ runner: "jest", patterns: ["a.test.ts"] }), /--runner=jest is not a runner/);
});

// --- the floor, under the new runner --------------------------------------------------------------------------------

test("#1319: under --runner=rstest a glob matching nothing is refused BEFORE rstest starts", () => {
  const { status, output } = floor(["packages/lab/src/packaging/nothing-matches-*.test.ts", "--run", "--runner=rstest"]);
  assert.equal(status, 1);
  assert.match(output, /matched 0, need at least 1/);
  assert.doesNotMatch(output, /rstest|Test Files|No test files found/i, "the floor refused; rstest never ran");
});

test("#1319: an unknown --runner is refused with exit 2, before the floor or any runner", () => {
  const { status, output } = floor(["packages/*/src/**/*.test.ts", "--run", "--runner=jest"]);
  assert.equal(status, 2);
  assert.match(output, /--runner=jest is not a runner/);
});

test("#1319: --runner=rstest really runs rstest, and forwards both its passing and its failing exit code", () => {
  const passing = floor(["packages/lab/src/packaging/commands-documented.test.ts", "--min=1", "--run", "--runner=rstest"]);
  assert.equal(passing.status, 0, passing.output);
  // A fixture that fails on purpose, OUTSIDE packages/*/src so no real suite run ever sees it. rstest, not a missing
  // file, must be the reason for the 1: "No test files found" also exits 1.
  const dir = mkdtempSync(join(tmpdir(), "runner-is-rstest-"));
  try {
    const file = join(dir, "always-fails.test.ts");
    writeFileSync(file, 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n'
      + 'test("deliberately false", () => { assert.equal(1, 2); });\n');
    const failing = floor([file, "--min=1", "--run", "--runner=rstest"]);
    assert.equal(failing.status, 1, failing.output);
    assert.doesNotMatch(failing.output, /No test files found/);
    assert.match(failing.output, /deliberately false/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the build cache ----------------------------------------------------------------------------------------------

/**
 * The config's `performance.buildCache` as a plain `node` process sees it with `CI` set to `ci`, or unset for undefined.
 * Read in a child, never imported here: inside an rstest worker `@rstest/core` resolves to rstest's runtime, where
 * `defineConfig` is not a function, so importing the config from a test fails the whole file under the new runner.
 */
function buildCacheWith(ci: string | undefined): unknown {
  const env = { ...process.env };
  delete env.CI;
  if (ci !== undefined) env.CI = ci;
  const script = `const { default: c } = await import(${JSON.stringify(CONFIG_URL)}); `
    + "process.stdout.write(JSON.stringify(c.performance?.buildCache ?? null));";
  const result = spawnSync("node", ["--input-type=module", "-e", script], { cwd: REPO, encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("#1319: rstest's build cache is on exactly when CI is set, read from the real config in a plain node process", () => {
  assert.equal(buildCacheWith("true"), true, "GitHub Actions sets CI=true");
  assert.equal(buildCacheWith("1"), true);
  assert.equal(buildCacheWith(undefined), false, "off locally, as #1315 measured: the build is under 1% of a run here");
  assert.equal(buildCacheWith(""), false);
  assert.equal(buildCacheWith("false"), false);
});

test("#1319: the cache is restored and its HIT or MISS printed before both test steps, keyed on the lockfile and the config", () => {
  const cache = STEPS.flatMap((step, index) => ((step.uses ?? "").startsWith("actions/cache@")
    && (step.with?.path ?? "").trim() === "node_modules/.cache/rstest-*" ? [index] : []));
  assert.equal(cache.length, 1, "exactly one actions/cache step persists rstest's build cache");
  const step = STEPS[cache[0]];
  assert.match(step.if ?? "", /inputs\.run-ts-tests/);
  assert.match(step.with?.key ?? "", /hashFiles\('package-lock\.json', 'scripts\/rstest\/rstest\.config\.mjs'\)/);
  assert.ok(step.id, "the cache step has an id, so its cache-hit output can be read");
  const printed = STEPS.flatMap((s, index) => ((s.run ?? "").includes(`steps.${step.id}.outputs.cache-hit`) ? [index] : []));
  assert.equal(printed.length, 1, "one step prints HIT or MISS");
  assert.match(STEPS[printed[0]].run ?? "", /HIT/);
  assert.match(STEPS[printed[0]].run ?? "", /MISS/);
  for (const testStep of [stepNamed(SCOPED), stepNamed(UNSCOPED)]) {
    assert.ok(cache[0] < printed[0] && printed[0] < testStep, "restore, then print, then the tests");
  }
});

test("#1319: a node_modules restore cannot bring back an rstest cache that the rstest step then reports as a MISS", () => {
  const nodeModules = STEPS.find((step) => step.id === "node-modules-cache");
  assert.ok(nodeModules, "the dedicated node_modules cache step is still there");
  const paths = (nodeModules.with?.path ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(paths, ["node_modules", "!node_modules/.cache"]);
});

test("#1319: after both test steps, an EMPTY rstest cache fails the job -- the assertion's own script, executed", () => {
  const index = stepNamed(CACHE_ASSERTION);
  assert.ok(index > stepNamed(SCOPED) && index > stepNamed(UNSCOPED), "it runs after the tests that fill the cache");
  assert.match(STEPS[index].if ?? "", /inputs\.run-ts-tests/);
  const script = STEPS[index].run ?? "";
  assert.doesNotMatch(script, /\$\{\{/, "free of workflow expressions, so this test runs exactly what CI runs");
  const dir = mkdtempSync(join(tmpdir(), "rstest-cache-assertion-"));
  const runIn = () => spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script],
    { cwd: dir, encoding: "utf8" });
  try {
    assert.equal(runIn().status, 1, "no node_modules/.cache at all");
    mkdirSync(join(dir, "node_modules/.cache/rstest-a11y-witness/rstest-development"), { recursive: true });
    assert.equal(runIn().status, 1, "the directory exists but holds no file");
    writeFileSync(join(dir, "node_modules/.cache/other-tool.json"), "{}");
    assert.equal(runIn().status, 1, "a file from another tool is not rstest's cache");
    writeFileSync(join(dir, "node_modules/.cache/rstest-a11y-witness/rstest-development/_meta"), "x");
    const filled = runIn();
    assert.equal(filled.status, 0, `${filled.stdout}${filled.stderr}`);
    assert.match(filled.stdout, /files under node_modules\/\.cache\/rstest-\* after the tests: 1\b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
