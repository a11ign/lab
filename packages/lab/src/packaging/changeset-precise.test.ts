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

import { touchesPublishedPackedFile } from "../../../../scripts/changeset-precise.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

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
