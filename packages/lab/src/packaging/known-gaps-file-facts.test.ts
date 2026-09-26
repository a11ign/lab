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

import { layerFile } from "../../../guards/src/layer-file.mjs";
import { ALL_ACCEPTANCE_CASES } from "../training/acceptance-matrix.mjs";

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
  const capturePure = readFileSync(layerFile("@a11ign/nvda-worker", "src/capture-pure.mjs", { from: import.meta.dirname }), "utf8");
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

// --- §53: the 4.1.3 status heads' ENUMERATED false-positive and miss sets (#2258, #2527) ---
//
// The sets are ACCEPTED BY ENUMERATION (`ceo`, 2026-09-25): a case outside them is a new reading and
// reopens #2258, so what this pins is the LIST, not a number. A test that only counted would let a case
// be swapped for another of the same cardinality, so each set is compared member by member as well.

// THE LIST IS ONE FILE (#2532): `evaluate-screenreader-acceptance.py` reads it to decide `passed`, and this test
// reads it to pin it to §53, so the doc and the gate cannot drift. It was two arrays written out here, which is a
// second copy of the ruling and the one place the gate could not see.
const ACCEPTED_CASES_FILE = "packages/lab/src/training/accepted-acceptance-cases.json";
type AcceptedEntry = { case: string, criterion: string, subtype: string };
const ACCEPTED_FILE: { falsePositives: AcceptedEntry[], misses: AcceptedEntry[] } =
  JSON.parse(readFileSync(join(REPO, ACCEPTED_CASES_FILE), "utf8"));
const ACCEPTED_FALSE_POSITIVES = ACCEPTED_FILE.falsePositives.map((entry) => entry.case).sort();
const ACCEPTED_MISSES = ACCEPTED_FILE.misses.map((entry) => entry.case).sort();
// THE LIST IS A `4.1.3` STATUS-HEAD LIST, NOT A GENERAL MECHANISM (`ceo`, 2026-09-25). Written out here and not
// read from the evaluator's own constant, so widening it takes an edit in two places and a reviewer sees both.
// `2.4.6` (#2188's icon-help false positive and its two heading misses) is NOT covered.
const ACCEPTABLE_CRITERION = "4.1.3";
const ACCEPTABLE_SUBTYPES = ["4.1.3:status-progress", "4.1.3:status-waiting"];
const STATUS_HEADS_SECTION = 53;
// The sizes the row states (2 and 9), written out rather than taken from the arrays above: a size read
// from the list it guards moves with it, and is no guard.
const FALSE_POSITIVE_COUNT = 2;
const MISS_COUNT = 9;
const FALSE_POSITIVE_LABEL = "**THE ACCEPTED FALSE-POSITIVE SET (2):**";
const MISS_LABEL = "**THE ACCEPTED-MISS SET (9):**";
const CASE_ID = /`(acceptance-[a-z0-9-]+\/(?:good|bad))`/g;

/** One numbered section of the file, from its `## N.` heading to the next `## ` heading or the end. */
const sectionOf = (text: string, number: number): string | null => {
  const start = text.search(new RegExp(`^## ${number}\\. `, "m"));
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
};

/** The `- \`case\`` bullets directly under a label, up to the first line that is not one; null if the label is absent. */
const enumeratedSet = (section: string, label: string): string[] | null => {
  const at = section.indexOf(label);
  if (at === -1) return null;
  const bullets: string[] = [];
  for (const line of section.slice(at + label.length).split("\n").slice(1)) {
    const match = /^- `(acceptance-[a-z0-9-]+\/(?:good|bad))`/.exec(line);
    if (!match) break;
    bullets.push(match[1]);
  }
  return bullets;
};

test("§53 exists and states the heads' limit, the cause, and what reopens #2258", () => {
  const section = sectionOf(KNOWN_GAPS, STATUS_HEADS_SECTION);
  assert.ok(section, "§53 (the 4.1.3 status heads' limit, #2527) is gone from known-gaps.md -- without it "
    + "\"4.1.3 status is model-triaged\" can be read as \"4.1.3 status is validated\", which is the claim "
    + "the row exists to stop");
  assert.match(section, /recall is a limit of the design/, "§53 no longer says the recall is a limit of the design");
  assert.match(section,
    /the activated control changes nothing visible and announces nothing, which is input-identical to the positives \(ADR 0021\)/,
    "§53 no longer carries the ACCEPTED cause verbatim -- the ruling accepts the FP WITH this cause, so an "
    + "edit that rewords it has changed what was accepted");
  assert.match(section, /any other false positive under either status head reopens #2258/i,
    "§53 no longer says an FP outside the enumerated set reopens #2258");
  assert.match(section, /a case outside the set is a new reading, not a covered one/,
    "§53 no longer says the misses are accepted by enumeration and not by margin");
});

test("§53 enumerates the accepted false positives exactly, each behind a vacuity guard", () => {
  const section = sectionOf(KNOWN_GAPS, STATUS_HEADS_SECTION);
  assert.ok(section, "§53 is gone -- see the test above");
  const found = enumeratedSet(section, FALSE_POSITIVE_LABEL);
  assert.ok(found, `the anchor ${FALSE_POSITIVE_LABEL} is gone from §53, so the set below it cannot be read`);
  assert.equal(found.length, FALSE_POSITIVE_COUNT, `the accepted false-positive set must hold exactly ${FALSE_POSITIVE_COUNT} cases (#2258): a `
    + "different size means the list was widened or its bullets no longer parse");
  assert.deepEqual([...found].sort(), ACCEPTED_FALSE_POSITIVES,
    "the accepted false-positive set changed. `ceo` accepted exactly these two (#2258, 2026-09-25); a "
    + "third is a NEW reading that reopens the row, not an edit to this list");
});

test("§53 enumerates the accepted misses exactly, each behind a vacuity guard", () => {
  const section = sectionOf(KNOWN_GAPS, STATUS_HEADS_SECTION);
  assert.ok(section, "§53 is gone -- see the test above");
  const found = enumeratedSet(section, MISS_LABEL);
  assert.ok(found, `the anchor ${MISS_LABEL} is gone from §53, so the set below it cannot be read`);
  assert.equal(found.length, MISS_COUNT, `the accepted-miss set must hold exactly ${MISS_COUNT} cases (#2258): a different `
    + "size means the list was widened or its bullets no longer parse");
  assert.deepEqual([...found].sort(), ACCEPTED_MISSES,
    "the accepted-miss set changed. These nine are the recall limit `product-manager` recorded on #2258 "
    + "(2026-09-25); a status-head miss outside them is a NEW reading that reopens the row");
});

test("§53 names no case outside the two sets, so prose cannot widen either one", () => {
  const section = sectionOf(KNOWN_GAPS, STATUS_HEADS_SECTION);
  assert.ok(section, "§53 is gone -- see the test above");
  const mentioned = [...section.matchAll(CASE_ID)].map((m) => m[1]);
  assert.ok(mentioned.length >= ACCEPTED_FALSE_POSITIVES.length + ACCEPTED_MISSES.length,
    "§53 mentions fewer case ids than the two sets hold -- the scan is not reading what it thinks it is");
  const allowed = new Set([...ACCEPTED_FALSE_POSITIVES, ...ACCEPTED_MISSES]);
  assert.deepEqual(mentioned.filter((id) => !allowed.has(id)), [],
    "§53 names a case that is in neither accepted set -- a sentence like \"and X too\" is a widening "
    + "the enumerated lists would not show");
});

test("§53's enumerated cases are real acceptance cases of the kind the sets claim", () => {
  const byFamily = new Map<string, { criterion: string, subtype: string }>(
    ALL_ACCEPTANCE_CASES.map((c: { family: string, criterion: string, subtype: string }) => [c.family, c]));
  assert.ok(byFamily.size > 0, "the acceptance matrix is empty -- the lookup below would pass on nothing");
  for (const id of ACCEPTED_MISSES) {
    const found = byFamily.get(id.replace(/\/(?:good|bad)$/, ""));
    assert.ok(found, `${id} is not an acceptance case (renamed or removed?) -- the miss set now pins a name nothing reads`);
    assert.equal(found.criterion, "4.1.3", `${id} is not a 4.1.3 case`);
    assert.match(found.subtype, /^status-(?:progress|waiting)$/, `${id} is not under a status head`);
    const entry = ACCEPTED_FILE.misses.find((candidate) => candidate.case === id);
    assert.equal(entry?.subtype, `4.1.3:${found.subtype}`,
      `${id} is labelled for ${found.subtype} but the file accepts it under ${entry?.subtype}: a miss is keyed by the head its case is labelled for`);
    assert.match(id, /\/bad$/, `${id}: a MISS is a positive the head failed to flag, so it is the bad page`);
  }
  for (const id of ACCEPTED_FALSE_POSITIVES) {
    const found = byFamily.get(id.replace(/\/(?:good|bad)$/, ""));
    assert.ok(found, `${id} is not an acceptance case (renamed or removed?) -- the FP set now pins a name nothing reads`);
    assert.equal(found.criterion, "4.1.2",
      `${id} is no longer a 4.1.2 icon case: an FP under a 4.1.3 head on a page of ANOTHER criterion is the reading §53 accepts`);
    assert.match(id, /\/good$/, `${id}: a false positive is a flag on a page with no defect, so it is the good page`);
  }
});

/** The entries that are not a `4.1.3` status-head entry keyed by case id + criterion + subtype. */
const entriesOutsideTheRuling = (entries: AcceptedEntry[]): AcceptedEntry[] =>
  entries.filter((entry) => Object.keys(entry).sort().join() !== "case,criterion,subtype"
    || entry.criterion !== ACCEPTABLE_CRITERION || !ACCEPTABLE_SUBTYPES.includes(entry.subtype));

test("the accepted-cases file is the ONE list: 2 false positives and 9 misses, each under a 4.1.3 status head", () => {
  assert.equal(ACCEPTED_FILE.falsePositives.length, FALSE_POSITIVE_COUNT,
    `${ACCEPTED_CASES_FILE} must list exactly ${FALSE_POSITIVE_COUNT} false positives (§53)`);
  assert.equal(ACCEPTED_FILE.misses.length, MISS_COUNT,
    `${ACCEPTED_CASES_FILE} must list exactly ${MISS_COUNT} misses (§53)`);
  assert.deepEqual(entriesOutsideTheRuling([...ACCEPTED_FILE.falsePositives, ...ACCEPTED_FILE.misses]), [],
    "an accepted entry is outside the `4.1.3` status heads, or lacks one of the three key fields (case id + "
    + "criterion + subtype). Widening the list is a NEW `ceo` ruling and a new known-gaps section, not an edit "
    + "to this file; `2.4.6` is not covered");
  const keys = [...ACCEPTED_FILE.falsePositives, ...ACCEPTED_FILE.misses]
    .map((entry) => `${entry.case}|${entry.criterion}|${entry.subtype}`);
  assert.equal(new Set(keys).size, keys.length, "an accepted entry is listed twice");
});

test("each accepted entry's subtype is the head §53 names beside its case", () => {
  const section = sectionOf(KNOWN_GAPS, STATUS_HEADS_SECTION);
  assert.ok(section, "§53 is gone -- see the first §53 test");
  const lines = section.split("\n");
  for (const entry of [...ACCEPTED_FILE.falsePositives, ...ACCEPTED_FILE.misses]) {
    const line = lines.find((candidate) => candidate.startsWith(`- \`${entry.case}\``));
    assert.ok(line, `${entry.case} has no bullet in §53`);
    assert.ok(line.includes(`\`${entry.subtype}\``) || line.includes(`\`${entry.subtype.replace(/^4\.1\.3:/, "")}\``),
      `§53 names a different head beside ${entry.case} than the file's ${entry.subtype}: the gate would accept `
      + `a failure the ruling does not describe. Line: ${line}`);
  }
});

test("MUTATION: the §53 readers notice a widened set, a removed anchor and a missing section", () => {
  const section = sectionOf(KNOWN_GAPS, STATUS_HEADS_SECTION);
  assert.ok(section, "§53 is gone -- see the first §53 test");
  const widened = section.replace(FALSE_POSITIVE_LABEL,
    `${FALSE_POSITIVE_LABEL}\n- \`acceptance-b3-icon-menu/good\``);
  assert.notEqual(widened, section, "the widening did not change the section -- the label moved");
  assert.equal(enumeratedSet(widened, FALSE_POSITIVE_LABEL)?.length, FALSE_POSITIVE_COUNT + 1,
    "a third bullet under the FP label was not read -- the reader would not see a widening");
  assert.equal(enumeratedSet(section.replace(MISS_LABEL, "**something else:**"), MISS_LABEL), null,
    "an absent anchor read as an empty set instead of as absent");
  assert.equal(sectionOf(KNOWN_GAPS.replace(/^## 53\. /m, "## 5x. "), STATUS_HEADS_SECTION), null,
    "a missing section heading was not reported as absent");

  const real = ACCEPTED_FILE.misses[0];
  assert.equal(entriesOutsideTheRuling([real]).length, 0, "the real first entry reads as outside the ruling -- the guard refuses everything");
  for (const widened of [
    { ...real, criterion: "2.4.6", subtype: "2.4.6:regex" },
    { ...real, subtype: "4.1.3:form-activation-silent" },
    { case: real.case, subtype: real.subtype },
  ]) {
    assert.equal(entriesOutsideTheRuling([widened as AcceptedEntry]).length, 1,
      `an entry outside the 4.1.3 status heads was not refused: ${JSON.stringify(widened)}`);
  }
});

// `ceo`'s 2026-09-25 rulings on three survey questions (#928, comment 5840564703, ruling 5), each written
// into the section that raised the question as one dated line. Pinned BY SECTION: a whole-file `includes`
// is satisfied by a copy in the wrong section, which is exactly the misplacement this guards.
const RULING_COMMENT_ID = "5840564703";
const RULING_DATE = "2026-09-25";
const RULED_SECTIONS: Array<{ section: number, states: RegExp, because: string }> = [
  { section: 31, states: /: NO\*\*[\s\S]*n=6 on one page shape[\s\S]*would change this; none is queued/,
    because: "NO, its bound (n=6, one page shape) and what would change it" },
  { section: 32, states: /agreed, do not ask now[\s\S]*cannot detect its absence[\s\S]*no reader is asking/,
    because: "not asked now, with the reason" },
  { section: 42, states: /ACCEPT the autofocus bound permanently, condition unchanged[\s\S]*not sized now/,
    because: "accepted permanently, condition unchanged, not sized" },
];
const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

// The DATE is read off the ruling's own line, not the section: §42 already carries another 2026-09-25 (the
// #2551 correction of its deleted-exception claim), so a section-wide count would refuse a correct file.
const rulingLines = (body: string): string[] => body.split("\n").filter((row) => row.includes(RULING_COMMENT_ID));

test("each of §31, §32 and §42 records ceo's 2026-09-25 ruling once, INSIDE that section", () => {
  for (const { section, states, because } of RULED_SECTIONS) {
    const body = sectionOf(KNOWN_GAPS, section);
    assert.ok(body, `§${section} is gone from known-gaps.md -- the ruling recorded in it has nowhere to be read`);
    assert.equal(occurrences(body, RULING_COMMENT_ID), 1,
      `§${section} must name #928 comment ${RULING_COMMENT_ID} exactly once (a copy in another section does not count)`);
    const [line] = rulingLines(body);
    assert.equal(occurrences(line, RULING_DATE), 1, `§${section}'s ruling line must carry ${RULING_DATE} exactly once`);
    assert.match(body, states, `§${section}'s dated line no longer states the ruling: ${because}`);
  }
});

test("MUTATION: deleting the line from one section turns only that section's reading red", () => {
  for (const { section } of RULED_SECTIONS) {
    const withoutIt = KNOWN_GAPS.split("\n")
      .filter((row) => !(row.includes(RULING_COMMENT_ID) && sectionOf(KNOWN_GAPS, section)!.includes(row)))
      .join("\n");
    assert.notEqual(withoutIt, KNOWN_GAPS, `§${section}: there was no ruling line to delete -- the reading above is vacuous`);
    for (const other of RULED_SECTIONS) {
      const expected = other.section === section ? 0 : 1;
      assert.equal(occurrences(sectionOf(withoutIt, other.section)!, RULING_COMMENT_ID), expected,
        `deleting §${section}'s line changed §${other.section}'s reading to something other than ${expected}`);
    }
  }
});
