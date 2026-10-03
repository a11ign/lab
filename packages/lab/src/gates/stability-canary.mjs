// @ts-check
// What `stability-gate.mjs` needs to turn a repeat-capture report into evidence it can KEEP (#3273).
//
// PURE, AND IT HAS TO BE. The gate script reaches the corpus (`dataset-paths.mjs`), so a test importing it
// is refused in the token-less acceptance job. Everything the test needs lives here and imports nothing but
// `node:path`; the script passes in the one thing that reaches the corpus, the root to write under.
import { resolve } from "node:path";

/** `repeat-capture` prints each distinct variant of a varying field as `      <n>: <the first 110 chars>`. */
const VARIANT_LINE = /^\s+\d+: /;

/**
 * The lines that say a field varies AND how: each `VARIES` line plus the variant lines printed under it.
 *
 * The gate kept only the `VARIES` lines, so a failed canary said that a field varied (`transcript counts
 * 11,11,11,11,11`) and not what differed, and nobody could tell a page that changed from a capture that varied.
 * A variant line counts only directly under a `VARIES` line: an indented `n: ` anywhere else is not evidence of
 * variance, so a STABLE report adds none.
 *
 * @param {string} stdout repeat-capture's report
 * @returns {string[]} trimmed, in report order; empty when nothing varies
 */
export function varianceLines(stdout) {
  /** @type {string[]} */
  const kept = [];
  let underVaries = false;
  for (const line of stdout.split("\n")) {
    if (line.includes("VARIES")) underVaries = true;
    else if (!(underVaries && VARIANT_LINE.test(line))) underVaries = false;
    if (underVaries) kept.push(line.trim());
  }
  return kept;
}

/**
 * Where ONE canary of ONE gate run keeps its raw captures.
 *
 * `repeat-capture` wrote `capture-1.json` .. `capture-5.json` into a single shared directory, so every canary
 * of every run overwrote the same five names and the failed run's captures were gone by the next canary. A
 * directory per canary per run cannot be overwritten by a later canary or by a run dispatched at the same time.
 *
 * @param {{ root: string, runId: string, name: string }} where `name` is the canary's path or live URL
 * @returns {string}
 */
export function canaryOutDir({ root, runId, name }) {
  const slug = name.replace(/^[a-z]+:\/\//i, "").replace(/[^A-Za-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
  return resolve(root, "stability", runId, slug);
}

/**
 * What an UNSTABLE canary reports: the lines that vary and the directory holding the captures they came from.
 *
 * @param {{ lines: string[], outDir: string }} found
 * @returns {string}
 */
export function unstableDetail({ lines, outDir }) {
  return `${lines.join("; ")}; captures kept in ${outDir}`;
}

/**
 * The arguments for one canary's `repeat-capture`, `--out` included.
 *
 * @param {{ script: string, url: string, times: number, worker: string, outDir: string,
 *   probeForms?: boolean, task?: string, probeFocus?: boolean }} canary
 * @returns {string[]}
 */
export function repeatCaptureArgs({ script, url, times, worker, outDir, probeForms, task, probeFocus }) {
  const args = [script, `--url=${url}`, `--times=${times}`, `--worker=${worker}`, `--out=${outDir}`];
  // Opt-in per canary: a capture must never pay for evidence nobody asked for, and a probe that does not
  // run is cheaper than one that does.
  if (probeForms) args.push("--probe-forms", `--task=${task}`);
  // FORWARDED, because it was not. `probeFocus` on a canary was read by nobody: the flag would have been
  // discarded, the canary would have run without the focus probe, and it would have reported STABLE having
  // compared an empty `focusOrder` against an empty `focusOrder`. Named here rather than remembered.
  if (probeFocus) args.push("--probe-focus");
  return args;
}
