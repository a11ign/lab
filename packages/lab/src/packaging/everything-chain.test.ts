/**
 * The whole-chain pipeline must name stages that exist, in the order they have to run.
 *
 * `lab:everything` was six npm scripts joined with `&&`, and replacing that string with a step list moves
 * the chain from a place nothing could check into one a test can. The risk of the move is a typo'd or
 * renamed script: `npm run` would fail at that stage with "Missing script", hours in, on the lab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS } from "../../scripts/everything-pipeline.mjs";

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
    ["retrain", "export-acceptance", "train", "promote", "grants-audit", "release-gate"]);
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
    ["promote", "grants-audit", "release-gate"]);
});
