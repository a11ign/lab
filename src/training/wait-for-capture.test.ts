/**
 * `training:wait` waits on nothing (A11-263).
 *
 * It used to watch the progress file and hold the process until the run finished: a wait over fleet work, in the agent's shell. A capture run is a job on the control plane
 * now, so it prints the status and the line to DECLARE (`waitingOn: [{ fleetJob: <id> }]`), and exits at once with `capture-status`'s codes. Driven as a subprocess because
 * the contract is the exit code and the output, and a unit test of the summary would not have seen a wait.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { scratchDir as tempDir } from "../fleet/scratch-dir.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const WAIT = resolve(ROOT, "packages/lab/src/training/wait-for-capture.mjs");
/** A wait that held the process would run into this; a command that returns at once never does. */
const AT_ONCE_MS = 20_000;

function waitFor(progress: Record<string, unknown> | null, args: string[] = []) {
  const root = tempDir("a11y-wait-");
  if (progress) writeFileSync(resolve(root, "capture-progress.json"), JSON.stringify(progress));
  const started = Date.now();
  const run = spawnSync(process.execPath, [WAIT, ...args], { cwd: ROOT, env: { ...process.env, DATASET_ROOT: root }, encoding: "utf8", timeout: AT_ONCE_MS });
  return { ...run, tookMs: Date.now() - started };
}

const base = {
  startedAt: new Date(Date.now() - 3_600_000).toISOString(), updatedAt: new Date(Date.now() - 3_000_000).toISOString(), finishedAt: null, outcome: null,
  worker: null, baseUrl: null, captureTimeoutMs: 1_000, total: 2, workers: [], current: [],
  cases: { a: { status: "pending" }, b: { status: "captured", phrases: 3 } },
};
const jobs = [{ id: "fj-20261025T000000Z-aaaaaa", kind: "dataset", submittedAt: "2026-10-25T00:00:00.000Z" }];

test("a run the service still holds is reported at once with the line to declare, and the exit is 0", () => {
  const run = waitFor({ ...base, fleetJobs: jobs });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.tookMs < AT_ONCE_MS, "it returned; it did not wait");
  assert.match(run.stdout, /Run in progress on the fleet job service \(1\/2 captured so far\)\. Not waiting here\./);
  assert.match(run.stdout, /declare: waitingOn: \[\{ "fleetJob": "fj-20261025T000000Z-aaaaaa" \}\]/);
  assert.match(run.stdout, /next: fleet job status fj-20261025T000000Z-aaaaaa/);
});

test("--json carries the same declaration for a caller that reads it", () => {
  const out = JSON.parse(execFileSync(process.execPath, [WAIT, "--json"], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, DATASET_ROOT: (() => { const root = tempDir("a11y-wait-"); writeFileSync(resolve(root, "capture-progress.json"), JSON.stringify({ ...base, fleetJobs: jobs })); return root; })() },
  }));
  assert.equal(out.declare, 'waitingOn: [{ "fleetJob": "fj-20261025T000000Z-aaaaaa" }]');
  assert.equal(out.verdict, 0);
});

test("the exit codes are capture-status's: 0 finished clean, 1 finished with failures, 2 no run, 3 a legacy file gone quiet", () => {
  assert.equal(waitFor({ ...base, fleetJobs: jobs, finishedAt: "2026-10-25T01:00:00.000Z", cases: { a: { status: "captured" }, b: { status: "captured" } } }).status, 0);
  const failed = waitFor({ ...base, fleetJobs: jobs, finishedAt: "2026-10-25T01:00:00.000Z", cases: { a: { status: "captured" }, b: { status: "failed", reason: "no" } } });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /failed: b: no/);
  assert.equal(waitFor(null).status, 2);
  assert.equal(waitFor({ ...base, fleetJobs: [] }).status, 3, "a run from before the service is judged by its file, as it always was");
});

test("it holds no watch and no timer: the file has no fs.watch, no setInterval and no setTimeout", () => {
  const source = readFileSync(WAIT, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(source, /\bwatch\(|setInterval|setTimeout|\bsleep\b/);
});
