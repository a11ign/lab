/**
 * Adding a case to one subtype must not RENAME the cases of another.
 *
 * A multi-defect case is named for the defects it carries — `table-unassociated-headers+also-vague-link`
 * — and captures live under that id. So changing which defects a host gets renames it, and a renamed case
 * has no captures: `check-signals` reports it as uncaptured, naming cases nobody has touched.
 *
 * `rotation` was a global counter advanced across every host in subtype-sorted order, so inserting a case
 * in ONE subtype shifted every host sorting after it. Measured 2026-08-26: adding five `1.3.1:no-headings`
 * cases renamed **164 of 1,401** across 55 base cases — every one in a subtype sorting after `1.3.1`, and
 * none before it. `--require-complete` then refused the whole corpus.
 *
 * It is the SAME defect the furniture buckets had and fixed, in a sibling mechanism nobody revisited — a
 * fix reaching one of several paths, which is this repo's most expensive recurring shape. Both now derive
 * from the subtype's hash plus the index within it; measured after the change, inserting the same five
 * cases renames **0**.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CASES as RAW_CASES } from "./case-matrix.mjs";

type Case = { id: string; criterion: string; subtype: string };
const CASES = RAW_CASES as Case[];

const SOURCE = readFileSync(fileURLToPath(new URL("./case-matrix.mjs", import.meta.url)), "utf8");

test("the accompanying-defect rotation is not a global running counter", () => {
  // Names the defect directly, so a revert reads as itself rather than as a mysterious recapture. The
  // measurement is in the comment above; this is the tripwire.
  const generator = SOURCE.slice(SOURCE.indexOf("const bySubtype = new Map()"));
  assert.ok(!/let\s+rotation\s*=/.test(generator),
    "a rotation accumulated across subtypes renames every host sorting after any inserted case. Derive it "
    + "from the subtype key and the host's index within that subtype, as `bucketFor` does for furniture");
  assert.match(generator, /fnv1a\(key\)\s*\+\s*indexInSubtype/,
    "the rotation must come from the subtype's hash plus the host's index within it");
});

test("known multi-defect ids are stable", () => {
  // A GOLDEN pin, and the reason it is golden rather than derived: the property under test is stability
  // ACROSS AN EDIT, which a single run of the generator cannot observe. These ids are in subtypes that
  // sort late, so they are the ones a positional rotation moves first — under the old code every one of
  // them changed when five cases were added to 1.3.1.
  //
  // If a deliberate corpus change moves these, update them: the recapture is the real cost and this test
  // is what makes it a decision rather than a surprise.
  // UPDATED 2026-08-31, deliberately: a twelfth `ROTATIONS` entry (`silent-toggle-inert`) re-rolled every
  // multi-defect case. 178 renamed and 178 added, 712 captures — paid to close the last two free vetoes
  // that can reach a report, `state_unchanged` on `3.3.1` and `4.1.3`.
  //
  // This test is what made that a decision rather than a surprise, which is its whole job. It failed
  // first, the cost was measured, and only then were these pins moved.
  const ids = new Set(CASES.map((testCase) => testCase.id));
  for (const id of [
    "table-unassociated-headers+also-bare-edit",
    "table-unassociated-hilltown+also-fake-heading-unnamed-graphic",
    "headings-none-refunds+also-filename-alt",
  ]) {
    assert.ok(ids.has(id),
      `${id} is gone. If you did not intend to rename it, the accompanying-defect rotation has moved — `
      + `every case sorting after your edit now has a new id and no captures under it`);
  }
});

test("every subtype's hosts are dealt DIFFERENT defect combinations", () => {
  // The rotation's actual job, which the fix must not cost. Independent hashing would let a subtype's
  // hosts collide on one combination; dealing consecutively from an offset cannot.
  const bySubtype = new Map<string, Set<string>>();
  for (const testCase of CASES) {
    const [base, suffix] = testCase.id.split("+also-");
    if (!suffix) continue;
    const key = `${testCase.criterion}:${testCase.subtype}:${base}`;
    bySubtype.set(key, (bySubtype.get(key) ?? new Set()).add(suffix));
  }
  assert.ok(bySubtype.size > 50, `only ${bySubtype.size} multi-defect host(s) found; the scan is broken`);
  const collided = [...bySubtype].filter(([, suffixes]) => suffixes.size < 2).map(([key]) => key);
  assert.ok(collided.length < bySubtype.size / 4,
    `${collided.length} host(s) carry only one defect combination across all their rounds — the rotation `
    + `has stopped spreading, so multi-defect coverage has quietly narrowed`);
});
