/**
 * EVERY place in this repo that spawns a bare `npx`/`npm` must resolve it through `npmCliInvocation`, or
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
 * REWRITTEN when #492 REOPENED. The original fix here was `npmCliExecutable(name)` -- append `.cmd` on
 * `win32`, unchanged elsewhere -- resolved as an ARGUMENT passed into `execFileSync`/`spawnSync`/`spawn`
 * (`execFileSync(npmCliExecutable("npx"), ...)`). That premise (Node auto-routes a bare `.cmd` through
 * `cmd.exe`) stopped being true in April 2024: CVE-2024-27980 ("BatBadBut") permanently made those
 * functions REFUSE (`EINVAL`) to launch a `.bat`/`.cmd` file directly without `shell: true`, on every Node
 * release past 18.20.2/20.12.2/21.7.3. `windows-2022`'s Node is well past the patch, so the fix turned an
 * `ENOENT` into an `EINVAL` on the very platform it targeted -- found live by #494's consumer gate, a real
 * `windows-2022` run (`34265163648`), not by this file, because the win32 branch had only ever been
 * verified by overriding `process.platform` in a unit test.
 *
 * `ceo`'s ruling: no `shell: true`, anywhere -- the same quoting-hazard class as `--worker=http://:8765`
 * dispatching four capture shards for 29 minutes. So the call shape changed entirely: `npmCliInvocation`
 * never spawns `.cmd`/`.bat`, it resolves npm's OWN CLI script (`npx-cli.js`/`npm-cli.js`, tried at both
 * the Windows-shaped and POSIX-shaped layout relative to `process.execPath`) and returns
 * `{ command: process.execPath, args: [script, ...originalArgs] }` -- so `argv[0]` is always `node`
 * itself. See `scripts/npm-cli-executable.mjs`'s own header for the full incident and the two-layout
 * resolution. **A unit guard pins the call shape; the consumer gate proves it runs** -- a source-text walk
 * structurally cannot catch a real `EINVAL`, only a real `windows-2022` dispatch can, and this file is the
 * former, not the latter.
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
 * IS `npmCliInvocation` itself -- so `execFileSync("npx", ...)` is unsafe and
 * `execFileSync(npmCliInvocation("npx", args).command, npmCliInvocation("npx", args).args, ...)`-shaped
 * code (in practice, `const npx = npmCliInvocation("npx", args); execFileSync(npx.command, npx.args, ...)`)
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
import { declareTreeWideGuard } from "../../../../scripts/tree-wide-guard.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file -- declared here
// rather than inferred from its source, per ceo's ruling (2026-09-09) that the tree-wide-guard
// population must be derived from a real import, never from scanning source text.
declareTreeWideGuard();

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
  // `npmCliScriptCandidates`/`resolveNpmCliScript`/`npmCliInvocation` imported under ALIASES to compare
  // both canonical copies side by side -- the identifier at each call site is `rootCandidates`/
  // `localCandidates`/`rootResolve`/`localResolve`/`rootInvocation`/`localInvocation`, never the literal
  // name `callsBareNpmCli` checks for, even though both resolve to the real, safe functions.
  "packages/worker-fleet/src/npm-cli-executable.test.ts":
    "imports npmCliScriptCandidates/resolveNpmCliScript/npmCliInvocation under aliases (root*/local*) to "
    + "compare the root and worker-fleet copies side by side -- the call site's identifier is the alias, "
    + "not the literal name this file's classifier matches, though both resolve to the real, safe functions",
};

/** Every `(identifier, literal)` pair the file's stripped source contains, for `"npx"`/`"npm"` literals. */
function npmCliCalls(executable: string): { identifier: string }[] {
  return [...executable.matchAll(SPAWNS_NPM_CLI)].map(([, identifier]) => ({ identifier }));
}

/** A call is SAFE only when the identifier invoking the literal IS `npmCliInvocation` itself. */
function callsBareNpmCli(executable: string): boolean {
  return npmCliCalls(executable).some(({ identifier }) => identifier !== "npmCliInvocation");
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

test("every npx/npm call site resolves through npmCliInvocation, or is a documented non-spawn", () => {
  const files = trackedSourceFiles();
  const unclassified: string[] = [];
  for (const file of files) {
    const executable = stripComments(read(file));
    if (npmCliCalls(executable).length === 0) continue;
    if (file in NPM_CLI_IS_DATA_NOT_A_SPAWN) continue;
    if (callsBareNpmCli(executable)) unclassified.push(file);
  }
  assert.deepEqual(unclassified, [],
    `${unclassified.length} file(s) spawn a bare "npx"/"npm" without resolving through npmCliInvocation -- `
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

test("CONTROL: a call resolved through npmCliInvocation passes", () => {
  const fixture = 'import { execFileSync } from "node:child_process";\n'
    + 'import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";\n'
    + 'const npx = npmCliInvocation("npx", ["tsc", "--build"]);\n'
    + 'execFileSync(npx.command, npx.args, { cwd: "/tmp" });\n';
  assert.equal(npmCliCalls(stripComments(fixture)).length, 1);
  assert.ok(!callsBareNpmCli(stripComments(fixture)),
    "a call resolved through npmCliInvocation must be classified SAFE, or every real fixed file would fail too");
});

test("CONTROL: a file that never mentions npx/npm as a call argument is simply not part of the population", () => {
  const fixture = 'export function addOne(n: number) { return n + 1; }\n';
  assert.equal(npmCliCalls(stripComments(fixture)).length, 0);
});
