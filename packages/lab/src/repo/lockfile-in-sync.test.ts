/**
 * EVERY WORKSPACE MUST BE IN THE LOCKFILE, or `pnpm install --frozen-lockfile` fails and ALL of CI goes red.
 *
 * Measured 2026-08-29, under npm: extracting `packages/control` without refreshing `package-lock.json` left
 * `npm ci` failing with `Missing: @a11ign/control@0.1.0 from lock file`, and that is the first
 * step of every workflow. `lint.yml` (retired 2026-09-06, folded into `.github/workflows/ci.yml`, which
 * gates lint, typecheck and the test suite the same way) and `action-smoke.yml` were both red for
 * hours, and `action-smoke` is release guard 5 — the only check that drives the weights the way a
 * consumer does — so a release could not have passed either.
 *
 * MOVED TO `pnpm-lock.yaml` BY #2301, which deleted `package-lock.json`; the property is the same and so is
 * the reason. `--frozen-lockfile` refuses a lockfile that disagrees with any manifest, and it is the first
 * step of every workflow, so a stale lockfile turns everything red at once.
 *
 * NOTHING LOCAL COULD SEE IT. The pre-push hook runs lint, typecheck and tests against the
 * `node_modules` already on disk; a frozen install is the one command that reads the lockfile as a
 * specification, and it only ever runs in CI. So every local check passed, every push succeeded, and
 * the thing that was broken was the thing nobody local runs.
 *
 * This is offline, reads one YAML file and the manifests, and takes milliseconds — so it belongs with the
 * checks that run before a push rather than with the ones that need a worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "../../../..");
const readManifest = (dir: string) => JSON.parse(readFileSync(resolve(ROOT, dir, "package.json"), "utf8"));

interface Importer { dependencies?: Record<string, { specifier: string; version: string }> }
const importers = (): Record<string, Importer> =>
  (parse(readFileSync(resolve(ROOT, "pnpm-lock.yaml"), "utf8")) as { importers: Record<string, Importer> }).importers;

/** Directories under packages/ that are real workspaces — those with a package.json. */
function workspaceDirs(): string[] {
  return readdirSync(resolve(ROOT, "packages"))
    .filter((entry) => existsSync(resolve(ROOT, "packages", entry, "package.json")))
    .map((entry) => `packages/${entry}`)
    .sort();
}

test("every workspace on disk is present in pnpm-lock.yaml", () => {
  const lock = importers();
  const missing = workspaceDirs().filter((dir) => !(dir in lock));
  assert.deepEqual(missing, [],
    "`pnpm install --frozen-lockfile` refuses a lockfile that does not describe every workspace, and it is the "
    + "first step of every CI workflow — so this failing means lint, typecheck, tests and action-smoke are ALL "
    + "red. Fix with: pnpm install");
});

test("every dependency a workspace declares is recorded in the lockfile, at the range it declares", () => {
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
  //
  // THE RANGE IS COMPARED TOO (#2301), which npm's lockfile made unnecessary to say: pnpm records each
  // importer's `specifier` beside what it resolved, and `--frozen-lockfile` refuses a specifier that differs
  // from the manifest's. That is exactly what `release:version` produces if its lockfile-only install is
  // skipped: every internal range moves from `0.0.0` to the released version in the manifests alone.
  const lock = importers();
  const unlocked: string[] = [];
  for (const dir of workspaceDirs()) {
    const declared: Record<string, string> = readManifest(dir).dependencies ?? {};
    const locked = lock[dir]?.dependencies ?? {};
    for (const [name, range] of Object.entries(declared)) {
      if (!(name in locked)) unlocked.push(`${dir} declares ${name}, and the lockfile does not record it`);
      else if (locked[name].specifier !== range) {
        unlocked.push(`${dir} declares ${name}@${range}, the lockfile records ${locked[name].specifier}`);
      }
    }
  }
  assert.deepEqual(unlocked, [],
    "A dependency in package.json that the lockfile does not carry resolves locally whenever something "
    + "else already pulled it in, and fails wherever a frozen install is the install — which is CI and the "
    + "lab. Fix with: pnpm install");
});

test("and the reverse: the lockfile names no workspace that has been deleted", () => {
  // The other direction is quieter and still wrong: a frozen install will try to link a path that is not there.
  const onDisk = new Set(workspaceDirs());
  const ghosts = Object.keys(importers())
    .filter((k) => k.startsWith("packages/"))
    .filter((k) => !onDisk.has(k));
  assert.deepEqual(ghosts, [], "the lockfile describes a workspace that no longer exists");
});

test("and no npm lockfile is left beside it, naming a resolver nobody installs with any more (#2301)", () => {
  assert.equal(existsSync(resolve(ROOT, "package-lock.json")), false,
    "package-lock.json came back: two lockfiles resolve two different trees, and only one of them is read");
});

test("the discovery is real, so this cannot pass having examined nothing", () => {
  assert.ok(workspaceDirs().length >= 5,
    `found only ${workspaceDirs().length} workspaces; the walk is broken, not the repo clean`);
  const declaring = workspaceDirs().filter((dir) => Object.keys(readManifest(dir).dependencies ?? {}).length > 0);
  assert.ok(declaring.length >= 5, "the dependency comparison above would pass over nothing");
});
