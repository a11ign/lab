/**
 * What `evidence:check` can be AIMED at, and which box its report names — #1948.
 *
 * These four facts decided whether #1908's acceptance (ten reads of one family, five on each of two
 * workers) could be dispatched at all, and not one of them was guarded. `probe-chain.test.ts` reads this
 * script's SOURCE for the probe-flag rule, which is the only reason any of it is checked today;
 * `narrowTo`, `stratify` and `resultRow` are exported so these can be asserted against the real functions
 * instead.
 *
 * The fourth is the one that cost a verdict: `report.json` carried a single top-level `worker` set to
 * `workers[0]` — the first url on the argv, never the one that captured — so a fleet dispatch produced a
 * report naming the same box whether or not it did any of the work. A constant read as a measurement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CASES } from "./case-matrix.mjs";
import { drainAcrossPool } from "./worker-pool.mjs";
import { narrowTo, stratify, resultRow } from "../../scripts/evidence-check.mjs";

/** #1908's family, and the string its seven cases embed. */
const FAMILY = "media-autoplay-audio";
const WAV = "data:audio/wav";

test("--only= matches the FAMILY first, so one family is one case and six siblings are invisible", () => {
  // DERIVED, never pinned as a number in prose: the row that needed this said "14 variants" from a test
  // asserting `>= 1`, and a floor reads the same at 14, at 7 and at 1.
  const embedTheWav = CASES.filter((testCase: unknown) => JSON.stringify(testCase).includes(WAV));
  assert.equal(embedTheWav.length, 7,
    "the positive control for the narrowing below: if no case embedded the WAV at all, every count here "
    + "would be zero and the assertions would pass having examined nothing");

  const selected = narrowTo(CASES, FAMILY);
  assert.deepEqual(selected.map((c: { id: string }) => c.id), [FAMILY],
    "`--only=media-autoplay-audio` selects ONE case. The other six have ids beginning "
    + "`media-autoplay-audio+`, and the filter reads `family ?? id` — their families are "
    + "`multi-defect-1.4.2` and `conformant-behaviour-1.4.2`, which the filter cannot see. That is the "
    + "population #1908 asks about; widening the filter would silently change what it measures.");
  // The other direction, so this cannot be a filter that returns one case for everything.
  assert.equal(narrowTo(CASES, null).length, CASES.length, "no `--only=` narrows nothing");
  assert.ok(narrowTo(CASES, "multi-defect-1.4.2").length > 1,
    "a family that several cases share selects all of them — the narrowing is by family, not by count");
});

test("--sample is inert under a one-family --only=, and is not inert without one", () => {
  // `-e sample=1` and `-e sample=200` do identical work once `--only=` names a family, because `stratify`
  // keeps one case per family and a family filter leaves one family. An operator sizing a dispatch reads
  // the two flags as independent; under a narrowing they are not.
  const selected = narrowTo(CASES, FAMILY);
  assert.deepEqual(stratify(selected, 1), stratify(selected, 200));
  assert.equal(stratify(selected, 200).length, 1);
  // The control: over the WHOLE corpus the sample size is exactly what decides the size of the run, so
  // the equality above is a property of the narrowing rather than of `stratify` ignoring its limit.
  assert.equal(stratify(CASES, 1).length, 1);
  assert.ok(stratify(CASES, 200).length > 1,
    "unnarrowed, a bigger sample takes more families — otherwise the limit is being dropped");
});

test("one case is one worker, and the row names the one that captured it", async () => {
  // A case is INDIVISIBLE by construction (a good/bad pair must come from the same screen reader on the
  // same machine), so a one-case run is one worker's work however many boxes are named. Ten stub workers,
  // one item: nine drain an empty queue. Which box that leaves is not a choice anyone made — which is why
  // the report has to record it rather than assume it.
  const workers = Array.from({ length: 10 }, (_unused, index) => `http://203.0.113.${index}:8765`);
  const testCase = { id: "stub-case", family: "stub" };
  const rows: { id: string; worker: string | null }[] = [];
  const handledBy: string[] = [];

  await drainAcrossPool({
    workers,
    items: [testCase],
    // `workers[0]` REFUSES READINESS, which is the sharpest form of the defect: the report used to name
    // the first url on the argv, so it would have named a box that never became usable. Refusing rather
    // than racing also makes this deterministic — the assertion below is about attribution, and a test
    // that depends on which of ten stubs wins a timer is a different test.
    prepare: async (worker: string) => {
      if (worker === workers[0]) throw new Error("not ready");
      return worker;
    },
    handle: async (item: typeof testCase, { worker }: { worker: string }) => {
      handledBy.push(worker);
      rows.push(resultRow({
        testCase: item, variant: "good", worker,
        comparison: { verdict: "SAME", changes: [], phrases: null },
      }));
    },
  });

  assert.equal(handledBy.length, 1, "one item is handled once, whatever the pool size");
  assert.equal(new Set(handledBy).size, 1, "and by exactly one worker, because a case is indivisible");
  assert.equal(rows[0].worker, handledBy[0],
    "the row must name the box that captured it, taken from the pool's own context");
  assert.notEqual(rows[0].worker, workers[0],
    "`workers[0]` is what `report.json` named for every row until #1948, and here it is a worker that "
    + "never even became usable — the field was a constant, not a measurement");
});

test("a case no worker captured names no worker, rather than inventing one", () => {
  // UNCOMPARED rows exist precisely because nothing ran. `null` is the honest answer and a readable one:
  // a reader diffing two runs can tell "captured by box 3" from "never captured".
  const row = resultRow({
    testCase: { id: "stub-case" }, variant: "bad", worker: null,
    comparison: { verdict: "REJECTED", changes: [], phrases: null },
  });
  assert.equal(row.worker, null);
  assert.deepEqual(Object.keys(row), ["id", "variant", "worker", "comparison"]);
});

test("every report row is built by resultRow, so no path can record one without a worker", () => {
  // A SOURCE READ, like `probe-chain.test.ts`'s rule for this same file, and for the same reason: what is
  // being guarded is that four scattered call sites keep going through one builder. The alternative —
  // extracting a helper that returns its own arguments so a test can call it — is the extraction CLAUDE.md
  // names as not being progress.
  const source = readFileSync(resolve(process.cwd(), "packages/lab/scripts/evidence-check.mjs"), "utf8");
  const pushes = [...source.matchAll(/results\.push\(([\s\S]{0,12})/g)].map(([, tail]) => tail.trim());
  assert.ok(pushes.length >= 4, `only ${pushes.length} results.push( call(s) found; this scan has broken`);
  for (const tail of pushes) {
    assert.ok(tail.startsWith("resultRow("),
      `a result row is being built inline (\`results.push(${tail}…\`) rather than by \`resultRow\`, which `
      + "is where the capturing worker is recorded. A row built any other way silently has no worker, and "
      + "the report goes back to naming a box that may not have captured anything.");
  }
  assert.match(source, /JSON\.stringify\(\{ workers, results, summary \}/,
    "the report's top level lists the pool AS DISPATCHED (`workers`), not a singular `worker` — which was "
    + "`workers[0]` and therefore the same value whichever box did the work");
});
