// No `@ts-check`: this file imports "vitest", the ad hoc runner named in #1798's own Acceptance
// (`npx vitest run …`) rather than this repo's project-wide rstest/tsx runner -- vitest is not a project
// devDependency, so the whole-program typecheck (which picks up every `packages/*/scripts/**/*.mjs`) has
// no types to resolve it against. Every other file in that glob keeps its own `@ts-check`; this one is the
// exception because its test framework is.
import { describe, test, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presentMissing, noteMissing } from "./corpus-snapshot.mjs";

/**
 * #1798: `WANTED_SIBLINGS.filter(...)` dropped a missing sibling with no note, unlike the `WANTED`
 * branch, which prints `note: ... absent, archiving the rest`. Every lab-dispatched run since #566
 * reported success while protecting zero `board-snapshots` files, and nothing in its own output said so.
 *
 * `main()` now derives both `WANTED`'s and `WANTED_SIBLINGS`'s present/missing split through the shared
 * `presentMissing` helper and reports either's `missing` through the ONE shared `noteMissing` call site.
 * A first version of this file asserted a template literal RETYPED in the test rather than the call
 * site's own emission, so a mutation to the real `process.stderr.write` text or its guard survived with
 * 0 red (reviewer's finding on PR #1837). This version spies on `process.stderr.write` and asserts what
 * `noteMissing` actually wrote, so a mutation to that call site's text or condition fails here.
 */
describe("presentMissing", () => {
  test("a member present on disk is reported present, not missing", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-snapshot-siblings-"));
    try {
      mkdirSync(join(root, "real-page-corpus"));
      const result = presentMissing(root, ["real-page-corpus", "screenreader-acceptance", "board-snapshots"]);
      expect(result.present).toEqual(["real-page-corpus"]);
      expect(result.missing).toEqual(["screenreader-acceptance", "board-snapshots"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("every member present reports nothing missing", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-snapshot-siblings-"));
    try {
      mkdirSync(join(root, "real-page-corpus"));
      mkdirSync(join(root, "screenreader-acceptance"));
      mkdirSync(join(root, "board-snapshots"));
      const result = presentMissing(root, ["real-page-corpus", "screenreader-acceptance", "board-snapshots"]);
      expect(result.missing).toEqual([]);
      expect(result.present).toEqual(["real-page-corpus", "screenreader-acceptance", "board-snapshots"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("noteMissing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("board-snapshots absent from a fixture RUNS dir reaches real stderr, not a retyped string", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-snapshot-siblings-"));
    try {
      mkdirSync(join(root, "real-page-corpus"));
      mkdirSync(join(root, "screenreader-acceptance"));
      // board-snapshots deliberately absent -- the lab's own state (#1798's own measurement).
      const { missing } = presentMissing(root, ["real-page-corpus", "screenreader-acceptance", "board-snapshots"]);
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      noteMissing(missing);
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith("note: board-snapshots absent, archiving the rest\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("nothing missing writes nothing to stderr -- the silent-drop bug this row fixes, in reverse", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    noteMissing([]);
    expect(write).not.toHaveBeenCalled();
  });

  test("several missing members join with a comma, exactly as WANTED's own note always has", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    noteMissing(["real-page-corpus", "board-snapshots"]);
    expect(write).toHaveBeenCalledWith("note: real-page-corpus, board-snapshots absent, archiving the rest\n");
  });
});
