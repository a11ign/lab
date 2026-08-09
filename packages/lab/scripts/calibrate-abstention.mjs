/**
 * What does lowering the abstention floor actually COST? Measured, per candidate floor.
 *
 *   node packages/lab/scripts/calibrate-abstention.mjs
 *
 * ## Why this exists
 *
 * Blocker B4 in PLAN.md is a DECISION, not a task: what error rate among accepted predictions are we
 * willing to defend? That number sets the abstention floor, and the floor decides how much the tool reports
 * versus declines. It is a product and legal judgement.
 *
 * A decision like that should not be made from an abstract principle. This script makes it concrete: for
 * each candidate floor, it reports exactly which calibration pages would be SCORED, and what the scorer
 * then says about them versus what their publisher claims. The output is a table someone can point at.
 *
 * ## What it can and cannot tell you
 *
 * The calibration split is SEVEN pages. That bounds what any conformal method can express here: with n
 * calibration points the finest achievable error rate is about 1/(n+1), so **n=7 supports roughly 12.5%
 * granularity and nothing finer.** Quoting a 5% guarantee off seven points would be arithmetic theatre.
 *
 * So this is not a conformal calibration. It is the measurement a conformal calibration would need, plus an
 * honest statement of how far the data goes. Widening the calibration split is what makes the guarantee
 * possible, and ADR 0010 says what that requires.
 *
 * ## Reading the output
 *
 * The column that matters is **false positives on conformant pages**. Those are the accusations. A floor
 * that scores more pages is only better if that column stays at zero — this project's whole position is
 * that for an accessibility tool the expensive direction to be wrong in is claiming a failure that is not
 * there.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from THIS module, never from the caller's cwd. A bare "packages/scorer/python/score.py" is
// right only when you happen to run from the repo root, and `spawned-paths.test.ts` fails the build for
// it — because `gate:stability` once spawned a moved script and died with "Command failed" and nothing
// to read.
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const ROOT = resolve(REPO, process.env.REAL_CORPUS_ROOT || "runs/real-page-corpus");
const PYTHON = process.env.A11Y_PYTHON || resolve(REPO, ".venv/bin/python");
const SCORER = resolve(REPO, "packages/scorer/python/score.py");
/**
 * Which weights to measure. Defaults to the shipped model; `A11Y_SCORER_MODEL=/tmp/some-model` points it
 * at a scratch retrain. Without this the script could not perform the comparison its own header calls for
 * -- "retrain to a scratch output, then re-run the sweep" -- so a candidate model could only be judged by
 * replacing the shipped one first, which is the wrong order.
 */
const MODEL = process.env.A11Y_SCORER_MODEL;

/** Floors to try. The shipped one (0.847) is included so the status quo appears as a row. */
const CANDIDATE_FLOORS = [0.847, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.0];

function calibrationPages() {
  return readdirSync(ROOT)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(resolve(ROOT, f), "utf8")))
    .filter((entry) => entry.role === "calibration");
}

/**
 * Score one capture, ignoring the shipped floor.
 *
 * The floor lives in the training report and gates the scorer's own abstention, so asking "what would this
 * page score if we accepted it?" means reading the raw scores and novelty and applying a floor ourselves.
 * That is what makes a sweep possible at all.
 */
function scoreOne(entry) {
  const args = [SCORER, "--stdin", ...(MODEL ? ["--model", MODEL] : [])];
  const out = JSON.parse(execFileSync(PYTHON, args, {
    input: JSON.stringify(entry.capture), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  }));
  const record = out.records[0];
  return {
    url: entry.capture.url,
    claim: entry.publishedClaim,
    cosine: record.novelty?.nearestTrainingCosine ?? null,
    // `predictions` is the scorer's own per-criterion verdict at its trained thresholds, BEFORE the
    // abstention gate. That is what would be reported if the page were accepted.
    predicted: Object.entries(record.predictions ?? {}).filter(([, hit]) => hit).map(([c]) => c),
  };
}

function main() {
  const pages = calibrationPages();
  if (!pages.length) {
    process.stderr.write(`no calibration captures in ${ROOT}\n`
      + "run: node packages/lab/src/training/capture-real-pages.mjs --role=calibration --worker=URL\n");
    process.exit(2);
  }
  process.stdout.write(`Scoring ${pages.length} calibration page(s) from ${ROOT}\n`);
  process.stdout.write(`Model: ${MODEL ?? "packages/scorer/models/screenreader-scorer (shipped)"}\n\n`);
  const scored = pages.map(scoreOne).sort((a, b) => (b.cosine ?? 0) - (a.cosine ?? 0));

  for (const page of scored) {
    process.stdout.write(`  ${String(page.cosine).padEnd(7)} ${page.claim.padEnd(12)} `
      + `${page.predicted.length ? page.predicted.join(",") : "(no findings)"}  `
      + `${page.url.replace("https://www.w3.org/WAI/demos/bad/", "")}\n`);
  }

  process.stdout.write("\n  floor   scored  conformant scored  FALSE POSITIVES  inaccessible caught\n");
  process.stdout.write("  " + "-".repeat(72) + "\n");
  const rows = [];
  for (const floor of CANDIDATE_FLOORS) {
    const accepted = scored.filter((p) => (p.cosine ?? 0) >= floor);
    const conformant = accepted.filter((p) => p.claim === "conformant");
    // A finding on a page its publisher calls conformant is a false positive by that publisher's claim.
    const falsePositives = conformant.filter((p) => p.predicted.length > 0).length;
    const inaccessible = accepted.filter((p) => p.claim === "inaccessible");
    const caught = inaccessible.filter((p) => p.predicted.length > 0).length;
    rows.push({ floor, scored: accepted.length, conformantScored: conformant.length, falsePositives,
      inaccessibleScored: inaccessible.length, inaccessibleCaught: caught });
    process.stdout.write(`  ${String(floor).padEnd(7)} ${String(accepted.length).padEnd(7)} `
      + `${String(conformant.length).padEnd(18)} ${String(falsePositives).padEnd(16)} `
      + `${caught} of ${inaccessible.length}\n`);
  }

  const n = scored.length;
  process.stdout.write(`\n  Calibration set is ${n} pages, so the finest error rate this data can express is `
    + `about ${(100 / (n + 1)).toFixed(1)}%.\n`);
  process.stdout.write("  Anything finer than that would be arithmetic theatre. Widening the split is what\n"
    + "  makes a real conformal guarantee possible — see ADR 0010.\n");
  process.stdout.write("\n  The column that decides it is FALSE POSITIVES: those are accusations against pages\n"
    + "  their own publisher calls conformant.\n");

  // A scratch model writes to its own file. Overwriting the shipped model's sweep with a candidate's
  // numbers would silently rewrite the measurement that PLAN.md's B4 decision rests on.
  const outPath = resolve(ROOT, MODEL ? "abstention-sweep.candidate.json" : "abstention-sweep.json");
  writeFileSync(outPath, JSON.stringify({ model: MODEL ?? "shipped", calibrationPages: n, scored, rows }, null, 2));
  process.stdout.write(`\n  written: ${outPath}\n`);
}

main();
