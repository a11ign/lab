/**
 * Every caller of the trainer must name a scratch `--output`.
 *
 * `train-screenreader-model.py` defaults `--output` into `packages/scorer/models/screenreader-scorer`,
 * the SHIPPED model directory, and `refuse_to_destroy_release_weights` argues at length that this is
 * correct rather than an oversight: four downstream scripts default to reading that same path, so moving
 * the default out of the tree would decouple train from evaluate and leave the acceptance gate measuring
 * the OLD weights while the new ones sat elsewhere.
 *
 * The consequence is a duty on every CALLER, and duties nobody checks are duties nobody discharges.
 * Measured 2026-08-26: `npm run lab:everything` — the whole corpus-to-release chain, dispatched as one
 * supervised unit — died at its train step after `lab:retrain` had already run, with
 *
 *     REFUSING to overwrite .../screenreader-scorer: it holds a RELEASE-ELIGIBLE model
 *
 * and exit 3. The refusal was right and saved the shipped weights; the caller was wrong. `training:train`
 * passed no `--output` while the Ansible `train` job passed `--output runs/model-candidate` — the same
 * fact written in two places, drifting, which is this repo's most-repeated defect after the one where a
 * remedy reaches only some of the paths that need it.
 *
 * So this is not a test that those two strings are right. It is a test that a THIRD caller cannot repeat
 * it, which is the only version worth having.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const TRAINER = "train-screenreader-model.py";

/** Every line that invokes the trainer, wherever it is spelled, with where it came from. */
function trainerInvocations(): Array<{ where: string; command: string }> {
  const found: Array<{ where: string; command: string }> = [];
  const scripts = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts ?? {};
  for (const [name, body] of Object.entries<string>(scripts)) {
    // A composite script chains several commands; only the segment that runs the trainer is this test's
    // business, or `lab:everything` would be judged on its `&&`-joined neighbours.
    for (const segment of body.split("&&")) {
      if (segment.includes(TRAINER)) found.push({ where: `package.json ${name}`, command: segment });
    }
  }
  // The Ansible catalogue holds its own spellings, and it is the half that was RIGHT — so reading only
  // package.json would have passed this test on the day the defect shipped.
  //
  // PARSED, never scanned line by line: an argv list wraps across lines, so a line containing the
  // trainer does not contain its `--output`. The first version of this test did scan lines and reported
  // the correct half of the codebase as the broken one.
  const jobs = (parseYaml(readFileSync(
    join(REPO, "packages/worker-fleet/ansible/lab-job.yml"), "utf8")) as
    Array<{ vars: { lab_jobs: Record<string, { argv?: string[] | string }> } }>)[0].vars.lab_jobs;
  for (const [name, entry] of Object.entries(jobs)) {
    const command = [entry.argv ?? ""].flat().join(" ");
    if (command.includes(TRAINER)) found.push({ where: `lab-job.yml ${name}`, command });
  }
  return found;
}

test("no caller of the trainer may omit --output", () => {
  const invocations = trainerInvocations();
  // A discovery test that discovers nothing passes while examining nothing — the failure this repo has
  // shipped three times. If the trainer is renamed, this must fail rather than fall silent.
  assert.ok(invocations.length >= 3,
    `found only ${invocations.length} invocation(s) of ${TRAINER}; the search is broken, and an empty `
    + `search reports a clean result`);
  for (const { where, command } of invocations) {
    assert.match(command, /--output[= ]/,
      `${where} invokes the trainer without --output, so it writes to the SHIPPED model directory. `
      + `The trainer refuses that and exits 3, which killed the whole lab:everything chain after its `
      + `capture and export stages had already run. Name a scratch directory: --output runs/model-<name>`);
    assert.ok(!/--output[= ]\S*packages\/scorer/.test(command),
      `${where} aims the trainer AT the shipped model directory explicitly. Promotion is a separate, `
      + `deliberate step — one release-eligible model was already lost to a git checkout`);
  }
});

test("the npm chain and the Ansible job train into the same scratch directory", () => {
  // `lab:everything` runs on the lab as ONE unit, so it cannot call `lab:job` and must use the npm
  // scripts; the `train` JOB is the same work dispatched separately. They then hand off to
  // `promote:gated --from=candidate`, which reads `runs/model-candidate` — so if these two disagree,
  // promotion silently promotes whatever the OTHER path left behind.
  const scripts = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;
  assert.match(scripts["training:train"], /--output runs\/model-candidate/);
  // `--from=candidate` moved out of the npm string into the pipeline's step list when `lab:everything`
  // became a staged runner; `everything-chain.test.ts` owns that assertion now. Asserting it here too
  // would be a second copy of the same claim, which is the defect this file is about.
  assert.match(scripts["lab:everything"], /everything-pipeline\.mjs/,
    "the whole chain must run through the staged pipeline, which names the stage that fails");
  const playbook = readFileSync(
    join(REPO, "packages/worker-fleet/ansible/lab-job.yml"), "utf8");
  assert.match(playbook, /--output", "runs\/model-\{\{ out \| default\('candidate'\) \}\}"/,
    "the Ansible train job must default to the same scratch directory the npm chain writes");
});
