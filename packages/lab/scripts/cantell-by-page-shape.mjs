// @ts-check
/**
 * Is the scorer's abstention (`cantTell`) higher on pages that show a data table or a filter? (a11ign/a11ign#4242, outcome 3 of #4084)
 *
 *   node packages/lab/scripts/cantell-by-page-shape.mjs [path/to/abstention-sweep.json]
 *
 * ## Why this exists
 *
 * 4.1.3 Status Messages and 3.3.1 Error Identification are asserted only by the trained scorer, and the scorer abstains on pages unlike its
 * training data. Data tables and filter screens are the suspected miss, and nobody had measured it. This groups the calibration pages by the
 * SHAPE their corpus entry declares and prints, per group, how often each page is referred to a human.
 *
 * ## What it reads
 *
 * The per-page `cantTell` list that `calibrate-abstention.mjs` already computes and writes into `abstention-sweep.json` (`scored[]`). It
 * scores nothing itself and reaches no fleet or lab: the sweep is a recorded result, and a host without one gets a refusal naming the file,
 * never a zero. The shape comes from the CORPUS (`demonstrates`), joined by url, for the reason `calibrate-abstention.mjs` gives: a capture's
 * own stamp is only as fresh as its last recapture.
 *
 * The path defaults to the sweep's place under `runs/`, spelled out here rather than imported from `dataset-paths.mjs`, because anything that
 * reaches that module is classed as needing a corpus and this pure grouping does not.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { REAL_PAGES, realPageFor } from "../src/training/real-page-corpus.mjs";

const TABLE_OR_FILTER = /table|filter/i;
const STATUS_MESSAGES = "4.1.3";
const ERROR_IDENTIFICATION = "3.3.1";
const TWICE = 2;
// 2, the repository's "cannot tell" exit: nothing was measured, which is not the same as nothing found.
const NO_SWEEP_EXIT = 2;
const DEFAULT_SWEEP = "runs/abstention/abstention-sweep.json";

/** The two groups, in print order. */
export const SHAPES = /** @type {const} */ (["table-or-filter", "other"]);

/**
 * Which group a corpus page belongs to, from what the corpus says it demonstrates.
 * @param {{ demonstrates: string }} page
 * @returns {"table-or-filter" | "other"}
 */
export function shapeOf(page) {
  return TABLE_OR_FILTER.test(page.demonstrates) ? "table-or-filter" : "other";
}

/** @param {readonly number[]} values @returns {number | null} null, not NaN, when there is nothing to average. */
function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** @param {readonly { cantTell: readonly string[] }[]} pages @param {string} criterion @returns {number | null} */
function shareCantTell(pages, criterion) {
  return mean(pages.map((p) => (p.cantTell.includes(criterion) ? 1 : 0)));
}

/**
 * One row per group. A group with no pages has `n: 0` and every figure `null`.
 * @param {readonly { url: string, cantTell: readonly string[] }[]} scored  the sweep's per-page rows
 * @param {(url: string) => { demonstrates: string } | undefined} [lookup]
 * @returns {{ shape: "table-or-filter" | "other", n: number, meanCantTell: number | null,
 *   share413: number | null, share331: number | null, undeclared: number }[]}
 */
export function summariseByShape(scored, lookup = realPageFor) {
  const declared = scored.flatMap((row) => {
    const page = lookup(row.url);
    return page ? [{ shape: shapeOf(page), cantTell: row.cantTell }] : [];
  });
  return SHAPES.map((shape) => {
    const pages = declared.filter((p) => p.shape === shape);
    return {
      shape,
      n: pages.length,
      meanCantTell: mean(pages.map((p) => p.cantTell.length)),
      share413: shareCantTell(pages, STATUS_MESSAGES),
      share331: shareCantTell(pages, ERROR_IDENTIFICATION),
      // Counted once per row, on the first group only, so the rows still add to the pages that were grouped.
      undeclared: shape === SHAPES[0] ? scored.length - declared.length : 0,
    };
  });
}

/**
 * The row's verdict: is the table/filter mean at least twice the other group's? `null` when either mean is unknown, or the other is zero
 * (a ratio over zero says nothing; the caller reports the two means).
 * @param {ReturnType<typeof summariseByShape>} rows @returns {boolean | null}
 */
export function atLeastTwice(rows) {
  const [shaped, other] = rows;
  if (shaped.meanCantTell === null || other.meanCantTell === null || other.meanCantTell === 0) return null;
  return shaped.meanCantTell >= TWICE * other.meanCantTell;
}

/** @param {number | null} value @param {(v: number) => string} format */
const orNone = (value, format) => (value === null ? "-" : format(value));

/** @param {ReturnType<typeof summariseByShape>} rows @returns {string[]} */
export function tableLines(rows) {
  const head = `${"shape".padEnd(17)}${"n".padEnd(5)}${"mean cantTell".padEnd(15)}${"4.1.3 cantTell".padEnd(16)}3.3.1 cantTell`;
  const body = rows.map((r) => `${r.shape.padEnd(17)}${String(r.n).padEnd(5)}${orNone(r.meanCantTell, (v) => v.toFixed(2)).padEnd(15)}`
    + `${orNone(r.share413, (v) => `${(100 * v).toFixed(0)}%`).padEnd(16)}${orNone(r.share331, (v) => `${(100 * v).toFixed(0)}%`)}`);
  return [head, ...body];
}

/** @param {string} path */
const noSweepMessage = (path) => `no recorded sweep at ${path}. This script reads \`calibrate-abstention.mjs\`'s output and scores nothing itself: `
  + "the sweep is the lab's to run (ask `orchestrator`), and an absent file is not a rate of zero.";

/** @param {string} path @returns {{ scored: { url: string, cantTell: string[] }[] }} */
function readSweep(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The calibration pages in the corpus, for the reader to hold the sweep's `n` against. */
const calibrationPageCount = () => REAL_PAGES.filter((p) => p.role === "calibration").length;

function main() {
  const path = resolve(process.argv[2] ?? DEFAULT_SWEEP);
  if (!existsSync(path)) {
    process.stderr.write(`${noSweepMessage(path)}\n`);
    process.exit(NO_SWEEP_EXIT);
  }
  const { scored } = readSweep(path);
  const rows = summariseByShape(scored);
  process.stdout.write(`  sweep: ${path}\n  pages in the sweep: ${scored.length}; calibration pages in the corpus: ${calibrationPageCount()}\n\n`);
  for (const line of tableLines(rows)) process.stdout.write(`  ${line}\n`);
  const undeclared = rows[0].undeclared;
  if (undeclared > 0) process.stdout.write(`\n  NOTE: ${undeclared} scored page(s) are not in real-page-corpus.mjs and are in neither group.\n`);
  const verdict = atLeastTwice(rows);
  process.stdout.write(`\n  table/filter mean at least twice the other group's: ${verdict === null ? "cannot tell (a group is empty, or the other mean is 0)" : verdict ? "YES" : "NO"}\n`);
}

// Only when RUN, never on import, so the grouping can be tested without a sweep.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
