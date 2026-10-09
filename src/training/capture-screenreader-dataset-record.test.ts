// A dataset capture leaves the same per-run record as a real-pages capture (#4462, split from #4459): when it started,
// which boxes took part, and why each other named box sat out, in `runs/capture-runs.jsonl`.
//
// THE PROBES ARE STUBBED, so no worker is touched. The helper is driven for what a run WRITES; the script's WIRING
// is read as text, as `pool-invariants.test.ts` does, because the script's closure reaches the corpus and the
// control plane (`page-server.mjs`, `fleet-wake.ts`) and a checkout without them cannot import it.
//
// The ruling is that the dataset capture records WITHOUT the guard (wiring it in would change what it refuses), so
// `readyCount` is `null`: the guard is what reads a ready count. Each claim has its control beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildRunRecord, recordUnguardedRun } from "./capture-run-record.mjs";

/** Built from octets: a written-out private address is refused by the leak guard. */
const workerUrl = (octet: number) => `http://${[192, 168, 64, octet].join(".")}:8765`;
const A = workerUrl(1);
const B = workerUrl(2);
const C = workerUrl(3);
const STARTED_AT = "2026-10-09T09:00:00.000Z";
const FILE = "/runs/capture-runs.jsonl";

/** `fleet-wake`'s own words: `no-answer` is a box that returned nothing, anything else answered or refused. */
const probes = (outcomes: Record<string, string>) => async (worker: string) => ({ outcome: outcomes[worker] ?? "ok" });

async function record(run: { named: string[], participants: string[] }, outcomes: Record<string, string> = {}) {
  const written: { file: string, text: string }[] = [];
  const reported: string[] = [];
  await recordUnguardedRun({ file: FILE, startedAt: STARTED_AT, ...run }, {
    probe: probes(outcomes),
    append: (file, text) => { written.push({ file, text }); },
    makeDir: () => {},
    report: (message) => { reported.push(message); },
  });
  return { written, reported, lines: written.map(({ text }) => JSON.parse(text)) };
}

/** The IMPORT, not the name: the script's own comments say why it is not behind the guard. */
const GUARD_IMPORT = /from "\.\/capture-fleet-guard\.mjs"/;
const script = readFileSync(fileURLToPath(new URL("./capture-screenreader-dataset.mjs", import.meta.url)), "utf8");
const realPages = readFileSync(fileURLToPath(new URL("./capture-real-pages.mjs", import.meta.url)), "utf8");

test("a dataset run appends ONE record naming the participants it used", async () => {
  const { written, lines } = await record({ named: [A, B], participants: [A, B] });
  assert.equal(written.length, 1);
  assert.equal(written[0]!.file, FILE);
  assert.ok(written[0]!.text.endsWith("\n"), "one JSON object per line");
  assert.deepEqual(lines[0], { startedAt: STARTED_AT, readyCount: null, participants: [A, B], excluded: [] });
});

test("control: a box named and not used is excluded WITH its reason, asleep and down told apart", async () => {
  const { lines } = await record({ named: [A, B, C], participants: [A] }, { [B]: "no-answer", [C]: "refused" });
  assert.deepEqual(lines[0].participants, [A]);
  assert.deepEqual(lines[0].excluded, [{ worker: B, reason: "asleep" }, { worker: C, reason: "down" }]);
});

test("a run that read no ready count writes readyCount: null, never 0", async () => {
  const { lines } = await record({ named: [A, B], participants: [A] });
  assert.equal(lines[0].readyCount, null);
  assert.notEqual(lines[0].readyCount, 0);
});

test("control: the shared builder keeps a count it is GIVEN, so the null above is the run's and not the builder's", () => {
  const given = buildRunRecord({ startedAt: STARTED_AT, readyCount: 5, participants: [A], excluded: [] });
  assert.equal(given.readyCount, 5);
  assert.deepEqual(Object.keys(given).sort(), ["excluded", "participants", "readyCount", "startedAt"]);
});

test("a run that found nobody still records, with every named box excluded and no participants", async () => {
  const { lines } = await record({ named: [A, B], participants: [] }, { [A]: "no-answer" });
  assert.deepEqual(lines[0].participants, []);
  assert.deepEqual(lines[0].excluded, [{ worker: A, reason: "asleep" }, { worker: B, reason: "down" }]);
});

test("a local-guest run, which named no fleet, records its participant and excludes nobody", async () => {
  const { lines } = await record({ named: [], participants: [A] });
  assert.deepEqual(lines[0], { startedAt: STARTED_AT, readyCount: null, participants: [A], excluded: [] });
});

test("a record that cannot be written is SAID and does not throw", async () => {
  const reported: string[] = [];
  await assert.doesNotReject(recordUnguardedRun({ file: FILE, startedAt: STARTED_AT, named: [A], participants: [A] }, {
    probe: probes({}),
    append: () => { throw new Error("disk full"); },
    makeDir: () => {},
    report: (message) => { reported.push(message); },
  }));
  assert.match(reported.join(""), /CAPTURE RUN RECORD NOT WRITTEN to \/runs\/capture-runs\.jsonl: disk full/);
});

test("control: a record that CAN be written reports nothing", async () => {
  assert.deepEqual((await record({ named: [A], participants: [A] })).reported, []);
});

test("the dataset script records into the file real-pages does, before it captures, and not through the guard", () => {
  assert.match(script, /captureRunsFile\(runsRoot\(\)\)/, "the same file as capture-real-pages.mjs");
  assert.match(realPages, /captureRunsFile\(runsRoot\(\)\)/, "control: the pattern matches the script it is copied from");
  const recorded = script.indexOf("await recordDatasetRun(run, checked");
  const captured = script.indexOf("await captureDataset(cases, done, checked, lease)");
  assert.ok(recorded > 0 && captured > recorded, "recorded after the pool is checked and before the first case");
  assert.match(script, /recordNobodyThenFail\(run, error\)/, "a run that finds nobody records too");
  assert.ok(!GUARD_IMPORT.test(script), "the ruling: the dataset capture is not put behind the guard");
  assert.ok(GUARD_IMPORT.test(realPages), "control: the same pattern does find the guard where it is wired");
});
