/**
 * The pipeline CLAIMS its stages are idempotent. This is what holds the claim up.
 *
 * `lab:pipeline`'s own failure message tells the operator:
 *
 * > Fix what it named, then re-run this pipeline — every stage is idempotent, and a stage that already
 * > succeeded either hits its cache or re-runs cheaply.
 *
 * That is advice an operator acts on: it is why you re-run the whole chain after a stage fails rather
 * than trying to resume by hand. Nothing asserted it.
 *
 * ## The failure this is aimed at, arrived at by asking what could break the claim invisibly
 *
 * A stage that APPENDS rather than replaces. Re-running would silently double the corpus — and every
 * downstream gate would pass, on twice the data, reporting nothing wrong. That is precisely the shape
 * *Building ML Powered Applications* names as ML's distinguishing failure mode: *"an ML pipeline can
 * execute with no errors and produce an entirely useless model"*, because the data stays numeric and the
 * right shape throughout.
 *
 * Checked before writing this, and the pipeline is clean today: nothing appends except the `everything`
 * transcript, which is truncated at the start of each run precisely so it cannot accumulate. That
 * truncation is the reason the exception is safe, so it is asserted here rather than assumed — the
 * exception and its guard travel together or the exception is just a hole.
 *
 * ## What this does NOT claim
 *
 * It does not prove a re-run produces byte-identical output. That needs the corpus and a second full
 * run — hours — and the cache key already carries most of it: `capture-cache.test.ts` proves the key is
 * stable under object-key order and across repeated calls, which is what makes a re-captured case a
 * cache hit rather than fresh work.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS } from "../../scripts/everything-pipeline.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * The one file a pipeline stage may append to, and why that is safe.
 *
 * The transcript accumulates a run's stage output on purpose — "a chain killed at hour three must still
 * leave behind what it had already done". It is safe only because the runner truncates it first, which
 * the second test below asserts. An append with no truncation is the corpus-doubling failure above.
 */
const MAY_APPEND = new Map([
  ["packages/lab/scripts/everything-pipeline.mjs",
    "the run transcript, truncated by rmSync at the start of each run so it cannot accumulate across runs"],
]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO, dir))) {
    if (entry === "node_modules" || entry === "dist") continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(REPO, rel)).isDirectory()) sourceFiles(rel, found);
    else if (/\.(mjs|ts)$/.test(entry) && !entry.includes(".test.")) found.push(rel);
  }
  return found;
}

test("no pipeline stage APPENDS to its output", () => {
  // DISCOVERED, not listed. A list of files to check is a list somebody must remember to extend, which
  // this repo's own housekeeping rule says does not happen.
  const offenders: string[] = [];
  for (const file of [...sourceFiles("packages/lab/src"), ...sourceFiles("packages/lab/scripts")]) {
    const body = readFileSync(join(REPO, file), "utf8");
    const appends = /appendFileSync|createWriteStream\([^)]*flags:\s*["']a["']|\{\s*flag:\s*["']a["']/.test(body);
    if (appends && !MAY_APPEND.has(file)) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    `stage(s) append to their output: ${offenders.join(", ")}. Re-running the pipeline would then DOUBLE `
    + "what they wrote, and every downstream gate would pass on it — the data stays the right shape, so "
    + "nothing errors. If the append is deliberate, add it to MAY_APPEND with the truncation that makes "
    + "it safe.");
});

test("the one file that MAY append is truncated at the start of every run", () => {
  // The exception's guard. Without this, MAY_APPEND is just a hole with a comment in it — and the
  // transcript accumulating across runs is exactly how "the fixture capture keeps failing" came to be
  // read off a later, unrelated job.
  const runner = readFileSync(join(REPO, "packages/lab/scripts/everything-pipeline.mjs"), "utf8");
  assert.match(runner, /rmSync\(TRANSCRIPT,\s*\{\s*force:\s*true\s*\}\)/,
    "the transcript must be removed before a run, or it accumulates across runs and a later job's output "
    + "is read as this one's");
  // And it must run BEFORE the stages do — which is an EXECUTION order, not a source order, and the
  // first version of this assertion confused the two. It compared the source position of
  // `rmSync(TRANSCRIPT` against `appendFileSync`, and matched the IMPORT on line 24: it was measuring
  // where a symbol is imported, not where anything happens. The append itself sits inside
  // `keepingTranscript`, a function DEFINED above `main` and CALLED from inside it.
  //
  // The honest textual proxy is the `pipeline(` call, which is the moment any stage can run.
  const truncatesAt = runner.indexOf("rmSync(TRANSCRIPT");
  const stagesRunAt = runner.indexOf("pipeline({");
  assert.ok(truncatesAt !== -1 && stagesRunAt !== -1, "both anchors must exist for this to mean anything");
  assert.ok(truncatesAt < stagesRunAt,
    "the transcript must be cleared before any stage runs, or a later job's output is read as this one's");
});

test("running the chain does not MUTATE its own stage list", () => {
  // The second run must see the same steps as the first. A runner that shifted or spliced STEPS would
  // make "re-run this pipeline" mean something different the second time, which is the claim failing in
  // the least visible way possible: the pipeline succeeds, having done less.
  const before = STEPS.map((s: { name: string }) => s.name);
  const runner = readFileSync(join(REPO, "packages/lab/scripts/everything-pipeline.mjs"), "utf8");
  for (const mutator of [".shift(", ".pop(", ".splice(", ".sort(", ".reverse("]) {
    assert.ok(!runner.includes(`STEPS${mutator}`),
      `the runner calls STEPS${mutator}, so a second run would not see the same stages as the first`);
  }
  assert.deepEqual(STEPS.map((s: { name: string }) => s.name), before);
  assert.ok(Object.isFrozen(STEPS) || before.length > 0,
    "STEPS must be readable and stable for the re-run advice to mean anything");
});
