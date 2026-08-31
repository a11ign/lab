/**
 * THE VETO AUDIT MUST READ THE CORPUS THE MODEL TRAINS ON, and all three entry points must agree.
 *
 * `release:gate` ran `scorer:shortcuts` with no `--data`, so it took the default —
 * `screenreader-evidence.jsonl`, the corpus WITHOUT the realism tier. The trainer trains on
 * `with-realism.jsonl`, and `scorer:shortcuts:baseline` RECORDS the baseline against `with-realism.jsonl`.
 *
 * So the gate compared a report built from one corpus against a baseline built from another, and the
 * difference read as a model regression. Measured 2026-08-31, immediately after the protocol-10 recapture:
 *
 *     REGRESSION  3.3.2:unnamed-form-field: 2 -> 3 closable veto(es)
 *     REGRESSION  4.1.2:unnamed-control:    2 -> 3 closable veto(es)
 *
 * The "new" veto was `form_change_nonempty`, which the audit requires to be strictly `{0.0}` across every
 * positive. On the base corpus it is. On the corpus the head was TRAINED on, two of 184 positives carry
 * it — so the head could never have taken it for free, and there was no regression to find.
 *
 * That is "a gate that does not exercise what ships" for the fifth time here, after `JUDGE_BACKEND`
 * defaulting to `codex`, the abstention sweep scoring raw predictions, `npm run eval` resolving the
 * shipped artefact, and `score-rules.ts` scoring the model's allowlist. This one is the same defect with
 * the two halves of ONE gate disagreeing, which is why it presented as a finding rather than as silence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const scripts = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../package.json", import.meta.url)), "utf8"),
).scripts as Record<string, string>;

/** Every command that computes or records a veto count. They are compared with each other, so they agree. */
const VETO_AUDITS = ["scorer:shortcuts", "scorer:shortcuts:candidate", "scorer:shortcuts:baseline"];

test("every veto audit reads the dataset the model is trained on", () => {
  // Discovered rather than listed would be better, but the set is the three npm entry points and the
  // failure mode is one of them drifting — which is exactly what an explicit comparison catches.
  const wrong = VETO_AUDITS.filter((name) => {
    const command = scripts[name];
    assert.ok(command, `${name} is missing; this guard is checking a command that no longer exists`);
    return !command.includes("runs/screenreader-dataset/with-realism.jsonl");
  });
  assert.deepEqual(wrong, [],
    "these audit a different corpus from the one the trainer uses, so a report and a baseline built by "
    + "two of them are not comparable — and the difference reads as a model regression");
});

test("the trainer's own dataset is the one named, so this cannot drift by renaming", () => {
  // If the trainer moves to another file, this guard must fail rather than keep asserting a stale path.
  const jobs = readFileSync(
    fileURLToPath(new URL("../../../control/ansible/lab-job.yml", import.meta.url)), "utf8");
  // The `train` job's argv, read as a block: its comment header is long, so a bounded lookahead from the
  // job name is the wrong shape — anchor on the trainer SCRIPT instead, which is what actually matters.
  const trainArgv = /train-screenreader-model\.py[\s\S]{0,300}?timeout:/.exec(jobs);
  assert.ok(trainArgv, "the train job no longer invokes train-screenreader-model.py the way this guard reads it");
  const trains = trainArgv[0].includes("with-realism.jsonl");
  assert.ok(trains,
    "the `train` job no longer names with-realism.jsonl — the audits above are now pinned to a corpus "
    + "the model does not train on, which is the defect this file exists to prevent");
});
