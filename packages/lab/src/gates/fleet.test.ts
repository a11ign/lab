/**
 * A gate that runs on one box makes a claim about one box.
 *
 * `gate:stability` reported "8 of 8 canaries examined and clean" while describing a single machine of
 * five, and the fleet has five. That is the D6 defect — scope not travelling with a verdict — surviving
 * inside the very gate migrated to prevent it. It was found by a person asking "are you running this on
 * the fleet or just one machine?", which is exactly the mechanism this repo says cannot be relied on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { gateWorkers, acrossFleet, fleetVerdict, renderPerWorker } from "./fleet.mjs";

const box = (worker: string, verdict: string) =>
  ({ worker, result: { verdict, why: `${verdict} on ${worker}` }, error: null });

test("naming a worker is the ESCAPE HATCH, and the scope says so out loud", () => {
  const named = gateWorkers("http://REDACTED-INTERNAL-ADDRESS:8765");
  assert.deepEqual(named.workers, ["http://REDACTED-INTERNAL-ADDRESS:8765"]);
  assert.match(named.scope, /ONLY/,
    "a one-box run must announce itself as one box, or its verdict reads as a fleet claim");
});

test("the DEFAULT is every worker in the inventory, not one", () => {
  const all = gateWorkers(undefined);
  assert.ok(all.workers.length > 1, "the fleet has five boxes; a default of one is the defect");
  assert.match(all.scope, /inventory\.yml/);
});

test("one box's crash does not discard the other boxes' answers", async () => {
  const outcomes = await acrossFleet(["a", "b", "c"], async (worker) => {
    if (worker === "b") throw new Error("EHOSTUNREACH");
    return { verdict: "PASS", why: "clean" };
  });
  assert.equal(outcomes.length, 3);
  assert.equal(outcomes[1].error, "EHOSTUNREACH");
  assert.equal(outcomes[0].result?.verdict, "PASS");
  assert.equal(outcomes[2].result?.verdict, "PASS",
    "Promise.all would have rejected and thrown away two results already in hand");
});

test("every box clean is a fleet PASS that names the denominator", () => {
  const verdict = fleetVerdict([box("a", "PASS"), box("b", "PASS")], "8 canaries");
  assert.equal(verdict.verdict, "PASS");
  assert.equal(verdict.of, 2);
  assert.match(verdict.why, /every worker in inventory\.yml/);
});

test("AN UNREACHABLE BOX CANNOT BE PASSED OVER — it reduces coverage", () => {
  // The case the fan-out exists for. Four boxes clean and one unreachable is NOT "the fleet is stable";
  // it is four fifths of an answer, and a gate that rounds it up launders unknown into fine.
  const outcomes = [box("a", "PASS"), box("b", "PASS"), box("c", "PASS"), box("d", "PASS"),
    { worker: "e", result: null, error: "EHOSTUNREACH" }];
  const verdict = fleetVerdict(outcomes, "8 canaries");
  assert.equal(verdict.verdict, "INCONCLUSIVE");
  assert.equal(verdict.examined, 4);
  assert.equal(verdict.of, 5);
});

test("a box that could not judge itself also reduces coverage, not merely one that crashed", () => {
  // `gate:stability` on worker-2 reported INCONCLUSIVE because two captures hit ETIMEDOUT. That box did
  // not fail determinism — it could not measure it — and the two need opposite responses.
  const verdict = fleetVerdict([box("a", "PASS"), box("b", "INCONCLUSIVE")], "8 canaries");
  assert.equal(verdict.verdict, "INCONCLUSIVE");
  assert.equal(verdict.examined, 1);
});

test("ONE BOX REPORTING INSTABILITY FAILS THE FLEET, and outranks a second box's silence", () => {
  // Failures come first: a defect proven on one machine is a defect however little the rest could say.
  const verdict = fleetVerdict([box("a", "FAIL"), box("b", "INCONCLUSIVE")], "8 canaries");
  assert.equal(verdict.verdict, "FAIL");
  assert.equal(verdict.failures, 1);
});

test("the per-worker report names every box, including the ones that errored", () => {
  const rendered = renderPerWorker([box("http://a:8765", "PASS"),
    { worker: "http://b:8765", result: null, error: "EHOSTUNREACH" }]);
  assert.match(rendered, /http:\/\/a:8765\s+PASS/);
  assert.match(rendered, /http:\/\/b:8765\s+ERROR — EHOSTUNREACH/,
    "a box that did not answer must appear in the report; absent boxes are how a short fleet goes unnoticed");
});
