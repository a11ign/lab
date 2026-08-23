/**
 * The retrain sequence: does it run the right steps in the right order, and does it STOP when it should?
 *
 * This is the half that has actually gone wrong. Until 2026-08-23 the sequence existed nowhere — producing
 * a candidate meant running eight things by hand, and the ORDER and the STOP CONDITIONS lived in somebody's
 * head. Every defect found that day existed because the pipeline had never once run end to end.
 *
 * None of this needs a fleet, a lab or a corpus. `runStep` is injectable, so the orchestration is testable
 * in milliseconds while the steps it orchestrates are not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { pipeline, STEPS } from "../../scripts/retrain-pipeline.mjs";

const record = (failAt?: string) => {
  const ran: string[] = [];
  const runStep = (step: { name: string }) => {
    ran.push(step.name);
    return { ok: step.name !== failAt, output: "" };
  };
  return { ran, runStep };
};

test("every step runs, in the declared order, when nothing fails", () => {
  const { ran, runStep } = record();
  const result = pipeline({ runStep });
  assert.equal(result.ok, true);
  assert.deepEqual(ran, STEPS.map((s: { name: string }) => s.name));
});

test("a FAILING GATE stops the run, and nothing after it is attempted", () => {
  // The defect this prevents: a pipeline that carries on past `check-signals` produces a candidate trained
  // on a corpus with a hole in it, and the number at the end looks exactly like a good one.
  const { ran, runStep } = record("check-signals");
  const result = pipeline({ runStep });
  assert.equal(result.ok, false);
  assert.equal(result.stoppedAt, "check-signals");
  assert.ok(!ran.includes("export"), `export ran after a failed gate: ${ran.join(" -> ")}`);
  assert.ok(!ran.includes("build-realism"));
});

test("a failure in ANY step stops the run, not only in a gate", () => {
  const { ran, runStep } = record("capture");
  const result = pipeline({ runStep });
  assert.equal(result.stoppedAt, "capture");
  assert.deepEqual(ran, ["generate", "capture"]);
});

test("generate comes before capture, or the run tests the PREVIOUS commit's pages", () => {
  // Not a stylistic ordering. The lab job used to capture whatever pages were on disk: it pulled the new
  // commit, printed "capture runs at <sha>", captured the OLD pages, hit cache on every case and exited 0
  // in 13 seconds. A full recapture reported as done, having done nothing.
  const names = STEPS.map((s: { name: string }) => s.name);
  assert.ok(names.indexOf("generate") < names.indexOf("capture"));
  assert.ok(names.indexOf("capture") < names.indexOf("check-signals"),
    "signals must be checked against captures that exist");
  assert.ok(names.indexOf("check-signals") < names.indexOf("export"),
    "a corpus with a blind case must never reach the exporter");
});

test("check-signals is declared a GATE, so its failure is reported as the pipeline working", () => {
  const gate = STEPS.find((s: { name: string }) => s.name === "check-signals");
  assert.equal((gate as { gate?: boolean }).gate, true);
});

test("every step names what it is for, or the sequence is unreviewable", () => {
  for (const step of STEPS as { name: string; why?: string; script?: string }[]) {
    assert.ok(step.why && step.why.length > 20, `${step.name} has no explanation`);
    assert.ok(step.script, `${step.name} names no script`);
  }
});
