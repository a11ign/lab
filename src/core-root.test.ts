/**
 * THE LAB DOES NOT ASSUME THE CORE IS THREE DIRECTORIES ABOVE IT (a11ign/a11ign#5185, a follow-up to #5175).
 *
 * `new URL("../../../", import.meta.url)` was the core's root only while the core laid the lab under its `packages/`. From a standalone checkout it is the directory that holds the
 * checkout, so `check-shipped-provenance.ts` looked for `.changeset/` and the shipped weights there, found neither, and examined a tree that is not the core's. `coreRoot` takes the root
 * from a variable, RECOGNISES a laid lab (one that stands at `<core>/packages/lab`) and otherwise refuses naming the variable.
 *
 * Each direction is a test: a named root is used and the specific variable beats the general one; a laid lab is recognised; a lab that is neither named nor laid is refused, including the
 * look-alikes (`work/lab`, `packages/scorer`). The last test is the population scan, with the positive control that it finds the idiom where it is planted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { stripComments } from "@a11ign/toolchain/lib/source-text";
import { CORE_ROOT_VARIABLE, coreRoot } from "./dataset-paths.ts";
import { LAB_ROOT, labSources } from "./product-checks/lab-sources.ts";

const SPECIFIC = "A11Y_PROMOTE_ROOT";

/** A scratch directory holding `<core>/packages/lab` (laid) and `<elsewhere>/lab` (standalone). */
function planted() {
  const base = mkdtempSync(join(tmpdir(), "core-root-"));
  const laid = join(base, "core", "packages", "lab");
  const standalone = join(base, "elsewhere", "lab");
  mkdirSync(laid, { recursive: true });
  mkdirSync(standalone, { recursive: true });
  return { base, core: join(base, "core"), laid, standalone };
}

test("a root named by the gate's own variable is used, and beats A11Y_CORE_ROOT", () => {
  const { standalone } = planted();
  assert.equal(coreRoot(SPECIFIC, { [SPECIFIC]: "/named/core", [CORE_ROOT_VARIABLE]: "/general" }, standalone), resolve("/named/core"));
});

test("A11Y_CORE_ROOT names the core for a gate whose own variable is unset or empty", () => {
  const { standalone } = planted();
  assert.equal(coreRoot(SPECIFIC, { [CORE_ROOT_VARIABLE]: "/general/core" }, standalone), resolve("/general/core"));
  assert.equal(coreRoot(SPECIFIC, { [SPECIFIC]: "", [CORE_ROOT_VARIABLE]: "/general/core" }, standalone), resolve("/general/core"));
});

test("a lab laid at <core>/packages/lab is recognised with no variable set", () => {
  const { core, laid } = planted();
  assert.equal(coreRoot(SPECIFIC, {}, laid), core);
});

test("a standalone lab with no variable is REFUSED, naming both variables (the other direction)", () => {
  const { standalone } = planted();
  assert.throws(() => coreRoot(SPECIFIC, {}, standalone), (error: Error) =>
    error.message.includes(SPECIFIC) && error.message.includes(CORE_ROOT_VARIABLE));
});

test("a checkout that is not named packages/lab, or sits under a directory not named packages, is not laid", () => {
  const { base } = planted();
  for (const where of [join(base, "x", "packages", "scorer"), join(base, "x", "work", "lab"), join(base, "x", "packages", "nested", "lab", "src")]) {
    mkdirSync(where, { recursive: true });
    assert.throws(() => coreRoot(SPECIFIC, {}, where), /not laid under the core/, where);
  }
});

test("no non-test source of the lab computes a root with a three-level URL climb", () => {
  // Exactly three, the row's own count. Four climbs from `src/packaging/` or `src/harnesses/` name the core's root from one level deeper (five files, a11ign/a11ign#5185's follow-up row).
  const CLIMB = /new URL\(\s*["'`](?:\.\.\/){3}["'`]/;
  assert.ok(CLIMB.test('const REPO = fileURLToPath(new URL("../../../", import.meta.url));'), "POSITIVE CONTROL: the idiom is seen where it is written");
  assert.ok(!CLIMB.test('const HERE = fileURLToPath(new URL("../", import.meta.url));'), "a one-level climb is the lab's own root, not a reach");
  const files = labSources(/\.(ts|mjs)$/);
  const labRelative = files.map((file) => relative(LAB_ROOT, file));
  for (const known of ["scripts/promote-model.ts", "scripts/check-shipped-provenance.ts", "scripts/check-rehearsal-currency.ts", "src/dataset-paths.ts"]) {
    assert.ok(labRelative.includes(known), `${known} is not in the scanned population (${files.length} files)`);
  }
  const offenders = files.filter((file) => CLIMB.test(stripComments(readFileSync(file, "utf8")))).map((file) => relative(LAB_ROOT, file));
  assert.deepEqual(offenders, [], "ask `coreRoot(<variable>)` for the core, or `REPO_ROOT` for the root that holds runs/; never count `..` from this file");
});
