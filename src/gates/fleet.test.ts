/**
 * What a gate says about a run over the fleet: a verdict over the ITEMS, and where the work landed.
 *
 * The gates used to spread their own work (`gateWorkers`, `acrossFleet`, a drain over a pool of boxes), and the tests here refused three wrong shapes of it. A gate SUBMITS a fleet job now
 * (A11-263): the service books the boxes and holds a group to one, so spreading is not the gate's to get wrong. What is left, and tested, is the verdict.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { fleetVerdict, renderShards } from "./fleet.ts";

test("the report shows where work LANDED, so an uneven split is evidence rather than an artefact", () => {
  const rendered = renderShards([{ worker: "a11y-worker-14" }, { worker: "a11y-worker-14" }, { worker: "a11y-worker-15" }]);
  assert.match(rendered, /a11y-worker-14 +2 item\(s\)/);
  assert.match(rendered, /a11y-worker-15 +1 item\(s\)/);
  assert.equal(rendered.split("\n").length, 2, "one line per box");
});

test("THE DENOMINATOR IS THE PAGES, not the machines", () => {
  // The boxes are how the work was spread; the pages are what was examined. Swapping them is how a gate
  // reports a number nobody asked for.
  const verdict = fleetVerdict(
    [{ result: {}, error: null }, { result: {}, error: null }, { result: {}, error: null }],
    { of: 3, what: "3 canaries x 5 captures", workers: 5, failed: 0 });
  assert.equal(verdict.verdict, "PASS");
  assert.equal(verdict.of, 3, "three pages on five boxes is a claim about three pages");
  assert.match(verdict.why, /run as a fleet job on 5 box\(es\)/);
});

test("an item nobody could judge reduces COVERAGE rather than passing quietly", () => {
  const verdict = fleetVerdict(
    [{ result: {}, error: null }, { result: null, error: "ETIMEDOUT" }],
    { of: 2, what: "2 canaries", workers: 5, failed: 0 });
  assert.equal(verdict.verdict, "INCONCLUSIVE");
  assert.equal(verdict.examined, 1);
});

test("a bad result FAILS, and outranks an unmeasurable one", () => {
  const verdict = fleetVerdict(
    [{ result: {}, error: null }, { result: null, error: "ETIMEDOUT" }],
    { of: 2, what: "2 canaries", workers: 5, failed: 1 });
  assert.equal(verdict.verdict, "FAIL", "a defect proven on one page is a defect however little else said");
});
