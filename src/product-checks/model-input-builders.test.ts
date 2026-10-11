/**
 * NOBODY BUILDS THE MODEL'S INPUT EXCEPT THE SHARED `modelInput` BUILDER.
 *
 * Two files once constructed `input: { screenReader, transcript, structure, interaction, evidenceUnits, ... }` by
 * hand, and the copies drifted the moment the contract gained a field. This pins that the lab's two builders
 * (the corpus export and the realism tier) call the shared builder and do not assemble the input again.
 *
 * Moved from the core's `model-input.test.ts` (ADR 0045 cut 1), whose test read these two files through the
 * core's `packages/lab/` path; the contract's own assertions stay with the scorer. The core's test also covers
 * `score.py`, the product's live path, which is the core's file. This is the thirteenth of the product tests
 * that read lab files: the row counted twelve, and this one reads two lab files and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAB_ROOT } from "./lab-sources.ts";

const BUILDERS = ["src/training/export-screenreader-dataset.mjs", "scripts/build-realism-tier.ts"];

test("NOBODY builds the model's input except the shared modelInput builder", () => {
  assert.equal(BUILDERS.length, 2, "this test names the lab's two input builders; a third is a decision to make here");
  for (const relative of BUILDERS) {
    // Read, not tolerated absent: a missing builder is a failure, since a tolerance that passed it would defeat the test.
    const source = readFileSync(join(LAB_ROOT, relative), "utf8");
    assert.ok(source.includes("modelInput("), `${relative} does not use the shared modelInput builder`);
    assert.ok(!/evidenceUnits:\s*evidenceUnits\(/.test(source),
      `${relative} assembles the model input by hand again: that duplication is what let the contract `
      + "drift when it gained a field, and the copies cannot be kept in step by remembering");
  }
});
