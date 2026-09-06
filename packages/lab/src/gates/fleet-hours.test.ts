import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { occupancyMs, scan, report, METHOD } from "../../scripts/fleet-hours.mjs";

/** A capture is billed on the LAST cumulative `atMs`, so a fixture needs marks that climb. */
const marks = (...ms: number[]) => ms.map((atMs, i) => ({ event: `mark${i}`, atMs }));

function corpus(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-hours-"));
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(body));
  }
  return dir;
}

test("a capture is billed for its LAST cumulative atMs, not its first", () => {
  assert.equal(occupancyMs({ diagnostics: marks(846, 12_000, 27_400) }), 27_400);
});

test("the max wins even if the marks are not in order — atMs is cumulative, the array order is not a contract", () => {
  // Reading `marks[marks.length - 1]` would bill 900ms for a 27s capture and look entirely plausible.
  assert.equal(occupancyMs({ diagnostics: marks(846, 27_400, 900) }), 27_400);
});

test("a capture with no atMs anywhere reads null, never 0", () => {
  // 0 would be BILLED, silently, as a free capture. null is unbillable and gets counted as such.
  assert.equal(occupancyMs({ diagnostics: [{ event: "browserReused" }] }), null);
  assert.equal(occupancyMs({ diagnostics: [] }), null);
  assert.equal(occupancyMs({}), null);
});

test("WRAPPED captures are billed too — the wrapper-read defect this repo keeps re-finding", () => {
  // `runs/fetched/*.json` nest the capture under `.capture`. A walk that reads only the top level bills
  // them at zero, and the total is quietly short by exactly the captures somebody fetched to investigate.
  const dir = corpus({
    "plain.json": { diagnostics: marks(1_000, 20_000) },
    "fetched/wrapped.json": { role: "candidate", capture: { diagnostics: marks(1_000, 30_000) } },
  });
  const found = scan(dir);
  assert.equal(found.captures, 2, "both shapes must be recognised as captures");
  assert.deepEqual(found.billed.sort((a: number, b: number) => a - b), [20_000, 30_000]);
});

test("ANTI-VACUITY: the walk is proven to work, so a zero from the real corpus means zero", () => {
  // The sibling of every skip-honestly guard here. Without this, a scan() that silently read nothing
  // would make every assertion above pass against an empty set.
  const dir = corpus({ "one.json": { diagnostics: marks(5_000) } });
  assert.equal(scan(dir).billed.length, 1);
});

test("an implausible duration is excluded AND counted — never silently dropped", () => {
  // A 40-hour "capture" is a clock artefact, not a cost. Dropping it quietly would understate nothing
  // and overstate wildly; counting it means the report can say why the numbers do not add up.
  const dir = corpus({
    "sane.json": { diagnostics: marks(20_000) },
    "absurd.json": { diagnostics: marks(40 * 3_600_000) },
    "instant.json": { diagnostics: marks(12) },
  });
  const found = scan(dir);
  assert.equal(found.billed.length, 1);
  assert.equal(found.implausible, 2);
});

test("the report converts to worker-hours and carries what it could NOT bill", () => {
  const found = scan(corpus({
    // 20 min + 25 min = 45 min = 0.75 h. Deliberately NOT a round half-hour: the first version of this
    // test expected 1.5 h from a fixture that summed to 0.5 h once one capture was filtered, and 0.5 is
    // exactly what the filtered-and-unfiltered readings would both have produced had the sum been rounder.
    "a.json": { diagnostics: marks(1_200_000) },
    "b.json": { diagnostics: marks(1_500_000) },
    "c.json": { diagnostics: [{ event: "no-time" }] },
  }));
  const summary = report(found);
  assert.equal(summary.workerHours, 0.75);
  assert.equal(summary.capturesBilled, 2);
  assert.equal(summary.unbillable.noAtMs, 1,
    "an unbillable capture must be visible, or an absent capture reads as a cheap one");
});

test("the plausibility bounds are INCLUSIVE at the edges, and a magic number nobody tested is not a bound", () => {
  // Written after the fixture above billed 0.5h where 1.5h was expected: a 1-hour "capture" was silently
  // excluded and the total looked merely wrong rather than filtered. The boundary is now asserted, so
  // moving either bound fails here rather than quietly changing every board figure that follows.
  const dir = corpus({
    "at-min.json": { diagnostics: marks(1_000) },
    "below-min.json": { diagnostics: marks(999) },
    "at-max.json": { diagnostics: marks(30 * 60 * 1_000) },
    "above-max.json": { diagnostics: marks(30 * 60 * 1_000 + 1) },
  });
  const found = scan(dir);
  assert.deepEqual(found.billed.sort((a: number, b: number) => a - b), [1_000, 1_800_000],
    "both edges are billed; one step outside either is not");
  assert.equal(found.implausible, 2);
});

test("an empty corpus bills nothing, which is what the CLI refuses on", () => {
  const found = scan(corpus({}));
  assert.equal(found.billed.length, 0);
  assert.equal(report(found).workerHours, 0);
});

test("the report EMITS its method, so nothing downstream has to retype it", () => {
  // `docs/board/reported.json` records a method string beside every total. Typed there, it is this file's
  // implementation stated twice with nothing comparing them — and its first version described summing
  // per-case times from a progress-file field that does not exist. Emitting it deletes the copy.
  const summary = report(scan(corpus({ "a.json": { diagnostics: marks(60_000) } })));
  assert.equal(summary.method, METHOD);
  assert.match(summary.method, /never wall clock/,
    "the method must state what it is NOT — that is the half a reader gets wrong");
});
