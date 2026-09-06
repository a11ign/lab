/**
 * A handful of `docs/known-gaps.md` claims that ARE mechanically checkable, pinned so they cannot go
 * stale silently — the same shape `backlog.test.ts` uses for backlog.md, applied to the higher-stakes
 * sibling. This is NOT a general prose parser: known-gaps.md is mostly narrative measurement, which no
 * test should try to re-derive. These are the specific numbers, constants and file facts an audit found
 * this file quoting, that a real source artefact can confirm or refute directly.
 *
 * EVERY ASSERTION HAS A VACUITY GUARD: before checking the claim, confirm the ANCHOR text this test keys
 * on is still present in the real source. Read a moved phrase as "still true" is exactly the count-based
 * check this repo's whole diagnostics model exists to catch — a check that examines nothing must never
 * report success.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const KNOWN_GAPS = readFileSync(join(REPO, "docs/known-gaps.md"), "utf8");

test("known-gaps.md exists and still opens with its own stated purpose", () => {
  assert.match(KNOWN_GAPS, /What this project does \*\*not\*\* currently do/,
    "the file's own framing sentence moved or was deleted — every claim below assumes this document is "
    + "still the one CLAUDE.md points at as \"what this project does NOT do\"");
});

test("§9's veto table is marked stale, and the CURRENT baseline backs the correction", () => {
  assert.match(KNOWN_GAPS, /STALE — verified against the tracked baseline/,
    "§9's correction (form_field_unnamed no longer vetoes the three focus subtypes) is gone from the "
    + "file — either it was removed, or the whole section was rewritten without carrying the correction");

  const baselinePath = join(REPO, "packages/lab/scripts/scorer-shortcuts.baseline.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.ok(Array.isArray(baseline.rows) && baseline.rows.length > 0,
    "scorer-shortcuts.baseline.json's `rows` array is gone, empty, or was renamed -- the file's shape "
    + "changed and this test's assumptions about it need re-checking, not just patching");
  const bySubtype = new Map<string, { vetoes: Array<{ feature: string }> }>(
    baseline.rows.map((s: { subtype: string, vetoes: Array<{ feature: string }> }) => [s.subtype, s]));
  for (const subtype of [
    "2.1.1:control-unreachable-by-keyboard", "2.1.2:focus-trapped", "2.4.3:focus-order-scrambled",
  ]) {
    const entry = bySubtype.get(subtype);
    assert.ok(entry, `${subtype} is gone from the baseline — the file this test reads has changed shape, `
      + "re-verify the claim rather than trusting this test's structure");
    const features = entry!.vetoes.map((v) => v.feature);
    assert.ok(!features.includes("form_field_unnamed"),
      `${subtype} has form_field_unnamed back in its vetoes -- the FOCUS_SAFE remedy (known-gaps.md §9) `
      + "may have regressed, or the corpus changed under it. Re-read §9 before assuming this is fine.");
  }
});

test("§16's ABSENCE_CRITERIA count is marked stale, and the real set matches verify-gate.ts today", () => {
  assert.match(KNOWN_GAPS, /this list is illustrative history/,
    "§16's staleness correction is gone — either removed or the section was rewritten without it");

  const verifyGate = readFileSync(join(REPO, "packages/judge/src/verify-gate.ts"), "utf8");
  const match = verifyGate.match(/export const ABSENCE_CRITERIA = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "ABSENCE_CRITERIA is gone from verify-gate.ts or was renamed — re-verify §16 by hand");
  const criteria = [...match[1].matchAll(/"([\d.]+)"/g)].map((m) => m[1]);
  assert.ok(criteria.includes("1.4.13") && criteria.includes("3.2.1")
    && criteria.includes("3.2.2") && criteria.includes("3.3.3"),
    "§16's correction names 1.4.13, 3.2.1, 3.2.2 and 3.3.3 as criteria the original nine-item list "
    + "omitted -- one of them is gone from ABSENCE_CRITERIA, so the correction itself may now be stale");
  assert.ok(!criteria.includes("3.3.2"),
    "3.3.2 is back in ABSENCE_CRITERIA -- §16's correction says it was reclassified to 4.1.2:unnamed-"
    + "control and removed on 2026-09-05; if it has returned, re-read that reclassification before trusting "
    + "the correction's account of it");
});

test("§17's landmark-feature removal and schema advance both still hold", () => {
  assert.match(KNOWN_GAPS, /CLOSED — confirmed 2026-09-05/,
    "§17's closing confirmation is gone from the file");

  const features = readFileSync(
    join(REPO, "packages/scorer/python/screenreader_features.py"), "utf8");
  assert.match(features, /`landmark_present` AND `landmark_named` WERE REMOVED HERE — known-gaps §17/,
    "the removal comment citing known-gaps §17 is gone from screenreader_features.py -- either the "
    + "features came back, or the comment was deleted without the doc being re-checked");
  assert.doesNotMatch(features, /values\["landmark_present"\]\s*=/,
    "landmark_present is computed again -- §17's removal has been reverted and the doc's CLOSED claim "
    + "is now wrong");

  // AN ABSENT MIGRATION FILE IS THE CLAIM SATISFIED, NOT AN ERROR — corrected 2026-09-06.
  //
  // This read the file unconditionally, so it could only pass while a migration was OPEN: the file
  // exists for the duration of one and is deleted when it closes (`lab-inventory.mjs` states the close
  // as "promoting weights stamped <schema> and DELETING schema-migration.json"). So closing a migration
  // broke a test that asserts a migration has closed. It had never run in the state the project is
  // trying to reach, and it failed for the first time on the night the v18 -> v19 close landed.
  //
  // §17's claim is that the shipped schema has advanced PAST v16. No open migration means the shipped
  // schema IS the pending one, which is the strongest form of that claim rather than a missing input --
  // the same rule this file applies everywhere else, that an absence and a negative must not share a
  // value. When one IS open, the assertion below is the check that was always intended.
  const migrationPath = join(REPO, "packages/scorer/models/schema-migration.json");
  if (existsSync(migrationPath)) {
    const migration = JSON.parse(readFileSync(migrationPath, "utf8"));
    const shippedVersion = Number(migration.shippedSchema.match(/v(\d+)$/)?.[1]);
    assert.ok(shippedVersion >= 18,
      `shipped schema is ${migration.shippedSchema}, which is v16 or earlier -- §17 claims the migration `
      + "it opened has since closed because the shipped schema advanced past v16; if the schema has moved "
      + "BACKWARDS this needs a human, not a re-run of this test");
  }
});

test("§38 (4.1.2 settability) stays connected to the code comment and test it cites", () => {
  assert.match(KNOWN_GAPS, /4\.1\.2's SETTABILITY clause cannot be assessed by this tool/,
    "§38 is gone -- it was added by this unit specifically because coverage.md/criterion-coverage.ts "
    + "already said this and known-gaps.md did not; if it has been removed, re-check whether that is "
    + "still true before deleting this test");

  const coverageTest = readFileSync(
    join(REPO, "packages/judge/src/criterion-coverage.test.ts"), "utf8");
  assert.match(coverageTest, /4\.1\.2's note accounts for all THREE clauses, including the settable one/,
    "the test §38 relies on for its claim (that 4.1.2's coverage note states the settability gap) is gone "
    + "or renamed -- re-verify the underlying note directly in criterion-coverage.ts");
});

test("§39 is marked CLOSED, and the threshold constant it quotes lives where the closure says it moved", () => {
  assert.match(KNOWN_GAPS, /CLOSED 2026-09-06, and the answer was sharper than/,
    "§39's closure is gone -- if the F55 lower bound question was reopened, update this test to match "
    + "rather than deleting it, since the underlying question (is the threshold verified against a real "
    + "positive) is still one worth pinning");

  // §39 records the constant MOVING, not merely renaming: capture-pure.mjs no longer judges anything
  // (ADR 0021, "captures record, rules decide"), so `FOCUS_SCRIPT_BLUR_WINDOW_MS` has no home there any
  // more. It now lives in rules.ts as `FOCUS_SCRIPT_WINDOW_MS`, judging a HELD time rather than gating a
  // capture-time pairing -- same value, different question.
  const capturePure = readFileSync(join(REPO, "packages/nvda-worker/src/capture-pure.mjs"), "utf8");
  assert.doesNotMatch(capturePure, /FOCUS_SCRIPT_BLUR_WINDOW_MS/,
    "§39 says this constant moved OUT of capture-pure.mjs entirely -- if it is back, the closure's account "
    + "of the architecture is wrong and needs re-checking, not just this test");

  const rules = readFileSync(join(REPO, "packages/judge/src/rules.ts"), "utf8");
  const match = rules.match(/const FOCUS_SCRIPT_WINDOW_MS = (\d+);/);
  assert.ok(match, "FOCUS_SCRIPT_WINDOW_MS is gone or was renamed in rules.ts -- §39 says this is where the "
    + "F55 threshold now lives");
  assert.equal(match[1], "50",
    `FOCUS_SCRIPT_WINDOW_MS is now ${match?.[1]}, not 50 -- §39 quotes the old value carrying over `
    + "unchanged. If it moved because someone tuned it to make a test pass rather than because a real "
    + "blur() was measured, that is exactly the shortcut docs/backlog.md warns against taking");
});
