#!/usr/bin/env node
// @ts-check
/**
 * Does the exported dataset have the shape a model can learn from?
 *
 *   npm run corpus:distribution
 *
 * The check itself is `dataset-distribution.mjs` and is pure; this is the part that finds the file, says
 * what it examined, and decides the exit code.
 *
 * ## Why the count of what it examined is printed even on success
 *
 * "No problems" over an export that turned out to be a stale local copy is the same sentence as "no
 * problems" over the real thing, and this repo has read the first as the second more than once. So the
 * record count and the path are printed on every run, pass or fail — `rules:coverage` earns its keep the
 * same way.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { distributionProblems } from "../src/training/dataset-distribution.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_DATA = "runs/screenreader-dataset/screenreader-evidence.jsonl";

/** @param {string[]} argv */
export function dataPathFrom(argv) {
  const named = argv.find((a) => a.startsWith("--data="));
  return resolve(REPO, named ? named.slice("--data=".length) : process.env.DATASET_EXPORT || DEFAULT_DATA);
}

function main() {
  refuseUnknownFlags(["--data", "--json"], {
    entry: import.meta.url,
    command: "npm run corpus:distribution",
  });
  const path = dataPathFrom(process.argv.slice(2));
  if (!existsSync(path)) {
    // A REFUSAL, not a pass. `runs/` is gitignored, so a missing export is the normal state of a fresh
    // checkout — and reporting that as clean is how a check comes to mean nothing.
    process.stdout.write(`\n  NO EXPORT at ${path.replace(REPO, "")}\n`
      + "  This is a refusal, not a pass: there is nothing here to have an opinion about.\n"
      + "  Run `npm run training:export`, or ask the box that owns the corpus:\n"
      + "    npm run lab:job -- -e job=export\n");
    process.exitCode = 2;
    return;
  }
  const records = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const problems = distributionProblems(records);
  // NAMED AND COUNTED, always. See the header: "no problems" is only meaningful beside what was examined.
  process.stdout.write(`\n  ${records.length} record(s) from ${path.replace(REPO, "")}\n`);
  if (!problems.length) {
    process.stdout.write("  DISTRIBUTION OK — every field is populated somewhere, and both classes are present.\n");
    return;
  }
  for (const problem of problems) process.stdout.write(`\n  PROBLEM  ${problem}\n`);
  process.stdout.write(`\n  ${problems.length} problem(s). A model fitted to this export would train, `
    + "score, and mean nothing — which is the failure mode that distinguishes an ML pipeline from\n"
    + "  ordinary software: the data stays the right shape all the way through.\n");
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
