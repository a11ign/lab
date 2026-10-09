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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CASES } from "./case-matrix.mjs";
import { drainAcrossPool } from "./worker-pool.mjs";
import {
  narrowTo, stratify, resultRow, caseComparer, countUncomparedAgainstCoverage, writeReports,
} from "../../scripts/evidence-check.mjs";

/** #1908's family, and the string its seven cases embed. */
const FAMILY = "media-autoplay-audio";
const WAV = "data:audio/wav";

/**
 * A capture the pipeline's own gates ACCEPT, and the title it was taken against.
 *
 * Borrowed in shape from `capture-decisions.test.ts`, deliberately: the handler below runs the real
 * `isEvidence` and the real `compareCapture` rather than stubs of them, so the branch a row lands in is
 * decided by the production gates and a fixture that stopped satisfying them would show up as a changed
 * verdict rather than as a silent pass.
 */
const TITLE = "Aquarium 001 schedule";
const EMPTY_STRUCTURE = { headings: [], landmarks: [], formFields: [] };
const EVIDENCE = {
  transcript: ["heading, level 1, Aquarium 001 schedule", "Departures from Central station"],
  structure: { ...EMPTY_STRUCTURE, headings: ["Aquarium 001 schedule, heading, level 1"] },
};
/** The wrong page: reaches the handler, and `isEvidence` refuses it. */
const NOT_EVIDENCE = { transcript: ["Cannot reach this site", "Try again"], structure: EMPTY_STRUCTURE };

/** The pool's real handler over stub I/O, with the rows it pushes. */
function driveOneCase(io: {
  captureOn: (testCase: unknown, variant: string, worker: string) => Promise<unknown>;
  titleFor: () => Promise<string | null>;
}) {
  const results: { id: string; variant: string; worker: string | null; comparison: { verdict: string } }[] = [];
  const handle = caseComparer({
    results,
    io: { baselineFor: () => EVIDENCE, write: () => {}, ...io },
  });
  return { results, handle };
}

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

test("the reconciliation site writes that null too, and does not reach for workers[0]", () => {
  // THE FOURTH production call site, executed — the other direction of the same defect. Its `null` is
  // correct, so the guard cannot be a rule over the pushes; run it instead. The mutant this kills is
  // `worker: null` becoming `worker`, which inside this function resolves to the module-level
  // `workers[0]`: a row that exists because NOTHING captured it, stamped with the first url on the argv.
  const selected = [{ id: "never-ran", family: "stub" }, { id: "already-has-rows", family: "stub" }];
  const captured = resultRow({
    testCase: selected[1], variant: "good", worker: "http://203.0.113.42:8765",
    comparison: { verdict: "SAME", changes: [], phrases: null },
  });
  const results = [captured];

  countUncomparedAgainstCoverage({
    selected, results,
    // Every variant was ASKED for — a baseline exists — so the ones with no row are missing rather than
    // never requested. That distinction is the function's first line, and stubbing it away would make the
    // reconciliation examine nothing.
    io: { baselineFor: () => ({ transcript: [], structure: {} }), write: () => {} },
  });

  const added = results.filter((row) => row !== captured);
  assert.equal(added.length, 3, "three asked-for variants had no row: both of the first case, and the "
    + "second case's `bad`. The control for the assertion below — with none added it would pass empty.");
  assert.deepEqual(added.map((row) => row.worker), [null, null, null]);
  // And the row that WAS captured keeps its box: reconciliation adds, it does not restamp.
  assert.equal(captured.worker, "http://203.0.113.42:8765");
});

test("every capture path records the worker the pool HANDED it, on all three of its verdicts", async () => {
  // THE PRODUCTION CALL SITES, executed. The three `resultRow` pushes inside the pool's handler
  // (`evidence-check.mjs` SKIPPED / REJECTED / compared) are the whole of done-when 2, and until this test
  // they were guarded only by a source scan that could not reach their arguments: `worker: null` on the
  // compared site left the focused suite green while a real run printed `Captured by 0 of the 3 worker(s)
  // named: none`. Worse than a stale row — `capturedBy` drops a box that did the work, and #1908's ten
  // reads would be posted with no box against them.
  //
  // A source read cannot fix that, because the defect and the correct code SPELL THE SAME: `worker` is
  // also a module-level `const worker = workers[0]` (`:82`), so deleting the handler's `{ worker }`
  // parameter restores #1948's original constant with every line below unchanged. Here both bindings are
  // in scope and only the parameter can produce the address asserted.
  const HANDED = "http://203.0.113.42:8765";
  const stubCase = { id: "stub-case", family: "stub" };

  const compared = driveOneCase({ captureOn: async () => EVIDENCE, titleFor: async () => TITLE });
  await compared.handle(stubCase, { worker: HANDED });
  assert.deepEqual(compared.results.map((r) => r.comparison.verdict), ["SAME", "SAME"],
    "the control for the two assertions below: a fixture the real gates stopped accepting would land these "
    + "rows on another branch, and an attribution assertion over the wrong branch examines nothing");
  assert.deepEqual(compared.results.map((r) => r.worker), [HANDED, HANDED]);

  const skipped = driveOneCase({ captureOn: async () => EVIDENCE, titleFor: async () => null });
  await skipped.handle(stubCase, { worker: HANDED });
  assert.deepEqual(skipped.results.map((r) => r.comparison.verdict), ["SKIPPED", "SKIPPED"]);
  assert.deepEqual(skipped.results.map((r) => r.worker), [HANDED, HANDED]);

  const rejected = driveOneCase({ captureOn: async () => NOT_EVIDENCE, titleFor: async () => TITLE });
  await rejected.handle(stubCase, { worker: HANDED });
  assert.deepEqual(rejected.results.map((r) => r.comparison.verdict), ["REJECTED", "REJECTED"]);
  assert.deepEqual(rejected.results.map((r) => r.worker), [HANDED, HANDED]);

  // And it VARIES with what it is handed, so none of the above can be satisfied by a constant that happens
  // to read like an address — which is precisely the failure this row exists about.
  const second = driveOneCase({ captureOn: async () => EVIDENCE, titleFor: async () => TITLE });
  await second.handle(stubCase, { worker: "http://203.0.113.43:8765" });
  assert.deepEqual(second.results.map((r) => r.worker),
    ["http://203.0.113.43:8765", "http://203.0.113.43:8765"]);
});

test("every report row is built by resultRow, so no path can record one without a worker", () => {
  // A SOURCE READ, like `probe-chain.test.ts`'s rule for this same file. Its claim is narrower than it
  // looks and is worth stating: that every push goes through the ONE builder, not that any of them passes
  // the right thing — the window ends inside `resultRow(` and every argument is outside it. What the three
  // CAPTURE sites pass is asserted by executing them, in the test above. The fourth, the uncompared
  // reconciliation, is the one site that passes `null` correctly, so what guards it is the builder test
  // two above rather than a rule over the pushes — a "no site passes null" scan would turn it red and
  // delete the honest answer.
  const source = readFileSync(resolve(process.cwd(), "packages/lab/scripts/evidence-check.mjs"), "utf8");
  const pushes = [...source.matchAll(/results\.push\(([\s\S]{0,12})/g)].map(([, tail]) => tail.trim());
  assert.ok(pushes.length >= 4, `only ${pushes.length} results.push( call(s) found; this scan has broken`);
  for (const tail of pushes) {
    assert.ok(tail.startsWith("resultRow("),
      `a result row is being built inline (\`results.push(${tail}…\`) rather than by \`resultRow\`, which `
      + "is where the capturing worker is recorded. A row built any other way silently has no worker, and "
      + "the report goes back to naming a box that may not have captured anything.");
  }
});

test("#1948: the report's top level names the POOL, and no singular `worker` returns to it", () => {
  // WAS A SOURCE REGEX pinning the literal `JSON.stringify({ workers, results, summary }`, which stopped
  // being readable the moment #2122 gave the report three more fields — and would have gone on passing if
  // `workers` had been renamed inside a differently-spelled literal. `writeReports` is exported now, so
  // this asks the writer instead of the file: run it, read what it wrote, and look at the keys.
  const dir = mkdtempSync(join(tmpdir(), "evidence-check-aim-"));
  try {
    const { latest } = writeReports({
      workers: ["http://worker-2:7331", "http://worker-3:7331"],
      results: [resultRow({ testCase: { id: FAMILY }, variant: "good", worker: "http://worker-3:7331",
        comparison: { verdict: "SAME" } })],
      summary: { compared: 1 },
      out: dir, runs: join(dir, "runs"),
    });
    const report = JSON.parse(readFileSync(latest, "utf8"));
    assert.deepEqual(report.workers, ["http://worker-2:7331", "http://worker-3:7331"],
      "the pool AS DISPATCHED, in full");
    assert.equal("worker" in report, false,
      "and NO singular `worker` at the top level — it was `workers[0]`, the first url on the argv, so it "
      + "named the same box whether or not that box did any of the work. The per-row `worker` below is "
      + "the one that answers that question.");
    assert.equal(report.results[0].worker, "http://worker-3:7331",
      "the positive control for the assertion above: a `worker` key EXISTS in this report, on the row "
      + "where it is a measurement, so `\"worker\" in report` is false by absence and not by an empty file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
