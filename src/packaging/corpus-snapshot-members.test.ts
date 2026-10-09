/**
 * #1798's `presentMissing`/`noteMissing` coverage, MOVED HERE BY #1940 FROM
 * `packages/lab/scripts/corpus-snapshot.test.mjs`, WHERE NO RUNNER COULD REACH IT.
 *
 * Every runner entry point globs for `.test.ts` files under some package's `src`. The old path missed on
 * both counts -- under `scripts/`, not `src/`, and `.mjs`, not `.ts` -- so these tests passed by hand and
 * were executed by no gate from the day they were written. `every-test-file-is-run.test.ts` is the guard that
 * stops the next one; this file is the one orphan it found, given a home a glob reaches.
 *
 * THE NAME IS NOT `corpus-snapshot.test.ts`, DELIBERATELY. That path is #1936's, taken by draft PR #1944,
 * which tests the tar parsing and the hollow-archive refusal. `product-manager` ruled on 2026-09-22 that a
 * row landing before #1944 gives the moved tests a distinct name rather than contending for one file, and
 * `members` is what these tests are actually about: the present/missing split `main()` derives for BOTH
 * `WANTED` and `WANTED_SIBLINGS` through one shared helper.
 *
 * TWO THINGS CHANGED IN THE MOVE, AND NOTHING ELSE. The framework is `node:test` rather than `vitest` --
 * vitest was never a devDependency here, which is the other half of why nothing ran this -- and the
 * `process.stderr.write` spy is a hand-rolled swap in a `finally` rather than `vi.spyOn`, because the
 * node:test shim `scripts/rstest/node-test-shim.mjs` refuses every `mock` property but `fn` and `method`,
 * `restoreAll` among them. Each assertion still asserts exactly what it asserted before.
 *
 * #1798's own reason for these tests, kept verbatim: `WANTED_SIBLINGS.filter(...)` dropped a missing
 * sibling with no note, unlike the `WANTED` branch, which prints `note: ... absent, archiving the rest`.
 * Every lab-dispatched run since #566 reported success while protecting zero `board-snapshots` files, and
 * nothing in its own output said so. `main()` now derives both splits through the shared `presentMissing`
 * helper and reports either's `missing` through the ONE shared `noteMissing` call site. A first version of
 * this file asserted a template literal RETYPED in the test rather than the call site's own emission, so a
 * mutation to the real `process.stderr.write` text or its guard survived with 0 red (reviewer's finding on
 * PR #1837). This version captures `process.stderr.write` and asserts what `noteMissing` actually wrote.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presentMissing, noteMissing } from "../../scripts/corpus-snapshot.mjs";

const SIBLINGS = ["real-page-corpus", "screenreader-acceptance", "board-snapshots"];

/** Run `body` with `process.stderr.write` replaced, and return everything it was handed. */
function capturingStderr(body: () => void): string[] {
  const written: string[] = [];
  const real = process.stderr.write;
  process.stderr.write = ((chunk: string) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    body();
  } finally {
    process.stderr.write = real;
  }
  return written;
}

/** A throwaway RUNS directory holding exactly `members`, removed however the test ends. */
function withRunsDir(members: string[], body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "corpus-snapshot-siblings-"));
  try {
    for (const member of members) mkdirSync(join(root, member));
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("presentMissing", () => {
  test("a member present on disk is reported present, not missing", () => {
    withRunsDir(["real-page-corpus"], (root) => {
      const result = presentMissing(root, SIBLINGS);
      assert.deepEqual(result.present, ["real-page-corpus"]);
      assert.deepEqual(result.missing, ["screenreader-acceptance", "board-snapshots"]);
    });
  });

  test("every member present reports nothing missing", () => {
    withRunsDir(SIBLINGS, (root) => {
      const result = presentMissing(root, SIBLINGS);
      assert.deepEqual(result.missing, []);
      assert.deepEqual(result.present, SIBLINGS);
    });
  });
});

describe("noteMissing", () => {
  test("board-snapshots absent from a fixture RUNS dir reaches real stderr, not a retyped string", () => {
    // board-snapshots deliberately absent -- the lab's own state (#1798's own measurement).
    withRunsDir(["real-page-corpus", "screenreader-acceptance"], (root) => {
      const { missing } = presentMissing(root, SIBLINGS);
      const written = capturingStderr(() => noteMissing(missing));
      assert.deepEqual(written, ["note: board-snapshots absent, archiving the rest\n"]);
    });
  });

  test("nothing missing writes nothing to stderr -- the silent-drop bug this row fixes, in reverse", () => {
    assert.deepEqual(capturingStderr(() => noteMissing([])), []);
  });

  test("several missing members join with a comma, exactly as WANTED's own note always has", () => {
    const written = capturingStderr(() => noteMissing(["real-page-corpus", "board-snapshots"]));
    assert.deepEqual(written, ["note: real-page-corpus, board-snapshots absent, archiving the rest\n"]);
  });
});
