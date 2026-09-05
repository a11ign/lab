import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (p: string) => readFileSync(resolve(REPO, p), "utf8");

/**
 * BOTH pipelines keep a full transcript, from ONE definition.
 *
 * `keepingTranscript` was written in `everything-pipeline.mjs` and its comment states the problem exactly:
 * the runner prints a six-line tail per stage and captures the child's stdout to do it, so the detail
 * "no longer reaches the journal AT ALL". It then solved that for the nine top-level stages only — while
 * `retrain` is one of those stages AND is itself a pipeline, running the same `run` in a child process
 * and tailing its own five stages before the parent ever sees them.
 *
 * So the record billed as full nested a tail inside it. Measured 2026-09-01 on a real run:
 * `build-realism` prints one line per head, and the everything transcript preserved three of thirteen.
 * `4.1.3: 0 of 37` — every real page masked for that head — was legible only because 4.1.3 sorts last.
 *
 * That is this repo's most expensive recurring shape: a remedy correct, commented, and reachable from
 * only one of the paths that needed it (`anchorToTop`, `ensureSpeechChannel`, `waitForAnnouncement`).
 * The remedy here is one definition both entry points call, which is why this asserts on the IMPORT
 * rather than on a second copy being present and correct.
 */
test("keepingTranscript has one home, and everything-pipeline imports it", () => {
  const retrain = read("packages/lab/scripts/retrain-pipeline.mjs");
  const everything = read("packages/lab/scripts/everything-pipeline.mjs");

  assert.match(retrain, /export function keepingTranscript\(/,
    "it belongs beside `run`, because the tail it compensates for is there");
  assert.doesNotMatch(everything, /function keepingTranscript\(/,
    "a second copy is how two pipelines come to disagree about what a record is");
  assert.match(everything, /import \{[^}]*keepingTranscript[^}]*\} from "\.\/retrain-pipeline\.mjs"/,
    "everything-pipeline must import it, not redefine it");
});

test("each pipeline writes its OWN transcript, so a nested run cannot interleave", () => {
  const retrain = read("packages/lab/scripts/retrain-pipeline.mjs");
  const everything = read("packages/lab/scripts/everything-pipeline.mjs");
  assert.match(retrain, /RETRAIN_TRANSCRIPT = resolve\(runsRoot\(\), "retrain-transcript\.log"\)/);
  assert.match(everything, /TRANSCRIPT = resolve\(runsRoot\(\), "everything-transcript\.log"\)/);
  // The path is required rather than defaulted, so neither can silently inherit the other's file while
  // `everything` has `retrain` running inside it.
  assert.match(retrain, /keepingTranscript\(runStep, \{ transcript \}\)/,
    "the transcript path must be REQUIRED — a default is how two concurrent pipelines share one file");
});

test("a dry run keeps no transcript at all", () => {
  // The `rmSync` that starts a fresh record is skipped on a dry run — correctly — but the APPEND was not,
  // so `--dry-run` added stages to the last real run's record. That is the exact failure the comment on
  // that rmSync describes, reintroduced by the guard written to prevent it.
  for (const file of ["packages/lab/scripts/retrain-pipeline.mjs", "packages/lab/scripts/everything-pipeline.mjs"]) {
    assert.match(read(file), /runStep: dryRun \? run : keepingTranscript\(/,
      `${file}: a dry run must bypass the transcript, not append "(dry run)" to the last real one`);
  }
});

test("the retrain transcript is reachable — a record nothing can fetch is a record nobody reads", () => {
  const doc = parse(read("packages/control/ansible/lab-fetch.yml")) as Record<string, unknown>[];
  const artifacts = JSON.stringify(doc);
  assert.match(artifacts, /retrain-transcript/,
    "lab-fetch.yml must expose it; `runs/` is gitignored and the lab is not reachable any other way");
});
