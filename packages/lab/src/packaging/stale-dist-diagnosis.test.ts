/**
 * #789: a resolution failure that names a missing export or module reads as "somebody removed it", and
 * when the real cause is a `dist` older than its own `src`, that reading is wrong and costs an
 * investigation. `stale-dist-diagnosis.mjs` appends a diagnosis to such a failure, never replaces it.
 *
 * Driven against a REAL failure wherever possible, not a hand-typed string: `diagnoseResolutionFailure`'s
 * own test below spawns a genuine `node` subprocess importing a genuinely stale `dist` file and captures
 * its real stderr, because a test asserting a string this file's own code constructed would be satisfied
 * by the string existing, not by the real failure path producing it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  srcPathFor, staleDistNote, specifierFromFailure, diagnoseResolutionFailure,
} from "../../../../scripts/stale-dist-diagnosis.mjs";

function tempFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "stale-dist-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("srcPathFor: dist/<name>.js -> src/<name>.ts, this repo's own 1:1 build convention", () => {
  const { dir, cleanup } = tempFixture();
  try {
    mkdirSync(join(dir, "dist"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/widget.ts"), "export const x = 1;\n");
    assert.equal(srcPathFor(join(dir, "dist/widget.js")), join(dir, "src/widget.ts"));
    assert.equal(srcPathFor(join(dir, "dist/widget.d.ts")), join(dir, "src/widget.ts"));
  } finally {
    cleanup();
  }
});

test("srcPathFor: no matching source at all -> null, not a guess", () => {
  assert.equal(srcPathFor("/nowhere/dist/ghost.js"), null);
});

test("srcPathFor: a path with no /dist/ segment is not this shape at all", () => {
  assert.equal(srcPathFor("/repo/packages/evidence/src/conformance.ts"), null);
});

test("staleDistNote: dist strictly OLDER than src names both paths and both timestamps", () => {
  const { dir, cleanup } = tempFixture();
  try {
    const dist = join(dir, "widget.js"), src = join(dir, "widget.ts");
    writeFileSync(dist, "");
    writeFileSync(src, "");
    utimesSync(dist, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    utimesSync(src, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));
    const note = staleDistNote(dist, src);
    assert.ok(note, "a stale dist must produce a note");
    assert.match(note as string, new RegExp(dist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(note as string, new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(note as string, /2026-01-01/);
    assert.match(note as string, /2026-01-02/);
    assert.match(note as string, /npm run build/, "must name the fix, not just the fact");
  } finally {
    cleanup();
  }
});

test("staleDistNote: ACCEPTANCE 3 -- dist NEWER than (or equal to) src is not stale, reports nothing extra", () => {
  const { dir, cleanup } = tempFixture();
  try {
    const dist = join(dir, "widget.js"), src = join(dir, "widget.ts");
    writeFileSync(dist, "");
    writeFileSync(src, "");
    utimesSync(src, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    utimesSync(dist, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));
    assert.equal(staleDistNote(dist, src), null,
      "a genuinely missing export with a CURRENT build must add nothing -- the ordinary case, and the "
      + "one this note must never become noise on");
  } finally {
    cleanup();
  }
});

test("staleDistNote: either path missing at all is not a staleness claim, it is a different question", () => {
  assert.equal(staleDistNote("/nowhere/x.js", "/nowhere/x.ts"), null);
});

test("specifierFromFailure: the SyntaxError shape from #789's own first incident", () => {
  const text = "SyntaxError: The requested module '@a11ign/evidence/conformance' does not provide an "
    + "export named 'activationBudgetFromDiagnostics'";
  assert.equal(specifierFromFailure(text), "@a11ign/evidence/conformance");
});

test("specifierFromFailure: the TS2307 shape from #789's own second incident", () => {
  const text = "error TS2307: Cannot find module '@a11ign/evidence/document-identity' or its "
    + "corresponding type declarations.";
  assert.equal(specifierFromFailure(text), "@a11ign/evidence/document-identity");
});

test("specifierFromFailure: text matching neither shape names nothing", () => {
  assert.equal(specifierFromFailure("Error: something else entirely went wrong"), null);
});

test("#789 ACCEPTANCE 1+2: driven against a REAL crash, not a hand-typed string -- a genuinely stale "
  + "dist produces a real SyntaxError, and the diagnosis names it correctly", () => {
  const { dir, cleanup } = tempFixture();
  try {
    // A real package shape: dist/consumer.js imports dist/widget.js, which is missing the export the
    // SOURCE already has -- exactly #789's own reproduction, built fresh rather than asserted from memory.
    mkdirSync(join(dir, "dist"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "dist/widget.js"), "export function existingExport() { return 1; }\n");
    writeFileSync(join(dir, "src/widget.ts"),
      "export function existingExport() { return 1; }\nexport function newExport() { return 2; }\n");
    writeFileSync(join(dir, "consumer.mjs"),
      "import { newExport } from \"./dist/widget.js\";\nconsole.log(newExport());\n");
    utimesSync(join(dir, "dist/widget.js"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    utimesSync(join(dir, "src/widget.ts"), new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));

    let stderr = "";
    try {
      execFileSync("node", ["consumer.mjs"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      assert.fail("the consumer must actually crash -- otherwise this is not testing a real failure");
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr ?? "");
    }
    assert.match(stderr, /does not provide an export named 'newExport'/,
      "the real Node error text this whole tool exists to augment");

    const resolve = (specifier: string): string => join(dir, specifier.replace(/^\.\//, ""));
    const note = diagnoseResolutionFailure(stderr, resolve);
    assert.ok(note, "a REAL stale-dist crash must produce a note");
    assert.match(note as string, /dist\/widget\.js/);
    assert.match(note as string, /src\/widget\.ts/);
    assert.match(note as string, /2026-01-01/);
    assert.match(note as string, /2026-01-02/);
  } finally {
    cleanup();
  }
});

test("#789 ACCEPTANCE 3: driven against a REAL crash where the export is genuinely, currently missing -- "
  + "the diagnosis adds nothing", () => {
  const { dir, cleanup } = tempFixture();
  try {
    mkdirSync(join(dir, "dist"));
    mkdirSync(join(dir, "src"));
    // The export really was never added -- source and dist AGREE, dist is not behind it.
    writeFileSync(join(dir, "dist/widget.js"), "export function existingExport() { return 1; }\n");
    writeFileSync(join(dir, "src/widget.ts"), "export function existingExport() { return 1; }\n");
    writeFileSync(join(dir, "consumer.mjs"),
      "import { neverExisted } from \"./dist/widget.js\";\nconsole.log(neverExisted());\n");
    // dist built AFTER src was last touched -- the ordinary, non-stale case.
    utimesSync(join(dir, "src/widget.ts"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    utimesSync(join(dir, "dist/widget.js"), new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));

    let stderr = "";
    try {
      execFileSync("node", ["consumer.mjs"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      assert.fail("the consumer must actually crash");
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr ?? "");
    }
    assert.match(stderr, /does not provide an export named 'neverExisted'/);

    const resolve = (specifier: string): string => join(dir, specifier.replace(/^\.\//, ""));
    assert.equal(diagnoseResolutionFailure(stderr, resolve), null,
      "a genuine missing export with a current dist must report the ordinary message and nothing extra");
  } finally {
    cleanup();
  }
});

test("diagnoseResolutionFailure: an unresolvable specifier is not this tool's to explain", () => {
  const resolve = (): string => { throw new Error("MODULE_NOT_FOUND"); };
  assert.equal(diagnoseResolutionFailure(
    "SyntaxError: The requested module 'nowhere' does not provide an export named 'x'", resolve), null);
});

test("diagnoseResolutionFailure: text naming neither known failure shape resolves nothing at all", () => {
  assert.equal(diagnoseResolutionFailure("Error: unrelated", () => "/should/not/be/called"), null);
});
