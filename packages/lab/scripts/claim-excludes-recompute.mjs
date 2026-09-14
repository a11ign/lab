// @ts-check
/**
 * Recompute calibrate-abstention's per-floor table from a STORED sweep output, with the corpus's CURRENT
 * `claimExcludes`. Read-only: no scorer, no lab, no write.
 *
 *   node packages/lab/scripts/claim-excludes-recompute.mjs --sweep=<abstention-sweep.json> --run=<run id>
 *        [--urls=<file: one URL per line>]
 *
 * ## Why this exists (#1628)
 *
 * A publisher's declared exceptions decide which of the scorer's findings count as "asserted wrongly" and
 * which as "disclosed". When the corpus corrects a page's `claimExcludes` (#1610 added 4.1.2 to networkrail
 * careers), no stored score changes: `predicted`, `cantTell` and `cosine` are produced without reading the
 * excludes (`productOutcomes`, `scoreOne`). So the corrected figure is this recomputation over the run's own
 * output, not a new sweep -- and the public claim (#1579) quotes it, which is why it must be a committed
 * command whose output can be recorded verbatim as a gate entry rather than a figure typed into a post.
 *
 * ## The control comes first, and nothing is printed before it passes
 *
 * The stored `claimExcludes` must reproduce the stored `rows` EXACTLY through `floorRows`, the one function the
 * sweep itself prints its table with. If they do not, the file was not produced by this table's definition,
 * and a recomputed figure would be a different measurement wearing the run's id.
 *
 * ## Exit codes
 *
 * 0 the table printed. 2 a refusal, with nothing printed to stdout: `--sweep`/`--run` missing, the sweep file
 * unreadable or not a sweep output, the stored rows do not reproduce, a scored page is absent from the corpus,
 * the corpus commit cannot be read, or an `--urls` list names no scored page.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { refuseUnknownFlags } from "@a11ign/worker-fleet/cli-flags";

import { sandboxGitEnv } from "../../../scripts/git-env.mjs";
import { floorRows } from "./calibrate-abstention.mjs";
import { normaliseUrl, realPageFor } from "../src/training/real-page-corpus.mjs";
import { REPO_ROOT } from "../src/dataset-paths.mjs";

refuseUnknownFlags(["--sweep=", "--run=", "--urls="], {
  entry: import.meta.url, command: "node packages/lab/scripts/claim-excludes-recompute.mjs",
});

const CORPUS_FILE = "packages/lab/src/training/real-page-corpus.mjs";
const REFUSED = 2;
/** Column widths of the printed table, in the order the header names them. */
const WIDTHS = { floor: 7, scored: 7, conformant: 11, wrongly: 17, disclosed: 10, wrongCells: 12, cells: 6 };

/** @param {string} name */
const arg = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
};

/** @param {readonly string[]} a @param {readonly string[]} b */
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * Pure: the first field where two row lists differ, named, so a refusal says WHERE the control failed rather
 * than only that it did.
 * @param {readonly any[]} want @param {readonly any[]} got
 */
function firstDifference(want, got) {
  if (want.length !== got.length) return `${got.length} recomputed rows against ${want.length} stored`;
  for (let i = 0; i < want.length; i += 1) {
    const key = Object.keys({ ...want[i], ...got[i] }).find((k) => want[i][k] !== got[i][k]);
    if (key) return `floor ${want[i].floor}: stored ${key}=${want[i][key]}, recomputed ${got[i][key]}`;
  }
  return "the rows differ in key order only";
}

/**
 * Pure: the control. `null` when the stored excludes reproduce the stored rows through `floorRows`; a refusal
 * string otherwise.
 * @param {any} sweep @param {readonly number[]} floors
 */
function controlRefusal(sweep, floors) {
  const control = floorRows(sweep.scored, floors);
  if (JSON.stringify(control) === JSON.stringify(sweep.rows)) return null;
  return "the control failed: the stored claimExcludes do not reproduce the stored rows through floorRows "
    + `(${firstDifference(sweep.rows, control)}). Nothing recomputed from this file would be the run's table.`;
}

/**
 * Pure: each scored page with the corpus's CURRENT excludes, and the pages whose excludes changed.
 * @param {readonly any[]} scored @param {(url: string) => any} corpusFor
 * @returns {{ refusal: string } | { merged: any[], changed: any[] }}
 */
function withCurrentExcludes(scored, corpusFor) {
  const merged = [];
  const changed = [];
  for (const page of scored) {
    const entry = corpusFor(page.url);
    if (!entry) return { refusal: `a scored page is not in the corpus: ${page.url}` };
    const before = page.claimExcludes ?? [];
    const after = entry.claimExcludes ?? [];
    if (sameSet(before, after)) merged.push(page);
    else {
      changed.push({ url: page.url, before, after });
      merged.push({ ...page, claimExcludes: after });
    }
  }
  return { merged, changed };
}

/**
 * Pure: the population an `--urls` list selects, by the corpus's own URL normalisation, and the listed URLs
 * that are not scored pages in this output.
 * @param {readonly any[]} merged @param {readonly string[]} urls
 * @returns {{ refusal: string } | { population: any[], unscoredListed: string[] }}
 */
function filterByUrls(merged, urls) {
  const wanted = new Set(urls.map(normaliseUrl));
  const population = merged.filter((p) => wanted.has(normaliseUrl(p.url)));
  if (population.length === 0) return { refusal: `none of the ${urls.length} listed URLs is a scored page in this output` };
  const scoredKeys = new Set(merged.map((p) => normaliseUrl(p.url)));
  return { population, unscoredListed: urls.filter((u) => !scoredKeys.has(normaliseUrl(u))) };
}

/**
 * Pure: the recomputation. A refusal is RETURNED as a string, never thrown, so each one can be driven.
 *
 * @param {{ sweep: any, corpusFor: (url: string) => any, urls?: readonly string[] | null }} input
 * @returns {{ refusal: string } | { rows: any[], floors: number[], scoredPages: number, changed: any[],
 *   population: number, listed: number | null, unscoredListed: string[] }}
 */
export function recompute({ sweep, corpusFor, urls = null }) {
  if (!Array.isArray(sweep?.scored) || !Array.isArray(sweep?.rows) || sweep.rows.length === 0) {
    return { refusal: "not a sweep output: it needs a `scored` array and a non-empty `rows` array" };
  }
  const floors = sweep.rows.map((/** @type {any} */ r) => r.floor);
  const refusal = controlRefusal(sweep, floors);
  if (refusal) return { refusal };
  const current = withCurrentExcludes(sweep.scored, corpusFor);
  if ("refusal" in current) return current;
  const selected = urls ? filterByUrls(current.merged, urls) : { population: current.merged, unscoredListed: [] };
  if ("refusal" in selected) return selected;
  return { rows: floorRows(selected.population, floors), floors, scoredPages: sweep.scored.length,
    changed: current.changed, population: selected.population.length, listed: urls ? urls.length : null,
    unscoredListed: selected.unscoredListed };
}

/** @param {any} r one `floorRows` row, as one printed line */
const tableLine = (r) => `  ${String(r.floor).padEnd(WIDTHS.floor)} ${String(r.scored).padEnd(WIDTHS.scored)} `
  + `${String(r.conformantScored).padEnd(WIDTHS.conformant)} ${String(r.falsePositives).padEnd(WIDTHS.wrongly)} `
  + `${String(r.disclosed).padEnd(WIDTHS.disclosed)} ${String(r.wrongCells).padEnd(WIDTHS.wrongCells)} `
  + `${String(r.cells).padEnd(WIDTHS.cells)} ${r.referred}`;

/**
 * Pure: the text this command prints. No local path appears in it, so it can be recorded verbatim.
 * @param {{ run: string, sha256: string, corpusCommit: string, head: string }} provenance
 * @param {any} result a non-refusal `recompute` result
 */
export function render(provenance, result) {
  const lines = [
    "claim-excludes-recompute (#1628)",
    `run: ${provenance.run}`,
    `sweep output: sha256 ${provenance.sha256}, ${result.scoredPages} scored pages, ${result.floors.length} floors`,
    `corpus: ${CORPUS_FILE} last changed on the first-parent line in ${provenance.corpusCommit}; checkout HEAD ${provenance.head}`,
    `control: the stored claimExcludes reproduce all ${result.floors.length} stored rows exactly`,
    `claimExcludes changed by the corpus since the run: ${result.changed.length}`,
    ...result.changed.map((/** @type {any} */ c) => `  ${c.url}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`),
    result.listed === null
      ? `population: all ${result.population} scored pages`
      : `population: ${result.population} of ${result.listed} listed URLs are scored pages in this output`,
    ...result.unscoredListed.map((/** @type {string} */ u) => `  listed, not scored in this output: ${u}`),
    "",
    "  floor   scored  conformant  asserted-wrongly  disclosed  wrong-cells  cells  referred",
    ...result.rows.map(tableLine),
  ];
  return `${lines.join("\n")}\n`;
}

/** @param {string} message */
function refuse(message) {
  process.stderr.write(`claim-excludes-recompute REFUSES -- ${message}\n`);
  process.exitCode = REFUSED;
}

/**
 * Git at THIS checkout, never the caller's: a hook exports `GIT_DIR`, and an inherited one would read another
 * repository's history. UTC, so the recorded commit time does not depend on who ran it.
 * @param {...string} args
 */
const git = (...args) => execFileSync("git", ["-C", REPO_ROOT, ...args],
  { env: sandboxGitEnv({ TZ: "UTC" }), encoding: "utf8" }).trim();

/** @param {string} path */
function readSweep(path) {
  const bytes = readFileSync(path);
  return { bytes, sweep: JSON.parse(bytes.toString("utf8")) };
}

function main() {
  const sweepPath = arg("sweep");
  const run = arg("run");
  const urlsPath = arg("urls");
  if (!sweepPath || !run) return refuse("--sweep=<abstention-sweep.json> and --run=<run id> are both required");
  let read;
  try {
    read = readSweep(sweepPath);
  } catch (error) {
    return refuse(`the sweep file could not be read as JSON (${/** @type {Error} */ (error).message})`);
  }
  const urls = urlsPath
    ? readFileSync(urlsPath, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : null;
  const result = recompute({ sweep: read.sweep, corpusFor: realPageFor, urls });
  if ("refusal" in result) return refuse(result.refusal);
  let corpusCommit;
  let head;
  try {
    corpusCommit = git("log", "-1", "--first-parent", "--date=format-local:%Y-%m-%dT%H:%M:%SZ", "--format=%h %cd", "--", CORPUS_FILE);
    head = git("rev-parse", "--short=8", "HEAD");
  } catch (error) {
    return refuse(`the corpus commit could not be read from git (${/** @type {Error} */ (error).message})`);
  }
  if (!corpusCommit) return refuse(`git has no first-parent commit for ${CORPUS_FILE} at this checkout`);
  const sha256 = createHash("sha256").update(read.bytes).digest("hex");
  process.stdout.write(render({ run, sha256, corpusCommit, head }, result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ? realpathSync(process.argv[1]) : "").href) main();
