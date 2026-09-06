// #58: every storage/memory accumulator on the control plane gets a lifecycle rule, an owner, or a
// deletion with a reason -- never "we should clean this up" left as an intention. This tests the
// measurement script that both discovers each accumulator and refuses to report an undecided one.
//
// THE MOST VALUABLE THING THIS FILE PROVES IS THE DIST-TRAP DETECTOR'S OWN CORRECTNESS. It went through
// two false-positive rounds while being built: first it flagged @a11y-witness/control, @a11y-witness/lab
// and @a11y-witness/nvda-worker as exposed, because it matched any mention of the package name after
// `from "`, including SUBPATH imports into raw `.mjs` source that this repo deliberately reaches that way
// (ADR 0031: nvda-worker ships with no build step at all). Narrowing to a BARE root-specifier match still
// flagged nvda-worker, because nothing checked whether that package's own root export even resolves into
// `dist/` -- it resolves straight to `src/index.mjs`. Both rounds are pinned here as fixtures so neither
// regresses silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { linkState, workspacePackages, packagesImportedByName, distTrapReport } from
  "../../../../scripts/control-plane-hygiene.mjs";

test("the real repo's dist-trap check finds every package it claims to check, and none currently exposed", () => {
  const trap = distTrapReport(process.cwd());
  // A floor, not a target -- this repo has 9 workspace packages today; the floor is set below that so
  // adding or retiring a package does not itself break this guard.
  assert.ok(trap.checked >= 5, `expected at least 5 workspace packages checked, found ${trap.checked}`);
  assert.deepEqual(trap.exposed.map((p) => p.name), [],
    `these packages are imported by bare specifier, export into dist/, and have no prepare build step: `
    + `${trap.exposed.map((p) => p.name).join(", ")}`);
});

test("linkState distinguishes real, symlink, and missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "hygiene-linkstate-"));
  const real = join(dir, "real");
  const linked = join(dir, "linked");
  mkdirSync(real);
  execFileSync("ln", ["-s", real, linked]);
  assert.equal(linkState(real), "real");
  assert.equal(linkState(linked), "symlink");
  assert.equal(linkState(join(dir, "nope")), "missing");
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Builds a synthetic repo under `os.tmpdir()` with `packages/<name>/package.json` for each spec, and
 * (optionally) a source file elsewhere importing it -- never the real `docs/board`-style shared fixture,
 * because this one needs a real `git grep`-able tree, so it is a real (if tiny) git repo.
 */
function fakeRepo(packageSpecs: Array<{ dir: string; name: string; rootExport: string; hasPrepare: boolean }>,
  importers: Array<{ path: string; line: string }>) {
  const dir = mkdtempSync(join(tmpdir(), "hygiene-disttrap-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "packages"), { recursive: true });
  for (const spec of packageSpecs) {
    mkdirSync(join(dir, "packages", spec.dir), { recursive: true });
    writeFileSync(join(dir, "packages", spec.dir, "package.json"), JSON.stringify({
      name: spec.name,
      exports: { ".": spec.rootExport },
      scripts: spec.hasPrepare ? { prepare: "tsc --build" } : {},
    }));
  }
  for (const imp of importers) {
    mkdirSync(join(dir, ...imp.path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, imp.path), imp.line);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

test("MUTATION-shaped: a bare-imported, dist-exporting package with no prepare is EXPOSED", () => {
  const dir = fakeRepo(
    [{ dir: "exposed-pkg", name: "@fake/exposed-pkg", rootExport: "./dist/index.js", hasPrepare: false }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/exposed-pkg";\n' }],
  );
  const trap = distTrapReport(dir);
  assert.deepEqual(trap.exposed.map((p) => p.name), ["@fake/exposed-pkg"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a dist-exporting package WITH a prepare script is not exposed", () => {
  const dir = fakeRepo(
    [{ dir: "safe-pkg", name: "@fake/safe-pkg", rootExport: "./dist/index.js", hasPrepare: true }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/safe-pkg";\n' }],
  );
  assert.deepEqual(distTrapReport(dir).exposed, []);
  rmSync(dir, { recursive: true, force: true });
});

test("a SUBPATH import into raw source is never flagged, even with no prepare and no dist export -- ADR 0031's shape", () => {
  const dir = fakeRepo(
    [{ dir: "mjs-pkg", name: "@fake/mjs-pkg", rootExport: "./src/index.mjs", hasPrepare: false }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/mjs-pkg/some-subpath.mjs";\n' }],
  );
  const trap = distTrapReport(dir);
  assert.deepEqual(trap.exposed, [],
    "a subpath import must never be read as needing the ROOT export's dist -- this was this check's own first false positive");
  rmSync(dir, { recursive: true, force: true });
});

test("a SUBPATH-ONLY import of a package whose root DOES export dist/ is not flagged as bare-imported", () => {
  // Isolates the quote-boundary check from rootExportsDist: this package WOULD be exposed if bare-
  // imported with no prepare, so if the subpath match were sloppy (missing the closing quote) this is
  // the fixture that would catch it -- the previous test's fixture could not, because its own
  // rootExportsDist was already false for an unrelated reason.
  const dir = fakeRepo(
    [{ dir: "dist-pkg-subpath-only", name: "@fake/dist-pkg-subpath-only", rootExport: "./dist/index.js", hasPrepare: false }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/dist-pkg-subpath-only/deep.js";\n' }],
  );
  const trap = distTrapReport(dir);
  assert.deepEqual(trap.exposed, [],
    "a subpath-only import must not count as a BARE import of the package, even when the root export is dist/");
  rmSync(dir, { recursive: true, force: true });
});

test("a package whose root export never resolves into dist/ is never flagged, even bare-imported with no prepare", () => {
  const dir = fakeRepo(
    [{ dir: "src-only", name: "@fake/src-only", rootExport: "./src/index.mjs", hasPrepare: false }],
    [{ path: "packages/caller/src/use.ts", line: 'import { x } from "@fake/src-only";\n' }],
  );
  assert.deepEqual(distTrapReport(dir).exposed, [],
    "a package with no dist in its own root export needs no prepare hook -- this was the SECOND false positive found building this check");
  rmSync(dir, { recursive: true, force: true });
});

test("a package only ever imported from its own directory is not counted as needed by others", () => {
  const dir = fakeRepo(
    [{ dir: "self-only", name: "@fake/self-only", rootExport: "./dist/index.js", hasPrepare: false }],
    [{ path: "packages/self-only/src/self-test.ts", line: 'import { x } from "@fake/self-only";\n' }],
  );
  assert.deepEqual(workspacePackages(dir).map((p) => p.name), ["@fake/self-only"]);
  assert.deepEqual([...packagesImportedByName(dir, workspacePackages(dir))], [],
    "a package importing only ITSELF must not count as needed by another package");
  rmSync(dir, { recursive: true, force: true });
});
