/**
 * `docs/not-working.md` used to carry the same section number more than once — four `## 18.`, two `## 15.`,
 * two `## 20.` (one nested) — because a number was picked from memory of the highest one seen, with nothing
 * checking it. CLAUDE.md records the cost: reading the wrong same-numbered section twice in two days,
 * because the guidance for which one is current ("read to the LAST one") was itself written backwards
 * before being corrected by `git log -S`.
 *
 * ## The rule this test enforces
 *
 * A bare number (`## 18.`) means the CURRENT entry. A duplicate gets a single lowercase letter appended,
 * assigned in COMMIT order (`18a` oldest, `18c` newest-of-the-superseded) — see "How the numbers on this
 * page stay findable" near the top of `not-working.md` for the full argument, including why a duplicate is
 * not always a supersession (`§15`/`§15a` are two unrelated findings that happened to collide).
 *
 * So the one thing that must be true, mechanically, forever: **at most one heading per base number may be
 * bare.** Two bare `18`s is exactly the ambiguity this scheme exists to make impossible, and letters do not
 * fix it if two entries both claim to be "the" `18`.
 *
 * ## Why this is a test and not a paragraph
 *
 * "A rule that asks a human to remember something is a rule that gets broken" is this repo's own reason for
 * `furniture-spread.test.ts` existing as a test rather than a comment. The identical logic applies to a
 * human remembering to check for an existing number before reusing it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
// #905: the numbering rules live in the doc cross-reference check the nightly report also runs -- one copy.
import {
  DOC, badLetterGroups, byNumber, duplicateCurrentNumbers, headings, orphanedLetters,
} from "../../../../scripts/doc-checks/not-working-numbering.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const HEADINGS = headings(REPO);

test("the page still has numbered headings to check -- the format has not silently changed", () => {
  // The vacuity guard: a heading format change (different marker, different punctuation) would make the
  // regex above match nothing, and every assertion below would then pass having examined an empty list --
  // the exact shape `backlog.test.ts`'s own header warns about ("nothing found" and "we could not ask"
  // reading the same). Sized against the known population (26 at the time this test was written) rather
  // than a bare `> 0`, so a regression that drops most headings while leaving a couple standing still fails.
  assert.ok(HEADINGS.length >= 20,
    `found only ${HEADINGS.length} numbered headings in ${DOC} -- either most of the page's entries were `
    + "removed, or the heading format changed and this pattern needs updating, not the count relaxed.");
});

test("no base number has more than one BARE (current) heading", () => {
  const offenders = duplicateCurrentNumbers(HEADINGS);

  assert.deepEqual(offenders.map((o) => o.number), [],
    "More than one heading claims to be the CURRENT (bare) entry for the same number -- exactly the "
    + "ambiguity this file's numbering scheme exists to make impossible:\n"
    + offenders.map(({ number, bare }) =>
      `  §${number}: ${bare.map((h) => `line ${h.line} "${h.title}"`).join(" AND ")}`).join("\n")
    + "\n\nGive every superseded or colliding entry beyond the first a letter suffix in commit order "
    + `(git log -S "<headline>" -- ${DOC}), and say so in the heading, per the scheme documented near the `
    + "top of the file.");
});

test("every lettered heading's base number has exactly one current (bare) sibling somewhere on the page", () => {
  // The other direction: a letter with nothing bare to point at is an orphan -- the current entry was
  // deleted or renumbered and the pointer was never updated.
  const orphaned = orphanedLetters(HEADINGS);
  assert.deepEqual(orphaned, [],
    `lettered heading(s) point at a current entry that does not exist:\n${orphaned.join("\n")}`);
});

test("letters within one duplicate group are unique and contiguous from 'a'", () => {
  // Catches a copy-paste that reuses an existing letter, or a gap left by an edit -- either would silently
  // make "which one is oldest" ambiguous again, one level down from the bare-number problem this exists for.
  assert.deepEqual(badLetterGroups(HEADINGS), []);
});

test("REPORT: sections, duplicate groups, and which entry is current", () => {
  const numbers = byNumber(HEADINGS);
  const duplicateGroups = [...numbers.entries()].filter(([, hs]) => hs.length > 1);

  const lines = [
    `${HEADINGS.length} numbered headings, ${numbers.size} distinct base numbers, `
    + `${duplicateGroups.length} duplicate group(s).`,
  ];
  for (const [number, hs] of duplicateGroups) {
    const current = hs.find((h) => h.letter === "");
    lines.push(`  §${number}: ${hs.length} entries, current = `
      + (current ? `line ${current.line} "${current.title}"` : "NONE (would fail the test above)"));
  }
  // Printed rather than asserted on: this test exists to make the summary visible in `npm test` output,
  // the way the CEO's acceptance test asked for, not to re-decide what the other tests already decided.
  console.log(lines.join("\n"));
  assert.ok(true);
});
