import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { corpusReadable } from "../training/corpus-settled.mjs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "../../../..");
const SCRIPT = join(REPO, "packages/lab/scripts/corpus-snapshot.mjs");
const source = () => readFileSync(SCRIPT, "utf8");

/**
 * WHAT THE SNAPSHOT MUST COVER, and why the first version had it backwards.
 *
 * `corpus:snapshot` archived `screenreader-dataset/{captures,manifest.json}` and nothing else. That corpus
 * is the one thing under `runs/` that CAN be rebuilt — pages are generated from `case-matrix.mjs` and
 * recaptured by the fleet, measured at 3 h 46 m for 2,122 captures. Expensive, and a matter of time and
 * machines rather than of luck.
 *
 * The two roots it omitted cannot be rebuilt at any price:
 *   real-page-corpus         captures of OTHER PEOPLE'S WEBSITES. Once w3.org edits a tutorial, the
 *                            capture of the previous version is gone for everyone, permanently.
 *   screenreader-acceptance  the held-out set, which `DATASET_KIND=acceptance` refuses to cache BY DESIGN.
 *
 * So the backup covered what was reproducible and omitted what was not — backwards, not merely partial.
 *
 * FOUND BY RUNNING THE RESTORE, NOT BY READING THE SCRIPT. A snapshot of a 417 MB `runs/` extracted to
 * 4,959 of 5,445 JSON files; the 486 missing were these. `corpus:backup --verify-only` reads the archive's
 * SIZE back, which a truncated or mis-scoped archive passes cleanly. **A backup nobody has extracted is
 * not a backup** — that is the row's own sentence and this is what it was protecting against.
 */
const MUST_ARCHIVE = ["real-page-corpus", "screenreader-acceptance"];

/**
 * Directories under `runs/` that are DERIVED and deliberately not archived, each with why. Classified
 * rather than omitted, so "nothing needs this" and "somebody forgot" stay different states.
 */
const REBUILDABLE: Record<string, string> = {
  "screenreader-dataset": "archived already, via WANTED — and rebuildable anyway: generated pages, recaptured",
  "embedding-cache": "a cache of encoder output, recomputed from the corpus on demand",
  "model-candidate": "trained FROM the corpus; a retrain reproduces it",
  "fetched": "artefacts pulled from the lab for reading; the lab holds the originals",
  "repeat-captures": "a diagnostic run's output, reproduced by re-running it",
  "worker-compare": "a diagnostic comparison, reproduced by re-running it",
  "runs": "a nested duplicate from a RUNS_ROOT mishap, not a distinct corpus",
};

test("the snapshot archives the roots that cannot be recaptured at any price", () => {
  const src = source();
  for (const name of MUST_ARCHIVE) {
    assert.match(src, new RegExp(`"${name}"`),
      `corpus-snapshot.mjs does not archive ${name}, which cannot be reproduced by recapturing. `
      + "The dataset it does archive can be.");
  }
});

test("both are reached through runsRoot, not the dataset root — they are SIBLINGS of it", () => {
  // Listing them without widening the tar's -C would archive nothing and report success, which is the
  // mis-scoped-archive failure one layer along.
  const src = source();
  assert.match(src, /runsRoot/, "the siblings live under runs/, so the script must resolve runsRoot()");
  assert.match(src, /"-C", RUNS/, "the tar must add a second -C for the sibling roots");
});

test("every capture-bearing directory under runs/ is archived or classified as rebuildable", () => {
  // DISCOVERY, so a new unreproducible root fails here the day it appears rather than the day someone
  // needs to restore it. Skips honestly without a corpus: `runs/` is gitignored and CI cannot see it.
  const runs = join(REPO, "runs");
  if (!existsSync(runs)) return;
  // A CORPUS BEING WRITTEN IS NOT A CORPUS TO AUDIT. A capture run creates and removes directories as it
  // goes, so a listing taken mid-run can name a root that will not exist a minute later — and this test
  // would report it as an unclassified, unarchived corpus. Skipping honestly is the house rule: a green
  // result from a moving corpus is as untrustworthy as a red one.
  const readable = corpusReadable({ evidenceDirs: [runs] });
  if (!readable.read) return;
  const dirs = readdirSync(runs, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
  if (dirs.length === 0) return;
  // ANTI-VACUITY: a corpus with no subdirectories would satisfy this having checked nothing.
  assert.ok(dirs.length >= 3, `only ${dirs.length} director(ies) under runs/; the layout changed`);

  const unclassified = dirs
    .filter((d) => !MUST_ARCHIVE.includes(d) && !(d in REBUILDABLE))
    .filter((d) => !d.startsWith("promoted-backup-"))
    .sort();
  assert.deepEqual(unclassified, [],
    "these live under runs/ and are neither archived by corpus:snapshot nor classified as rebuildable. "
    + "Decide which — an unarchived root that cannot be recaptured is the whole of this gate: "
    + unclassified.join(", "));
});
