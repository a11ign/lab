/**
 * The whole-chain pipeline must name stages that exist, in the order they have to run.
 *
 * `lab:everything` was six npm scripts joined with `&&`, and replacing that string with a step list moves
 * the chain from a place nothing could check into one a test can. The risk of the move is a typo'd or
 * renamed script: `npm run` would fail at that stage with "Missing script", hours in, on the lab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS, keepingTranscript } from "../../scripts/everything-pipeline.mjs";
import { STEPS as RETRAIN_STEPS } from "../../scripts/retrain-pipeline.mjs";
import { PIPELINES } from "../../../control/src/lab-pipeline.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPTS = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;

test("every stage names an npm script that exists", () => {
  assert.ok(STEPS.length >= 6, "an empty or truncated step list would report a clean run having done nothing");
  for (const step of STEPS) {
    assert.ok(SCRIPTS[step.script],
      `stage '${step.name}' runs \`npm run ${step.script}\`, which is not a script in package.json — `
      + `npm would fail with "Missing script" at that stage, hours into an unattended run`);
    assert.ok(step.why, `stage '${step.name}' must say what it is for; the banner is the point`);
  }
});

test("the chain runs in the only order that works", () => {
  // Each stage consumes what the one before it produced: you cannot train on an export that has not
  // happened, promote a candidate that has not been trained, or gate weights that have not been promoted.
  assert.deepEqual(STEPS.map((step) => step.name),
    ["retrain", "export-acceptance", "grants-audit", "applicability-audit", "train",
     "shortcuts", "acceptance", "promote", "release-gate"]);
});

/**
 * Stages that audit the CORPUS, and therefore belong before the stage that consumes it.
 *
 * Neither opens the model — both read `with-realism.jsonl` and the acceptance repeats and nothing else.
 * They ran AFTER `promote` until 2026-08-27, which meant the heads were fitted to a corpus that had not
 * been audited and the weights were in the shipped directory before the answer arrived. `grants-audit`
 * then refused the chain over one record, having prevented nothing — the difference between a gate and
 * a report is entirely when it runs.
 */
const CORPUS_AUDITS = ["grants-audit", "applicability-audit"];

test("a stage that audits the CORPUS runs before the stage that trains on it", () => {
  // The RULE, not the sequence. The literal above catches an accidental reorder; this says why one order
  // is right, so a future stage is placed by reasoning rather than by copying the list.
  const order = STEPS.map((step) => step.name);
  const train = order.indexOf("train");
  assert.ok(train > 0, "there must be a train stage for this constraint to mean anything");
  for (const audit of CORPUS_AUDITS) {
    const at = order.indexOf(audit);
    assert.ok(at !== -1, `${audit} must be in the chain; it is what says the corpus can support its labels`);
    assert.ok(at < train,
      `'${audit}' runs at ${at}, AFTER train at ${train}. It reads the corpus and never the model, so `
      + "running it later fits the heads to data whose audit has not happened — and if it also lands after "
      + "`promote`, the weights are already in the shipped directory when it refuses.");
  }
});

/**
 * A stage of the `full` pipeline that this chain does not run under its own name, and the stage that
 * DOES run it. Every claim here is verified below against the thing that supposedly contains it — an
 * unverified containment list is just a way of writing "trust me" in test form.
 */
const COVERED_BY: Record<string, string> = {
  capture: "retrain",
  "rules-gate": "release-gate",
  "rules-coverage": "release-gate",
  "rules-real-pages": "release-gate",
};

test("this chain runs every stage the authoritative full pipeline does", () => {
  // THE GUARD THAT WAS MISSING, and its absence cost a full run. `lab:everything` was six npm scripts
  // joined with `&&`; `lab-pipeline.mjs`'s `full` names thirteen jobs. Two spellings of "the whole
  // chain", and nothing compared them — so `shortcuts`, `acceptance` and `applicability-audit` were
  // simply absent, and the run died at
  //
  //     REFUSING to promote: runs/model-candidate is not releasable:
  //       held-out acceptance has not been run against these weights
  //
  // after every earlier gate had passed. `acceptance` is what writes the report `promote` requires; it
  // had no npm script at all, existing only as Ansible job argv, so the npm chain could not have run it.
  const ours = new Set(STEPS.map((step) => step.name));
  for (const job of PIPELINES.full.jobs) {
    if (ours.has(job)) continue;
    const container = COVERED_BY[job];
    assert.ok(container,
      `the 'full' pipeline runs '${job}' and this chain does not — either add it as a stage, or record `
      + `in COVERED_BY which stage contains it and prove that below`);
    assert.ok(ours.has(container), `${job} is claimed to be covered by '${container}', which is not a stage`);
  }
});

test("every claimed containment is real", () => {
  // Verified, not asserted. `retrain` genuinely runs a capture step, and `release:gate` genuinely chains
  // the three rules gates — if either stops doing so, the coverage claim above silently becomes false and
  // three gates vanish from the chain with nothing saying so.
  const retrainSteps = new Set(RETRAIN_STEPS.map((step) => step.name));
  assert.ok(retrainSteps.has("capture"),
    "retrain no longer runs a capture step, so 'capture' is not covered and must become its own stage");
  const releaseGate = SCRIPTS["release:gate"];
  for (const [job, container] of Object.entries(COVERED_BY)) {
    if (container !== "release-gate") continue;
    assert.ok(releaseGate.includes(job.replace("rules-", "rules:")),
      `release:gate no longer runs ${job}, so the chain would skip it entirely`);
  }
});

test("promotion is told which candidate, and the trainer is told where to write", () => {
  // The two halves of the defect that killed this chain twice on 2026-08-26. `training:train` wrote to
  // the SHIPPED model directory, which the trainer refuses; and promotion reads `runs/model-candidate`,
  // so the two must name the same scratch directory or promotion promotes whatever was there before.
  const promote = STEPS.find((step) => step.name === "promote");
  assert.deepEqual(promote?.args, ["--from=candidate"],
    "promote:gated with no --from does not promote the candidate this chain just trained");
  assert.match(SCRIPTS["training:train"], /--output runs\/model-candidate/,
    "the train stage must write where the promote stage reads");
});

test("the stages whose failure means the WORK is wrong are marked as gates", () => {
  // The runner prints a different sentence for a gate — "it failing is the pipeline working" — because
  // that changes what you go and look at. A gate silently demoted to an ordinary step sends the next
  // reader to debug the pipeline instead of the corpus.
  assert.deepEqual(STEPS.filter((step) => step.gate).map((step) => step.name),
    ["grants-audit", "applicability-audit", "shortcuts", "acceptance", "promote", "release-gate"]);
  // The three that are NOT gates produce the material the gates judge. If one of those fails the
  // pipeline still stops — it is required — but you go and look at the corpus, not at a verdict.
  assert.deepEqual(STEPS.filter((step) => !step.gate).map((step) => step.name),
    ["retrain", "export-acceptance", "train"]);
});

test("every stage's full output is kept, not just the tail the runner prints", () => {
  // THE REGRESSION THIS GUARDS, introduced while improving observability and caught by reading the first
  // green run rather than trusting its exit code. The runner prints a six-line tail per stage — which is
  // what makes nine stages legible — and captures the child's stdout to do it, so the detail stopped
  // reaching the journal at all. Measured: the fetched log fell from 400 lines to 63, and `RULES: PASS`,
  // the per-criterion table and `1183 scored, 0 false positive(s)` were all gone. The chain reported a
  // pass with the evidence FOR that pass discarded.
  const stages: Array<{ name: string; output: string }> = [];
  const fake = (step: { name: string }) => ({ ok: step.name !== "boom", output: `full detail of ${step.name}` });
  const transcript = join(tmpdir(), `everything-transcript-test-${process.pid}.log`);
  const wrapped = keepingTranscript(fake, { transcript });
  for (const step of [{ name: "first" }, { name: "boom" }]) {
    const result = wrapped(step, {});
    stages.push({ name: step.name, output: result.output });
  }
  const written = readFileSync(transcript, "utf8");
  rmSync(transcript, { force: true });
  assert.match(written, /full detail of first/, "a passing stage's output must be kept too");
  assert.match(written, /full detail of boom/, "a failing stage's output must be kept");
  assert.match(written, /=== boom {2}— FAILED/, "the transcript must say which stage failed");
  assert.ok(written.indexOf("first") < written.indexOf("boom"),
    "appended per stage, so a chain killed at hour three still leaves what it had done");
});

test("a declared subtype absent from the export names WHICH of the two it is", () => {
  // `rules:gate` failed hard on "declared in rule-ownership.json and appears in no record", offering two
  // explanations — the vocabulary moved, or the key was never right — and missing the third, which is the
  // common one locally: the export simply PREDATES the declaration. `runs/` is gitignored, so a working
  // copy is only ever as fresh as its last sync, and adding a subtype made every local gate fail until a
  // re-export only the lab can do.
  //
  // That is why the pre-push hook was being bypassed rather than fixed, and a check that gets skipped is
  // a check that does not run — this repo's own rule, arriving at the check itself.
  //
  // The case definitions decide it outright, so the gate states a fact instead of offering a guess.
  const source = readFileSync(
    join(REPO, "packages/lab/scripts/score-rules.ts"), "utf8");
  assert.match(source, /DEFINED_SUBTYPES/,
    "the gate must ask whether the CASE MATRIX defines the subtype; that is what separates a stale "
    + "export from a wrong declaration");
  assert.match(source, /UNDETERMINED \+ `\$\{subtype\} declared and defined/,
    "defined-but-absent is a stale export and must be UNDETERMINED, not a hard failure");
  assert.match(source, /declared but nothing defines it/,
    "declared with nothing defining it is a real error and must stay conclusive");
});

test("every long capture writes a progress file, or lab:status reports another job's numbers", () => {
  // `lab:status -e job=capture-real-pages` printed `captured: 29, total: 1431` for a 50-page job — the
  // DATASET run's file, under this job's name, with nothing saying so. That is the first of the six
  // misdiagnoses this repo records as costing a day: "I was reading a later, unrelated job."
  //
  // A status command that fills a gap with the wrong data is worse than one that says it has none.
  for (const script of [
    "packages/lab/src/training/capture-screenreader-dataset.mjs",
    "packages/lab/src/training/capture-real-pages.mjs",
  ]) {
    const source = readFileSync(join(REPO, script), "utf8");
    assert.match(source, /beginRun\(/,
      `${script} runs for minutes to hours and must report progress somewhere a tool can read, or `
      + `lab:status falls back to whichever progress file happens to be on disk`);
    assert.match(source, /progress\.finish\(/,
      `${script} must record that it FINISHED — corpus-settled.mjs asks that question, and without an `
      + `answer it falls back to a ten-minute clock and refuses audits after a clean run`);
  }
});
