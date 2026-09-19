/**
 * #781: the pure functions, driven directly with hand-built fixtures for every branch. The REAL
 * `runs/witness/` replay of the three pre-registered pages lives in `real-page-drift-summary-corpus.test.ts`
 * -- split out, not merged here, because THIS file is the CI acceptance command (`packages/lab/CLAUDE.md`'s
 * "a gate that reads runs/ is not yours to report": `runsRoot()` anywhere in an entry file marks the whole
 * file corpus-dependent for `acceptance-commands.mjs`'s closure walk, even inside a callback that honestly
 * skips when the corpus is absent, so a CI runner with no `runs/` would have nothing here it could run).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  shapeReadingFor, distinctShapes, worstFieldSpreadPercent, driftDistributionsByUrl, driftSummaryLine,
} from "./real-page-drift-summary.mjs";

/** An array of `n` placeholder entries -- only its LENGTH matters to `fieldValues`. */
const items = (n: number) => Array.from({ length: n }, (_, i) => `item-${i}`);

interface CaptureOpts {
  url?: string; capturedAt?: string; workerCode?: string; targetMatch?: string | null;
  structure?: Record<string, number>; interaction?: Record<string, number>;
}

const DEFAULT_STRUCTURE = { headings: 1, landmarks: 1, formFields: 1, tableCells: 1, links: 1, lists: 1, graphics: 1, frames: 0 };

/**
 * A minimal capture carrying real structure/interaction arrays and a real `domCensus` mark -- built to
 * exercise `documentIdentity`/`fieldValues` themselves, never a hand-built shape those functions bypass.
 */
function capture(opts: CaptureOpts = {}) {
  const {
    url = "https://example.com/", capturedAt = "2026-09-09T07:19:00.000Z", workerCode = "build-a",
    targetMatch = "matched", structure = DEFAULT_STRUCTURE, interaction = { controls: 1 },
  } = opts;
  const diagnostics: unknown[] = [];
  if (targetMatch !== null) diagnostics.push({ event: "domCensus", targetMatch });
  return {
    url, capturedAt, environment: { workerCode },
    structure: Object.fromEntries(Object.entries(structure).map(([k, n]) => [k, items(n)])),
    interaction: Object.fromEntries(Object.entries(interaction).map(([k, n]) => [k, items(n)])),
    diagnostics,
  };
}

test("shapeReadingFor reads the structure vector off a REAL fieldValues call, and null for a recordless capture", () => {
  const reading = shapeReadingFor(capture({ structure: { headings: 3, landmarks: 0, formFields: 2, tableCells: 0, links: 5, lists: 1, graphics: 0, frames: 0 } }));
  assert.deepEqual(reading?.vector, { headings: 3, landmarks: 0, formFields: 2, tableCells: 0, links: 5, lists: 1, graphics: 0, frames: 0 });
  assert.equal(reading?.targetMatch, "matched");
  assert.equal(shapeReadingFor({ notACapture: true }), null);
});

test("shapeReadingFor accepts a runs/witness/ {capturedAt, task, capture} record, not only a bare capture", () => {
  const wrapped = { capturedAt: "2026-09-09T07:19:00.000Z", task: "Read this page", capture: capture() };
  assert.notEqual(shapeReadingFor(wrapped), null);
});

test("shapeReadingFor ignores interaction fields entirely -- two captures differing ONLY in interaction "
  + "counts are the SAME structure shape (interaction varies with probe budgets, not with the page)", () => {
  const a = shapeReadingFor(capture({ interaction: { controls: 1 } }));
  const b = shapeReadingFor(capture({ interaction: { controls: 9 } }));
  assert.deepEqual(a?.vector, b?.vector);
});

/** A full `ShapeReading`-shaped fixture, so a hand-built distribution needs no `any`. */
const reading = (vector: Record<string, number>, capturedAt: string | null = null) =>
  ({ url: "https://example.com/", capturedAt, workerCode: "build-a", targetMatch: "matched", vector });

test("distinctShapes: hubspot's own worked case -- three readings of one vector, two of another, is TWO "
  + "shapes, never five singletons and never one blurred by tolerance", () => {
  const a = { headings: 92, landmarks: 2, formFields: 225, tableCells: 6, links: 99, lists: 40 };
  const b = { headings: 91, landmarks: 2, formFields: 224, tableCells: 6, links: 98, lists: 39 };
  const readings = [
    reading(a, "07:19"), reading(b, "08:04"), reading(a, "11:32"), reading(b, "14:09"), reading(a, "14:03"),
  ];
  const shapes = distinctShapes(readings);
  assert.equal(shapes.length, 2);
  assert.deepEqual(shapes.map((s) => s.count).sort(), [2, 3]);
});

test("worstFieldSpreadPercent: the worst field wins, not an average, and 0 below two readings", () => {
  const readings = [reading({ a: 100, b: 10 }), reading({ a: 90, b: 10 }), reading({ a: 100, b: 5 })];
  // a: (100-90)/100 = 10%; b: (10-5)/10 = 50% -- the worst field is b, not a's smaller spread.
  assert.equal(worstFieldSpreadPercent(readings), 50);
  assert.equal(worstFieldSpreadPercent([reading({ a: 1 })]), 0);
  assert.equal(worstFieldSpreadPercent([reading({ a: 0 }), reading({ a: 0 })]), 0);
});

test("driftDistributionsByUrl: a fallback capture is EXCLUDED and NAMED, never silently dropped and "
  + "never compared as if it were the page (#688's original defect)", () => {
  const [entry] = driftDistributionsByUrl([
    capture({ targetMatch: "matched" }), capture({ targetMatch: "matched" }), capture({ targetMatch: "fallback" }),
  ]);
  assert.equal(entry.n, 2);
  assert.equal(entry.excludedCount, 1);
  assert.equal(entry.refused, null);
});

test("driftDistributionsByUrl: a captures with NO identity mark at all (targetMatch null) is excluded too", () => {
  const [entry] = driftDistributionsByUrl([capture({ targetMatch: "matched" }), capture({ targetMatch: null })]);
  assert.equal(entry.n, 1);
  assert.equal(entry.excludedCount, 1);
});

test("driftDistributionsByUrl: matched captures spanning more than one worker build REFUSE, and the "
  + "message names every build (C8) -- ikea's own incident, four builds across five captures", () => {
  const [entry] = driftDistributionsByUrl([
    capture({ workerCode: "74f37905" }), capture({ workerCode: "94e91f68" }), capture({ workerCode: "9ad992a4" }),
  ]);
  assert.match(entry.refused ?? "", /74f37905/);
  assert.match(entry.refused ?? "", /94e91f68/);
  assert.match(entry.refused ?? "", /9ad992a4/);
  assert.match(entry.refused ?? "", /C8/);
  assert.equal(entry.shapes, undefined, "a refused entry reports no shapes -- comparing across builds "
    + "would measure the worker, not the page");
});

test("driftDistributionsByUrl: one worker build is silent, exactly like the matched-fleet case in "
  + "protocol-guard.test.ts -- the common case must add no noise", () => {
  const [entry] = driftDistributionsByUrl([capture({ workerCode: "build-a" }), capture({ workerCode: "build-a" })]);
  assert.equal(entry.refused, null);
  assert.equal(entry.build, "build-a");
});

test("driftDistributionsByUrl: every URL seen gets an entry, including one with a single usable capture "
  + "-- an absent page would read as nothing to report, and this is a fact worth stating instead", () => {
  const byUrl = driftDistributionsByUrl([capture({ url: "https://a.example/" })]);
  assert.equal(byUrl.length, 1);
  assert.equal(byUrl[0].n, 1);
  assert.equal(byUrl[0].refused, null);
  assert.match(driftSummaryLine(byUrl[0]), /only 1 usable capture/);
});

test("driftSummaryLine: REFUSED, few-captures and the normal case are three distinct, always-printed lines", () => {
  assert.match(driftSummaryLine({ url: "u", n: 3, excludedCount: 0, refused: "spans 2 builds (a, b) (C8)" }),
    /REFUSED -- spans 2 builds/);
  assert.match(driftSummaryLine({ url: "u", n: 1, excludedCount: 1, refused: null }),
    /only 1 usable capture.*1 more excluded/s);
  const normal = driftSummaryLine({
    url: "u", n: 5, excludedCount: 0, refused: null, build: "build-a",
    shapes: [{ vector: { a: 1 }, count: 3, capturedAt: ["07:19", "11:32", "14:03"] },
      { vector: { a: 2 }, count: 2, capturedAt: ["08:04", "14:09"] }],
    spreadPercent: 2.5,
  });
  assert.match(normal, /n=5 on build build-a/);
  assert.match(normal, /2 distinct shape\(s\)/);
  assert.match(normal, /worst-field spread 2\.5%/);
});
