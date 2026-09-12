/**
 * #1102: WHAT A PUBLISHED MANIFEST CLAIMS ABOUT PLATFORMS, AND WHY IT CLAIMS NOTHING.
 *
 * The row was filed because `entry-points.test.ts` exempts one published bin from its symlink check on the
 * grounds that `a11ign-nvda-worker` is "Windows-only by ADR 0001" — **a design record, not a field npm
 * reads.** npm installs that bin on macOS and Linux, creates a POSIX symlink, and `server.mjs`'s entry
 * guard omits `realpathSync`, so the server loads, `main()` never runs, and it exits 0 with no output.
 * The exemption is true of the INTENT and false of the thing npm reads.
 *
 * The row proposed declaring `"os": ["win32"]` and said it "may change what `npm ci` does in this
 * workspace, which needs measuring rather than assuming". **Measured 2026-09-12 in an isolated clone, and
 * the answer removes the remedy rather than qualifying it:**
 *
 * ```
 * $ npm install --dry-run          # with "os": ["win32"] on packages/nvda-worker
 * npm error code EBADPLATFORM
 * npm error notsup Unsupported platform for @a11ign/nvda-worker@0.1.0: wanted {"os":"win32"} (current: {"os":"darwin"})
 * exit 1
 * ```
 *
 * **A non-matching `os` or `cpu` on ANY workspace member fails the install for the WHOLE workspace.** Not
 * the member — the root command. So declaring it would break `npm install` on every developer Mac (this
 * repo's documented usual case) and `npm ci` on CI's `ubuntu-latest`. The field cannot be carried while
 * the package is a workspace member, and that is a fact about npm rather than a choice this repo made.
 *
 * Controls, because "exit 1" is not "the platform check fired" and the first reading nearly said it was:
 *
 * ```
 * cpu: ["arm64"] on darwin/arm64  -> exit 1, but from `npm run build` in prepare -- the check PASSED
 * cpu: ["s390x"] on darwin/arm64  -> exit 1, EBADPLATFORM: the check fired
 * ```
 *
 * **So this file asserts the ABSENCE, and that is the point.** An undeclared `os` currently reads as an
 * oversight — six published packages, none declaring one, and a row open saying one of them should. After
 * this test it is a DECLARED absence with a measurement behind it, which is the difference between a field
 * nobody thought about and a field that cannot be used. The repo's own rule: an absence has many causes,
 * and the remedy is to say which one.
 *
 * WHAT THIS DOES NOT FIX. `server.mjs`'s symlink-blind guard is still symlink-blind, and a consumer on
 * macOS still gets a bin that exits 0 silently. That fix is one line and is HELD by the capture-path
 * sequencing rule. This file makes the exemption honest; it does not make the bin work.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The TESTED comment stripper, not a hand-rolled line filter. My first version of the assertion below
// matched the exempted path and stayed green when the exemption was DELETED, because the path also appears
// in the comment above it -- caught by mutation, and it is this repo's "open-check satisfied by prose"
// shape in the file whose subject is a claim nothing enforces.
import { stripComments } from "@a11ign/evidence/source-text";

// The gate's own derivation, imported rather than retyped: `packages/*` minus `private`. A second walk
// here would be the fact-stated-twice shape on the very population under test, and #1078 measured that
// this population was believed to be five when it is six.
import { allPackages } from "../../../../scripts/isolation-gate.mjs";

/** @returns the parsed manifest of every package this repository publishes. */
function publishedManifests(): { dir: string; name: string; manifest: Record<string, unknown> }[] {
  return allPackages().map((dir: string) => {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { dir, name: manifest.name as string, manifest };
  });
}

test("the published population is non-empty and is the one the isolation gate installs", () => {
  // The vacuity guard. Every assertion below is a `.filter(...)` over this list, and a walk that returned
  // nothing would satisfy all of them while examining no package at all -- the shape that let an empty
  // `strays` array pass for a guard in #1101.
  const published = publishedManifests();
  assert.ok(published.length >= 1, "no published packages found -- the derivation is broken, not the tree");
  assert.deepEqual(
    published.map((p) => p.name).sort(),
    ["@a11ign/evidence", "@a11ign/judge", "@a11ign/nvda-worker", "@a11ign/scorer", "@a11ign/worker-fleet", "a11ign"],
    "the published set changed -- if that is intended, this list is where it is recorded");
});

test("#1102: NO published package declares os or cpu, and the absence is DECLARED, not accidental", () => {
  // Measured, not reasoned: a non-matching value here fails `npm install` for the whole workspace with
  // EBADPLATFORM -- so this is not a field the repo has forgotten, it is one it cannot use while these
  // packages are workspace members. Changing that means taking the package out of the workspace, or
  // injecting the field at pack time so the published manifest differs from the repo's -- a derived
  // artefact, with the shipping-in-one-commit-range problem that carries.
  const declaring = publishedManifests()
    .filter((p) => p.manifest.os !== undefined || p.manifest.cpu !== undefined)
    .map((p) => `${p.name}: os=${JSON.stringify(p.manifest.os)} cpu=${JSON.stringify(p.manifest.cpu)}`);

  assert.deepEqual(declaring, [],
    "a published package declares `os` or `cpu`. If the value matches every developer machine AND CI, the "
    + "install still works and this test is simply out of date -- update it with the measurement. If it "
    + "does not, `npm install` now fails for the whole workspace on any machine it excludes, including "
    + "CI's ubuntu-latest. Measured 2026-09-12: `\"os\": [\"win32\"]` on nvda-worker -> EBADPLATFORM, exit 1.");
});

test("#1102: the symlink guard's platform exemption names a constraint the manifest does NOT carry", () => {
  // THE ROW'S SUBJECT, pinned where it can be read. `entry-points.test.ts` exempts `server.mjs` because the
  // bin is "Windows-only by ADR 0001". That sentence is about intent; npm reads `os`, and the test above
  // asserts there is none. So the exemption rests on a claim nothing enforces -- and this asserts the two
  // facts TOGETHER, which is what neither file could do alone and why the exemption survived review.
  const guard = stripComments(readFileSync(
    join(allPackages().find((d: string) => d.endsWith("worker-fleet")) ?? "", "src/entry-points.test.ts"), "utf8"));
  assert.match(guard, /exempt = new Set\(\[[^\]]*packages\/nvda-worker\/src\/server\.mjs/,
    "the exemption moved or went away -- if it went away, delete this test with it. Matched against the "
    + "comment-STRIPPED source and anchored to the Set literal, because the path is named in the prose "
    + "above it too, and the first version of this assertion stayed green when the exemption was deleted.");

  const nvdaWorker = publishedManifests().find((p) => p.name === "@a11ign/nvda-worker");
  assert.ok(nvdaWorker, "@a11ign/nvda-worker is not in the published set");
  assert.equal(nvdaWorker.manifest.os, undefined,
    "nvda-worker now declares `os`, so the exemption's premise is manifest-backed and this test should be "
    + "replaced by one asserting the declared value covers only platforms where the exemption holds");
});
