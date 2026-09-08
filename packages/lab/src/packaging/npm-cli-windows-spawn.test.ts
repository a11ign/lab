/**
 * EVERY place in this repo that spawns a bare `npx`/`npm` must resolve it through `npmCliExecutable`, or
 * be discovered and refused — not just the one call site (`scripts/build-packages.mjs`) #492 was filed
 * against.
 *
 * `spawnSync`/`execFileSync`/`spawn` given a bare `"npx"`/`"npm"` is `ENOENT` on Windows without a shell.
 * npm ships both as `.cmd` batch-file shims there, not `.exe` binaries; Windows' `CreateProcess` can only
 * launch a real executable image directly, and neither function consults `PATHEXT` to try appending an
 * extension without `shell: true`. So the bare name resolves fine on Linux/macOS (where `npx`/`npm` are
 * real files) and fails only on the one platform this repository's own CI never runs -- caught by the V1
 * rehearsal (#324): three real `windows-2022` Action runs, none of which reached NVDA or the page, because
 * `npm ci`'s own `prepare` step crashed in `build-packages.mjs` before anything else ran.
 *
 * `scripts/npm-cli-executable.mjs`'s `npmCliExecutable(name)` resolves the extension (`.cmd` on `win32`,
 * unchanged elsewhere) rather than adding a shell -- `shell: true` re-interprets the WHOLE command line as
 * one string, reintroducing the quoting hazard this repository has already paid for once (four capture
 * shards dispatched at `--worker=http://:8765` for 29 minutes). A sweep of every tracked `.mjs`/`.ts` file
 * found **23 real call sites** once `build-packages.mjs`'s own instance was fixed and the search widened
 * to the shape rather than the file -- production code, lab/fleet tooling, and eight test files that spawn
 * `npx`/`npm` inside their own bodies. All 23 route through the helper now; this test is what keeps a
 * 24th from slipping past unnoticed.
 *
 * TWO CANONICAL COPIES, ONE PUBLISH BOUNDARY. `packages/worker-fleet/src/npm-cli-executable.mjs` is a
 * deliberate, disclosed duplicate of the repo-root file (see its own header): `doctor.mjs` ships inside
 * `@a11ign/worker-fleet`'s published `bin` entries and cannot import outside the package, the identical
 * constraint `git-safe-env.mjs` already carries for the same reason. `npm-cli-executable.test.ts` beside
 * it pins the two behaviourally equal, this repo's own remedy #3 ("pin them equal with a test") for the
 * one case remedy #1 ("delete a copy") cannot reach.
 *
 * DISCOVERED, never hand-listed, the identical shape `git-spawn-classification.test.ts` already uses and
 * for the identical reason: a hand-maintained "the files that spawn npx/npm" list is exactly the kind of
 * list a new call site slips past. Every `.ts`/`.mjs` file tracked in git is scanned, comments stripped
 * first, for a call shaped `<identifier>("npx"|"npm", ...)` -- broad enough to catch an indirected call
 * site (`isolation-gate.mjs`'s local `run("npm", ...)`, `doctor.mjs`'s injectable `run` parameter) without
 * being a list of function names a new wrapper could slip past.
 *
 * CLASSIFICATION, not a bare pass/fail: a call is SAFE only when the identifier calling `"npx"`/`"npm"`
 * IS `npmCliExecutable` itself -- so `execFileSync("npx", ...)` is unsafe and `execFileSync(npmCliExecutable("npx"), ...)`
 * is safe, without needing a separate "imports and uses the helper" check the way the git guard does: the
 * identifier at the call site says everything, because there is no indirection to hide behind here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/** Every tracked `.ts`/`.mjs` file, GIT_* scrubbed even for this housekeeping call. */
function trackedSourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.mjs"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes("/dist/") && !f.includes("/node_modules/"));
}

/**
 * `<identifier>("npx"|"npm", ...)`, comments stripped first. Deliberately not anchored to `execFileSync`/
 * `spawnSync`/`spawn` by name: `isolation-gate.mjs` and `doctor.mjs` both call through a local `run`
 * wrapper, never the `node:child_process` function directly.
 */
const SPAWNS_NPM_CLI = /\b(\w+)\(\s*["'](npx|npm)["']/g;

/**
 * CALLS PASSING THE STRING "npx"/"npm" AS DATA, NEVER AS A COMMAND TO SPAWN -- classified, never silently
 * skipped, the identical shape `GIT_IS_DATA_NOT_A_SPAWN` uses in `git-spawn-classification.test.ts` and for
 * the identical reason: `SPAWNS_NPM_CLI` is deliberately broad, so it also matches a string-membership
 * check (`.includes("npm")`, `.endsWith("npm")`) or a local predicate/classifier taking the word as its
 * own input, none of which spawns anything.
 */
const NPM_CLI_IS_DATA_NOT_A_SPAWN: Record<string, string> = {
  "packages/lab/src/gates/gate-partial-corpus-contract.test.ts":
    '`tokens[0]?.includes("npm")` -- a string-membership check on an already-captured argv token, not a spawn',
  "packages/worker-fleet/src/lab-job.test.ts":
    '`argv[0]?.endsWith("npm")` and `tokens[0]?.includes("npm")` -- string-membership checks on captured '
    + "argv, not a spawn (two occurrences)",
  "packages/lab/src/packaging/acceptance-prose.test.ts":
    '`onlyResolves("npx")` and `classifyCommand("npm run fleet:deploy", ...)` -- a local test predicate '
    + "standing in for an injected seam, and a string handed to a classifier as DATA to judge, neither of "
    + "which spawns anything (already exempted from git-spawn-classification.test.ts for the identical shape)",
  // THIS FILE'S OWN MUTATION/CONTROL FIXTURES, caught by its own discovery on the first real run --
  // exactly the #446 shape (`acceptance-prose.test.ts` above) reproduced one level in. Each fixture is a
  // STRING containing source text handed to `npmCliCalls`/`callsBareNpmCli` as data to classify, never
  // code this file itself executes.
  "packages/lab/src/packaging/npm-cli-windows-spawn.test.ts":
    'its own MUTATION/CONTROL test fixtures are STRINGS containing `execFileSync("npx", ...)`-shaped '
    + "source text, fed to npmCliCalls()/callsBareNpmCli() as the DATA under test -- never code this file "
    + "itself executes. The identical trap #446 hit in acceptance-prose.test.ts, found here by this "
    + "guard's own first real run rather than by review.",
  // `npmCliExecutable` imported under ALIASES to compare both canonical copies side by side -- the
  // identifier at each call site is `rootNpmCliExecutable`/`localNpmCliExecutable`, never the literal
  // name `callsBareNpmCli` checks for, even though both resolve to the real, safe function.
  "packages/worker-fleet/src/npm-cli-executable.test.ts":
    "imports npmCliExecutable under aliases (rootNpmCliExecutable, localNpmCliExecutable) to compare the "
    + "root and worker-fleet copies side by side -- the call site's identifier is the alias, not the "
    + "literal name this file's classifier matches, though both resolve to the real, safe function",
};

/** Every `(identifier, literal)` pair the file's stripped source contains, for `"npx"`/`"npm"` literals. */
function npmCliCalls(executable: string): { identifier: string }[] {
  return [...executable.matchAll(SPAWNS_NPM_CLI)].map(([, identifier]) => ({ identifier }));
}

/** A call is SAFE only when the identifier invoking the literal IS `npmCliExecutable` itself. */
function callsBareNpmCli(executable: string): boolean {
  return npmCliCalls(executable).some(({ identifier }) => identifier !== "npmCliExecutable");
}

test("the discovery finds a non-trivial population -- vacuity guard for the walk itself", () => {
  const files = trackedSourceFiles();
  assert.ok(files.length > 500, `only found ${files.length} tracked .ts/.mjs files -- the ls-files scan is broken`);
  const touchingNpmCli = files.filter((f) => npmCliCalls(stripComments(read(f))).length > 0);
  // The known census at the time this test was written: 23 real call sites plus 3 files carrying the
  // 4 documented data-not-a-spawn exemptions. A lower bound, not a pin -- a NEW file legitimately raises
  // this count, and the test below is what catches one that is not routed through the helper.
  assert.ok(touchingNpmCli.length >= 20,
    `only found ${touchingNpmCli.length} file(s) mentioning npx/npm as a call argument, fewer than the `
    + "known census of ~26 -- the discovery pattern itself is probably broken, not the population shrinking");
});

test("every NPM_CLI_IS_DATA_NOT_A_SPAWN entry names a real file that genuinely spawns nothing", () => {
  const tracked = new Set(trackedSourceFiles());
  for (const [file, reason] of Object.entries(NPM_CLI_IS_DATA_NOT_A_SPAWN)) {
    assert.ok(tracked.has(file),
      `${file} is exempted but is not a tracked source file -- a stale exemption hides the next real one`);
    assert.ok(reason.trim().length > 40, `${file}'s exemption needs a reason a reader can check`);
  }
});

test("every npx/npm call site resolves through npmCliExecutable, or is a documented non-spawn", () => {
  const files = trackedSourceFiles();
  const unclassified: string[] = [];
  for (const file of files) {
    const executable = stripComments(read(file));
    if (npmCliCalls(executable).length === 0) continue;
    if (file in NPM_CLI_IS_DATA_NOT_A_SPAWN) continue;
    if (callsBareNpmCli(executable)) unclassified.push(file);
  }
  assert.deepEqual(unclassified, [],
    `${unclassified.length} file(s) spawn a bare "npx"/"npm" without resolving through npmCliExecutable -- `
    + "this is the exact shape that made the Action's own build ENOENT on windows-2022 (#492), invisible "
    + "because every CI job here runs on Linux:\n"
    + unclassified.map((f) => `  ${f}`).join("\n"));
});

// --- The guard must be shown to fail, or it proves nothing (CLAUDE.md: "a guard must be shown to fail
// before it is trusted") ---

test("MUTATION: a file spawning a bare npx with no helper wrap is CAUGHT, not silently passed", () => {
  const fixture = 'import { execFileSync } from "node:child_process";\n'
    + 'execFileSync("npx", ["tsc", "--build"], { cwd: "/tmp" });\n';
  assert.equal(npmCliCalls(stripComments(fixture)).length, 1, "the discovery pattern must match a plain npx spawn");
  assert.ok(callsBareNpmCli(stripComments(fixture)), "a bare npx spawn must be classified UNSAFE");
});

test("MUTATION: an indirected call through a local run() wrapper is still discovered", () => {
  // isolation-gate.mjs's own shape: the literal "npm" is the first argument to a locally-named `run`,
  // never to execFileSync directly.
  const fixture = 'function run(cmd, args, cwd) { return execFileSync(cmd, args, { cwd }); }\n'
    + 'run("npm", ["pack", "--dry-run"], "/tmp");\n';
  assert.ok(callsBareNpmCli(stripComments(fixture)),
    "the discovery must see through a one-level indirection to the literal npm call");
});

test("CONTROL: a call resolved through npmCliExecutable passes", () => {
  const fixture = 'import { execFileSync } from "node:child_process";\n'
    + 'import { npmCliExecutable } from "../../../../scripts/npm-cli-executable.mjs";\n'
    + 'execFileSync(npmCliExecutable("npx"), ["tsc", "--build"], { cwd: "/tmp" });\n';
  assert.equal(npmCliCalls(stripComments(fixture)).length, 1);
  assert.ok(!callsBareNpmCli(stripComments(fixture)),
    "a call resolved through npmCliExecutable must be classified SAFE, or every real fixed file would fail too");
});

test("CONTROL: a file that never mentions npx/npm as a call argument is simply not part of the population", () => {
  const fixture = 'export function addOne(n: number) { return n + 1; }\n';
  assert.equal(npmCliCalls(stripComments(fixture)).length, 0);
});
