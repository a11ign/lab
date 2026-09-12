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
import { NIGHTLY_TENANTS } from "../../nightly/tenants.mjs";
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
 *
 * #1143: IT NAMED THE SEED BY PATH, so it broke the moment the population got a real tenant and the
 * placeholder left -- which is the transition the seed's own comment invites (*"when #908's first residual
 * lands, this file may go"*). A guard whose population is one hard-coded file cannot survive that file
 * being the temporary one. It now walks the population and asserts EVERY member is typechecked and linted,
 * with a vacuity guard, so it holds for whatever lives here rather than for the file that happened to live
 * here first.
 */
test("#1135 clause 5: the nightly population stays typechecked and linted on the PR path -- only its RUN moves", async () => {
  const nightly = globSync("packages/*/nightly/**/*.test.ts", { cwd: REPO })
    .map((f) => `${REPO}${f}`.replace(/\\/g, "/"));
  assert.ok(nightly.length > 0,
    "the nightly population is empty, so every assertion below would pass having examined nothing -- "
    + "`test:nightly`'s own --min refuses this too, and this is the second place it must not read as fine");
  const ts = await import("typescript");
  const configFile = ts.readConfigFile(`${REPO}tsconfig.json`, ts.sys.readFile);
  assert.equal(configFile.error, undefined, "tsconfig.json parses");
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, REPO);
  const typechecked = parsed.fileNames.map((f) => f.replace(/\\/g, "/"));
  assert.deepEqual(nightly.filter((f) => !typechecked.includes(f)), [],
    "tsconfig's include must resolve every nightly test, so `tsc --noEmit` reads them");
  const prTest = `${REPO}packages/lab/src/packaging/nightly-only-path.test.ts`;
  assert.ok(typechecked.includes(prTest), "and still resolves the PR population (the control)");

  const { ESLint } = await import("eslint");
  const eslint = new ESLint({ cwd: REPO });
  const ignored: string[] = [];
  const ruleless: string[] = [];
  for (const file of nightly) {
    if (await eslint.isPathIgnored(file)) ignored.push(file);
    const config = (await eslint.calculateConfigForFile(file)) as { rules?: Record<string, unknown> };
    if (Object.keys(config.rules ?? {}).length === 0) ruleless.push(file);
  }
  assert.deepEqual(ignored, [], "eslint must not ignore any of the nightly population");
  assert.deepEqual(ruleless, [], "and must apply real rules to each, not an empty config");
});

/**
 * #1143: NO TEST MAY BE IN BOTH POPULATIONS — asserted against the REAL TREE, which nothing did.
 *
 * The row that moved the first real tenant here specified this mutation: *"leave a copy at the old path.
 * Clause 1 must go red — a file in both populations is paid for twice, which is worse than not moving
 * it."* **It does not go red.** Clause 1 drives the two resolvers over a throwaway fixture repo, which is
 * the right way to test the GLOBS and cannot see anything about this repository's own files. So the whole
 * suite was green with the moved test present at both paths, and the PR path would have gone on paying
 * the 21.5 s the move exists to remove — while the row's acceptance said that case was covered.
 *
 * A guard over a fixture answers "does the pattern work". A guard over the tree answers "did anyone do
 * it". This repo keeps paying for the first standing in for the second.
 *
 * Compared by BASENAME rather than by content: a copy that was then edited is still a copy for this
 * purpose, and two files that genuinely need the same name in both populations is a thing to argue about
 * on a PR rather than to permit silently.
 */
test("#1143: no test file name appears in both the PR and the nightly populations", () => {
  const pr = globSync("packages/*/src/**/*.test.ts", { cwd: REPO });
  const nightly = globSync("packages/*/nightly/**/*.test.ts", { cwd: REPO });
  assert.ok(pr.length > 0 && nightly.length > 0,
    `both populations must be non-empty or this compares nothing: pr=${pr.length} nightly=${nightly.length}`);

  const base = (f: string) => f.split("/").pop();
  const prNames = new Set(pr.map(base));
  const inBoth = nightly.filter((f) => prNames.has(base(f)));
  assert.deepEqual(inBoth, [],
    "a test lives in both populations, so the PR path pays for it AND the nightly job runs it again. If a "
    + "file was moved here, delete the original; if the duplication is deliberate, say so here.");
});

// --- #1149: the nightly-only population is NAMED, and the names are pinned to the disk both ways -------
//
// `--min=1` and the `nightly.length > 0` guard both pass at N−1, so a tenant that is deleted, moved back
// or renamed past the glob leaves in silence and the job reports green over what remains. `ceo` ruled
// against a ratchet: a number bumped by hand records what someone last typed, and is satisfied by the
// very shrinkage it exists to catch.
//
// BOTH DIRECTIONS, AND THEY ARE DIFFERENT FAILURES. A one-directional pin is satisfied by an EMPTY
// manifest — the vacuity this row closes, reappearing one level up.

test("#1149: every nightly tenant on disk is NAMED in the manifest", () => {
  const onDisk = globSync("packages/*/nightly/**/*.test.ts", { cwd: REPO }).sort();
  assert.ok(onDisk.length > 0, "the walk found nothing, so neither assertion below examines anything");
  const unnamed = onDisk.filter((f) => !NIGHTLY_TENANTS.includes(f));
  assert.deepEqual(unnamed, [],
    `${unnamed.length} nightly test(s) are on disk and not in packages/lab/nightly/tenants.mjs. Add them `
    + "BY NAME: this population has no floor that can see it shrink, so the manifest is what makes a "
    + `tenant's arrival or departure visible:\n${unnamed.map((f) => `  ${f}`).join("\n")}`);
});

test("#1149: every name in the manifest is a file that EXISTS — the direction a one-way pin misses", () => {
  // Without this, an empty manifest satisfies the assertion above and the pin proves nothing. It is also
  // the direction that catches the real event: a tenant deleted from disk while its name stays here.
  const onDisk = new Set(globSync("packages/*/nightly/**/*.test.ts", { cwd: REPO }));
  // `local/uncontrolled-emptiness` (#1167, merged today) caught this line as I wrote it: without the pin
  // below, an EMPTY manifest satisfies this assertion — the precise vacuity this test exists to close,
  // committed inside the fix for it. The rule reported at the line, which is the whole argument for it
  // having become a rule rather than a sweep.
  assert.ok(NIGHTLY_TENANTS.length > 0,
    "#1149: an empty manifest passes every check below having named nothing, and the assertion above "
    + "would then be satisfied by a directory with no tenants at all");
  const missing = NIGHTLY_TENANTS.filter((f) => !onDisk.has(f));
  assert.deepEqual(missing, [],
    `${missing.length} name(s) in the manifest have no file on disk. A tenant left the nightly path and `
    + "the manifest still claims it — which is the event `--min=1` and the vacuity guard both pass "
    + `through:\n${missing.map((f) => `  ${f}`).join("\n")}`);
});

test("#1149 CONTROL: manifest and disk agree today, so a pin that always refuses is distinguishable", () => {
  const onDisk = globSync("packages/*/nightly/**/*.test.ts", { cwd: REPO }).sort();
  assert.deepEqual(onDisk, [...NIGHTLY_TENANTS].sort(),
    "if these ever differ, one of the two assertions above is the one to read — this control exists so a "
    + "guard that refuses everything cannot look identical to one that works");
  assert.equal(NIGHTLY_TENANTS.length, new Set(NIGHTLY_TENANTS).size, "each tenant is named once");
});
