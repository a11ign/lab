/**
 * THE `changed` JOB RUNS BEFORE `npm ci`, SO NOTHING IT IMPORTS MAY USE A PACKAGE SPECIFIER.
 *
 * `ci.yml`'s `changed` job is `checkout` + `setup-node` and no install — deliberately, because its whole
 * job is to decide whether anything else installs or builds at all. So every module reachable from
 * `scripts/ci-changed.mjs` must resolve by RELATIVE PATH or `node:` builtin. A `@a11ign/...`
 * specifier there dies before the workflow starts:
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@a11ign/worker-fleet'
 *       imported from .../scripts/changed-packages.mjs
 *
 * Measured on #238's first CI run, which is the point: `ci-changed.mjs` itself already carried a comment
 * explaining exactly this and importing relatively — *"every other root script uses the package specifier,
 * and every other root script runs after `npm run build`"* — and the knowledge stopped at that one file.
 * Guarding `scripts/` for the first time (#164) added the same import to two of its DEPENDENCIES, and
 * neither the author nor any local check could see it, because a developer's tree has `node_modules` and
 * the CI job does not.
 *
 * **A fix that reached one call site when the constraint reaches the whole graph** — this repo's most
 * expensive recurring shape, and the remedy is the same one it always is: pin the CLASS, not the
 * instance. Nothing about the two offending files was special; they were simply next.
 *
 * WALKS THE REAL GRAPH rather than a list of files somebody remembered. A hand-written list is exactly
 * what let this through: the constraint was recorded as a comment on one file, so the population it
 * described was "this file" rather than "everything this file needs".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Every `import ... from "<spec>"` in a module, in source order. */
function specifiersOf(source: string): string[] {
  return [...source.matchAll(/^\s*import\s+[^"']*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
}

/**
 * Everything reachable from `entry` by relative import, plus every package specifier found on the way.
 *
 * Static, and deliberately so: this must answer for the CI runner rather than for this machine, where a
 * dynamic check would resolve through a `node_modules` the runner does not have — the exact reason the
 * fault was invisible locally.
 */
function importGraph(entry: string): { files: Set<string>; packageSpecifiers: string[] } {
  const files = new Set<string>();
  const packageSpecifiers: string[] = [];
  const visit = (file: string): void => {
    const abs = resolve(file);
    if (files.has(abs) || !existsSync(abs)) return;
    files.add(abs);
    for (const spec of specifiersOf(readFileSync(abs, "utf8"))) {
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) { visit(resolve(dirname(abs), spec)); continue; }
      packageSpecifiers.push(`${relative(REPO, abs)} -> ${spec}`);
    }
  };
  visit(resolve(REPO, entry));
  return { files, packageSpecifiers };
}

test("nothing reachable from ci-changed.mjs needs node_modules", () => {
  const { files, packageSpecifiers } = importGraph("scripts/ci-changed.mjs");
  // Vacuity guard: a walk that found one file would pass this having examined nothing.
  assert.ok(files.size >= 4,
    `only ${files.size} files reachable -- the import walk is broken, not the graph`);
  assert.deepEqual(packageSpecifiers, [],
    "`ci.yml`'s `changed` job installs nothing, so these die with ERR_MODULE_NOT_FOUND before the "
    + "workflow starts. Import them relatively, as `ci-changed.mjs` itself does and explains.");
});

test("the walk actually follows relative imports — the check that stops it passing vacuously", () => {
  // If `visit` stopped at the entry file this test file's own guard would be worthless, so the graph is
  // asserted to CONTAIN a known dependency rather than merely to be large.
  const { files } = importGraph("scripts/ci-changed.mjs");
  const names = [...files].map((f) => relative(REPO, f));
  assert.ok(names.includes("scripts/changed-packages.mjs"),
    `the walk did not reach a known dependency; it found: ${names.join(", ")}`);
});
