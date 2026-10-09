/**
 * THE FLOOR GUARDS WHAT WAS EXAMINED, NOT WHAT WAS ON DISK — #930, found by worker-capture on #900.
 *
 * `full-page-claims.mjs` first checked `MIN_CAPTURES` against `files.length`, before the loop that sets
 * aside unparseable, no-census and pre-#887 captures. So thirty captures with no usable census passed the
 * floor, examined nothing, and printed "none — every examined capture's sweeps made at least as many trips
 * as its census" with exit 0 — the examined-nothing clean result the floor exists to prevent, and this
 * script is the lab's VERDICT for the question, so it is the one place that shape is most expensive.
 *
 * Driven through the REAL script as a subprocess, against synthetic directories via `REAL_CORPUS_ROOT` —
 * never `runs/`, never the fleet. A synthetic capture is enough because the script's decision is a
 * function of the diagnostics it is handed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/full-page-claims.mjs", import.meta.url));

/** A capture the script can examine: a census, and a sweep that recorded its trips. */
const EXAMINABLE = JSON.stringify({ capture: { diagnostics: [
  { event: "structureCensus", heading: 3 },
  { event: "sweep", type: "heading", prevStop: "exhausted", nextStop: "exhausted",
    prevTrips: 4, nextTrips: 4, found: 3 },
] } });

/** A capture with no census mark at all -- counted, never examined. */
const NO_CENSUS = JSON.stringify({ capture: { diagnostics: [] } });

function runAgainst(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "full-page-claims-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    // REAL_CORPUS_ROOT, not RUNS_ROOT: the override points at a directory that IS the corpus.
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8", env: { ...process.env, REAL_CORPUS_ROOT: dir },
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const many = (n: number, body: string, prefix: string) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}.json`, body]));

test("#930: thirty captures with no usable census REFUSE, rather than report a clean corpus", () => {
  // worker-capture's reproduction, verbatim: 30 no-census captures and one file that is not JSON.
  const { status, out } = runAgainst({ ...many(30, NO_CENSUS, "p"), "broken.json": "not json" });
  assert.notEqual(status, 0, `examined nothing and exited 0 -- the defect this file exists for:\n${out}`);
  assert.match(out, /examined 0 of 31/, "the refusal must say how many it examined out of how many it read");
  // The CURRENT wording of the clean verdict. Asserting absence of old text would pass forever once the
  // wording moved -- a check that cannot fail -- so this names what the script prints today.
  assert.doesNotMatch(out, /none of the \d+ examined/,
    "a verdict of 'none lose the claim' over zero examined captures is the clean-over-nothing result");
});

test("#930: every file lands in exactly one total — the unparseable one is counted, not dropped", () => {
  // The loop's comment used to claim "the count below says so" for an unparseable file when no count
  // did: 31 files and 0 + 30 + 0 = 30. The refusal now names all four totals.
  const { out } = runAgainst({ ...many(30, NO_CENSUS, "p"), "broken.json": "not json" });
  assert.match(out, /30 with no usable census, 0 predating #887's trips, 1 unparseable/);
});

test("#930: the floor applies to EXAMINED captures, so a mostly-unexaminable corpus still refuses", () => {
  // Enough files to have passed the old files.length floor, too few examinable to answer.
  const { status, out } = runAgainst({ ...many(4, EXAMINABLE, "g"), ...many(20, NO_CENSUS, "p") });
  assert.notEqual(status, 0, `4 examined is below the floor of 5 however many files sat beside them:\n${out}`);
  assert.match(out, /examined 4 of 24/);
});

test("#930 CONTROL: enough examinable captures still report, so the fix is not 'it always refuses'", () => {
  const { status, out } = runAgainst(many(6, EXAMINABLE, "g"));
  assert.equal(status, 0, `six examinable captures must produce a report:\n${out}`);
  assert.match(out, /examined 6 — 0 with no usable census, 0 predating #887's trips, 0 unparseable/);
});

test("#930: the verdict line carries its own denominator — examined, and on disk", () => {
  // The fleet operator's point, and #920's cure: a verdict one line away from its count gets quoted
  // without it. Both the LOSE line and the clean line must name how many were examined.
  const clean = runAgainst({ ...many(6, EXAMINABLE, "g"), ...many(2, NO_CENSUS, "p") });
  assert.match(clean.out, /0 of 6 examined \(of 8 on disk\) LOSE the full-page claim/);
  assert.match(clean.out, /none of the 6 examined —/);
});
