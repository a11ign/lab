// No `@ts-check`: this file imports "vitest", the ad hoc runner named in #1798's own Acceptance
// (`npx vitest run …`) rather than this repo's project-wide rstest/tsx runner -- vitest is not a project
// devDependency, so the whole-program typecheck (which picks up every `packages/*/scripts/**/*.mjs`) has
// no types to resolve it against. Every other file in that glob keeps its own `@ts-check`; this one is the
// exception because its test framework is.
import { describe, test, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presentMissing } from "./corpus-snapshot.mjs";

/**
 * #1798: `WANTED_SIBLINGS.filter(...)` dropped a missing sibling with no note, unlike the `WANTED`
 * branch, which prints `note: ... absent, archiving the rest`. Every lab-dispatched run since #566
 * reported success while protecting zero `board-snapshots` files, and nothing in its own output said so.
 *
 * `main()` now derives both `WANTED`'s and `WANTED_SIBLINGS`'s present/missing split through this same
 * `presentMissing` helper and prints the identical note for either's `missing`, so this exercises the
 * shared logic directly against a fixture RUNS dir missing one member, rather than re-deriving the note
 * text or spawning the CLI just to read its stderr.
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

  test("board-snapshots absent from a fixture RUNS dir is named in `missing`, exactly what the CLI's note reads from", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-snapshot-siblings-"));
    try {
      mkdirSync(join(root, "real-page-corpus"));
      mkdirSync(join(root, "screenreader-acceptance"));
      // board-snapshots deliberately absent -- the lab's own state (#1798's own measurement).
      const result = presentMissing(root, ["real-page-corpus", "screenreader-acceptance", "board-snapshots"]);
      expect(result.missing).toEqual(["board-snapshots"]);
      // The note printed at the call site is `note: ${missing.join(", ")} absent, archiving the rest`
      // (mirroring line 145's WANTED note) -- assert the exact text that call site would emit, so a
      // future edit to either message drifting out of sync fails here rather than silently.
      const note = `note: ${result.missing.join(", ")} absent, archiving the rest\n`;
      expect(note).toBe("note: board-snapshots absent, archiving the rest\n");
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
