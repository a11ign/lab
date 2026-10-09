/**
 * Every audit that reads `runs/` must be able to say it is reading a PARTIAL copy.
 *
 * `runs/` is gitignored, so a working copy is only ever as fresh as its last sync. That produced three
 * wrong answers in one afternoon: `check-signals` reported 860 stale locally and 0 on the lab at the same
 * commit; ADR 0016 was published stating 26 captured pages when the lab had 77; and `corpus:starvation`
 * printed a full starvation table computed on 1868 records while the lab's export held 2282.
 *
 * The starvation audit already had a staleness check and it faced the wrong way. `unmatched` counts records
 * whose CASE has gone — a rename or a deletion. It cannot see the far commoner direction: an export that
 * predates cases which now exist, where every record present is perfectly valid and hundreds are simply
 * absent. Locally that read `0 whose case is no longer defined` while 369 of 1303 cases had no record.
 *
 * Two directions, two counts, because they are different faults with different fixes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AUDIT = readFileSync(
  fileURLToPath(new URL("../../scripts/audit-corpus-starvation.mjs", import.meta.url)), "utf8");

test("the starvation audit counts cases with NO record, not only records with no case", () => {
  // Both directions must exist. Either alone is a check that reports clean on the fault it cannot see.
  assert.match(AUDIT, /const unmatched = records\.filter/,
    "records whose case has gone are no longer counted");
  assert.match(AUDIT, /const represented = new Set\(records\.map/,
    "nothing computes which defined cases are absent from the export");
  assert.match(AUDIT, /defined case\(s\) have NO record here/,
    "the count exists and is never said out loud — which is how the first direction failed");
});

test("a partial export says every count below it is partial, not just that some cases are missing", () => {
  // The number alone invites "369 missing, but the table is probably fine". It is not: every occurrence
  // count and every starvation verdict is computed over the records present.
  assert.match(AUDIT, /every count below is computed on part of the corpus/,
    "a partial corpus must invalidate the report it produced, not sit beside it as a footnote");
  assert.match(AUDIT, /lab:job -- -e job=export/,
    "it must name the command that settles it, like check-signals does");
});
