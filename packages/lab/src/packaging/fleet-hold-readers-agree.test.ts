/**
 * #2975 (cut-over 4 of 6): `packages/control` may import nothing by name (ADR 0012, `control-has-no-dependencies.test.ts`), so its
 * `fleetHoldUntil`/`fleetHoldWorkers` are COPIES of the tool's. #2027 is the defect a second reader is: the work gate's fleet batch dispatched
 * rows that were holding the fleet because the two readers did not agree. `lab` is the one package that may import both, so this is where they
 * are made to: the same bodies, the same answers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fleetHoldUntil as controlUntil, fleetHoldWorkers as controlWorkers } from "../../../control/src/fleet-playbook.mjs";
import { fleetHoldUntil as toolUntil, fleetHoldWorkers as toolWorkers } from "agent-org/src/waiting-condition.mjs";

const BODIES: Array<[label: string, body: string | null | undefined]> = [
  ["a bare timestamp", "Fleet-hold-until: 2026-09-22T04:00:00Z"],
  ["under a heading", "## Fleet-hold-until: 2026-09-22T04:00:00Z"],
  ["inside prose", "some prose\nFleet-hold-until: 2026-09-22T04:00:00Z\nmore prose"],
  ["named workers", "Fleet-hold-until: 2026-09-22T04:00:00Z a11y-worker-2,a11y-worker-3"],
  ["one named worker", "Fleet-hold-until: 2026-09-22T04:00:00Z a11y-worker-12"],
  ["a typo'd worker, which fails the whole line", "Fleet-hold-until: 2026-09-22T04:00:00Z a11y-wrker-2"],
  ["a worker list with a space", "Fleet-hold-until: 2026-09-22T04:00:00Z a11y-worker-2, a11y-worker-3"],
  ["a date the calendar does not have", "Fleet-hold-until: 2026-02-31T04:00:00Z"],
  ["a timestamp without seconds", "Fleet-hold-until: 2026-09-22T04:00Z"],
  ["a word, not a timestamp", "Fleet-hold-until: tomorrow"],
  ["lower-case field name", "fleet-hold-until: 2026-09-22T04:00:00Z"],
  ["no field", "no field here at all"],
  ["an empty body", ""],
  ["null", null],
  ["undefined", undefined],
];

test("control's copy of the fleet-hold readers answers exactly as the tool's does, body by body", () => {
  for (const [label, body] of BODIES) {
    assert.equal(controlUntil(body), toolUntil(body), `fleetHoldUntil disagrees on ${label}`);
    assert.deepEqual(controlWorkers(body), toolWorkers(body), `fleetHoldWorkers disagrees on ${label}`);
  }
});

test("the control: the bodies include holds that DO read, with and without workers, so agreement is not two readers both finding nothing", () => {
  assert.equal(toolUntil("Fleet-hold-until: 2026-09-22T04:00:00Z"), "2026-09-22T04:00:00Z");
  assert.deepEqual(toolWorkers("Fleet-hold-until: 2026-09-22T04:00:00Z a11y-worker-2,a11y-worker-3"), ["a11y-worker-2", "a11y-worker-3"]);
  assert.equal(BODIES.filter(([, body]) => toolUntil(body) !== null).length > 3, true);
});
