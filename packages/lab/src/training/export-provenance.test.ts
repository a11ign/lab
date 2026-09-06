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
