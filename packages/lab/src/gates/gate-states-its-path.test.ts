/**
 * `rules:gate` READS THE EXPORT and `rules:real-pages` READS THE CAPTURES, and until 2026-09-06 neither
 * said so.
 *
 * `export-screenreader-dataset.mjs` bakes `ruleEvidence: oracleCounts(capture)` at EXPORT time, so the
 * census every census-reading rule consults in `rules:gate` is frozen under whatever trust rule was current
 * when the export ran. MEASURED: after the census trust-rule tightening merged, every rule finding across
 * all 2,796 exported records was byte-identical -- 1,398 conformant, 10 with a finding, the same
 * per-criterion counts -- while the same change demonstrably alters what a capture-reading rule concludes.
 *
 * The freeze is deliberate and is not the defect. The defect was the SILENCE, and its shape is worse than
 * a disagreement: it presents as THE FIX APPEARING NOT TO WORK. Land a capture-layer fix, run `rules:gate`,
 * see no movement, conclude the fix is wrong -- and be wrong. That is the "two gates disagreeing about one
 * corpus" signal from the 1.3.1 episode (`rules:gate` said `29/29 EXACT` while `rules:coverage` said
 * `fired 0x` about the same rule) arriving as a silence instead of a contradiction, which is strictly
 * harder to notice.
 *
 * Asserted on the SOURCE rather than by running the gate, because running it needs `runs/` -- gitignored,
 * so CI and a fresh worktree both have none, and this guard must not be one of the checks that reports
 * clean having examined nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCORE_RULES = readFileSync(
  fileURLToPath(new URL("../../scripts/score-rules.ts", import.meta.url)), "utf8");

test("rules:gate says it read the EXPORT and names what that hides", () => {
  assert.match(SCORE_RULES, /reportWhichPathThisGateRead\(DATA\)/,
    "main() no longer states which path it read — the divergence is silent again, which is the exact "
    + "condition this guard exists to prevent");
  assert.match(SCORE_RULES, /frozen at\\n {2}\s*export time|frozen at/,
    "the output must say the census is FROZEN at export time; 'reads the export' alone does not tell a "
    + "reader why a capture-layer fix shows no movement");
  assert.match(SCORE_RULES, /rules:real-pages/,
    "it must name the sibling gate that DOES see a capture-layer change, or a reader has no next step");
});

test("it reports a NUMBER of newer captures, not a word", () => {
  // `crossCheckStructure`'s rule: "link 51/58" beats "examination was INCOMPLETE", because a number says
  // whether two captures moved or two thousand. A bare "may be stale" is the warning everyone learns to
  // scroll past.
  assert.match(SCORE_RULES, /newerThanExport/,
    "nothing counts how many captures are newer than the export");
  assert.match(SCORE_RULES, /capture\(s\) are NEWER than this export/,
    "the count exists and is never said out loud — which is how the first direction of the staleness "
    + "check in audit-corpus-starvation.mjs failed");
  assert.match(SCORE_RULES, /job=export/,
    "it must name the command that settles it, like check-signals and the starvation audit do");
});

test("an unreadable corpus prints NOT MEASURED, never OK", () => {
  // `capture:explain`'s rule, and the reason the divergence survived: a silence read as agreement. A
  // laptop with no captures must not be told its export is current.
  assert.match(SCORE_RULES, /NOT MEASURED \(no captures readable from here\)/,
    "with no captures on disk the gate must say it did not measure, rather than staying quiet — a "
    + "quiet gate here is indistinguishable from a current one");
});
