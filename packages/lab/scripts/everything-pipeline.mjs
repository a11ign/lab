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
import { pathToFileURL } from "node:url";

import { pipeline, run } from "./retrain-pipeline.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

// This chain is hours long and unattended. A mistyped `--dry-run` would run the REAL thing.
refuseUnknownFlags(["--dry-run"], { command: "npm run lab:everything" });

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
  { name: "promote", script: "promote:gated", args: ["--from=candidate"], gate: true,
    why: "candidate:gate, and only then copy the weights in — it never promotes on a failed gate" },
  { name: "grants-audit", script: "corpus:grants-audit", gate: true,
    why: "does every multi-defect page carry the evidence its labels claim?" },
  { name: "release-gate", script: "release:gate", gate: true,
    why: "migration, shortcuts, signals, rules, held-out acceptance, judge quality — the verdict" },
];

export { STEPS };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dryRun = process.argv.includes("--dry-run");
  const result = pipeline({ dryRun, steps: STEPS, runStep: run });
  // The stage names, always — on success as well as failure. "It passed" and "it passed these six things"
  // are different claims, and only the second survives being read back a week later.
  process.stdout.write(`\n=== ${result.ok ? "COMPLETE" : `STOPPED at ${result.stoppedAt}`}\n`);
  for (const { step, ok } of result.done) process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${step}\n`);
  process.exit(result.ok ? 0 : 1);
}
