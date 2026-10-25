/**
 * The progress file a capture run publishes, as the fleet job service changes it (A11-263): it names the jobs, a later process carries the run on, and a quiet file is not a wedged run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { scratchDir as tempDir } from "../fleet/scratch-dir.ts";
import { beginRun, continueRun, isStale, readProgress, stalenessMs, tally } from "./capture-progress.mjs";

const cases = [{ id: "a" }, { id: "b" }];

test("a run begins with no jobs, and addFleetJob records one once, newest last", () => {
  const root = tempDir("progress-");
  const run = beginRun({ root, worker: null, baseUrl: null, cases });
  assert.deepEqual(readProgress(root)?.fleetJobs, []);
  run.addFleetJob({ id: "fj-1", kind: "dataset", submittedAt: "t1" });
  run.addFleetJob({ id: "fj-2", kind: "dataset", submittedAt: "t2" });
  run.addFleetJob({ id: "fj-1", kind: "dataset", submittedAt: "t1" });
  assert.deepEqual(readProgress(root)?.fleetJobs?.map((job: { id: string }) => job.id), ["fj-2", "fj-1"], "a job is listed once, and the newest to be added is last");
});

test("a later process carries the run on instead of beginning a second one over it", () => {
  const root = tempDir("progress-");
  const first = beginRun({ root, worker: null, baseUrl: "http://pages.test", cases });
  first.addFleetJob({ id: "fj-1", kind: "dataset", submittedAt: "t1" });
  const startedAt = readProgress(root)!.startedAt;

  const later = continueRun(root);
  later.setWorkers(["w1", "w2"]);
  later.recapturing("a", "re-capturing a.bad");
  later.captured("b", { good: 3, bad: 4 });
  const state = readProgress(root)!;
  assert.equal(state.startedAt, startedAt, "the same run, not a new one");
  assert.deepEqual(state.fleetJobs.map((job: { id: string }) => job.id), ["fj-1"]);
  assert.deepEqual(state.workers, ["w1", "w2"]);
  assert.deepEqual(state.cases, { a: { status: "capturing", reason: "re-capturing a.bad" }, b: { status: "captured", phrases: { good: 3, bad: 4 } } });
  assert.deepEqual(tally(state), { captured: 1, failed: 0, skipped: 0, pending: 0, capturing: 1 });
  assert.throws(() => continueRun(tempDir("progress-empty-")), /no capture run in .* to carry on/);
});

test("the recorder's snapshot is a copy: changing it changes nothing", () => {
  const root = tempDir("progress-");
  const run = beginRun({ root, worker: null, baseUrl: null, cases });
  const snapshot = run.snapshot();
  snapshot.cases.a.status = "failed";
  assert.equal(run.snapshot().cases.a.status, "pending");
  assert.ok(join(root, "capture-progress.json").endsWith("capture-progress.json"));
});

test("a quiet file is wedged for a run from before the service, and unknowable for a run the service holds", () => {
  const long = Date.now() - 6 * 3_600_000;
  const quiet = { startedAt: new Date(long).toISOString(), updatedAt: new Date(long).toISOString(), finishedAt: null, captureTimeoutMs: 1_000 };
  assert.ok(isStale(quiet, Date.now()), "control: the old rule still stands");
  assert.equal(stalenessMs({ ...quiet, fleetJobs: [{ id: "fj-1" }] }, Date.now()), null, "cannot tell from the file");
  assert.equal(isStale({ ...quiet, fleetJobs: [{ id: "fj-1" }] }, Date.now()), false);
  assert.ok(isStale({ ...quiet, fleetJobs: [] }, Date.now()), "a file that names no job has no service to excuse its silence");
  assert.equal(isStale({ ...quiet, fleetJobs: [{ id: "fj-1" }], finishedAt: "x" }, Date.now()), false);
});
