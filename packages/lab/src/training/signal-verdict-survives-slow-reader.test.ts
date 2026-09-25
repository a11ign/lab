// no-token: gh -- nothing here calls gh or the network; check-signals runs against a generated manifest and an empty captures directory
// writes: runs/screenreader-dataset
// (the fixture is a temp dir of that shape and the script is pointed at it with DATASET_ROOT; the real corpus is never read)
/**
 * `check-signals` prints ~170 KB on a full manifest and its verdict line is the LAST thing it says. It used to
 * end in `process.exit(code)`, which on a pipe drops whatever the reader has not yet taken, so a reader that
 * was slow (the CI unit run, eight suites at once) got the case list and no verdict, and
 * `corpus-restore-drill` reported "no verdict line" for a gate that had answered INCONCLUSIVE. It reached
 * `main` as a red trunk on #2441's merge although that merge did not touch either file.
 *
 * The reader here is deliberately slow and deterministic -- it stops reading for a second -- so the test does not
 * depend on the runner's load. Break the fix (put `process.exit(exitCode)` back) and this goes red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../dataset-paths.mjs";

const GENERATE = resolve(REPO_ROOT, "packages/lab/src/training/generate-screenreader-dataset.mjs");
const CHECK_SIGNALS = resolve(REPO_ROOT, "packages/lab/src/training/check-signals.mjs");
const READER_STALL_MS = 1500;
/** Larger than a pipe buffer (64 KiB), or nothing is ever queued and the test proves nothing. */
const PIPE_BUFFER_BYTES = 1 << 16;

function envFor(dataset: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DATASET_ROOT: dataset };
  for (const name of ["RUNS_ROOT", "A11Y_RUNS_ROOT", "DATASET_KIND", "DATASET_CAPTURE_ROOT", "A11Y_DATASET_GRADE",
    "A11Y_RUNS_READONLY"]) delete env[name];
  return env;
}

/** stdout of `check-signals`, read only after `READER_STALL_MS` of not reading at all. */
function readSlowly(dataset: string): Promise<{ status: number | null; stdout: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CHECK_SIGNALS], { cwd: REPO_ROOT, env: envFor(dataset), stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.pause();
    setTimeout(() => child.stdout.resume(), READER_STALL_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", fail);
    child.on("close", (status) => done({ status, stdout: Buffer.concat(chunks).toString("utf8") }));
  });
}

test("the verdict line reaches a reader that was slow to read, and the exit code still says INCONCLUSIVE", async () => {
  const dataset = mkdtempSync(join(tmpdir(), "check-signals-slow-reader-"));
  try {
    execFileSync(process.execPath, [GENERATE], { cwd: REPO_ROOT, env: envFor(dataset) });
    mkdirSync(join(dataset, "captures"), { recursive: true });
    const { status, stdout } = await readSlowly(dataset);
    assert.ok(Buffer.byteLength(stdout) > PIPE_BUFFER_BYTES,
      "POSITIVE CONTROL: the output must outgrow the pipe buffer, or a truncating exit has nothing to truncate");
    assert.match(stdout, /^INCONCLUSIVE\b/m, "the verdict line is the last thing printed and is the one that was lost");
    assert.equal(status, 2, "no capture on disk is INCONCLUSIVE (2), and setting exitCode must not change that");
  } finally {
    rmSync(dataset, { recursive: true, force: true });
  }
});
