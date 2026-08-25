/**
 * `composite: true` must make the package dependency graph a COMPILER-ENFORCED invariant.
 *
 * That is the load-bearing claim in ADR 0005 — the reason the split is worth doing at all. Its argument is
 * that this repo's three most expensive defects were each "a fix applied at one call site when the behaviour
 * reached several", and that neither eslint nor plain `tsc` could see any of them. A reference graph can see
 * that class of mistake, but only if it genuinely refuses a bad graph.
 *
 * So this asserts the refusal rather than trusting the setting:
 *
 * - two projects that reference each other are a **build error** (TS6202), not a warning a human must spot;
 * - a sound composite project still builds and emits `.d.ts`, so the check is not merely always-failing.
 *
 * The second test is what makes the first mean anything, exactly as in `isolation-gate.test.ts`. A `tsc
 * --build` that failed on everything would "catch" the cycle and be useless.
 *
 * Why now, with `packages/` still empty (PLAN.md M1): the enforcement is verified BEFORE any code depends on
 * it. This project's most repeated failure is a check that exists and does not run — `capture-check` was
 * mandatory and never ran; `release:gate` was broken from the day it was written. Verifying the mechanism
 * while it guards nothing is the cheap moment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const fixture = (name: string) => join(root, "scripts/tsconfig-fixtures", name);

/** `tsc --build` caches in `.tsbuildinfo`, so a stale one would let a later run pass by doing nothing. */
function buildClean(dir: string): { code: number; output: string } {
  for (const stale of ["dist", "tsconfig.tsbuildinfo"]) rmSync(join(dir, stale), { recursive: true, force: true });
  try {
    const output = execFileSync("npx", ["tsc", "--build", "--force", dir], { cwd: root, encoding: "utf8" });
    return { code: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("a reference cycle between two projects is a BUILD ERROR", () => {
  const result = buildClean(fixture("cycle-a"));
  assert.notEqual(result.code, 0, "a circular project reference must fail the build, not merely warn");
  // The specific diagnostic, so a future tsc that failed for an unrelated reason cannot be mistaken for this
  // check still working.
  assert.match(result.output, /TS6202/);
  assert.match(result.output, /circular/i);
  // And not for the wrong reason. This test PASSED in a clean clone that was missing `tsconfig.base.json`
  // entirely — tsc reports the cycle before it needs the base config, so "the cycle is rejected" was true
  // while the milestone's whole point was absent from the repo. TS5083 is that state; refuse it here.
  assert.doesNotMatch(result.output, /TS5083/, "a config the fixture extends is missing; this passed vacuously");
});

test("a sound composite project builds and emits declarations", () => {
  const dir = fixture("sound-build");
  const result = buildClean(dir);
  assert.equal(result.code, 0, `a valid composite project must build; got: ${result.output}`);
  // `.d.ts` is not a nicety here: M0 measured that Node REFUSES to strip types under `node_modules`
  // (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a consumer can only ever get types from emit.
  for (const emitted of ["index.js", "index.d.ts", "index.d.ts.map"]) {
    assert.ok(existsSync(join(dir, "dist", emitted)), `expected dist/${emitted}`);
  }
  rmSync(join(dir, "dist"), { recursive: true, force: true });
  rmSync(join(dir, "tsconfig.tsbuildinfo"), { force: true });
});

/**
 * Every cross-package import must have a matching project reference — DISCOVERED, not listed.
 *
 * The two tests above verify the MECHANISM: a cycle is a build error, a sound project emits. Neither ever
 * looked at this repo's actual packages, so the mechanism was proven while guarding nothing — the failure
 * this file's own docstring names ("a check that exists and does not run"). It cost a fresh worker's
 * provisioning on 2026-08-25: `scorer` imported `@a11y-witness/evidence` and declared no reference, so
 * `tsc --build` had no ordering information and read a `.d.ts` one second after it was written.
 *
 * `judge` had suffered the identical fault, been fixed, and carried a comment explaining it. The knowledge
 * was in the repo; the coverage was not. A list of packages here would rot the same way — so the imports
 * are read from source and the references from the tsconfigs, and the two must agree.
 */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** A package is a TS project if it has a tsconfig; `nvda-worker` is `.mjs` and deliberately is not. */
function tsProjects(): string[] {
  return readdirSync(join(REPO_ROOT, "packages"))
    .filter((name) => existsSync(join(REPO_ROOT, "packages", name, "tsconfig.json")))
    .sort();
}

/** Strip `//` comments — these tsconfigs are JSONC and half their value is the comments. */
const readJsonc = (path: string) =>
  JSON.parse(readFileSync(path, "utf8").split("\n")
    .filter((line) => !line.trimStart().startsWith("//")).join("\n"));

function importedPackages(pkg: string): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|mjs)$/.test(entry.name) || entry.name.endsWith(".test.ts")) continue;
      for (const m of readFileSync(full, "utf8").matchAll(/["']@a11y-witness\/([a-z-]+)/g)) found.add(m[1]);
    }
  };
  walk(join(REPO_ROOT, "packages", pkg, "src"));
  found.delete(pkg);
  return found;
}

test("every cross-package import is backed by a project reference", () => {
  const projects = new Set(tsProjects());
  assert.ok(projects.size >= 4, `only ${projects.size} TS projects found; the layout moved and this is blind`);

  const missing: string[] = [];
  for (const pkg of projects) {
    const config = readJsonc(join(REPO_ROOT, "packages", pkg, "tsconfig.json"));
    const declared = new Set(((config.references ?? []) as Array<{ path: string }>)
      .map((r) => r.path.replace(/^\.\.\//, "")));
    for (const dep of importedPackages(pkg)) {
      // Only TS projects can be referenced. `nvda-worker` is `.mjs` with no tsconfig, and worker-fleet
      // reaches it through subpath exports precisely so it never loads the win32 capture driver.
      if (!projects.has(dep) || declared.has(dep)) continue;
      missing.push(`packages/${pkg} imports @a11y-witness/${dep} and declares no { "path": "../${dep}" }`);
    }
  }
  assert.deepEqual(missing, [],
    "tsc --build follows `references` to decide build ORDER. Without one, a package compiles against "
    + "whatever the sibling's dist happens to be — always fine on a warm machine, a race on a first "
    + "`npm install`. Add the reference; a cycle is a build error (TS6202), which the test above proves "
    + "is enforced.");
});
