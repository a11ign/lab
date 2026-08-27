/**
 * `gate:isolation` must refuse a package it CANNOT verify, rather than passing it.
 *
 * ## What the gate is for
 *
 * It answers "can a consumer install this package and use it?" by doing it: pack the tarball, install it
 * into a fresh directory OUTSIDE the repository, run the package's own smoke test there. A workspace
 * install cannot answer that question — it resolves everything by symlink from the repo root, so it is
 * structurally blind to phantom dependencies, cwd-relative resolution, files dropped by `"files"`, and
 * `"exports"` subpaths that do not resolve (ADR 0007).
 *
 * ## What this test proves, and what it deliberately leaves uncovered
 *
 * It does NOT run the pack-and-install path. That shells out to npm twice per package and would make a
 * unit test slow and network-shaped — and a proof that is slow gets skipped, which is the failure being
 * fixed.
 *
 * It proves the property most likely to rot: **a package the gate cannot verify must not read as
 * verified.** The script's own comment says why — "a package with no smoke test cannot be gated, and
 * silently passing it would make the gate a decoration". That is the examined-nothing failure this repo
 * names more than any other, and it is one line away at all times: `if (!existsSync(smoke)) return ok`.
 *
 * The uncovered half is stated in `gates-are-proven.test.ts` rather than implied here, because an
 * unstated gap reads as covered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkIsolation, allPackages, SMOKE } from "../../../../scripts/isolation-gate.mjs";

// SMOKE is IMPORTED, not restated, and the first version of this file restated it — wrongly, as
// "smoke-test.mjs" against the gate's "isolation-smoke.mjs". Every assertion below then reduced to "a
// package missing SOME file is refused", which is true and vacuous. The premise test caught it, and the
// fix is the one this repo prefers to a correction: delete the copy.

function packageDir(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "a11y-iso-")));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test("a directory with no package.json is refused, not skipped", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "a11y-iso-")));
  try {
    const result = checkIsolation(dir);
    assert.equal(result.ok, false, "a directory that is not a package must never read as a passing one");
    assert.equal(result.stage, "setup");
    assert.match(result.detail, /package\.json/, "the refusal must say what is missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a package with NO SMOKE TEST is refused — the gate must not decorate", () => {
  // THE ASSERTION THAT MATTERS. A package the gate cannot exercise passing is indistinguishable from one
  // it exercised and cleared, and this repo has paid for that shape repeatedly: `check-signals` scoring a
  // corpus that was not there, `rules:coverage` reporting a rule validated by a population it never read.
  const dir = packageDir({ "package.json": JSON.stringify({ name: "@a11y-witness/planted", version: "0.0.0" }) });
  try {
    const result = checkIsolation(dir);
    assert.equal(result.ok, false, "no smoke test means the package CANNOT be gated, which is not a pass");
    // STAGE `setup`, and asserting the stage rather than the wording is the whole point.
    //
    // Deleting the early return does NOT make the gate pass — it fails later trying to copy the missing
    // file, with a raw `ENOENT ... isolation-smoke.mjs`. The first version of this test matched
    // /smoke/i against the detail and so was satisfied by that ENOENT: it caught the mutation by accident
    // of the message rather than by intent, which is a proof that would stop working the day the error
    // text changed.
    //
    // The real property is WHERE the refusal comes from. A gate that diagnoses its own precondition tells
    // you to add a smoke test; one that trips over a missing file tells you a path does not exist and
    // leaves you to work out why. This repo's whole diagnostics model is that distinction.
    assert.equal(result.stage, "setup",
      `a package the gate cannot verify must be refused by the gate's own check, not by a downstream `
      + `file error: got stage=${result.stage} detail=${JSON.stringify(result.detail).slice(0, 120)}`);
    assert.match(result.detail, /cannot verify/i,
      `the refusal must say it could not verify, in the gate's words: got ${JSON.stringify(result.detail)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a package that HAS a smoke test gets past setup", () => {
  // The premise, kept even though SMOKE is now imported: an import proves the NAME agrees, not that the
  // gate still looks for a file at all. If the check were deleted, every refusal above would vanish and
  // only this would notice the gate had stopped gating.
  const dir = packageDir({
    "package.json": JSON.stringify({ name: "@a11y-witness/planted", version: "0.0.0" }),
    [SMOKE]: "process.exit(0);\n",
  });
  try {
    const result = checkIsolation(dir);
    assert.notEqual(result.stage, "setup",
      `with ${SMOKE} present the gate must move past setup; if it did not, this file's SMOKE constant has `
      + "drifted from the gate's and every assertion above is vacuous");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the gate has real packages to run against", () => {
  // A gate with an empty package list reports success having checked nothing — the same failure one level
  // up from the smoke-test case.
  const packages = allPackages();
  assert.ok(packages.length > 0, "allPackages() found none, so `gate:isolation --all` would examine nothing");
});
