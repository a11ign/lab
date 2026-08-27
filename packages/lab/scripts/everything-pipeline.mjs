/**
 * The whole chain — corpus, model, promotion, gates — as one supervised unit that says where it is.
 *
 * `lab:everything` was six npm scripts joined with `&&`. It ran as one systemd unit, which is right: a
 * laptop-side orchestrator was killed five times during one capture on 2026-08-26, and each time the unit
 * survived exactly as designed while the thing sequencing it did not. What the `&&` chain could not do is
 * say ANYTHING about where it had got to.
 *
 * Measured, the same day: the chain died at exit 3 with
 *
 *     REFUSING to overwrite .../screenreader-scorer: it holds a RELEASE-ELIGIBLE model
 *
 * and locating that cost two dispatches and a `lab:fetch` of the whole journal, because the failure was
 * a bare message in the middle of thousands of lines of export output with no marker saying which of the
 * six stages had produced it. The stage was `training:train`; nothing said so.
 *
 * `retrain-pipeline.mjs` had already solved this one layer down — named steps, a `why`, a banner, stderr
 * captured on failure, and a `STOPPED at <step>` line — so this is that runner over a longer chain rather
 * than a second implementation of it. Importing `pipeline` and `run` is deliberate: a second copy of
 * "print a banner and stop at the first failure" is exactly the duplication that lets two pipelines
 * disagree about what a failure means.
 */
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { pipeline, run } from "./retrain-pipeline.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

// This chain is hours long and unattended. A mistyped `--dry-run` would run the REAL thing.
refuseUnknownFlags(["--dry-run"], { entry: import.meta.url, command: "npm run lab:everything" });

/**
 * Every stage, in the order the `&&` chain ran them, with what each is for.
 *
 * `gate: true` marks a stage whose failure means the WORK is wrong rather than the pipeline — it failing
 * is the pipeline doing its job. The distinction changes what you go and look at, which is the whole
 * reason the runner prints it.
 */
const STEPS = [
  { name: "retrain", script: "lab:retrain",
    why: "pages, captures, check-signals, export, realism tier — the corpus the model is fitted to" },
  { name: "export-acceptance", script: "training:export-acceptance:all",
    why: "the held-out set, EVERY repeat — the evaluator reads every repeat, and exporting one is how a "
      + "held-out score comes to be computed half on each" },
  { name: "train", script: "training:train",
    why: "fit the heads into runs/model-candidate. NOT the shipped directory: the trainer refuses that, "
      + "and this stage is where that refusal killed the chain twice" },
  { name: "shortcuts", script: "scorer:shortcuts:candidate", gate: true,
    why: "which features did a head penalise for FREE? A veto that costs nothing is invisible to every "
      + "accuracy number, because the held-out split has the same structure (ADR 0015)" },
  { name: "acceptance", script: "training:evaluate-acceptance:candidate", gate: true,
    why: "score the held-out set AGAINST THESE WEIGHTS. Its absence is what refused promotion: "
      + "`model-candidate is not releasable: held-out acceptance has not been run against these weights`" },
  { name: "promote", script: "promote:gated", args: ["--from=candidate"], gate: true,
    why: "candidate:gate, and only then copy the weights in — it never promotes on a failed gate" },
  { name: "grants-audit", script: "corpus:grants-audit", gate: true,
    why: "does every multi-defect page carry the evidence its labels claim?" },
  { name: "applicability-audit", script: "corpus:applicability-audit", gate: true,
    why: "does any precondition silence a record labelled positive? A precondition that does is strictly "
      + "worse than the false positive it removes, and nothing about it shows in a score" },
  { name: "release-gate", script: "release:gate", gate: true,
    why: "migration, shortcuts, signals, rules, held-out acceptance, judge quality — the verdict" },
];

export { STEPS };

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** Where the FULL output of every stage lands, whatever the runner chooses to print. */
export const TRANSCRIPT = resolve(REPO, "runs", "everything-transcript.log");

/**
 * Run a stage, and keep everything it said.
 *
 * The runner prints a six-line tail per stage, which is what makes a nine-stage chain legible — and it
 * captures the child's stdout to do that, so the detail no longer reaches the journal AT ALL. Measured
 * on the first green run: the fetched log went from 400 lines to 63, and `RULES: PASS`, the per-criterion
 * table and `1183 scored, 0 false positive(s)` were all simply gone. The chain reported a pass with the
 * evidence FOR that pass discarded, which is worse than the illegibility it replaced — this repo's oldest
 * rule is that a number is only as good as what it was computed from.
 *
 * So the tail is the summary and this is the record. Appended per stage rather than written at the end,
 * because a chain killed at hour three must still leave behind what it had already done.
 */
export function keepingTranscript(runStep, { transcript = TRANSCRIPT } = {}) {
  return (step, options) => {
    const result = runStep(step, options);
    mkdirSync(dirname(transcript), { recursive: true });
    appendFileSync(transcript,
      `\n${"=".repeat(78)}\n=== ${step.name}${result.ok ? "" : "  — FAILED"}\n`
      + `${"=".repeat(78)}\n${result.output ?? ""}\n`, "utf8");
    return result;
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dryRun = process.argv.includes("--dry-run");
  // A fresh transcript per run: appending to the previous one is how "the fixture capture keeps failing"
  // came to be read off a later, unrelated job.
  if (!dryRun) rmSync(TRANSCRIPT, { force: true });
  const result = pipeline({ dryRun, steps: STEPS, runStep: keepingTranscript(run) });
  // The stage names, always — on success as well as failure. "It passed" and "it passed these six things"
  // are different claims, and only the second survives being read back a week later.
  process.stdout.write(`\n=== ${result.ok ? "COMPLETE" : `STOPPED at ${result.stoppedAt}`}\n`);
  for (const { step, ok } of result.done) process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${step}\n`);
  // Named on SUCCESS too. The evidence for a pass is exactly as worth keeping as the evidence for a
  // failure, and it is the half nobody thinks to go and fetch.
  if (!dryRun) {
    process.stdout.write(`\n  every stage's full output: ${TRANSCRIPT.replace(REPO, "")}\n`
      + "  fetch it with: npm run lab:fetch -- -e artifact=everything-transcript\n");
  }
  process.exit(result.ok ? 0 : 1);
}
