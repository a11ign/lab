// @ts-check
/**
 * HOW MANY FEATURE ZEROS ARE CAPTURE ARTEFACTS RATHER THAN PAGE FACTS?
 *
 * The reasoning, the `landmark_present` precedent and the verdict semantics are in
 * `observation-ambiguity.mjs`, which holds the analysis so it can be tested against captures built to
 * demonstrate each verdict. This is the CLI: it finds the captures, prints the table, writes the report.
 *
 * IT REPORTS AND NEVER BLOCKS. A high artefact rate is a fact about the capture path, not a defect a
 * commit introduced, and a gate that fires on an unchanged corpus is one people bypass —
 * `A11Y_SKIP_VERIFY=1` was used six times in one evening for a refusal that turned out to be a stale
 * export. `rules:coverage` is the model for the tone: state the number and what it rests on.
 *
 * It DOES exit 2 on an empty corpus, because "0 captures, no artefacts found" and "no artefacts found"
 * must never print the same way. That is the `examinedNothing` rule, whose own comment named the general
 * case and then covered only `compared === 0`.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { observationAmbiguity } from "../src/training/observation-ambiguity.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { datasetRoot, captureRoot, runsRoot } from "../src/dataset-paths.mjs";

const arg = (/** @type {string} */ name) =>
  process.argv.slice(2).find((value) => value.startsWith(name))?.slice(name.length);


/** @returns {Generator<string>} */
function* captureFiles(/** @type {string} */ root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* captureFiles(full);
    else if (entry.name.endsWith(".json")) yield full;
  }
}

function* captures(/** @type {string} */ root, /** @type {string[]} */ ids) {
  for (const file of captureFiles(root)) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    // The id is the FILENAME without `.json`, which is `<case>.<variant>` -- the only thing that can pair
    // two captures back up. Collected here rather than derived inside the analysis, because the analysis
    // is given captures and has no idea where any of them came from.
    ids.push(path.basename(file).replace(/\.json$/, ""));
    // A capture file may BE the capture or carry one. Reading the wrapper as the capture is a recorded
    // defect -- `capture:explain` reported 0 of 20 tab stops that way, and called it a page finding.
    yield parsed?.capture ?? parsed;
  }
}

/**
 * Did every PAIR get measured with the same instrument?
 *
 * The failure count alone is not the finding. A park that failed on both halves of a pair is symmetric and
 * harms nothing; one that failed on a single half means the two variants differ by the MEASURING TOOL and
 * not by accessibility -- the U+FFFC defect, which this project calls the one it cannot tolerate.
 *
 * @param {{parked: number, parkFailed: number, failedIds: string[]}} inst
 */
function reportInstrument(inst) {
  const total = inst.parked + inst.parkFailed;
  console.log("");
  console.log("was every pair measured with the SAME instrument? (`parkPointer`, read by nothing so far)");
  console.log("  " + String(inst.parkFailed).padStart(6) + " of " + total +
    " capture(s) failed to park the pointer " + pct(inst.parkFailed, total));
  const failed = new Set(inst.failedIds);
  // An id that is not `<case>.good` or `<case>.bad` has NO pair, so it cannot split one. Returning null
  // rather than a constructed string is the difference between "no mate" and "a mate we invented" -- the
  // first version fell back to a running number, and every failure then read as a split because no
  // number has a mate. A false report inside the report about false readings.
  const mateOf = (/** @type {string} */ id) => {
    const dot = id.lastIndexOf(".");
    const variant = dot === -1 ? "" : id.slice(dot + 1);
    if (variant !== "good" && variant !== "bad") return null;
    return id.slice(0, dot) + "." + (variant === "good" ? "bad" : "good");
  };
  const unpaired = inst.failedIds.filter((id) => mateOf(id) === null);
  const split = inst.failedIds
    .filter((id) => { const m = mateOf(id); return m !== null && !failed.has(m); }).sort();
  console.log("  " + String(split.length).padStart(6) + " of those SPLIT A PAIR — the half that failed was "
    + "measured differently from its mate");
  for (const id of split.slice(0, 8)) console.log("           " + id);
  if (split.length > 8) console.log("           ... and " + (split.length - 8) + " more");
  if (unpaired.length) {
    console.log("  " + String(unpaired.length).padStart(6) + " could not be paired at all (not <case>.<variant>) "
      + "— counted apart, never as splits");
  }
  console.log("  Ctrl over an image is a MAGNIFIER OVERLAY in Edge, which is why the park exists at all —");
  console.log("  so a split on an `image-*` case is the case where the remedy mattered most.");
}

const pct = (/** @type {number} */ part, /** @type {number} */ whole) =>
    (whole === 0 ? "   n/a" : (100 * part / whole).toFixed(1).padStart(5) + "%");

/**
 * Was each recorded activation soundly measured, and by how much?
 *
 * The verdict alone is now a constant -- `baselineQuiet` reads `true` on 1,117 of 1,117 stated entries on
 * the authoritative corpus -- so the MARGIN is the half that still carries information. A budget that
 * always wins by 200ms and one that always wins by 100ms print the same word and are different situations.
 *
 * @param {{entries: number, quiet: number, notQuiet: number, unstated: number, waits: number[]}} snd
 */
function reportSoundness(snd) {
  console.log("was each recorded activation SOUNDLY measured? (`baselineQuiet`, read by nothing so far)");
  console.log("  " + String(snd.entries).padStart(6) + " formChanges entr(ies): " +
    snd.quiet + " settled " + pct(snd.quiet, snd.entries) +
    "  " + snd.notQuiet + " NOISY " + pct(snd.notQuiet, snd.entries) +
    "  " + snd.unstated + " unstated " + pct(snd.unstated, snd.entries));
  // The MARGIN, so "always settles" and "always settles just in time" cannot print the same. A budget
  // with no headroom is one record from the cliff, which is the shape `choose_threshold` already taught
  // this repo: clean on this corpus, unusable on the next.
  const waits = [...(snd.waits ?? [])].sort((a, b) => a - b);
  if (waits.length) {
    const at = (/** @type {number} */ q) => waits[Math.min(waits.length - 1, Math.floor(waits.length * q))];
    console.log("  waited: p50 " + at(0.5) + "ms  p95 " + at(0.95) + "ms  max " + waits[waits.length - 1] +
      "ms of a 20000ms budget  (" + waits.length + " stated)");
  } else {
    console.log("  waited: NOT RECORDED on any entry -- so headroom is unknown, not comfortable.");
  }
  console.log("  NOISY means the speech baseline had not settled, so `after` is untrustworthy in EITHER");
  console.log("  direction -- and `validation_error_missing` reads an empty `after` as \"nothing was");
  console.log("  announced\". unstated is a capture taken before the field existed, NOT a noisy one:");
  console.log("  reading absence as false is the defect this whole report is about.");
}

function main() {
  refuseUnknownFlags(["--captures=", "--out=", "--json"], {
    entry: import.meta.url,
    command: "npm run corpus:observation-ambiguity",
  });
  const capturesArg = arg("--captures=");
  const CAPTURES = capturesArg ? path.resolve(capturesArg) : captureRoot(datasetRoot());
  const outArg = arg("--out=");
  const OUT = outArg ? path.resolve(outArg) : path.resolve(runsRoot(), "observation-ambiguity.json");

  /** @type {string[]} */
  const ids = [];
  const result = observationAmbiguity(captures(CAPTURES, ids), ids);
  const report = { capturesRoot: path.resolve(CAPTURES), ...result };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }


  console.log("OBSERVATION AMBIGUITY — how many feature zeros are artefacts?");
  console.log("read from " + path.resolve(CAPTURES));

  if (result.scanned === 0) {
    console.log("\nEXAMINED NOTHING — no captures under that root. This is not a clean result.");
    process.exit(2);
  }

  console.log(result.scanned + " capture(s); " + result.noCensus +
    " carry no usable census, so every channel on them answers `unknown`");
  console.log("");
  console.log("                   ---- of those empties ----");
  console.log("channel       empty   SWEEP MISSED   cannot say   page HAS none");
  for (const [channel, row] of Object.entries(result.channels)) {
    console.log(
      channel.padEnd(12) +
      String(row.empty).padStart(6) +
      String(row.sweepMissed).padStart(9) + " " + pct(row.sweepMissed, row.empty) +
      String(row.cannotSay).padStart(9) + " " + pct(row.cannotSay, row.empty) +
      String(row.emptySupported).padStart(9) + " " + pct(row.emptySupported, row.empty),
    );
  }
  console.log("");
  console.log("SWEEP MISSED  the census counted elements the sweep never reached. A capture defect.");
  console.log("cannot say    no census, or the probe never ran. A statement about this corpus, not a page.");
  console.log("page HAS none the only column on which a `0` is a fact about the page.");
  console.log("");
  console.log("interaction channels — no census, so read from the probe's own `formProbe` mark");
  for (const [field, row] of Object.entries(result.interaction)) {
    console.log("  " + field.padEnd(18) + "empty on " + String(row.empty).padStart(5) +
      ", of which " + String(row.emptyNotAsked).padStart(5) + " never asked " + pct(row.emptyNotAsked, row.empty));
  }
  console.log("");
  reportSoundness(result.soundness);
  reportInstrument(result.instrument);
  console.log("");
  console.log("Everything outside the last column is a `0` the featurizer reads as a fact about the page,");
  console.log("and it is not one. The two middle columns need opposite responses, which is why they are two.");
  console.log("");
  console.log("report written to " + path.resolve(OUT));
}

// Guarded, so importing this module cannot run it. `entry-points.test.ts` asserts it across every npm
// script, after a module-scope `leaseWorker` booted a Windows VM merely because somebody imported the
// file to check it still loaded -- which is the check CLAUDE.md makes mandatory for every `.mjs`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
