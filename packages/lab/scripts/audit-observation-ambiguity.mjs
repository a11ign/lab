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

const arg = (/** @type {string} */ name) =>
  process.argv.slice(2).find((value) => value.startsWith(name))?.slice(name.length);


function* captureFiles(/** @type {string} */ root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* captureFiles(full);
    else if (entry.name.endsWith(".json")) yield full;
  }
}

function* captures(/** @type {string} */ root) {
  for (const file of captureFiles(root)) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    // A capture file may BE the capture or carry one. Reading the wrapper as the capture is a recorded
    // defect -- `capture:explain` reported 0 of 20 tab stops that way, and called it a page finding.
    yield parsed?.capture ?? parsed;
  }
}

function main() {
  refuseUnknownFlags(["--captures=", "--out=", "--json"], {
    entry: import.meta.url,
    command: "npm run corpus:observation-ambiguity",
  });
  const CAPTURES = arg("--captures=") ?? "runs/screenreader-dataset/captures";
  const OUT = arg("--out=") ?? "runs/observation-ambiguity.json";

  const result = observationAmbiguity(captures(CAPTURES));
  const report = { capturesRoot: path.resolve(CAPTURES), ...result };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const pct = (/** @type {number} */ part, /** @type {number} */ whole) =>
    (whole === 0 ? "   n/a" : (100 * part / whole).toFixed(1).padStart(5) + "%");

  console.log("OBSERVATION AMBIGUITY — how many feature zeros are artefacts?");
  console.log("read from " + path.resolve(CAPTURES));

  if (result.scanned === 0) {
    console.log("\nEXAMINED NOTHING — no captures under that root. This is not a clean result.");
    process.exit(2);
  }

  console.log(result.scanned + " capture(s); " + result.noCensus +
    " carry no usable census, so every channel on them answers `unknown`");
  console.log("");
  console.log("channel       empty   UNSUPPORTED    supported | exact  trunc phantom unknown");
  for (const [channel, row] of Object.entries(result.channels)) {
    const seen = row.verdicts;
    console.log(
      channel.padEnd(12) +
      String(row.empty).padStart(6) +
      String(row.emptyUnsupported).padStart(8) + " " + pct(row.emptyUnsupported, row.empty) +
      String(row.emptySupported).padStart(13) + " |" +
      String(seen.exact ?? 0).padStart(6) + String(seen.truncated ?? 0).padStart(7) +
      String(seen.phantom ?? 0).padStart(8) + String(seen.unknown ?? 0).padStart(8),
    );
  }
  console.log("");
  console.log("interaction channels — no census, so read from the probe's own `formProbe` mark");
  for (const [field, row] of Object.entries(result.interaction)) {
    console.log("  " + field.padEnd(18) + "empty on " + String(row.empty).padStart(5) +
      ", of which " + String(row.emptyNotAsked).padStart(5) + " never asked " + pct(row.emptyNotAsked, row.empty));
  }
  console.log("");
  console.log("UNSUPPORTED is the number that decides this: the channel is empty AND this capture cannot say");
  console.log("the page has none. Every one is a 0 the featurizer reads as a fact about the page.");
  console.log("");
  console.log("report written to " + path.resolve(OUT));
}

// Guarded, so importing this module cannot run it. `entry-points.test.ts` asserts it across every npm
// script, after a module-scope `leaseWorker` booted a Windows VM merely because somebody imported the
// file to check it still loaded -- which is the check CLAUDE.md makes mandatory for every `.mjs`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
