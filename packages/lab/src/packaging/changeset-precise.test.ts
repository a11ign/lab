/**
 * `scripts/changeset-precise.mjs` is the pre-push hook's answer to "does this push touch a file `npm pack`
 * actually SHIPS for a PUBLISHED package" (#261) -- the precise question, not `changed-packages.mjs`'s
 * blunt "any file under `packages/<name>/`". Paying `changeset status --since=origin/main` (measured
 * 3.8-7.8s) unconditionally would more than double the hook's own stated budget, so the hook only pays it
 * when this answers `true`.
 *
 * Driven against THIS repo's real packages rather than a fixture, because the question is inherently about
 * what `npm pack` really ships and which `package.json`s carry `private: true` -- a fixture repo would
 * need to fake both, which is the exact "a test written against a shape you did not verify" trap this
 * repo's own CLAUDE.md names. `evidence` and `control` are real, stable choices: `evidence` is published
 * and has never been `private`; `control` (ADR 0012) is deliberately `private` and always will be.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { touchesPublishedPackedFile } from "../../../../scripts/changeset-precise.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const CLI = join(REPO, "scripts/changeset-precise.mjs");

test("a source file a PUBLISHED package's build ships is true", () => {
  assert.equal(touchesPublishedPackedFile(["packages/evidence/src/announcement.ts"], REPO), true);
});

test("a TEST file is false — its build has no dist counterpart, and npm never packs it", () => {
  assert.equal(touchesPublishedPackedFile(["packages/evidence/src/announcement.test.ts"], REPO), false);
});

test("a file under a PRIVATE package is false, however central to that package it is", () => {
  assert.equal(touchesPublishedPackedFile(["packages/control/src/fleet-playbook.mjs"], REPO), false);
});

test("a file outside every package/ directory is false", () => {
  assert.equal(touchesPublishedPackedFile(["docs/getting-started.md", "scripts/doctor.mjs"], REPO), false);
});

test("an empty diff is false, not an error", () => {
  assert.equal(touchesPublishedPackedFile([], REPO), false);
});

test("one packed file among several unrelated ones is still true — `.some()`, not `.every()`", () => {
  assert.equal(touchesPublishedPackedFile(
    ["docs/README.md", "packages/control/src/fleet-playbook.mjs", "packages/evidence/src/announcement.ts"],
    REPO,
  ), true);
});

// --- #288: THE CLI BOUNDARY -- the pre-push hook depends on exactly this contract, and none of the
// tests above exercise it. A `.some()`/`.every()` unit test on `touchesPublishedPackedFile` proves the
// LOGIC is right; it says nothing about whether the ENTRY POINT can answer that question at all when git
// itself fails, which is the shape #288 measured live: an unresolvable base ref threw inside
// `execFileSync("git", ...)`, uncaught, so the process exited non-zero having printed NOTHING -- and the
// hook's `[ "$(...)" = "true" ]` read that empty stdout as a confident "false", not as "could not ask".

test("#288: a REAL, resolvable ref prints exactly `true` or `false` on stdout -- nothing else", () => {
  // HEAD...HEAD is always resolvable and always empty, so this is a real exercise of the CLI's happy
  // path without depending on `origin/main` existing in whatever environment runs this test.
  const stdout = execFileSync("node", [CLI, "HEAD"], { encoding: "utf8" });
  assert.equal(stdout, "false", "an empty diff must print exactly `false` -- no trailing newline, no noise");
});

test("#288: an UNRESOLVABLE base ref must NOT print `true` -- and must exit non-zero, "
  + "so the hook can tell 'could not ask' apart from a real `false`", () => {
  assert.throws(() => execFileSync("node", [CLI, "not-a-real-ref-xyz"], { encoding: "utf8", stdio: "pipe" }),
    (error: unknown) => {
      const err = error as { status?: number, stdout?: string };
      assert.notEqual(err.status, 0, "an unresolvable ref must exit non-zero");
      assert.notEqual(err.stdout, "true",
        "the exact defect this row exists to end: empty/error output must never be readable as `true`");
      return true;
    });
});

test("#288 MUTATION TARGET: reproduces the measured live shape -- exit 1, stdout empty, stderr carries "
  + "the real git failure rather than silence", () => {
  try {
    execFileSync("node", [CLI, "not-a-real-ref-xyz"], { encoding: "utf8", stdio: "pipe" });
    assert.fail("expected the CLI to exit non-zero on an unresolvable ref");
  } catch (error) {
    const err = error as { status?: number, stdout?: string, stderr?: string };
    assert.equal(err.status, 1);
    assert.equal(err.stdout, "", "measured on #288: EXIT=1 STDOUT=[] -- nothing was ever written to stdout");
    assert.match(err.stderr ?? "", /not-a-real-ref-xyz/,
      "the real failure reason must survive to stderr, or a caller cannot tell this apart from any other "
      + "non-zero exit");
  }
});
