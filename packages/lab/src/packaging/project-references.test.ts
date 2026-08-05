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
import { existsSync, rmSync } from "node:fs";
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
