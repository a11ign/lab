// @ts-check
/**
 * #1790: how many `routeChange` results would a document-identity signal classify differently from the
 * heading-change proxy, on the real-page corpus on disk? The analysis is `route-change-identity.mjs`,
 * whose header records the signal chosen and the one tried and set aside; this is the CLI that finds the
 * captures, prints the table and writes the report.
 *
 * IT REPORTS AND NEVER BLOCKS — this row is read-only against `runs/real-page-corpus` by design.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";
import { realCorpusRoot, runsRoot, refuseIfRunsReadonly } from "../src/dataset-paths.mjs";
import { classifyRouteChange } from "../src/training/route-change-identity.mjs";

/** @returns {Generator<{file: string, capture: Record<string, unknown>}>} */
function* corpusCaptures(/** @type {string} */ root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root)) {
    if (!entry.endsWith(".json")) continue;
    const full = path.join(root, entry);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(full, "utf8")); } catch { continue; }
    const capture = /** @type {{capture?: unknown}} */ (parsed).capture ?? parsed;
    // `capture-progress.json` carries no `interaction` at all -- it is the sweep's own bookkeeping file,
    // not a page capture, and would otherwise print as "no routeChange probed" alongside real absences.
    if (!capture || typeof capture !== "object" || !("interaction" in capture)) continue;
    yield { file: entry, capture: /** @type {Record<string, unknown>} */ (capture) };
  }
}

function classifyCorpus(/** @type {string} */ root) {
  const results = [];
  let noRouteChange = 0;
  let total = 0;
  for (const { file, capture } of corpusCaptures(root)) {
    total += 1;
    const interaction = /** @type {{routeChange?: unknown}} */ (capture.interaction ?? {});
    if (!interaction.routeChange) { noRouteChange += 1; continue; }
    const route = /** @type {Record<string, unknown>} */ (interaction.routeChange);
    const diagnostics = Array.isArray(capture.diagnostics) ? capture.diagnostics : [];
    results.push(classifyRouteChange({ file, route, diagnostics }));
  }
  return { total, noRouteChange, results };
}

function reportGroup(/** @type {string} */ title, /** @type {ReturnType<typeof classifyCorpus>["results"]} */ group) {
  console.log(`${title} (${group.length}):`);
  for (const entry of group) {
    console.log(`  ${entry.file}`);
    console.log(`    heading proxy: ${entry.headingProxy}   announcement: ${entry.announcement}   census (rejected candidate): ${entry.census}`);
  }
}

function main() {
  refuseUnknownFlags(["--corpus=", "--json"], {
    entry: import.meta.url,
    command: "npm run corpus:route-change-identity",
  });
  const corpusArg = process.argv.find((value) => value.startsWith("--corpus="));
  const ROOT = corpusArg ? path.resolve(corpusArg.slice("--corpus=".length)) : realCorpusRoot();
  const OUT = path.resolve(runsRoot(), "route-change-identity.json");
  refuseIfRunsReadonly(OUT);

  const { total, noRouteChange, results } = classifyCorpus(ROOT);
  const measured = results.filter((entry) => entry.agree !== null);
  const disagreements = measured.filter((entry) => !entry.agree);
  const unmeasured = results.filter((entry) => entry.agree === null);
  const report = {
    corpusRoot: path.resolve(ROOT),
    totalCaptures: total,
    noRouteChangeProbed: noRouteChange,
    measured: measured.length,
    agreements: measured.length - disagreements.length,
    disagreements: disagreements.length,
    unmeasured: unmeasured.length,
    disagreementFiles: disagreements.map((entry) => entry.file),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ...report, results }, null, 2));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("ROUTE-CHANGE DOCUMENT IDENTITY -- #1790, measured against " + path.resolve(ROOT));
  if (total === 0) {
    console.log("\nEXAMINED NOTHING -- no captures under that root. This is not a clean result.");
    process.exitCode = 2;
    return;
  }
  console.log(`${total} capture(s) on disk, ${noRouteChange} carry no routeChange probe result.`);
  console.log(`${measured.length} of the remaining ${total - noRouteChange} have both a comparable heading `
    + "pair and a non-empty announcement; the rest are reported separately as unmeasured, never as agreement.");
  console.log("");
  console.log(`${measured.length - disagreements.length} AGREE (heading proxy and NVDA's own document `
    + "announcement give the same answer).");
  reportGroup("DISAGREE", disagreements);
  console.log("");
  console.log(`${unmeasured.length} UNMEASURED (missing a usable heading pair, an announcement, or both) `
    + "-- excluded from the count above, not counted as agreement.");
  console.log("");
  console.log("report written to " + OUT);
}

// Guarded, so importing this module cannot run it -- the check CLAUDE.md makes mandatory for every `.mjs`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
