/**
 * The sweep printed a number nothing compared, for as long as it existed.
 *
 * On 2026-08-24 a candidate at 0 misses / 0 false accusations on the synthetic hold-out was found to accuse
 * 12 of 18 conformant REAL pages, where the shipped model accused none. Nothing caught it; it surfaced
 * because the sweep was run by hand and the two JSON files happened to be side by side.
 *
 * Real pages are the only measurement here that shares nothing with the corpus generator, so they are the
 * only thing capable of falsifying a generator-shaped assumption — every other gate runs on pages we wrote.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { captureProtocolCensus, compareAtFloor } from "../scripts/calibrate-abstention.mjs";

const row = (floor: number, falsePositives: number) =>
  ({ floor, scored: 21, conformantScored: 18, falsePositives, disclosed: 0,
     inaccessibleScored: 3, inaccessibleCaught: 3 });

test("more false accusations than the baseline is a regression", () => {
  const c = compareAtFloor([row(0.5587, 12)], [row(0.5587, 0)], 0.5587);
  assert.equal(c?.delta, 12);
});

test("fewer is an improvement, and reads as a negative delta", () => {
  const c = compareAtFloor([row(0.6, 1)], [row(0.6, 4)], 0.6);
  assert.equal(c?.delta, -3);
});

test("rows are matched on FLOOR, never on position", () => {
  // The floor is derived per model, so the two sweeps do not share an index. Comparing rows[i] to rows[i]
  // would measure a candidate at one floor against a baseline at another and call the difference a change
  // in the model — the same defect as keying page furniture on array position.
  const candidate = [row(0.5, 9), row(0.7, 2)];
  const baseline = [row(0.7, 2), row(0.5, 9)];
  const c = compareAtFloor(candidate, baseline, 0.7);
  assert.equal(c?.delta, 0, "matched by position, not by floor");
});

test("a baseline that never swept this floor falls back to a LOWER one, never a higher", () => {
  // A lower floor scores at least as many pages, so it can only report at least as many false positives.
  // Falling back upward would compare against a stricter baseline and flatter the candidate.
  const c = compareAtFloor([row(0.65, 5)], [row(0.6, 7), row(0.8, 0)], 0.65);
  assert.equal(c?.was.floor, 0.6);
  assert.equal(c?.delta, -2);
});

test("no comparable baseline row yields no verdict, rather than a fabricated one", () => {
  assert.equal(compareAtFloor([row(0.5, 3)], [], 0.5), null);
  assert.equal(compareAtFloor([], [row(0.5, 3)], 0.5), null);
});

const captured = (protocol?: number | null) =>
  ({ capture: { url: "https://example.test/", environment: protocol === undefined ? undefined : { captureProtocol: protocol } } });

test("the capture-protocol census counts each protocol the fit was taken under (#2212)", () => {
  // A stale split must say so in its own output: 49 captures at 18 while the workers serve 21 read
  // identically to a current split until something prints the census.
  assert.deepEqual(captureProtocolCensus([captured(18), captured(18), captured(21)]), { "18": 2, "21": 1 });
});

test("a capture that records no protocol counts as absent, and does not crash the census", () => {
  const nullEnvironment = { capture: { environment: null } };
  assert.deepEqual(captureProtocolCensus([captured(), captured(null), nullEnvironment, { capture: {} }]), { absent: 4 });
});

test("an empty fit has an empty census, so the positive control is the two cases above", () => {
  assert.deepEqual(captureProtocolCensus([]), {});
});
