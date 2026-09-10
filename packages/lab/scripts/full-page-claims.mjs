#!/usr/bin/env node
/**
 * How many real-page captures lose Requirement 2's full-page claim, and to which sweep.
 *
 * #894 shipped `ranOutShortOfTheCensus`: a sweep that reported it ran out, having made fewer round trips
 * than the census counts elements, cannot support "every structural sweep ran until the page ran out of
 * elements". This walks the corpus and says how many captures that withholds the claim from, BY PAGE.
 *
 * WHY A SCRIPT AND A LAB JOB RATHER THAN A SHELL LOOP: `runs/` in any checkout is a copy only as fresh as
 * its last sync — one measured here was 89 hours old — so a corpus-wide count is a VERDICT only when the
 * lab runs it, against the corpus the lab owns. `CLAUDE.md`'s "A GATE THAT READS runs/ IS NOT YOURS TO
 * REPORT" is the rule; this file is what lets that rule be obeyed rather than worked around.
 *
 * WITHHOLDING, NOT ASSERTING. Every number here is "this capture cannot support the claim", never "this
 * page is incomplete" — `ranOutShortOfTheCensus`'s own header explains why that asymmetry is the safe
 * direction, and a reader who inverts it will overstate what the corpus knows.
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sweepOutcomes, ranOutShortOfTheCensus } from "@a11ign/evidence/conformance";
import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { realCorpusRoot } from "../src/dataset-paths.mjs";
import { captureAgeLines } from "../src/training/real-page-freshness.mjs";

// FROM `dataset-paths.mjs`, never resolved here. `runs/` moves (A11Y_RUNS_ROOT, RUNS_ROOT, a mounted
// volume on the lab) and a second copy of that resolution is the "fact stated twice" shape this repo has
// paid for five times in a day -- `dataset-paths.test.ts` refuses a file that rolls its own, correctly.
const CORPUS = realCorpusRoot();

/**
 * Below this many EXAMINED captures the answer is not worth stating, and a zero would read as "all clean".
 *
 * Applied to `examined`, after the loop -- never to the files on disk. #900's first version checked
 * `files.length` before the loop that skips unparseable, no-census and pre-#887 captures, so a directory of
 * thirty captures with no usable census passed the floor, examined NOTHING, and printed "none — every
 * examined capture's sweeps made at least as many trips as its census" with exit 0: the exact
 * examined-nothing clean result the floor exists to stop, in the one place it is the verdict. Found by
 * worker-capture reproducing it against a synthetic directory, not by reading the diff.
 */
const MIN_CAPTURES = 5;

/** The census keys `ranOutShortOfTheCensus` can compare against — the four with a `CENSUS_KEY` entry. */
const CENSUS_FIELDS = ["heading", "landmark", "link", "graphic"];

/** @param {Record<string, any>} capture */
function scopeInputOf(capture) {
  const diagnostics = Array.isArray(capture?.diagnostics) ? capture.diagnostics : [];
  const mark = diagnostics.find((m) => m?.event === "structureCensus");
  // An ERRORED census is not a reading of zero. `ranOutShortOfTheCensus` returns [] on a null census,
  // which is the honest answer: coverage unknown, no claim withheld and none made.
  const census = mark && !("error" in mark)
    ? Object.fromEntries(CENSUS_FIELDS.filter((k) => typeof mark[k] === "number").map((k) => [k, mark[k]]))
    : null;
  return { sweeps: sweepOutcomes(diagnostics), census };
}

function main() {
  // No flags, and an unrecognised one is REFUSED rather than ignored -- a `--role=calibration` somebody
  // assumes this accepts would otherwise run the whole corpus and report it as though it were filtered.
  refuseUnknownFlags([], { entry: import.meta.url, command: "npm run lab:full-page-claims" });
  let files;
  try {
    files = readdirSync(CORPUS).filter((f) => f.endsWith(".json")).sort();
  } catch (error) {
    throw new Error(`cannot read the real-page corpus at ${CORPUS} — is this the lab?`, { cause: error });
  }

  const lost = [];
  // HOW OLD EACH EXAMINED CAPTURE IS, reported beside the count -- `real-page-corpus-freshness.test.ts`.
  // A corpus-wide figure over captures taken across different builds is the "dataset that spans a code
  // change" shape: the count can move because the instrument moved, and a reader who is not told the
  // ages cannot tell that from the page changing. `capturedAt`/`role` live on the WRAPPER, not on
  // `capture`, which is where `calibrate-abstention.mjs` reads them too.
  const ages = [];
  let examined = 0, noCensus = 0, noTrips = 0, unparseable = 0;
  for (const file of files) {
    let capture, parsed;
    try {
      parsed = JSON.parse(readFileSync(join(CORPUS, file), "utf8"));
      capture = parsed.capture ?? parsed;
    } catch {
      // Not evidence either way -- and COUNTED, so every file on disk lands in exactly one total below.
      // This comment used to say "the count below says so" when no count did: 31 files, 0 + 30 + 0 = 30.
      unparseable += 1;
      continue;
    }
    const input = scopeInputOf(capture);
    if (!input.census) { noCensus += 1; continue; }
    // A capture from before #887 records no `trips`, so it cannot answer this question at all. Counted
    // separately: "cannot say" and "says no" are different answers and collapsing them is the defect this
    // whole area keeps producing.
    if (!input.sweeps.some((s) => typeof s.trips === "number")) { noTrips += 1; continue; }
    examined += 1;
    if (typeof parsed.capturedAt === "string") {
      ages.push({ at: parsed.capturedAt, role: parsed.role ?? "no role recorded" });
    }
    const short = ranOutShortOfTheCensus(input);
    if (short.length) lost.push({ page: file.replace(/\.json$/, ""), short });
  }

  // THE FLOOR, ON WHAT WAS EXAMINED -- see MIN_CAPTURES. Refuses rather than reporting, and names every
  // reason a file was set aside, so "the corpus predates #887" and "this is not the corpus" read differently.
  if (examined < MIN_CAPTURES) {
    throw new Error(`examined ${examined} of ${files.length} file(s) at ${CORPUS} — below the floor of `
      + `${MIN_CAPTURES} (${noCensus} with no usable census, ${noTrips} predating #887's trips, ${unparseable} `
      + "unparseable). A clean result here would mean 'nothing was examined', not 'nothing was found'.");
  }

  console.log(`FULL-PAGE CLAIM, over ${files.length} capture(s) at ${CORPUS}`);
  console.log(`  examined ${examined} — ${noCensus} with no usable census, ${noTrips} predating #887's trips, `
    + `${unparseable} unparseable`);
  console.log(`  ${lost.length} of ${examined} LOSE the full-page claim`);
  console.log(`${captureAgeLines(ages).join("\n")}\n`);
  for (const { page, short } of lost) {
    console.log(`  ${page}`);
    for (const s of short) {
      console.log(`      ${s.type.padEnd(9)} found ${String(s.found).padStart(4)}  census `
        + `${String(s.census).padStart(4)}  trips ${String(s.trips).padStart(4)}`);
    }
  }
  if (!lost.length) console.log("  none — every examined capture's sweeps made at least as many trips as its census");
}

// RUN ONLY WHEN INVOKED, never on import -- `entry-points.test.ts` requires it, so that
// `node -e "import(...)"` can check this file still loads without it doing its work. realpath'd because
// npm's own .bin symlink would otherwise make the comparison silently false.
if (import.meta.url === pathToFileURL(process.argv[1] ? realpathSync(process.argv[1]) : "").href) main();
