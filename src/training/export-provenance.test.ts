import { strict as assert } from "node:assert";
import { test } from "node:test";

import { captureEnvironment } from "./export-screenreader-dataset.mjs";

// WHICH BOX TOOK A CAPTURE is the one question `environment.worker` exists to answer, and it was
// answered from the EXPORTER's environment rather than from the capture -- so it named the exporting
// machine's configuration, which has nothing to do with where the evidence came from.
//
// These pin the property, not the shape: the value must come from the capture, and must NOT come from
// the ambient environment. Mutation-checked by restoring the original expression, which fails all four.

const capture = (worker: string | null) => ({
  environment: { browserVersion: "151.0.4129.101", workerCode: "abc123" },
  provenance: { worker },
});

test("the worker is read from the capture, not from the exporter's environment", () => {
  const previous = process.env.A11Y_WORKERS;
  process.env.A11Y_WORKERS = "http://not-the-capturing-box:8765";
  try {
    const env = captureEnvironment(capture("http://203.0.113.107:8765"));
    assert.equal(env.worker, "http://203.0.113.107:8765");
  } finally {
    if (previous === undefined) delete process.env.A11Y_WORKERS;
    else process.env.A11Y_WORKERS = previous;
  }
});

test("two captures from different boxes keep different workers in one export", () => {
  // The defect's signature: every record carrying the SAME value. Attribution is the only thing this
  // field is for, so a constant cannot do its job -- which is exactly why nothing noticed for months.
  const a = captureEnvironment(capture("http://203.0.113.107:8765"));
  const b = captureEnvironment(capture("http://203.0.113.224:8765"));
  assert.notEqual(a.worker, b.worker);
});

test("an unattributable capture exports null, never a plausible guess", () => {
  const previous = process.env.A11Y_WORKER;
  process.env.A11Y_WORKER = "http://tempting-fallback:8765";
  try {
    // A capture with no recorded worker is unattributable. Naming the exporter's own box would be a
    // wrong answer wearing a right one's clothes -- the failure this repo names "a correct value read
    // from the wrong place". `null` says "not recorded", which is what is true.
    assert.equal(captureEnvironment({ environment: {} }).worker, null);
    assert.equal(captureEnvironment(capture(null)).worker, null);
  } finally {
    if (previous === undefined) delete process.env.A11Y_WORKER;
    else process.env.A11Y_WORKER = previous;
  }
});

test("the sibling fields still come from the capture's own environment", () => {
  const env = captureEnvironment(capture("http://203.0.113.59:8765"));
  assert.equal(env.browserVersion, "151.0.4129.101");
  assert.equal(env.workerCode, "abc123");
});

// WHICH PROTOCOL PRODUCED THIS RECORD (#1989). The cache keys on `captureProtocol`, so a v21 capture is
// never served from a v20 entry -- but the exporter dropped the field, so the RECORD could not say. All
// 3,742 records in the three corpora carried none, and a corpus mixed across the 20 -> 21 bump looked
// exactly like one that was not.
//
// These pin the property rather than a number: the value must come from the capture, a capture that did
// not record one must export `null`, and two protocols must stay distinguishable. Mutation-checked by
// hard-coding `captureProtocol: 21` in the exporter, which the first test alone survives.

// The two real protocols either side of #1918's bump -- the populations #1926 must be able to tell
// apart. Named because the test's subject IS which number came out, so a bare literal in the assertion
// and a bare literal in the input read as the same thing when they are the claim and its control.
const BEFORE_BUMP = 20;
const AFTER_BUMP = 21;
// Falsy, and RECORDED -- the pair `||` cannot tell apart.
const FALSY_BUT_RECORDED = 0;

const captureAt = (captureProtocol: unknown) =>
  ({ environment: captureProtocol === undefined ? {} : { captureProtocol } });

test("the protocol is read from the capture", () => {
  assert.equal(captureEnvironment(captureAt(AFTER_BUMP)).captureProtocol, AFTER_BUMP);
});

test("two captures on different protocols stay distinguishable in one export", () => {
  // The whole point of the stamp: a mixed corpus must be detectable after the fact. A hard-coded or
  // defaulted value passes the test above and fails this one.
  const before = captureEnvironment(captureAt(BEFORE_BUMP));
  const after = captureEnvironment(captureAt(AFTER_BUMP));
  assert.equal(before.captureProtocol, BEFORE_BUMP);
  assert.equal(after.captureProtocol, AFTER_BUMP);
  assert.notEqual(before.captureProtocol, after.captureProtocol);
});

test("a capture that recorded no protocol exports null, never a default protocol number", () => {
  // A record claiming a protocol it was not captured under is WORSE than one claiming none: it puts a
  // record into a population it does not belong to, which is the one thing this field exists to prevent.
  assert.equal(captureEnvironment(captureAt(undefined)).captureProtocol, null);
  assert.equal(captureEnvironment({}).captureProtocol, null);
});

test("a recorded protocol 0 exports as 0, not as 'not recorded'", () => {
  // `knownOr` is `||`, so it would collapse a recorded 0 into `null`. Every sibling field here is a
  // string and cannot tell the difference; this one is a NUMBER, and the two states it would merge are
  // the two populations the stamp exists to separate.
  assert.equal(captureEnvironment(captureAt(FALSY_BUT_RECORDED)).captureProtocol, FALSY_BUT_RECORDED);
});
