/**
 * EVERY TEST FILE IN THIS REPOSITORY IS CLAIMED BY SOME RUNNER — #1940.
 *
 * A test file can sit in this tree, pass when run by hand, and be executed by no gate at all. Exactly one
 * did: `packages/lab/scripts/corpus-snapshot.test.mjs` held #1798's `presentMissing`/`noteMissing`
 * coverage and was under `scripts/`, not `src/`, and `.mjs`, not `.ts` — missing every runner glob on both
 * counts. One orphan in 626. It had never run in CI since the day it was written, and nothing said so.
 *
 * WHY A GUARD AND NOT A MOVE. Moving that one file fixes today's instance and leaves the class. Its
 * sibling `assert-glob-not-empty.mjs` guards the OPPOSITE direction — that a glob matches *something* —
 * which passes perfectly while a file sits outside every glob. A test nobody runs is the same shape as a
 * guard that cannot fire: it reads as coverage and is not.
 *
 * THE GLOBS ARE READ FROM THE RUNNERS THEMSELVES, NEVER RETYPED HERE. `package.json`'s scripts are parsed
 * for every invocation of `assert-glob-not-empty.mjs` — the floor script every test entry point goes
 * through — and its positional patterns and its own `--min` are taken from that argv; the rstest config is
 * IMPORTED and its `include` read off the object rstest itself is handed. A second, hand-written copy of
 * the list is the defect this repository keeps paying for, and it would drift the first time a glob
 * changed. The matcher is `node:fs`'s `globSync`, which is the same function `assert-glob-not-empty.mjs`
 * resolves its own patterns with, so "reached" here means reached by the real mechanism.
 *
 * WHAT THIS DOES NOT COVER, named rather than left to be discovered:
 *   - Python tests. They are not `*.test.*` files; `test:python` runs each package's own `tests`
 *     directory through pytest.
 *   - CI's per-package scoped globs and `test:changed`, both COMPUTED at run time from the changed files.
 *     Neither is a universe: a file outside every static glob cannot be selected by either of them either,
 *     so the static globs are the right population for this question.
 *   - Untracked files. `walkTree` reads `git ls-files`, so a new test file is invisible to this guard
 *     until `git add`. That is true of every discovery in this repository (see `select-changed-tests.mjs`'s
 *     own note); the discriminator is a `git add -N` before trusting a local green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { walkTree, declareTreeWideGuard } from "../../../guards/src/tree-wide-guard.mjs";
import { underFloor } from "../../../guards/src/assert-glob-not-empty.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file.
declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** The floor script every runner entry point in `package.json` goes through; its argv carries the globs. */
const FLOOR_SCRIPT = "assert-glob-not-empty.mjs";

/** Shell operators that end a command, so a chained script's later words are never read as patterns. */
const OPERATORS = ["&&", "||", "|", ";", "&"];

/** One glob a runner really resolves, with the floor declared beside it in the same place. */
type RunnerGlob = { source: string; pattern: string; min: number };

/** `globSync` bound to the repository root, so a test's own cwd cannot change what "reached" means. */
const globFromRepo = (pattern: string): string[] => globSync(pattern, { cwd: REPO });

/** Split a package.json script into argv words, honouring the double quotes that keep a glob unexpanded. */
function tokenize(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

/**
 * The patterns and floor one `assert-glob-not-empty.mjs` invocation declares, or null for a script that
 * never calls it. The patterns are its POSITIONAL arguments, exactly as the script's own parser reads
 * them: everything after the script name until the first flag or shell operator.
 */
function floorInvocation(command: string): { patterns: string[]; min: number } | null {
  const argv = tokenize(command);
  const at = argv.findIndex((word) => word.endsWith(FLOOR_SCRIPT));
  if (at === -1) return null;
  const rest = argv.slice(at + 1);
  const end = rest.findIndex((word) => word.startsWith("-") || OPERATORS.includes(word));
  const patterns = end === -1 ? rest : rest.slice(0, end);
  const declared = rest.flatMap((word) => /^--min=(\d+)$/.exec(word)?.[1] ?? []);
  return { patterns, min: declared.length > 0 ? Number(declared[0]) : 1 };
}

/** Every glob `package.json`'s own scripts hand to the floor, sourced by the script that declares it. */
function packageJsonGlobs(): RunnerGlob[] {
  const scripts = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")).scripts ?? {};
  return Object.entries(scripts as Record<string, string>).flatMap(([name, command]) => {
    const invocation = floorInvocation(command);
    if (invocation === null) return [];
    return invocation.patterns.map((pattern) => ({ source: `package.json:${name}`, pattern, min: invocation.min }));
  });
}

/**
 * rstest's own `include`, read off the config object rstest is handed rather than off its source text.
 * It declares no floor of its own, so 1 — "not vacuous" — is the only claim this file makes about it.
 */
async function rstestConfigGlobs(): Promise<RunnerGlob[]> {
  // The specifier is COMPUTED and the bundler told to leave it alone: rstest bundles a statically written
  // import of its own config into the test and evaluates it inside its own module cycle, which throws
  // "Cannot access '__rspack_default_export' before initialization". This loads the real file from disk.
  const href = new URL("../../../../scripts/rstest/rstest.config.mjs", import.meta.url).href;
  const config = (await import(/* webpackIgnore: true */ href)).default;
  const include: string[] = config.include ?? [];
  return include.map((pattern) => ({ source: "scripts/rstest/rstest.config.mjs:include", pattern, min: 1 }));
}

async function runnerGlobs(): Promise<RunnerGlob[]> {
  return [...packageJsonGlobs(), ...await rstestConfigGlobs()];
}

/**
 * THE PREDICATE. Which of `paths` no runner glob reaches — the one function the guard below and its
 * positive control both ask, so neither can be reading a different question from the other.
 */
function unreachedBy(paths: string[], globs: RunnerGlob[]): string[] {
  const reached = new Set(globs.flatMap((glob) => globFromRepo(glob.pattern)));
  return paths.filter((path) => !reached.has(path));
}

/** Every tracked `*.test.*` file under `packages/`, whatever its extension or depth. */
function trackedTestFiles(): string[] {
  return walkTree({ kind: "all", roots: ["packages"] })
    .map((file) => file.path)
    .filter((path) => /\.test\.[A-Za-z0-9]+$/.test(basename(path)));
}

test("every tracked test file under packages/ is reached by at least one runner glob — the positive "
  + "control for this emptiness lives in the next test, which asserts the same predicate REPORTS a real "
  + "file that no glob reaches", async () => {
  const globs = await runnerGlobs();
  const orphans = unreachedBy(trackedTestFiles(), globs);
  assert.deepEqual(orphans, [],
    `${orphans.length} test file(s) are executed by no runner: ${orphans.join(", ")}\n`
    + "A test outside every runner glob passes by hand and is run by no gate (#1940). Either move it under "
    + `a path a glob reaches, or grow a glob to include it — the ${globs.length} globs in force are:\n  `
    + globs.map((g) => `${g.pattern}   (${g.source})`).join("\n  "));
});

test("POSITIVE CONTROL: a real, tracked file that no runner glob reaches IS reported by the same "
  + "predicate — and stops being reported the moment a glob covering it is added, so the report comes "
  + "from the glob set rather than from the path being unmatchable", async () => {
  // A real file on disk, tracked, sibling of the orphan this row removed -- not a literal invented here.
  // A `.mjs` under `packages/<pkg>/scripts/` is the exact shape that slipped past every glob.
  const control = "packages/lab/scripts/corpus-snapshot.mjs";
  const tracked = walkTree({ kind: "all", roots: ["packages/lab/scripts"] }).map((file) => file.path);
  assert.ok(tracked.includes(control), `${control} is not tracked — this control asserts nothing about a `
    + "path that does not exist, which is how an emptiness assertion passes by finding nothing");

  const globs = await runnerGlobs();
  assert.deepEqual(unreachedBy([control], globs), [control]);

  const covering: RunnerGlob = { source: "this test", pattern: "packages/*/scripts/**/*.mjs", min: 1 };
  assert.ok(globFromRepo(covering.pattern).includes(control), "the covering glob must really match it");
  assert.deepEqual(unreachedBy([control], [...globs, covering]), []);
});

test("the walk really spans packages/ — a floor AND a spread across packages, because a root narrowed to "
  + "one package would still report every file it found as reached", () => {
  const testFiles = trackedTestFiles();
  const MIN_TEST_FILES = 600;
  assert.ok(testFiles.length >= MIN_TEST_FILES,
    `only ${testFiles.length} test file(s) found under packages/ — the walk looks broken (626 at #1940)`);

  const packages = new Set(testFiles.map((path) => path.split("/")[1]));
  const MIN_PACKAGES = 8;
  assert.ok(packages.size >= MIN_PACKAGES,
    `test files found in only ${packages.size} package(s) (${[...packages].join(", ")}) — a walk rooted `
    + "at one package answers a narrower question than this guard asks");
});

test("every runner glob still satisfies the floor declared beside it, so a glob quietly narrowed or "
  + "misspelled fails here even while the union above still covers every file", async () => {
  const globs = await runnerGlobs();
  // The population, pinned before anything is filtered out of it: an extraction that found no glob at all
  // would make every check below pass by having nothing to check.
  assert.ok(globs.length > 0, "no runner glob was read from package.json or the rstest config at all");
  const sources = new Set(globs.map((glob) => glob.source));
  for (const expected of ["package.json:test:ts", "package.json:test:org", "package.json:test:all",
    "package.json:test:nightly", "scripts/rstest/rstest.config.mjs:include"]) {
    assert.ok(sources.has(expected), `no glob was read from ${expected} — the extraction above found `
      + `${[...sources].join(", ")}, so a runner's own pattern is no longer being checked at all`);
  }

  const short = globs.flatMap((glob) => underFloor([glob.pattern], glob.min, globFromRepo)
    .map(({ matched }) => `${glob.source}: ${glob.pattern} matched ${matched}, below its own --min=${glob.min}`));
  assert.deepEqual(short, []);
});
