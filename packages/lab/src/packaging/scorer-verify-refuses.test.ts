/**
 * `scorer:verify` must REFUSE a model directory carrying an executable-on-load artefact.
 *
 * ## Why this gate matters more than its size suggests
 *
 * The weights are the only artefact this project publishes. `.pt`, `.pkl` and `.ckpt` are pickle-backed
 * formats that execute arbitrary code when loaded, so one landing in `packages/scorer/models/` and
 * reaching npm is a supply-chain compromise of every consumer. safetensors is the format that cannot.
 *
 * This script existed and **NOTHING invoked it** — not an npm script, not a playbook, not another module —
 * so the security check on the published artefact had never run. It is now the first stage of
 * `release:gate`, and this is the test that has watched it refuse.
 *
 * ## Two tiers, because the predicate and the wiring fail independently
 *
 * The Site Reliability Workbook's monitoring-test tiers apply directly (ch4, "Testing Alerting Logic"):
 * check the signal moves, check the rule fires, check the notification reaches someone. Here:
 *
 *   1. `problems()` — the PURE decision. Fast, exhaustive, and it can enumerate every unsafe extension.
 *   2. the COMMAND, run against a planted directory. This is the tier this repo keeps needing, because
 *      its recurring defect is a correct remedy that some path never reaches — `refreshBrowseBuffer`
 *      guarded on a flag nothing set, `ensureSpeechChannel` fixed at one call site of two. A green
 *      predicate says nothing about whether the exit code, the message, or the wiring work.
 *
 * The second tier costs one temp directory and two empty files, which is the whole argument against
 * "this gate needs a real model to test".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { problems, classify } from "../../scripts/verify-safetensors.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPT = join(REPO, "packages/lab/scripts/verify-safetensors.mjs");

/** Every format that executes on load. Named here so the test fails if the script's set shrinks. */
const EXECUTABLE_ON_LOAD = [".pt", ".pkl", ".ckpt", ".bin", ".pth", ".h5"];

function planted(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "a11y-model-"));
  for (const name of files) writeFileSync(join(dir, name), "");
  return dir;
}

test("the pure decision refuses every executable-on-load extension", async () => {
  for (const ext of EXECUTABLE_ON_LOAD) {
    const dir = planted([`model.safetensors`, `weights${ext}`]);
    try {
      const found = await classify([join(dir, "model.safetensors"), join(dir, `weights${ext}`)], dir);
      const errors = problems(found, "training");
      assert.ok(errors.some((e: string) => e.includes("unsafe")),
        `${ext} executes on load and must be refused; problems() said ${JSON.stringify(errors)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("a directory of safetensors alone is accepted", () => {
  // The control. Without it, every assertion above is satisfied by a gate that refuses EVERYTHING —
  // which would be safe, useless, and switched off the first time it blocked a release.
  const errors = problems({ unsafe: [], safetensors: ["model.safetensors"], inference: [] }, "training");
  assert.deepEqual(errors, []);
});

test("training mode refuses a directory with NO safetensors at all", () => {
  // An empty model directory is not a passing one. "Nothing unsafe here" and "nothing here" are the
  // examined-nothing failure this repo names most often.
  const errors = problems({ unsafe: [], safetensors: [], inference: [] }, "training");
  assert.ok(errors.length > 0, "an empty directory must not read as clean");
});

test("THE COMMAND refuses a planted directory, and names the file", () => {
  const dir = planted(["model.safetensors", "weights.pkl"]);
  try {
    let status = 0;
    let output = "";
    try {
      output = execFileSync("node", [SCRIPT, dir], { encoding: "utf8" });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      status = failure.status ?? 1;
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    }
    assert.notEqual(status, 0, "a poisoned model directory must exit non-zero, or release:gate sails past it");
    // The MESSAGE, not just the code. A refusal that does not name the file sends the reader to read the
    // whole directory, which is the difference between a gate and an obstacle.
    assert.match(output, /weights\.pkl/, `the refusal must name the offending file; got: ${output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("THE COMMAND accepts a clean directory", () => {
  const dir = planted(["model.safetensors"]);
  try {
    const output = execFileSync("node", [SCRIPT, dir], { encoding: "utf8" });
    assert.match(output, /PASSED/, "a clean directory must pass, or the gate blocks every release");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
