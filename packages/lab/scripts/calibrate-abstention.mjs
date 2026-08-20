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
import { fileURLToPath, pathToFileURL } from "node:url";

import { realPageFor } from "../src/training/real-page-corpus.mjs";

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
    // From the CORPUS, because a captured file does not carry the publisher's exceptions. A miss throws
    // rather than defaulting to "no exceptions" -- see `realPageFor`.
    claimExcludes: claimExcludesFor(entry),
  };
}

/** The publisher's declared exceptions for a captured page. Throws on a failed join; see `realPageFor`. */
function claimExcludesFor(entry) {
  const url = entry.capture?.url;
  const page = url ? realPageFor(url) : undefined;
  if (!page) {
    throw new Error(`captured page ${url ?? "(no url)"} is not in real-page-corpus.mjs, so what its `
      + "publisher claims cannot be read. Refusing to assume it claims everything.");
  }
  return page.claimExcludes ?? [];
}

/**
 * Findings a publisher's own statement CONTRADICTS. Those are the accusations.
 *
 * A finding is only a false positive on a criterion the publisher positively CLAIMS. Three cases, and they
 * need three different answers:
 *
 *   claimed     the statement says this conforms -> a finding contradicts it. FALSE POSITIVE.
 *   disclosed   the statement names this as failing -> the finding is corroborated. Not an error. And not
 *               scored as a true positive either: we cannot show it is the SAME instance the publisher
 *               meant, and a statement usually scopes its failures to features ("the interactive polls").
 *   unmentioned nothing is claimed either way -> unknown. Excluded from both columns.
 *
 * This replaced `predicted.length > 0`, which counted any finding at all. That penalised the model for
 * being RIGHT about a criterion its publisher discloses in writing -- and it forced a workaround, because
 * only a publisher with an unqualified claim could be a calibration page. Three of thirty-nine qualified.
 *
 * `claimExcludes` may be criterion (`"1.4.3"`) or subtype (`"1.1.1:missing-alt"`) granularity while
 * `predicted` is criterion-only, so a criterion matches if it or any of its subtypes is excluded. Same
 * semantics as `known_indices` in the trainer, deliberately -- two rules for one question is how they drift.
 *
 * A fully-excluded page yields no claimed criteria and so cannot produce a false positive. That is correct:
 * a publisher who tells us nothing we can check contributes structure to the corpus and no verdict.
 *
 * @param {{predicted: string[], claimExcludes?: string[]}} page
 */
export function contradictedFindings(page) {
  const disclosed = new Set((page.claimExcludes ?? []).map((entry) => entry.split(":")[0]));
  return page.predicted.filter((criterion) => !disclosed.has(criterion));
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

  process.stdout.write("\n  floor   scored  conformant  FALSE POSITIVES  disclosed  inaccessible caught\n");
  process.stdout.write("  " + "-".repeat(76) + "\n");
  const rows = [];
  for (const floor of CANDIDATE_FLOORS) {
    const accepted = scored.filter((p) => (p.cosine ?? 0) >= floor);
    const conformant = accepted.filter((p) => p.claim === "conformant");
    // Only findings the publisher's statement CONTRADICTS. See `contradictedFindings`.
    const falsePositives = conformant.filter((p) => contradictedFindings(p).length > 0).length;
    // Findings on criteria the publisher itself discloses as failing. Not errors -- reported so a
    // corroborated finding is visible rather than merely uncounted, which would read as the model
    // saying nothing on pages where it was in fact agreeing with the publisher.
    const disclosed = conformant.filter(
      (p) => p.predicted.length > contradictedFindings(p).length).length;
    const inaccessible = accepted.filter((p) => p.claim === "inaccessible");
    const caught = inaccessible.filter((p) => p.predicted.length > 0).length;
    rows.push({ floor, scored: accepted.length, conformantScored: conformant.length, falsePositives,
      disclosed, inaccessibleScored: inaccessible.length, inaccessibleCaught: caught });
    process.stdout.write(`  ${String(floor).padEnd(7)} ${String(accepted.length).padEnd(7)} `
      + `${String(conformant.length).padEnd(11)} ${String(falsePositives).padEnd(16)} `
      + `${String(disclosed).padEnd(10)} ${caught} of ${inaccessible.length}\n`);
  }

  const n = scored.length;
  process.stdout.write(`\n  Calibration set is ${n} pages, so the finest error rate this data can express is `
    + `about ${(100 / (n + 1)).toFixed(1)}%.\n`);
  process.stdout.write("  Anything finer than that would be arithmetic theatre. Widening the split is what\n"
    + "  makes a real conformal guarantee possible — see ADR 0010.\n");
  process.stdout.write("\n  The column that decides it is FALSE POSITIVES: findings a publisher's own statement\n"
    + "  CONTRADICTS. `disclosed` is the opposite -- findings on criteria the publisher itself names as\n"
    + "  failing, which are corroborated rather than wrong, and are not scored either way because we\n"
    + "  cannot show they are the same instance the statement meant.\n");

  // A scratch model writes to its own file. Overwriting the shipped model's sweep with a candidate's
  // numbers would silently rewrite the measurement that PLAN.md's B4 decision rests on.
  const outPath = resolve(ROOT, MODEL ? "abstention-sweep.candidate.json" : "abstention-sweep.json");
  writeFileSync(outPath, JSON.stringify({ model: MODEL ?? "shipped", calibrationPages: n, scored, rows }, null, 2));
  process.stdout.write(`\n  written: ${outPath}\n`);
}

// Only when RUN, never on import. `contradictedFindings` is exported so it can be tested, and importing
// this module used to execute the whole sweep -- spawning the scorer once per page and overwriting
// `abstention-sweep.json`, the file whose numbers PLAN.md's decisions rest on. Same guard as
// `capture-screenreader-dataset.mjs:785`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
