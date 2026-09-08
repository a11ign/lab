/**
 * A1B: the PR `ts` job and `trunk-guard` ran the same suite, twice, on every merge (chairman, measured:
 * PR `ts` 83-155s against trunk-guard's 144-155s). `ci-changed.mjs`'s existing PACKAGE-level scoping
 * (`testPackages`) was not narrowing enough on its own -- a change to a widely-depended-on package
 * already selects nearly every test at that granularity. This narrows one step further, to FILES: which
 * test files actually import -- directly, or through any number of other files -- a changed source file.
 *
 * THE ZERO-TESTS FALLBACK IS THE LOAD-BEARING HALF. "Run only what changed" is easy; "notice when that
 * set is empty and say so" is what stops this shipping as a check that passes having run nothing -- this
 * is the job that gates every PR, and it would be a spectacular place to introduce that defect. Pinned
 * below by construction (a source file nothing imports) and by the real repo's own count.
 *
 * TRANSITIVITY IS THE OTHER HALF, pinned by a fixture built specifically so a ONE-HOP walk cannot pass:
 * `far.test.ts` imports `middle.ts`, which imports `source.ts` -- three files, two hops, and only the
 * transitive walk reaches the far end. `npm run mutate` collapses `sourceClosure`'s queue to a single
 * pass and this is the test that must go red when it does.
 *
 * A1C: `packages/*\/src/` was never the only thing a test can depend on. `scripts/*.mjs` is covered BY
 * IMPORT (the same reverse index -- `sourceClosure`'s walk was never package-restricted); a hook or
 * workflow file (never `import`ed) is covered BY PATH STRING, against comment-stripped source so a doc
 * comment merely MENTIONING a path -- this repo's own `` `scripts/foo.mjs` `` markdown convention -- is
 * never mistaken for a test that exercises it. `BROAD` narrows to exactly `ci.yml` itself and
 * `ci-changed.mjs`'s own `ROOT_TS_FILES`.
 *
 * A1D: AND SOME TESTS CANNOT BE SELECTED AT ALL. A guard whose population is the TREE imports nothing
 * from the file it governs, so every mechanism above -- import closure, path string, package fallback --
 * is structurally blind to it. `main` went red at `9c20dc99` on exactly that: run `34202041349` printed
 * `4 test file(s) selected precisely` and `git-spawn-classification.test.ts` was not among them, while
 * the file it fails on had just landed in a different PR. Both PRs green alone, jointly red, no shared
 * file for B4's intersection to see.
 *
 * THE MUTATION THAT MATTERS HERE IS THE NARROWING ONE. A selector that runs too FEW guards is
 * indistinguishable from a passing suite, which is how that red reached main; a selector that runs too
 * many is merely slower and says so in its own output. So the always-run assertions below are a FLOOR
 * plus named members plus the incident itself, and `npm run mutate` on `discoversFromTree`'s first
 * `return true` -- the whole git leg -- must turn them red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sourceClosure, discoverTestFiles, selectTests, broadReasons, pathStringReferences,
  discoversFromTree, alwaysRunTests, testFilesToRun,
} from "../../../../scripts/select-changed-tests.mjs";

type PackageSpec = { dir: string; name: string; exportsMap?: Record<string, unknown>; files: Record<string, string> };

/**
 * A synthetic repo under `os.tmpdir()`, real files on disk -- `sourceClosure` reads source text off the
 * filesystem, so a fixture has to be real files, not an in-memory shape. No `git init`: `discoverTestFiles`
 * uses `git ls-files`, so callers that need it use the REAL repo instead (see the smoke test below); the
 * synthetic fixtures below drive `sourceClosure`/`selectTests` directly with a hand-built test-file list.
 */
function fakeRepo(packages: PackageSpec[]): string {
  const dir = mkdtempSync(join(tmpdir(), "select-changed-tests-"));
  for (const pkg of packages) {
    const pkgRoot = join(dir, "packages", pkg.dir);
    mkdirSync(join(pkgRoot, "src"), { recursive: true });
    writeFileSync(join(pkgRoot, "package.json"),
      JSON.stringify({ name: pkg.name, exports: pkg.exportsMap ?? {} }));
    for (const [relPath, content] of Object.entries(pkg.files)) {
      writeFileSync(join(pkgRoot, relPath), content);
    }
  }
  return dir;
}

function packageIndexFor(packages: PackageSpec[]): Map<string, { dir: string; exportsMap: Record<string, unknown> }> {
  const index = new Map();
  for (const pkg of packages) index.set(pkg.name, { dir: pkg.dir, exportsMap: pkg.exportsMap ?? {} });
  return index;
}

test("sourceClosure: THE MUTATION TARGET -- a THREE-HOP relative import chain is walked in full, "
  + "not just the entry's own imports", () => {
  const packages: PackageSpec[] = [{
    dir: "pkg-a", name: "@fake/pkg-a",
    files: {
      "src/far.test.ts": 'import { x } from "./middle.js";\n',
      "src/middle.ts": 'import { y } from "./source.js";\n',
      "src/source.ts": "export const y = 1;\n",
    },
  }];
  const dir = fakeRepo(packages);
  const closure = sourceClosure(join(dir, "packages/pkg-a/src/far.test.ts"), dir, packageIndexFor(packages));
  const names = [...closure].map((f) => f.replace(`${dir}/`, ""));
  assert.ok(names.includes("packages/pkg-a/src/middle.ts"), `one hop missing: ${names.join(", ")}`);
  assert.ok(names.includes("packages/pkg-a/src/source.ts"),
    `TWO hops missing -- the walk stopped at the first import instead of following it further: ${names.join(", ")}`);
  rmSync(dir, { recursive: true, force: true });
});

test("sourceClosure: a bare WORKSPACE PACKAGE specifier resolves through `exports` back to SOURCE, "
  + "never `dist/`, which does not exist on this fixture at all", () => {
  const packages: PackageSpec[] = [
    {
      dir: "pkg-a", name: "@fake/pkg-a",
      exportsMap: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      files: { "src/index.ts": "export const shared = 1;\n" },
    },
    {
      dir: "pkg-b", name: "@fake/pkg-b",
      files: { "src/consumer.test.ts": 'import { shared } from "@fake/pkg-a";\n' },
    },
  ];
  const dir = fakeRepo(packages);
  const closure = sourceClosure(join(dir, "packages/pkg-b/src/consumer.test.ts"), dir, packageIndexFor(packages));
  const names = [...closure].map((f) => f.replace(`${dir}/`, ""));
  assert.ok(names.includes("packages/pkg-a/src/index.ts"),
    `cross-package specifier did not resolve to source: ${names.join(", ")}`);
  rmSync(dir, { recursive: true, force: true });
});

test("sourceClosure: a package shipping SRC RAW (ADR 0031's shape -- an export target with no dist/) "
  + "is followed as a literal path, needing no dist-to-src swap", () => {
  const packages: PackageSpec[] = [
    {
      dir: "pkg-nobuild", name: "@fake/pkg-nobuild",
      exportsMap: { ".": "./src/index.mjs" },
      files: { "src/index.mjs": "export const raw = 1;\n" },
    },
    {
      dir: "pkg-b", name: "@fake/pkg-b",
      files: { "src/consumer.test.ts": 'import { raw } from "@fake/pkg-nobuild";\n' },
    },
  ];
  const dir = fakeRepo(packages);
  const closure = sourceClosure(join(dir, "packages/pkg-b/src/consumer.test.ts"), dir, packageIndexFor(packages));
  const names = [...closure].map((f) => f.replace(`${dir}/`, ""));
  assert.ok(names.includes("packages/pkg-nobuild/src/index.mjs"), `no-build package not reached: ${names.join(", ")}`);
  rmSync(dir, { recursive: true, force: true });
});

test("sourceClosure: an ordinary npm dependency (no @fake/* match) is not a workspace file and is "
  + "silently skipped, never crashing the walk", () => {
  const packages: PackageSpec[] = [{
    dir: "pkg-a", name: "@fake/pkg-a",
    files: { "src/uses-external.test.ts": 'import { z } from "some-real-npm-package";\n' },
  }];
  const dir = fakeRepo(packages);
  const closure = sourceClosure(join(dir, "packages/pkg-a/src/uses-external.test.ts"), dir, packageIndexFor(packages));
  assert.equal(closure.size, 1, "only the entry itself should be in the closure");
  rmSync(dir, { recursive: true, force: true });
});

test("broadReasons: a file under packages/*/src/ is never counted as a reason for a broad run", () => {
  assert.deepEqual(broadReasons(["packages/evidence/src/wcag.ts"]), []);
});

test("broadReasons: a root config file (ci-changed.mjs's own ROOT_TS_FILES) IS a reason", () => {
  const files = ["package.json", "tsconfig.json", "packages/evidence/src/wcag.ts"];
  assert.deepEqual(broadReasons(files), ["package.json", "tsconfig.json"]);
});

test("broadReasons: ci.yml itself IS a reason -- a job definition can affect anything the job runs", () => {
  assert.deepEqual(broadReasons([".github/workflows/ci.yml"]), [".github/workflows/ci.yml"]);
});

test("#A1c NARROWING: a scripts/*.mjs file is NO LONGER a broad reason on its own -- it goes through "
  + "the by-import reference search instead", () => {
  assert.deepEqual(broadReasons(["scripts/merge-guard.mjs"]), []);
});

test("#A1c NARROWING: a hook or non-ci.yml workflow file is NO LONGER a broad reason -- it goes through "
  + "the by-path-string reference search instead", () => {
  assert.deepEqual(broadReasons(["scripts/git-hooks/pre-push", ".github/workflows/auto-arm.yml"]), []);
});

// --- pathStringReferences: the hook/workflow half, comment-stripped ---

test("pathStringReferences: a real quoted string literal naming the path IS a reference", () => {
  const dir = mkdtempSync(join(tmpdir(), "select-changed-tests-pathref-"));
  writeFileSync(join(dir, "hook.test.ts"),
    'const HOOK_PATH = "scripts/git-hooks/pre-push";\ntest("x", () => {});\n');
  const found = pathStringReferences("scripts/git-hooks/pre-push", ["hook.test.ts"], dir);
  assert.deepEqual(found, ["hook.test.ts"]);
  rmSync(dir, { recursive: true, force: true });
});

test("pathStringReferences: MUTATION TARGET -- a path mentioned ONLY inside a comment (this repo's own "
  + "markdown-backtick convention for discussing a file) is NOT a reference -- a test that DISCUSSES a "
  + "file is not a test that exercises it, the #446 heading-collision shape applied to this search", () => {
  const dir = mkdtempSync(join(tmpdir(), "select-changed-tests-pathref-"));
  writeFileSync(join(dir, "unrelated.test.ts"),
    '/**\n * See `scripts/git-hooks/pre-push` for the hook this test does NOT touch.\n */\n'
    + 'test("y", () => {});\n');
  const found = pathStringReferences("scripts/git-hooks/pre-push", ["unrelated.test.ts"], dir);
  assert.deepEqual(found, [], "a comment-only mention must never be read as a real reference");
  rmSync(dir, { recursive: true, force: true });
});

test("pathStringReferences: a file with no reference at all, quoted or otherwise, is correctly absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "select-changed-tests-pathref-"));
  writeFileSync(join(dir, "other.test.ts"), 'test("z", () => { assert.equal(1, 1); });\n');
  assert.deepEqual(pathStringReferences("scripts/git-hooks/pre-push", ["other.test.ts"], dir), []);
  rmSync(dir, { recursive: true, force: true });
});

// --- selectTests: the two new #A1c shapes ---

test("selectTests: a scripts/*.mjs file is selected BY IMPORT, via the SAME reverse index as "
  + "packages/*/src/ -- the walk was never package-restricted", () => {
  const repoRoot = "/repo";
  const closureOf = () => new Set([`${repoRoot}/scripts/some-script.mjs`, `${repoRoot}/packages/lab/src/packaging/uses-script.test.ts`]);
  const result = selectTests(["scripts/some-script.mjs"], { closureOf: () => closureOf(),
    testFiles: ["packages/lab/src/packaging/uses-script.test.ts"], repoRoot, testPackages: ["lab"] });
  assert.deepEqual(result.selectedTests, ["packages/lab/src/packaging/uses-script.test.ts"]);
  assert.deepEqual(result.fallbackPackages, []);
});

test("selectTests: a scripts/*.mjs file with ZERO reaching tests falls back to EVERY IMPLICATED "
  + "package -- there is no 'its own package' for a file outside packages/", () => {
  const result = selectTests(["scripts/orphan-script.mjs"],
    { closureOf: () => new Set(), testFiles: [], repoRoot: "/repo", testPackages: ["lab", "evidence"] });
  assert.deepEqual(result.selectedTests, []);
  assert.deepEqual(result.fallbackPackages, ["evidence", "lab"]);
  assert.deepEqual(result.uncoveredFiles, ["scripts/orphan-script.mjs"]);
});

test("selectTests: a hook/workflow file is selected BY PATH STRING, via the injected `referencesPath`", () => {
  const referencesPath = (file: string) =>
    (file === "scripts/git-hooks/pre-push" ? ["packages/lab/src/packaging/pre-push-x.test.ts"] : []);
  const result = selectTests(["scripts/git-hooks/pre-push"], { closureOf: () => new Set(),
    testFiles: ["packages/lab/src/packaging/pre-push-x.test.ts"], repoRoot: "/repo", testPackages: ["lab"],
    referencesPath });
  assert.deepEqual(result.selectedTests, ["packages/lab/src/packaging/pre-push-x.test.ts"]);
  assert.deepEqual(result.fallbackPackages, []);
});

test("selectTests: #A1c MUTATION TARGET -- a hook/workflow file whose reference search finds NOTHING "
  + "falls back to every implicated package, named, never silence", () => {
  const referencesPath = () => [];
  const result = selectTests(["scripts/git-hooks/pre-push"],
    { closureOf: () => new Set(), testFiles: [], repoRoot: "/repo", testPackages: ["lab"], referencesPath });
  assert.deepEqual(result.selectedTests, []);
  assert.deepEqual(result.fallbackPackages, ["lab"]);
  assert.deepEqual(result.uncoveredFiles, ["scripts/git-hooks/pre-push"]);
});

test("SMOKE, against the real repo and #479's own real shape: scripts/git-hooks/pre-push plus its own "
  + "new test selects precisely the pre-push tests, no broad fallback", () => {
  const repoRoot = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
  const packageJson = JSON.parse(readFileSync(`${repoRoot}/packages/lab/package.json`, "utf8"));
  const packages = new Map([[packageJson.name, { dir: "lab", exportsMap: packageJson.exports ?? {} }]]);
  const testFiles = discoverTestFiles(repoRoot, ["lab"]);
  const closureOf = (testFile: string) => sourceClosure(`${repoRoot}/${testFile}`, repoRoot, packages);
  const changed = ["scripts/git-hooks/pre-push"];
  assert.deepEqual(broadReasons(changed), [], "a hook must not be broad any more");
  const result = selectTests(changed, { closureOf, testFiles, repoRoot, testPackages: ["lab"] });
  assert.ok(result.selectedTests.length > 0, "the hook is genuinely referenced by real tests -- selecting nothing is wrong");
  assert.ok(result.selectedTests.length < testFiles.length,
    `selected ${result.selectedTests.length} of ${testFiles.length} candidates -- expected real narrowing`);
  assert.deepEqual(result.fallbackPackages, []);
  assert.ok(result.selectedTests.some((f) => f.includes("pre-push")),
    `expected a pre-push-named test among the selection: ${result.selectedTests.join(", ")}`);
});

test("selectTests: MUTATION TARGET -- a changed source file with ZERO reaching tests falls back to its "
  + "OWN PACKAGE, never silently selecting nothing", () => {
  const changed = ["packages/pkg-a/src/orphan.ts"];
  const result = selectTests(changed, { closureOf: () => new Set(), testFiles: [], repoRoot: "/repo" });
  assert.deepEqual(result.selectedTests, []);
  assert.deepEqual(result.fallbackPackages, ["pkg-a"]);
  assert.deepEqual(result.uncoveredFiles, changed);
});

test("selectTests: a changed file that reaches real tests selects exactly those, no fallback", () => {
  const repoRoot = "/repo";
  const closureOf = (testFile: string) => {
    if (testFile === "packages/pkg-a/src/far.test.ts") {
      return new Set([`${repoRoot}/packages/pkg-a/src/far.test.ts`, `${repoRoot}/packages/pkg-a/src/source.ts`]);
    }
    return new Set([`${repoRoot}/${testFile}`]);
  };
  const testFiles = ["packages/pkg-a/src/far.test.ts", "packages/pkg-a/src/unrelated.test.ts"];
  const result = selectTests(["packages/pkg-a/src/source.ts"], { closureOf, testFiles, repoRoot });
  assert.deepEqual(result.selectedTests, ["packages/pkg-a/src/far.test.ts"]);
  assert.deepEqual(result.fallbackPackages, []);
});

test("selectTests: a DIRECTLY changed test file selects itself even when no closure reaches it -- it is "
  + "its own reason to run", () => {
  const result = selectTests(["packages/pkg-a/src/self.test.ts"],
    { closureOf: () => new Set(), testFiles: [], repoRoot: "/repo" });
  assert.deepEqual(result.selectedTests, ["packages/pkg-a/src/self.test.ts"]);
  assert.deepEqual(result.fallbackPackages, []);
});

test("selectTests: two changed files in the SAME uncovered package fold into ONE fallback entry, not two", () => {
  const changed = ["packages/pkg-a/src/orphan-one.ts", "packages/pkg-a/src/orphan-two.ts"];
  const result = selectTests(changed, { closureOf: () => new Set(), testFiles: [], repoRoot: "/repo" });
  assert.deepEqual(result.fallbackPackages, ["pkg-a"]);
});

test("discoverTestFiles: matches ONLY the given packages' own **/*.test.ts under src/, against the REAL "
  + "repo -- the identical glob ci.yml's own step already uses, so this can never select a file the shell "
  + "would not also have matched", () => {
  const repoRoot = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
  const files = discoverTestFiles(repoRoot, ["evidence"]);
  assert.ok(files.length > 5, `too few evidence test files found: ${files.length}`);
  assert.ok(files.every((f) => f.startsWith("packages/evidence/src/") && f.endsWith(".test.ts")),
    `a file outside packages/evidence/src/ leaked in: ${files.find((f) => !f.startsWith("packages/evidence/src/"))}`);
  assert.ok(!files.some((f) => f.startsWith("packages/judge/")), "a package NOT asked for leaked in");
});

test("SMOKE, against the real repo: a well-known, widely-imported source file narrows the candidate "
  + "population rather than selecting everything -- the whole point of this row", () => {
  const repoRoot = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
  const packageJson = JSON.parse(readFileSync(`${repoRoot}/packages/evidence/package.json`, "utf8"));
  const packages = new Map([[packageJson.name, { dir: "evidence", exportsMap: packageJson.exports ?? {} }]]);
  const testFiles = discoverTestFiles(repoRoot, ["evidence"]);
  const closureOf = (testFile: string) => sourceClosure(`${repoRoot}/${testFile}`, repoRoot, packages);
  const result = selectTests(["packages/evidence/src/wcag.ts"], { closureOf, testFiles, repoRoot });
  assert.ok(result.selectedTests.length > 0, "wcag.ts is a real, imported file -- selecting nothing is wrong");
  assert.ok(result.selectedTests.length < testFiles.length,
    `selected ${result.selectedTests.length} of ${testFiles.length} candidates -- expected real narrowing`);
  assert.deepEqual(result.fallbackPackages, []);
});


// -- #A1d: the always-run discovery guards -----------------------------------------------------------

const REPO = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** The real repo's whole test population and a closure walker over it, built once for the tests below. */
function realRepoWalk(): { every: string[]; closureOf: (t: string) => Set<string> } {
  const dirs = readdirSync(`${REPO}/packages`, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
  const packages = new Map<string, { dir: string; exportsMap: Record<string, unknown> }>();
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(`${REPO}/packages/${dir}/package.json`, "utf8"));
    packages.set(manifest.name, { dir, exportsMap: manifest.exports ?? {} });
  }
  return {
    every: discoverTestFiles(REPO, dirs),
    closureOf: (t: string) => sourceClosure(`${REPO}/${t}`, REPO, packages),
  };
}

/**
 * THE FIXTURES HERE ARE REAL FILES, and that is not a stylistic preference — the first version of these
 * four tests used synthetic strings that LOOKED like the shapes `discoversFromTree` searches for, and
 * this file promptly joined the population of four other tree-walking guards: `git-spawn-classification`
 * (a string containing `execFileSync("git", ["ls-files"` is indistinguishable from a real spawn to a
 * scanner that strips comments and not string literals), `git-population-vacuity`, `dataset-paths` and
 * `corpus-readers-are-guarded` (`realCorpusRoot()` and `runs/screenreader-dataset/` in a fixture read as
 * a corpus reader). Four red guards, none of them wrong.
 *
 * That could have been closed with four exemption entries — every one of those guards has a table for
 * exactly this, and `acceptance-prose.test.ts`, the file from THIS row's own incident, already sits in
 * one of them. Asserting against real files is better: it needs no exemption anywhere, and it pins the
 * predicate to the population it will actually meet rather than to my idea of what that looks like.
 *
 * The cost is that these assertions are claims about OTHER files. If one changes character the message
 * says so, and the fix is to re-read that file and move the assertion — never to relax it.
 */
const realSource = (rel: string) => readFileSync(`${REPO}/${rel}`, "utf8");

test("discoversFromTree: a git ENUMERATION is a tree walk, however it is spawned -- the indirected form "
  + "matters, and `isolation-gate.mjs` is the real file that proves it: it reaches `git ls-files` through "
  + "a local `run()` seam, so matching `execFileSync`/`spawnSync` by name silently dropped three tests", () => {
  assert.equal(discoversFromTree(realSource("packages/lab/src/packaging/generated-paths.test.ts")), true,
    "a direct `git ls-files` enumeration in a guard that walks the tree");
  assert.equal(discoversFromTree(realSource("scripts/isolation-gate.mjs"), { asHelper: true }), true,
    "`run(\"git\", [\"ls-files\"], dir, sandboxGitEnv())` -- the INDIRECTED spawn. If this file stops "
    + "reaching git through a seam, move this assertion to whichever one still does; do not delete it, "
    + "because the seam is the whole reason the pattern is not a list of function names");
});

test("discoversFromTree: COMMENTS ARE STRIPPED FIRST -- a file that DESCRIBES a tree walk in prose has "
  + "not performed one, and this selector's own header would otherwise classify half the repo", () => {
  assert.equal(discoversFromTree("// this file only DISCUSSES the ls-files walk\nconst x = 1;"), false);
  assert.equal(discoversFromTree("/* a directory walk would be wrong here */\nconst x = 1;"), false);
});

test("discoversFromTree: in a TEST a directory read IS the population; in a HELPER it is the behaviour of "
  + "the module under test -- pinned against the two real modules the distinction was drawn from, because "
  + "without it `capture-cache.mjs`'s 13 consumers join a set they belong in for no reason", () => {
  const census = realSource("packages/worker-fleet/src/command-line-census.mjs");
  assert.equal(discoversFromTree(census, { asHelper: true }), true,
    "it walks the tree's known CLI roots and skips `node_modules` -- a shared discovery walker, so its "
    + "consumers ARE guards over the tree");

  const captureCache = realSource("packages/lab/src/training/capture-cache.mjs");
  assert.equal(discoversFromTree(captureCache, { asHelper: true }), false,
    "one flat `readdirSync(pageDir)` and no build output to skip -- a data read, not a population");
  assert.equal(discoversFromTree(captureCache), true,
    "and the SAME source qualifies under the test rule, which is what makes this a real distinction "
    + "between the two legs rather than a stricter regex");
});

test("discoversFromTree: a walk rooted in the CORPUS is subtracted -- `runs/` is gitignored, so nothing "
  + "under it can ever be a changed file -- but a tracked-tree walk that merely NAMES a corpus path is "
  + "not, which is the under-inclusion this whole row is about", () => {
  assert.equal(discoversFromTree(realSource("packages/evidence/src/announcement.corpus.test.ts")), false,
    "it roots its walk on the LITERAL captures directory under the gitignored corpus root, not on one of "
    + "the accessor functions -- using only `corpus-readers-are-guarded.test.ts`'s accessor marker and "
    + "not its path marker let this file straight in, and that pair exists there because one of them is "
    + "not enough. (The literal itself is deliberately NOT written out here: this file would then match "
    + "that guard's own discovery, which is how the first draft of these fixtures made four tree-walking "
    + "guards go red at once.)");
  assert.equal(discoversFromTree(realSource("packages/lab/src/training/real-page-corpus-freshness.test.ts")),
    true, "it walks the TRACKED tree (`SKIP_DIRS` naming node_modules) to find corpus readers, so it "
    + "names corpus paths constantly while being exactly the guard this row exists to keep running");
});

test("alwaysRunTests: THE INCIDENT, reproduced -- the diff that added `acceptance-prose.test.ts` "
  + "(`bb0854da`, two files) selects six tests and NOT `git-spawn-classification.test.ts`, the guard it "
  + "went on to break; the always-run set is what puts it back", () => {
  const { every, closureOf } = realRepoWalk();
  const guard = "packages/lab/src/packaging/git-spawn-classification.test.ts";
  // The incident's own diff, quoted rather than re-derived from history: a shallow checkout cannot see
  // `bb0854da`, and a test that skips in CI proves nothing about the job CI runs.
  const changed = ["packages/lab/src/packaging/acceptance-prose.test.ts", "scripts/acceptance-commands.mjs"];
  const testFiles = discoverTestFiles(REPO, ["lab"]);
  const selection = selectTests(changed, { closureOf, testFiles, repoRoot: REPO, testPackages: ["lab"] });
  assert.ok(!selection.selectedTests.includes(guard),
    "if selection now reaches this guard by import, the incident has changed shape and this test is "
    + "asserting about a repository that no longer exists -- read it before relaxing it");
  assert.deepEqual(selection.fallbackPackages, [], "neither changed file is uncovered, so nothing widens");

  const alwaysRun = alwaysRunTests(every, { closureOf, repoRoot: REPO });
  assert.ok(alwaysRun.some((g) => g.test === guard), `${guard} is not in the always-run set`);
  assert.ok(testFilesToRun({ ...selection, alwaysRun }).includes(guard),
    "the guard must reach what the job actually RUNS, not merely a set the selector computed");
});

test("alwaysRunTests: a FLOOR against the real repo -- the narrowing mutation is the one with teeth, "
  + "because a selector that runs too few guards is indistinguishable from a passing suite", () => {
  const { every, closureOf } = realRepoWalk();
  const alwaysRun = alwaysRunTests(every, { closureOf, repoRoot: REPO });
  assert.ok(every.length > 400, `only ${every.length} test files discovered -- the population is wrong`);
  assert.ok(alwaysRun.length >= 60,
    `${alwaysRun.length} always-run guard(s) of ${every.length} test files; measured 107 on 2026-09-08, `
    + "and a floor of 60 is well below every leg being intact but far above the git leg alone (14)");
  assert.ok(alwaysRun.length < every.length / 2,
    `${alwaysRun.length} of ${every.length} -- more than half the suite always-running means the `
    + "predicate has stopped discriminating and A1b's whole narrowing is gone");
  assert.ok(alwaysRun.every((g) => g.why.length > 0), "every member carries the reason it qualified");
});

test("alwaysRunTests: the five guards #501 names are all in, and `cli-flags.test.ts` is in BY THE HELPER "
  + "LEG specifically -- its own source walks nothing, so it can only have arrived through "
  + "`command-line-census.mjs`, which is the leg a self-only predicate would silently drop", () => {
  const { every, closureOf } = realRepoWalk();
  const alwaysRun = alwaysRunTests(every, { closureOf, repoRoot: REPO });
  const by = new Map(alwaysRun.map((g) => [g.test, g.why]));
  for (const named of [
    "packages/lab/src/packaging/git-spawn-classification.test.ts",
    "packages/lab/src/packaging/generated-paths.test.ts",
    "packages/lab/src/packaging/tracked-source-leak-guard.test.ts",
    "packages/lab/src/packaging/pre-install-import-graph.test.ts",
    "packages/worker-fleet/src/cli-flags.test.ts",
  ]) assert.ok(by.has(named), `#501 names ${named} and it is not in the always-run set`);

  const viaHelper = by.get("packages/worker-fleet/src/cli-flags.test.ts") ?? "";
  assert.match(viaHelper, /^imports the tree walker packages\/worker-fleet\/src\/command-line-census\.mjs$/);
  assert.equal(discoversFromTree(readFileSync(`${REPO}/packages/worker-fleet/src/cli-flags.test.ts`, "utf8")),
    false, "if this file starts walking the tree itself, the helper leg is no longer pinned by it");
});

test("alwaysRunTests: a `capture-cache.mjs` consumer is NOT in the set -- the helper leg's strictness, "
  + "pinned from the other side, because relaxing it adds 13 ordinary unit tests that no changed file "
  + "can reach through a corpus directory read", () => {
  const { every, closureOf } = realRepoWalk();
  const tests = new Set(alwaysRunTests(every, { closureOf, repoRoot: REPO }).map((g) => g.test));
  assert.ok(!tests.has("packages/lab/src/training/capture-resume.test.ts"));
  assert.ok(!tests.has("packages/evidence/src/announcement.corpus.test.ts"),
    "a corpus reader has no tracked population and cannot be broken by a changed file");
});

test("testFilesToRun: the union is deduplicated and sorted, and the package fallback globs still ride "
  + "along -- a guard selection already reached must not be handed to `tsx --test` twice", () => {
  const run = testFilesToRun({
    selectedTests: ["b.test.ts", "a.test.ts"],
    alwaysRun: [{ test: "a.test.ts", why: "walks the tree itself" }, { test: "c.test.ts", why: "x" }],
    fallbackPackages: ["lab"],
  });
  assert.deepEqual(run, ["a.test.ts", "b.test.ts", "c.test.ts", "packages/lab/src/**/*.test.ts"]);
});
