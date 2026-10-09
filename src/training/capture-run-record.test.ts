// A capture run's own record of its fleet (#4459): boxes ready at the start, boxes that took part, and why each
// other sat out. Driven through the REAL guard with stubbed probes, so no worker is touched and the record is read
// back from the same `append` the guard calls.
//
// Every claim has its control beside it: a run with a box missing writes unequal counts AND a run with none missing
// writes equal ones with an empty `excluded`, because a record that always says "everyone took part" (or never
// does) would pass either half alone.
//
// IT IMPORTS THE GUARD AND THE RECORD, NOT THE CAPTURE SCRIPT, for the reason `capture-fleet-guard.test.ts` gives:
// the script's closure reaches the corpus and the acceptance job has no `runs/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertOneBrowserAcross, EXIT_FLEET_INCONSISTENT } from "./capture-fleet-guard.mjs";
import {
  appendRunRecord, buildRunRecord, captureRunsFile, CAPTURE_RUNS_FILE, EXCLUSION_REASONS,
} from "./capture-run-record.mjs";

/** Built from octets, as `capture-fleet-guard.test.ts` does: a written-out private address is refused by the leak guard. */
const workerUrl = (octet: number) => `http://${[192, 168, 64, octet].join(".")}:8765`;
const A = workerUrl(1);
const B = workerUrl(2);
const C = workerUrl(3);
const STARTED_AT = "2026-10-09T09:00:00.000Z";
const FILE = "/runs/capture-runs.jsonl";

/** `/health` as a worker answers it: no `worker` key. Only the browser differs here, which is all these tests split on. */
const health = (browserVersion: string) => ({ ok: true, environment: { browserVersion } });

type Probes = Record<string, () => unknown>;

/**
 * Drive the guard and return what it appended and what it did about it. `unchecked` waives the coverage refusal
 * (the fixture reports one field), so a test of the RECORD is not also a test of coverage, which
 * `capture-fleet-guard.test.ts` owns.
 */
async function run(probes: Probes, options: {
  alreadyExcluded?: { worker: string, reason: "asleep" | "down" }[], record?: boolean, split?: boolean,
  append?: (file: string, text: string) => void,
} = {}) {
  const lines: string[] = [];
  const events: string[] = [];
  const reported: string[] = [];
  const append = options.append ?? ((file: string, text: string) => { events.push("append"); lines.push(`${file} ${text}`); });
  await assertOneBrowserAcross(Object.keys(probes), "before the run", {
    probe: async (url) => probes[url.replace(/\/health$/, "")]!(),
    report: (text) => void reported.push(text),
    exit: (code) => void events.push(`exit ${code}`),
    allowUncheckedFields: true,
    runRecord: options.record === false ? undefined
      : { file: FILE, startedAt: STARTED_AT, alreadyExcluded: options.alreadyExcluded, append, makeDir: () => undefined },
  });
  const records = lines.map((line) => JSON.parse(line.slice(FILE.length + 1)));
  return { records, events, reported };
}

const agreeing = (): Probes => ({ [A]: () => health("151"), [B]: () => health("151"), [C]: () => health("151") });
const unreachable = () => { throw new Error("no route to host"); };

test("a box that does not answer is down: readyCount exceeds participants, and the reason is written", async () => {
  const { records } = await run({ ...agreeing(), [C]: unreachable });
  assert.deepEqual(records, [{
    startedAt: STARTED_AT, readyCount: 2, participants: [A, B], excluded: [{ worker: C, reason: "down" }],
  }]);
});

test("a box the wake step left asleep is carried as asleep, beside the one the probe found down", async () => {
  const { records } = await run({ [A]: () => health("151"), [B]: unreachable },
    { alreadyExcluded: [{ worker: C, reason: "asleep" }] });
  assert.deepEqual(records[0].excluded,
    [{ worker: C, reason: "asleep" }, { worker: B, reason: "down" }]);
  assert.equal(records[0].readyCount, 1);
  assert.deepEqual(records[0].participants, [A]);
});

test("CONTROL: every box taking part writes equal counts and an empty excluded", async () => {
  const { records } = await run(agreeing());
  assert.equal(records.length, 1);
  assert.equal(records[0].readyCount, records[0].participants.length);
  assert.equal(records[0].readyCount, 3);
  assert.deepEqual(records[0].excluded, []);
});

test("a split fleet exits 3 and has ALREADY written its record, naming the boxes inconsistent", async () => {
  const { records, events } = await run({ ...agreeing(), [C]: () => health("150") });
  // Order is the claim: a record written after `exit` is a record the process never writes.
  assert.deepEqual(events, ["append", `exit ${EXIT_FLEET_INCONSISTENT}`]);
  assert.equal(records[0].readyCount, 3);
  assert.deepEqual(records[0].participants, []);
  assert.deepEqual(records[0].excluded.map(({ reason }: { reason: string }) => reason),
    ["inconsistent", "inconsistent", "inconsistent"]);
});

test("CONTROL: a consistent fleet never exits, so the order above is not a fixture that always exits", async () => {
  const { events } = await run(agreeing());
  assert.deepEqual(events, ["append"]);
});

test("the coverage refusal writes its record before exiting too, not only the browser split", async () => {
  const events: string[] = [];
  await assertOneBrowserAcross([A, B], "before the run", {
    probe: async () => ({ ok: true, environment: { browserVersion: "151" } }),
    report: () => undefined,
    exit: (code) => void events.push(`exit ${code}`),
    runRecord: { file: FILE, startedAt: STARTED_AT, append: () => void events.push("append"), makeDir: () => undefined },
  });
  assert.deepEqual(events, ["append", `exit ${EXIT_FLEET_INCONSISTENT}`]);
});

test("--allow-mixed-browsers lets the fleet take part, and the record says so rather than calling it refused", async () => {
  const records: string[] = [];
  await assertOneBrowserAcross([A, B], "before the run", {
    probe: async (url) => health(url.startsWith(A) ? "151" : "150"),
    report: () => undefined, exit: () => undefined, allowMixedBrowsers: true, allowUncheckedFields: true,
    runRecord: { file: FILE, startedAt: STARTED_AT, append: (_, text) => void records.push(text), makeDir: () => undefined },
  });
  assert.deepEqual(JSON.parse(records[0]!).participants, [A, B]);
});

test("a guard given no runRecord appends nothing, and one given it appends exactly once", async () => {
  assert.deepEqual((await run(agreeing(), { record: false })).events, []);
  assert.equal((await run(agreeing())).records.length, 1);
});

test("a record that cannot be written is reported by name, and the run is not stopped by it", async () => {
  const { reported, events } = await run(agreeing(), { append: () => { throw new Error("ENOSPC"); } });
  assert.match(reported.join(""), /CAPTURE RUN RECORD NOT WRITTEN to \/runs\/capture-runs\.jsonl: ENOSPC/);
  assert.deepEqual(events, []);
});

test("a figure the run did not read is null, never 0 and never an estimate", () => {
  const record = buildRunRecord({ startedAt: STARTED_AT, readyCount: null, participants: [A], excluded: [] });
  assert.equal(JSON.parse(JSON.stringify(record)).readyCount, null);
});

test("a reason outside inconsistent/asleep/down is refused, and the three are exactly the row's", () => {
  assert.deepEqual([...EXCLUSION_REASONS], ["inconsistent", "asleep", "down"]);
  assert.throws(() => buildRunRecord({
    startedAt: STARTED_AT, readyCount: 1, participants: [A], excluded: [{ worker: B, reason: "tired" as never }],
  }), /tired/);
});

test("appendRunRecord writes one JSON line per run to runs/capture-runs.jsonl and keeps the earlier ones", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-runs-"));
  try {
    const file = captureRunsFile(join(root, "runs"));
    assert.equal(file, join(root, "runs", CAPTURE_RUNS_FILE));
    appendRunRecord(buildRunRecord({ startedAt: STARTED_AT, readyCount: 1, participants: [A], excluded: [] }), file);
    appendRunRecord(buildRunRecord({ startedAt: STARTED_AT, readyCount: 2, participants: [A, B], excluded: [] }), file);
    const lines = readFileSync(file, "utf8").split("\n");
    assert.equal(lines.pop(), "", "ends in a newline, so the next run starts a new line");
    assert.deepEqual(lines.map((line) => JSON.parse(line).readyCount), [1, 2]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
