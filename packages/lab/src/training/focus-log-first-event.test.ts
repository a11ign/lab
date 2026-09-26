/**
 * #2550: the first event of every focus log, per protocol. Fixtures are hand-built shapes of the
 * `interaction.focusEvents` record (`{asked, checked, log}`), not copies of a real capture.
 *
 * THE POSITIVE CONTROL LIVES HERE: a real-corpus reading of "0 focusout-first" only means something because
 * the first two tests show a `focusout`-first fixture lands in that bucket and a log-less one lands in
 * neither of the others.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { captureProtocolOf, countFirstEvents, firstEventBucket } from "./focus-log-first-event.mjs";

const withLog = (log: unknown[], protocol: number | null = 21, checked = true) => ({
  environment: protocol === null ? {} : { captureProtocol: protocol },
  interaction: { focusEvents: { asked: true, checked, log } },
});

test("a log whose first entry is a focusout counts exactly 1 in the focusout bucket (the positive control)", () => {
  const result = countFirstEvents([
    { file: "a.json", capture: withLog([{ type: "focusout", id: 3, atMs: 5 }, { type: "focusin", id: 4, atMs: 6 }]) },
  ]);
  assert.deepEqual(result.byProtocol["21"], { focusin: 0, focusout: 1, noLog: 0, other: 0, total: 1 });
  assert.deepEqual(result.focusoutFirst.map((entry) => entry.file), ["a.json"]);
});

test("a capture with no focusEvents log lands in the no-log bucket and in neither of the other two", () => {
  const result = countFirstEvents([{ file: "b.json", capture: { environment: { captureProtocol: 21 }, interaction: {} } }]);
  assert.deepEqual(result.byProtocol["21"], { focusin: 0, focusout: 0, noLog: 1, other: 0, total: 1 });
  assert.deepEqual(result.focusoutFirst, []);
});

test("checked:false, an empty log and a missing key are all no-log, never a silent zero of the others", () => {
  assert.equal(firstEventBucket(withLog([{ type: "focusout", id: 1, atMs: 0 }], 21, false)), "noLog");
  assert.equal(firstEventBucket(withLog([])), "noLog");
  assert.equal(firstEventBucket({ interaction: { focusEvents: { checked: true } } }), "noLog");
  assert.equal(firstEventBucket({}), "noLog");
});

test("a focusin-first log is the focusin bucket", () => {
  assert.equal(firstEventBucket(withLog([{ type: "focusin", id: 1, atMs: 0 }])), "focusin");
});

test("an unexpected first type is counted as other, so the buckets always sum to the total", () => {
  const result = countFirstEvents([
    { file: "c.json", capture: withLog([{ type: "blur", id: 1, atMs: 0 }]) },
    { file: "d.json", capture: withLog([{ type: "focusin", id: 1, atMs: 0 }]) },
  ]);
  const tally = result.byProtocol["21"];
  assert.equal(tally.other, 1);
  assert.equal(tally.focusin + tally.focusout + tally.noLog + tally.other, tally.total);
});

test("captures are counted per protocol, and an absent protocol is its own key", () => {
  const result = countFirstEvents([
    { file: "e.json", capture: withLog([{ type: "focusin", id: 1, atMs: 0 }], 21) },
    { file: "f.json", capture: withLog([{ type: "focusout", id: 1, atMs: 0 }], 16) },
    { file: "g.json", capture: withLog([{ type: "focusin", id: 1, atMs: 0 }], null) },
  ]);
  assert.deepEqual(Object.keys(result.byProtocol).sort(), ["16", "21", "absent"]);
  assert.equal(result.byProtocol["16"].focusout, 1);
  assert.equal(result.byProtocol["21"].focusout, 0);
  assert.equal(captureProtocolOf({ environment: null }), "absent");
});

test("a focusout-first capture is classed sameControlReversed only when the next event is a focusin for the SAME id", () => {
  const result = countFirstEvents([
    { file: "same.json", capture: withLog([{ type: "focusout", id: 7, atMs: 1 }, { type: "focusin", id: 7, atMs: 1 }]) },
    { file: "other-id.json", capture: withLog([{ type: "focusout", id: 7, atMs: 1 }, { type: "focusin", id: 8, atMs: 1 }]) },
    { file: "alone.json", capture: withLog([{ type: "focusout", id: 7, atMs: 1 }]) },
  ]);
  const byFile = Object.fromEntries(result.focusoutFirst.map((entry) => [entry.file, entry.sameControlReversed]));
  assert.deepEqual(byFile, { "same.json": true, "other-id.json": false, "alone.json": false });
});
