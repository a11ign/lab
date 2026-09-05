/**
 * A handful of mechanically checkable claims made to a STRANGER, in README.md, packages/README.md and
 * docs/METHODOLOGY.md — pinned so they cannot silently drift back to false. Same shape as
 * known-gaps-file-facts.test.ts, applied to documents someone who cannot check our internal state reads.
 *
 * The bar here is higher than for an internal doc: a stale claim in a doc WE read wastes an evening: a
 * stale claim in one of these is a false statement made to someone who has no way to verify it themselves.
 *
 * EVERY ASSERTION HAS A VACUITY GUARD, same reason as always: a check that examines nothing must never
 * report success.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const README = readFileSync(join(REPO, "README.md"), "utf8");
const PACKAGES_README = readFileSync(join(REPO, "packages/README.md"), "utf8");

/** Every directory under packages/ that is a real npm package (has its own package.json). */
function realPackages(): string[] {
  return readdirSync(join(REPO, "packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => {
      try { readFileSync(join(REPO, "packages", name, "package.json"), "utf8"); return true; }
      catch { return false; }
    });
}

test("the real package count and private/public split", () => {
  const names = realPackages();
  assert.ok(names.length >= 8, `only found ${names.length} packages under packages/ -- the discovery `
    + "walk may be broken, not the codebase suddenly smaller");

  const privateOnes = names.filter((name) => {
    const pkg = JSON.parse(readFileSync(join(REPO, "packages", name, "package.json"), "utf8"));
    return pkg.private === true;
  });

  assert.match(README, /`packages\/README\.md` has the split and the licence of each/,
    "root README's pointer to packages/README.md's split is gone -- re-check whether this claim needs "
    + "a home elsewhere before deleting this test");
  assert.match(PACKAGES_README, /Three more exist and are deliberately absent/,
    "packages/README.md's correction (nine packages, three private) is gone -- either it was removed or "
    + "the file was rewritten without carrying the correction");

  for (const name of privateOnes) {
    assert.match(PACKAGES_README, new RegExp(`\\|\\s*\`${name}\`\\s*\\|`),
      `packages/README.md's private-packages table no longer lists ${name}, which package.json marks `
      + "private -- either it was un-privated, or the doc's table has gone stale again");
  }
  // The published ones must still each have a row in the main migration table -- by PACKAGE NAME, which
  // for `cli` is the unscoped `a11y-witness`, not the directory name.
  for (const name of names.filter((n) => !privateOnes.includes(n))) {
    const pkg = JSON.parse(readFileSync(join(REPO, "packages", name, "package.json"), "utf8"));
    const shortName = String(pkg.name).replace(/^@a11y-witness\//, "");
    assert.match(PACKAGES_README, new RegExp(`\`${shortName}\``),
      `packages/README.md never mentions the published package "${shortName}" (directory packages/${name})`);
  }
});

test("packages/control has a README, because it did not for a while", () => {
  assert.doesNotThrow(() => readFileSync(join(REPO, "packages/control/README.md"), "utf8"),
    "packages/control/README.md is gone again -- it is a real, private package with no top-level README, "
    + "the exact gap this test exists to catch");
});

test("nvda-speech is marked private everywhere it is described", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "packages/nvda-speech/package.json"), "utf8"));
  assert.equal(pkg.private, true,
    "packages/nvda-speech/package.json is no longer private -- if it was deliberately published, the "
    + "PRIVATE markers in README.md and packages/README.md need removing, not just this test");
  assert.match(README, /nvda-speech\/\s+PRIVATE\./,
    "root README's repository map no longer marks nvda-speech PRIVATE");
});

test("README.md does not hardcode docs/coverage.md's generated criterion count", () => {
  // The generated page's own count is the ground truth (coverage-doc.test.ts regenerates and diffs it);
  // README used to carry a hand-typed copy ("18 of 55") that drifted from it the moment the code moved to
  // 19. The fix was to delete the copy, not to update the number -- so this asserts the copy stays deleted
  // rather than pinning a count that will drift again the next time a criterion's status changes.
  assert.doesNotMatch(README, /\d+ of 55 produce findings/,
    "README.md states a hardcoded \"N of 55\" count again -- read it from docs/coverage.md instead, or "
    + "this will silently drift from it exactly as the deleted copy did");
  const coverage = readFileSync(join(REPO, "docs/coverage.md"), "utf8");
  assert.match(coverage, /\d+ of 55 produce findings/,
    "docs/coverage.md no longer states its own count in the expected shape -- the generator or the test "
    + "template changed; re-check this assertion's pattern before trusting it");
});

test("the eval fixture count docs/METHODOLOGY.md and README.md quote is the real one", () => {
  const casesSrc = readFileSync(join(REPO, "packages/lab/src/eval/cases.ts"), "utf8");
  const fixturePaths = new Set([...casesSrc.matchAll(/fixture:\s*"([^"]+)"/g)].map((m) => m[1]));
  assert.ok(fixturePaths.size > 0,
    "no `fixture: \"...\"` entries found in cases.ts -- the eval case list's shape changed, re-derive "
    + "the count by hand before trusting this test");
  assert.equal(fixturePaths.size, 34,
    `cases.ts declares ${fixturePaths.size} distinct fixture files, not 34 -- README.md and `
    + "docs/METHODOLOGY.md both quote 34 labelled fixtures; update whichever is now wrong");

  const methodology = readFileSync(join(REPO, "docs/METHODOLOGY.md"), "utf8");
  assert.match(methodology, /34 labelled fixtures/,
    "docs/METHODOLOGY.md's corrected fixture count (added auditing user-facing docs) is gone");
});
