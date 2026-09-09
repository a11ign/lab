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

/** Where the real-page captures live, overridable for a checkout that mounts `runs/` elsewhere. */
const CORPUS = process.env.A11Y_REAL_PAGE_CORPUS
  ?? join(process.env.A11Y_RUNS_ROOT ?? process.env.RUNS_ROOT ?? "runs", "real-page-corpus");

/** Below this, the directory almost certainly is not the corpus, and a zero would read as "all clean". */
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
  let files;
  try {
    files = readdirSync(CORPUS).filter((f) => f.endsWith(".json")).sort();
  } catch (error) {
    throw new Error(`cannot read the real-page corpus at ${CORPUS} — is this the lab?`, { cause: error });
  }
  if (files.length < MIN_CAPTURES) {
    throw new Error(`${files.length} capture(s) at ${CORPUS}: below the floor of ${MIN_CAPTURES}, so a `
      + "clean result here would mean 'nothing was examined' rather than 'nothing was found'");
  }

  const lost = [];
  let examined = 0, noCensus = 0, noTrips = 0;
  for (const file of files) {
    let capture;
    try {
      const parsed = JSON.parse(readFileSync(join(CORPUS, file), "utf8"));
      capture = parsed.capture ?? parsed;
    } catch {
      continue; // a file that will not parse is not evidence either way, and the count below says so
    }
    const input = scopeInputOf(capture);
    if (!input.census) { noCensus += 1; continue; }
    // A capture from before #887 records no `trips`, so it cannot answer this question at all. Counted
    // separately: "cannot say" and "says no" are different answers and collapsing them is the defect this
    // whole area keeps producing.
    if (!input.sweeps.some((s) => typeof s.trips === "number")) { noTrips += 1; continue; }
    examined += 1;
    const short = ranOutShortOfTheCensus(input);
    if (short.length) lost.push({ page: file.replace(/\.json$/, ""), short });
  }

  console.log(`FULL-PAGE CLAIM, over ${files.length} capture(s) at ${CORPUS}`);
  console.log(`  examined ${examined} — ${noCensus} with no usable census, ${noTrips} predating #887's trips`);
  console.log(`  ${lost.length} of ${examined} LOSE the full-page claim\n`);
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
