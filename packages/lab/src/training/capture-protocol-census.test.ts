import { test } from "node:test";
import assert from "node:assert/strict";

import { captureProtocolCensus } from "./capture-protocol-census.mjs";

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
