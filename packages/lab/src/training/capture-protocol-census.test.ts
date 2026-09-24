import { test } from "node:test";
import assert from "node:assert/strict";

import {
  captureProtocolCensus, protocolCensusLines, protocolCensusOfTheMix, recordProtocolCensus, withTotal,
} from "./capture-protocol-census.mjs";

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

// The generated tier's stamp lives on the RECORD (`provenance.environment.captureProtocol`), not on a capture (#2371).
const stamped = (protocol?: number | null) =>
  ({ provenance: { environment: protocol === undefined ? undefined : { captureProtocol: protocol } } });

test("the record census counts the stamp the generated tier carries, and absent for a record with none (#2371)", () => {
  assert.deepEqual(recordProtocolCensus([stamped(21), stamped(21), stamped(18)]), { "21": 2, "18": 1 });
  const nullEnvironment = { provenance: { environment: null } };
  assert.deepEqual(recordProtocolCensus([stamped(), stamped(null), nullEnvironment, { provenance: {} }, {}]), { absent: 5 });
});

test("the record census does not read a capture, and the capture census does not read a record's provenance", () => {
  // Each reader is blind to the other's path, so a half cannot be counted from the wrong place and come out equal.
  assert.deepEqual(recordProtocolCensus([captured(18)]), { absent: 1 });
  assert.deepEqual(captureProtocolCensus([stamped(21)]), { absent: 1 });
});

test("a census carries its total, so an empty group prints n=0 rather than a bare {}", () => {
  assert.deepEqual(withTotal({ "18": 2, absent: 3 }), { n: 5, counts: { "18": 2, absent: 3 } });
  assert.deepEqual(withTotal({}), { n: 0, counts: {} });
});

test("one run reads both halves of the mix: generated at 21 beside real-page at 18 (#2215)", () => {
  const mix = protocolCensusOfTheMix({
    trainingEntries: [captured(18), captured(18), captured(18)],
    generatedRecords: [stamped(21), stamped(21)],
  });
  assert.deepEqual(mix, {
    realPage: { n: 3, counts: { "18": 3 } },
    generated: { n: 2, counts: { "21": 2 } },
  });
  assert.deepEqual(protocolCensusLines(mix), ['real-page {"18":3} n=3', 'generated {"21":2} n=2']);
});

test("a half that joined nothing reads n=0 in the printed line, not a pass", () => {
  const mix = protocolCensusOfTheMix({ trainingEntries: [], generatedRecords: [stamped(21)] });
  assert.deepEqual(protocolCensusLines(mix), ["real-page {} n=0", 'generated {"21":1} n=1']);
});
