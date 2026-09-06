/**
 * EVERY place in this repo that spawns `git` must scrub `GIT_*` from its environment, or be discovered
 * and refused — not just the eleven tests that left evidence when this went wrong.
 *
 * git EXPORTS `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` into every hook environment. On 2026-09-06 the
 * pre-push hook started running `npm test` with `GIT_DIR` set — because the audit row "nothing installs
 * the git hooks" had just been CLOSED — and a test that spawned git with `cwd` alone and an inherited
 * `env` operated on the REAL repository instead of its own throwaway one: `core.bare` flipped twice,
 * stray commits landed on real refs, and a test's own `git config user.name` was written into the real
 * repo and reused as author on 15 commits, six of them real work already on `origin/main`. **A closed
 * row created the exposure.**
 *
 * Three test files (`pre-commit-hook`, `promotion-refuses-dirty`, `lab-reset-removal`) were where the
 * corruption left evidence, because they write. But eleven git-shelling tests existed, and read-only
 * ones are not exempt: a redirected `git status`/`git ls-files`/`git branch --list` does not corrupt
 * anything, it silently examines the WRONG repository and reports on it as though it were this one. And
 * the class is bigger than tests -- production code shells to git too (`code-drift.mjs`'s
 * `workerSourceDirty`, read via a redirected `git status`, would report a dirty worker checkout as
 * CLEAN). THREE is the instance; the population this test discovers is the class.
 *
 * DISCOVERED, never hand-listed: a hand-maintained "the files that spawn git" list is exactly the kind
 * of list a new call site slips past -- this repo's own recorded shape (CLAUDE.md, "A FACT STATED
 * TWICE"). Every `.ts`/`.mjs` file tracked in git is scanned, comments stripped first (the same reason
 * `exit-code-contract.test.ts`/`cli-flags.test.ts`/`rules-gate-export-divergence.test.ts` strip them: a
 * file that only MENTIONS spawning git in prose has not done it), for a call shaped
 * `<identifier>("git", ...)` -- broad enough to catch an indirected call site (`install-git-hooks.mjs`
 * calls `run("git", ...)` through an injected seam, not `execFileSync` directly) without being a list of
 * function names that a new wrapper could slip past.
 *
 * CLASSIFICATION, not a bare pass/fail: a discovered file is SAFE only if it imports one of the three
 * canonical scrubbing helpers (`scripts/git-env.mjs`, `scripts/test-support/git-sandbox.ts`, or
 * `packages/worker-fleet/src/git-safe-env.mjs` -- the last one a DELIBERATE, disclosed duplicate forced
 * by worker-fleet's publish boundary, see that file's own header) AND actually calls it, not merely
 * imports it unused. A twelfth git-shelling file that imports nothing fails this test by name until
 * somebody classifies it -- which is the whole point: this walk is a census, and a classification is
 * only as good as the population it can actually see (a sibling lesson: `evidence-fields.test.ts`
 * reads a capture's fields at the top level and cannot see one wrapped in `.capture`, so 29 real records
 * were invisible to a working guard -- the same failure mode, a reader examining less than it believes,
 * one level along).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11y-witness/evidence/source-text";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/**
 * The three modules a git-shelling file may import to be classified SAFE, matched by BASENAME rather
 * than full repo path -- every real call site imports one of these by a RELATIVE specifier (`./git-env.mjs`,
 * `../../../scripts/git-env.mjs`, etc.), so matching the full canonical path would miss every real import.
 * Adding a fourth canonical helper means adding its basename here.
 */
const CANONICAL_HELPER_BASENAMES = ["git-env.mjs", "git-safe-env.mjs", "git-sandbox.ts"];
const CANONICAL_HELPERS = [
  "scripts/git-env.mjs",
  "scripts/test-support/git-sandbox.ts",
  "packages/worker-fleet/src/git-safe-env.mjs",
];

/** Every tracked `.ts`/`.mjs` file, GIT_* scrubbed even for this housekeeping call -- no reason to be the exception. */
function trackedSourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.mjs"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes("/dist/") && !f.includes("/node_modules/"))
    // The three canonical helpers and their OWN tests are exempt from needing to import themselves --
    // they either ARE the sanitizer or exist to prove it, and are read separately below.
    .filter((f) => !CANONICAL_HELPERS.includes(f) && !f.endsWith("git-safe-env.test.ts") && !f.endsWith("git-sandbox.test.ts"));
}

/**
 * `<identifier>("git", ...)`, comments stripped first. Deliberately not anchored to `execFileSync` /
 * `spawnSync` / `execFile` / `spawn` by name: `install-git-hooks.mjs` calls `run("git", ...)` through an
 * injected seam precisely so it is testable without a real git binary, and a discovery anchored to the
 * four node:child_process names would miss exactly that indirection -- the same "static derivation
 * cannot be trusted" lesson CLAUDE.md already records for CLI flag scraping.
 */
const SPAWNS_GIT_DIRECTLY = /\b\w+\(\s*["']git["']/;

/**
 * A file spawns git either directly (matched above) or through `withGitSandbox`, which never appears as
 * a literal `"git"` call at the SITE it is used from -- `pre-commit-hook.test.ts`, `promotion-refuses-
 * dirty.test.ts` and `lab-reset-removal.test.ts` all migrated to it and, correctly, no longer contain the
 * literal string. Missing this second form would silently shrink the discovered population by exactly the
 * three files that motivated writing this test in the first place -- the "reader examining less than it
 * believes" failure named in this file's header, caught here by testing the discovery against the real
 * fixed files rather than trusting the regex on sight.
 */
function spawnsGit(executable: string): boolean {
  return SPAWNS_GIT_DIRECTLY.test(executable) || /\bwithGitSandbox\(/.test(executable);
}

/** Imports one of the canonical helpers (by basename, since real imports are relative) AND actually calls it. */
function usesCanonicalHelper(executable: string): boolean {
  const importsHelper = CANONICAL_HELPER_BASENAMES.some((basename) => executable.includes(basename));
  if (!importsHelper) return false;
  return /\bsandboxGitEnv\(/.test(executable) || /\bwithGitSandbox\(/.test(executable);
}

test("the discovery finds a non-trivial population -- vacuity guard for the walk itself", () => {
  const files = trackedSourceFiles();
  assert.ok(files.length > 500, `only found ${files.length} tracked .ts/.mjs files -- the ls-files scan is broken`);
  const spawningGit = files.filter((f) => spawnsGit(stripComments(read(f))));
  // The known census at the time this test was written: 11 tests plus 7 production files (see this
  // file's header). A lower bound, not a pin -- a NEW git-spawning file legitimately raises this count,
  // and the test below is what catches one that is not classified. This guard exists only to catch the
  // OTHER failure: the regex itself breaking and matching nothing.
  assert.ok(spawningGit.length >= 18,
    `only found ${spawningGit.length} git-spawning file(s), fewer than the known census of ~18 -- the `
    + `discovery pattern itself is probably broken, not the population shrinking`);
});

test("every git-spawning file imports and USES a canonical GIT_* scrubbing helper", () => {
  const files = trackedSourceFiles();
  const unclassified: string[] = [];
  for (const file of files) {
    const executable = stripComments(read(file));
    if (!spawnsGit(executable)) continue;
    if (!usesCanonicalHelper(executable)) unclassified.push(file);
  }
  assert.deepEqual(unclassified, [],
    `${unclassified.length} file(s) spawn git without scrubbing GIT_* through a canonical helper -- this `
    + "is the exact shape that let a leaked GIT_DIR redirect a spawned git call onto the real repository "
    + `on 2026-09-06 (docs/backlog.md, 'a closed row created the exposure'):\n`
    + unclassified.map((f) => `  ${f}`).join("\n"));
});

// --- The guard must be shown to fail, or it proves nothing (CLAUDE.md: "a guard must be shown to fail
// before it is trusted") ---

test("MUTATION: a file spawning git with no helper import is CAUGHT, not silently passed", () => {
  const fixture = 'import { execFileSync } from "node:child_process";\n'
    + 'execFileSync("git", ["status"], { cwd: "/tmp" });\n';
  assert.ok(spawnsGit(stripComments(fixture)), "the discovery pattern must match a plain git spawn");
  assert.ok(!usesCanonicalHelper(stripComments(fixture)),
    "a file with no canonical-helper import must not be classified SAFE");
});

test("MUTATION: an import with no actual call is NOT classified SAFE -- 'imported' is not 'used'", () => {
  const fixture = 'import { execFileSync } from "node:child_process";\n'
    + 'import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";\n'
    // sandboxGitEnv is imported but never called -- the git spawn below is still bare.
    + 'execFileSync("git", ["status"], { cwd: "/tmp" });\n';
  assert.ok(spawnsGit(stripComments(fixture)));
  assert.ok(!usesCanonicalHelper(stripComments(fixture)),
    "importing sandboxGitEnv without calling it must not satisfy the check -- an unused import guards nothing");
});

test("MUTATION: an indirected call through an injected seam is still discovered", () => {
  // install-git-hooks.mjs's own shape: the literal "git" is the first argument to a locally-named `run`,
  // never to execFileSync directly. A discovery anchored to node:child_process function names would miss
  // this exact file.
  const fixture = 'const run = (cmd, args, opts) => execFileSync(cmd, args, opts);\n'
    + 'run("git", ["config", "core.hooksPath", "x"], { cwd: "/repo" });\n';
  assert.ok(spawnsGit(stripComments(fixture)),
    "the discovery must see through a one-level indirection to the literal git call");
});

test("CONTROL: a correctly classified file passes", () => {
  const fixture = 'import { execFileSync } from "node:child_process";\n'
    + 'import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";\n'
    + 'execFileSync("git", ["status"], { cwd: "/tmp", env: sandboxGitEnv() });\n';
  assert.ok(spawnsGit(stripComments(fixture)));
  assert.ok(usesCanonicalHelper(stripComments(fixture)),
    "a file importing AND calling sandboxGitEnv must be classified SAFE, or every real file would fail too");
});

test("MUTATION: a file using withGitSandbox with no literal git call is still discovered, not invisible", () => {
  // Exactly the shape pre-commit-hook.test.ts, promotion-refuses-dirty.test.ts and lab-reset-removal.test.ts
  // took after migrating: the literal "git" string disappears behind `sandbox.run`/`sandbox.commit`, and a
  // discovery anchored ONLY to a literal git call would silently shrink the population by these three --
  // the exact "reader examining less than it believes" failure this file's header names.
  const fixture = 'import { withGitSandbox } from "../../../../scripts/test-support/git-sandbox.ts";\n'
    + 'withGitSandbox((sandbox) => { sandbox.run(["status"]); });\n';
  assert.ok(spawnsGit(stripComments(fixture)),
    "a file that spawns git only through withGitSandbox, with no literal git call of its own, must still "
    + "be discovered -- and must also be classified SAFE, since going through the sandbox IS the fix");
  assert.ok(usesCanonicalHelper(stripComments(fixture)));
});

test("CONTROL: a file that never spawns git is simply not part of the population", () => {
  const fixture = 'export function addOne(n: number) { return n + 1; }\n';
  assert.ok(!spawnsGit(stripComments(fixture)));
});
