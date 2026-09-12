/**
 * #1135: A NIGHTLY-ONLY TEST POPULATION EXISTS, AND THE WIRING IS THE DELIVERABLE.
 *
 * `npm test` (`test:ts`) and `npm run coverage` resolved the same glob, `packages/*\/src/**\/*.test.ts`, and
 * `assert-glob-not-empty` accepts no exclusion -- so every `.test.ts` under `src/` ran on both paths, always,
 * and #908's plan to move a converted guard's run-property residual off the PR path had nowhere to put it.
 * The cheap fix, an env guard that returns early on the PR path, was refused before anyone reached for
 * it: a vacuity guard that SKIPS is indistinguishable from one that PASSES, which is the defect it exists
 * to prevent. So the population is a directory the PR glob cannot see by construction, and this file pins
 * four things: the PR resolver does not see it, the nightly resolver does, the nightly workflow runs it as
 * a job that fails when it fails, and the PR suite's floor still holds after the split.
 *
 * Clauses 1 and 2 run the runner's OWN resolver (`underFloor`, with node's `globSync`) over a fixture tree,
 * never a string comparison on `package.json`: a glob is what it matches.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { globSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { underFloor } from "../../../../scripts/assert-glob-not-empty.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const PACKAGE_JSON = JSON.parse(readFileSync(`${REPO}package.json`, "utf8")) as { scripts: Record<string, string> };
const NIGHTLY_WORKFLOW = `${REPO}.github/workflows/nightly.yml`;

/** The glob a script hands to assert-glob-not-empty: the first quoted argument. */
function globOf(script: string): string {
  const m = /assert-glob-not-empty\.mjs\s+"([^"]+)"/.exec(script);
  assert.ok(m, `script hands a quoted glob to assert-glob-not-empty: ${script}`);
  return m[1];
}
/** `--min=N` as the script states it. */
function floorOf(script: string): number {
  const m = /--min=(\d+)/.exec(script);
  assert.ok(m, `script states a --min floor: ${script}`);
  return Number(m[1]);
}

const PR_GLOB = globOf(PACKAGE_JSON.scripts["test:ts"]);
const NIGHTLY_GLOB = globOf(PACKAGE_JSON.scripts["test:nightly"]);

/** A fixture tree with one test on each path, and a resolver bound to it (the runner's own `globSync`). */
function fixtureTree() {
  const root = mkdtempSync(join(tmpdir(), "nightly-only-path-"));
  mkdirSync(join(root, "packages/pkg/src/deep"), { recursive: true });
  mkdirSync(join(root, "packages/pkg/nightly/deep"), { recursive: true });
  writeFileSync(join(root, "packages/pkg/src/deep/pr.test.ts"), "");
  writeFileSync(join(root, "packages/pkg/nightly/deep/night.test.ts"), "");
  const resolve = (pattern: string) => globSync(pattern, { cwd: root });
  return { root, resolve, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("#1135 clause 1: a test in the nightly-only path is NOT in the PR suite's population, by the resolver", () => {
  const t = fixtureTree();
  try {
    const matched = t.resolve(PR_GLOB);
    assert.ok(matched.some((f) => f.endsWith("pr.test.ts")), "the PR glob still finds a src/ test");
    assert.ok(!matched.some((f) => f.includes("nightly")), `the PR glob must not reach nightly/: ${matched}`);
  } finally { t.dispose(); }
});

test("#1135 clause 2: it IS in the nightly suite's population, by the same route -- excluded from both is deleted", () => {
  const t = fixtureTree();
  try {
    const matched = t.resolve(NIGHTLY_GLOB);
    assert.ok(matched.some((f) => f.endsWith("night.test.ts")), `the nightly glob finds nightly/: ${matched}`);
    assert.ok(!matched.some((f) => f.includes("/src/")), "and does not double-run the PR population");
    assert.deepEqual(underFloor([NIGHTLY_GLOB], 1, t.resolve), [], "the runner's own floor check passes on it");
  } finally { t.dispose(); }
});

test("#1135 clause 3: nightly.yml runs the nightly-only population as a job that FAILS when it fails", () => {
  const doc = parseYaml(readFileSync(NIGHTLY_WORKFLOW, "utf8")) as {
    jobs: Record<string, { "continue-on-error"?: boolean; steps: Array<{ run?: string; "continue-on-error"?: boolean }> }>;
  };
  const runners = Object.entries(doc.jobs).filter(([, job]) =>
    job.steps.some((s) => /\bnpm run test:nightly\b/.test(s.run ?? "")));
  assert.equal(runners.length, 1, `exactly one job runs test:nightly, got ${runners.map(([n]) => n)}`);
  const [name, job] = runners[0];
  assert.notEqual(job["continue-on-error"], true, `${name} must fail the run when the population fails`);
  const step = job.steps.find((s) => /\bnpm run test:nightly\b/.test(s.run ?? ""));
  assert.notEqual(step?.["continue-on-error"], true, `${name}'s step must not swallow a failure`);
  assert.notEqual(name, "coverage", "its own job, so #169's coverage classifier never reads it as a coverage miss");
});

test("#1135 clause 4: the PR suite's floor still holds after the split, on the real tree", () => {
  const min = floorOf(PACKAGE_JSON.scripts["test:ts"]);
  // EQUALITY, not a floor (#1067): the row states `--min=300`; a different number is a decision this test
  // should make somebody state, in both directions.
  assert.equal(min, 300, `the PR floor is the one the row states, not lowered to make room: ${min}`);
  const resolve = (pattern: string) => globSync(pattern, { cwd: REPO });
  assert.deepEqual(underFloor([PR_GLOB], min, resolve), [], "the PR glob resolves at or above its floor");
  assert.deepEqual(underFloor([NIGHTLY_GLOB], 1, resolve), [], "and the nightly population on the real tree is not empty");
});

/**
 * #1135 clause 5 (worker-judge's injection on #1136): THE SPLIT IS EXECUTION-ONLY. The PR path stops
 * RUNNING the nightly population and nothing else -- `tsc --noEmit` and `eslint .` still reach it, so a
 * type error or a lint error in a nightly-only test is caught on the PR that introduces it, and only its
 * run-time verdict waits for the night. Pinned through the real resolvers (TypeScript's own config
 * parser and ESLint's own ignore/config calculation), never a string read of tsconfig's include list, so
 * a narrowed include or a new ignore pattern fails here rather than silently un-typechecking the
 * population.
 */
test("#1135 clause 5: the nightly population stays typechecked and linted on the PR path -- only its RUN moves", async () => {
  const seed = `${REPO}packages/lab/nightly/nightly-population-seed.test.ts`;
  const ts = await import("typescript");
  const configFile = ts.readConfigFile(`${REPO}tsconfig.json`, ts.sys.readFile);
  assert.equal(configFile.error, undefined, "tsconfig.json parses");
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, REPO);
  const typechecked = parsed.fileNames.map((f) => f.replace(/\\/g, "/"));
  assert.ok(typechecked.includes(seed), "tsconfig's include resolves the nightly seed, so `tsc --noEmit` reads it");
  const prTest = `${REPO}packages/lab/src/packaging/nightly-only-path.test.ts`;
  assert.ok(typechecked.includes(prTest), "and still resolves the PR population (the control)");

  const { ESLint } = await import("eslint");
  const eslint = new ESLint({ cwd: REPO });
  assert.equal(await eslint.isPathIgnored(seed), false, "eslint does not ignore the nightly population");
  const config = (await eslint.calculateConfigForFile(seed)) as { rules?: Record<string, unknown> };
  assert.ok(Object.keys(config.rules ?? {}).length > 0, "and applies real rules to it, not an empty config");
});
