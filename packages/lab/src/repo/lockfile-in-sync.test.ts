/**
 * EVERY WORKSPACE MUST BE IN THE LOCKFILE, or `npm ci` fails and ALL of CI goes red.
 *
 * Measured 2026-08-29: extracting `packages/control` without refreshing `package-lock.json` left
 * `npm ci` failing with `Missing: @a11y-witness/control@0.1.0 from lock file`, and that is the first
 * step of every workflow. `lint.yml` (which gates lint, typecheck and the test suite) and
 * `action-smoke.yml` were both red for hours, and `action-smoke` is release guard 5 — the only check
 * that drives the weights the way a consumer does — so a release could not have passed either.
 *
 * NOTHING LOCAL COULD SEE IT. The pre-push hook runs lint, typecheck and tests against the
 * `node_modules` already on disk; `npm ci` is the one command that reads the lockfile as a
 * specification, and it only ever runs in CI. So every local check passed, every push succeeded, and
 * the thing that was broken was the thing nobody local runs.
 *
 * This is offline, reads two JSON files, and takes milliseconds — so it belongs with the checks that
 * run before a push rather than with the ones that need a worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../../..");
const read = (file: string) => JSON.parse(readFileSync(resolve(ROOT, file), "utf8"));

/** Directories under packages/ that are real workspaces — those with a package.json. */
function workspaceDirs(): string[] {
  return readdirSync(resolve(ROOT, "packages"))
    .filter((entry) => existsSync(resolve(ROOT, "packages", entry, "package.json")))
    .map((entry) => `packages/${entry}`)
    .sort();
}

test("every workspace on disk is present in package-lock.json", () => {
  const lock = read("package-lock.json");
  const missing = workspaceDirs().filter((dir) => !(dir in lock.packages));
  assert.deepEqual(missing, [],
    "`npm ci` refuses a lockfile that does not describe every workspace, and it is the first step of "
    + "every CI workflow — so this failing means lint, typecheck, tests and action-smoke are ALL red. "
    + "Fix with: npm install --package-lock-only");
});

test("every dependency a workspace declares is recorded in the lockfile", () => {
  // THE SIBLING GAP, and it cost a lab round-trip on 2026-09-02.
  //
  // The test above answers "is this workspace in the lock". It cannot see a workspace that GAINED a
  // dependency: `packages/cli` declared `yaml` for the forms config (ADR 0024), the lockfile was never
  // refreshed, and every local check passed — because `yaml` was already in `node_modules` as somebody
  // else's transitive dependency, so `import { parse } from "yaml"` resolved on this machine.
  //
  // It failed on the LAB, three stages into a pipeline, as
  // `error TS2307: Cannot find module 'yaml'`. That is the same shape as the defect this file was written
  // for and one level down: the thing that was broken was the thing nobody local runs, and the reason it
  // looked fine locally is that node_modules is not the specification — the lockfile is.
  const lock = read("package-lock.json");
  const unlocked: string[] = [];
  for (const dir of workspaceDirs()) {
    const declared = read(`${dir}/package.json`).dependencies ?? {};
    const locked = lock.packages[dir]?.dependencies ?? {};
    for (const name of Object.keys(declared)) {
      if (!(name in locked)) unlocked.push(`${dir} declares ${name}, and the lockfile does not record it`);
    }
  }
  assert.deepEqual(unlocked, [],
    "A dependency in package.json that the lockfile does not carry resolves locally whenever something "
    + "else already pulled it in, and fails wherever `npm ci` is the install — which is CI and the lab. "
    + "Fix with: npm install");
});

test("and the reverse: the lockfile names no workspace that has been deleted", () => {
  // The other direction is quieter and still wrong: `npm ci` will try to link a path that is not there.
  const lock = read("package-lock.json");
  const onDisk = new Set(workspaceDirs());
  const ghosts = Object.keys(lock.packages)
    .filter((k) => k.startsWith("packages/") && !k.includes("node_modules"))
    .filter((k) => !onDisk.has(k));
  assert.deepEqual(ghosts, [], "the lockfile describes a workspace that no longer exists");
});

test("each workspace's LINK entry exists too, which is what npm ci actually resolves", () => {
  // Two entries per workspace: `packages/<name>` describing it, and `node_modules/<pkg-name>` linking
  // it. The first version of this test checked only the first, and `npm ci` reads the second.
  const lock = read("package-lock.json");
  const missing = workspaceDirs()
    .map((dir) => ({ dir, name: read(`${dir}/package.json`).name as string }))
    .filter(({ name }) => name && !(`node_modules/${name}` in lock.packages))
    .map(({ name }) => name);
  assert.deepEqual(missing, [], "a workspace with no node_modules link cannot be resolved by npm ci");
});

test("the discovery is real, so this cannot pass having examined nothing", () => {
  assert.ok(workspaceDirs().length >= 5,
    `found only ${workspaceDirs().length} workspaces; the walk is broken, not the repo clean`);
});
