// @ts-check
/**
 * #2550: how many captures open their focus log on a `focusout`, per capture protocol? The counting is
 * `focus-log-first-event.mjs`, whose header says why it matters (the `i === 0` carve-out in
 * `focusLossVerdict`); this is the CLI that finds the captures and prints the table.
 *
 * READS the real-page corpus (`realCorpusRoot()`) and the dataset captures (`captureRoot(datasetRoot())`), and
 * WRITES NOTHING. IT REPORTS AND NEVER BLOCKS. The reading that closes the row is taken by `orchestrator` on
 * the lab, because `runs/` is not on any other host (`packages/lab/CLAUDE.md`).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { captureRoot, datasetRoot, realCorpusRoot } from "../src/dataset-paths.mjs";
import { countFirstEvents } from "../src/training/focus-log-first-event.mjs";
import { captureAgeLines } from "../src/training/real-page-freshness.mjs";

/** @returns {{file: string, capture: Record<string, unknown>, at: string | null, role: string}[]} */
function capturesUnder(/** @type {string} */ root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root).sort()) {
    if (!entry.endsWith(".json")) continue;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(root, entry), "utf8")); } catch { continue; }
    // A wrapped file carries `{capture, capturedAt, role}`; a plain one is the capture. The wrapper's own
    // top level has no `interaction`, so it is unwrapped only when it has none itself. A file with no
    // `interaction` in either place (`capture-progress.json`) is bookkeeping, not a capture.
    const capture = parsed?.interaction ? parsed : parsed?.capture;
    if (!capture || typeof capture !== "object" || !("interaction" in capture)) continue;
    // A capture's age, wrapper first: the same mixed-population risk `real-page-freshness.mjs` measured, here
    // because a count taken across a half-refreshed corpus is two populations read as one.
    const at = typeof parsed.capturedAt === "string" ? parsed.capturedAt : typeof capture.capturedAt === "string" ? capture.capturedAt : null;
    found.push({ file: entry, capture, at, role: typeof parsed.role === "string" ? parsed.role : "no role recorded" });
  }
  return found;
}

// `initial` and `focusin-unmarked` sit AFTER the total because they are not buckets: `initial` counts captures
// whose log[0] carries `initial: true` and `focusin-unmarked` a focusin-first log WITHOUT it, so a protocol-22
// zero under `focusout` can be told from a marker that was never written (#2594).
const HEADERS = ["protocol", "focusin", "focusout", "no-log", "other", "total", "initial", "focusin-unmarked"];

/** @param {ReturnType<typeof countFirstEvents>["byProtocol"]} byProtocol */
function tableLines(byProtocol) {
  // Each column is as wide as its header, so the row and the header cannot drift apart.
  const row = (/** @type {string[]} */ cells) => cells.map((cell, i) => cell.padStart(HEADERS[i].length)).join("  ");
  const rows = Object.entries(byProtocol).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return [
    row(HEADERS),
    ...rows.map(([protocol, t]) => row([protocol, ...[t.focusin, t.focusout, t.noLog, t.other, t.total, t.initial, t.focusinUnmarked].map(String)])),
  ];
}

/** @param {{label: string, root: string}} source */
function reportSource({ label, root }) {
  const captures = capturesUnder(root);
  console.log(`\n== ${label}: ${path.resolve(root)}`);
  if (captures.length === 0) {
    console.log("EXAMINED NOTHING -- no captures under that root. This is not a clean result.");
    return;
  }
  const { total, byProtocol, focusoutFirst } = countFirstEvents(captures);
  const ages = captures.flatMap(({ at, role }) => (at ? [{ at, role }] : []));
  console.log(captureAgeLines(ages).join("\n"));
  console.log(`${total} capture(s). no-log = checked:false, empty or absent log (its own number, not a zero above).`);
  console.log("initial = log[0] carries initial:true; focusin-unmarked = focusin-first WITHOUT it. A focusout of 0 at protocol 22 means something only beside a nonzero initial.");
  console.log(tableLines(byProtocol).join("\n"));
  console.log(`\n${focusoutFirst.length} focusout-first capture(s)${focusoutFirst.length ? ":" : "."}`);
  for (const entry of focusoutFirst) {
    const next = entry.next ? `${entry.next.type} id ${entry.next.id}` : "nothing";
    console.log(`  ${entry.file}  [protocol ${entry.protocol}]  focusout id ${entry.id} "${entry.name}", next: ${next}`
      + `  ${entry.sameControlReversed ? "SAME-ID REVERSED PAIR" : "NOT a same-id pair -- class by hand"}`);
  }
}

function main() {
  refuseUnknownFlags([], { entry: import.meta.url, command: "npm run corpus:focus-log-first-event" });
  console.log("FIRST EVENT OF interaction.focusEvents.log, per capture protocol -- #2550");
  const sources = [
    { label: "real-page corpus", root: realCorpusRoot() },
    { label: "dataset captures", root: captureRoot(datasetRoot()) },
  ];
  // No exit code: this reports and never blocks, and an empty root already prints "EXAMINED NOTHING".
  for (const source of sources) reportSource(source);
}

// Guarded, so importing this module cannot run it -- the check CLAUDE.md makes mandatory for every `.mjs`.
// Realpath'd, or npm's own .bin symlink reads this false and `main()` never runs -- #1086.
if (import.meta.url === pathToFileURL(process.argv[1] ? fs.realpathSync(process.argv[1]) : "").href) main();
