// The corpus run's own precondition, and for two months it could not fail (#2018).
//
// `assertOneBrowserAcross` passed each guest's raw `/health` payload to `fleetConsistency`, which keys
// every value it compares by `guest.worker` — a field `/health` does not carry. Ten guests collapsed onto
// the single key `undefined`, the map held one entry, and `consistent` was true for any fleet at all. The
// guard runs before the captures and again after, and on a split it is supposed to `process.exit(3)`
// rather than write two browser builds into one corpus. It never could, and `--allow-mixed-browsers`
// existed to override a check that had never fired.
//
// So both directions are pinned here, because the defect was that ONE OF THE TWO ANSWERS WAS UNREACHABLE:
// a split fleet must be refused, and a matched one must still pass. Driven through the REAL
// `fleetConsistency` — the defect was the shape crossing that boundary, so a stub would take the boundary
// out of the test along with the bug.
//
// IT IMPORTS `capture-fleet-guard.mjs`, NOT THE CAPTURE SCRIPT, and that is part of the same fix: the
// guard used to live inside `capture-real-pages.mjs`, whose import closure reaches `dataset-paths.mjs`
// and therefore the corpus — so the acceptance job, which has no `runs/`, refuses to run any test that
// imports it. A guard no CI job could exercise is how this one shipped unable to fire.
import { test } from "node:test";
import assert from "node:assert/strict";

import { assertOneBrowserAcross } from "./capture-fleet-guard.mjs";
import { fleetConsistency } from "@a11ign/worker-fleet/fleet-consistency";

/**
 * Fixture addresses BUILT FROM OCTETS, for the reason `fleet-consistency.test.ts` gives: #63's history
 * purge rewrote every RFC 1918 literal in the tree to one string, which would silently make two distinct
 * guests here the same box — and `tracked-source-leak-guard` refuses a written-out one anyway.
 */
const privateAddress = (...octets: number[]) => octets.join(".");
const workerUrl = (octet: number) => `http://${privateAddress(192, 168, 64, octet)}:8765`;

/**
 * What a worker actually answers, from `server.mjs`'s own contract line:
 * `GET /health -> { ok, screenReader, busy, code, environment }`.
 *
 * **There is no `worker` key, and that absence IS the defect** — so the fixture is the real payload rather
 * than the shape `fleetConsistency` documents. A fixture that helpfully added the key would be testing the
 * fix against a fleet that cannot exist.
 */
const health = (browserVersion: string) => ({
  ok: true, screenReader: "nvda", busy: false, code: "abc1234",
  environment: {
    browserVersion, screenReaderVersion: "2026.1.1", guidepupVersion: "0.31.0",
    windowsVersion: "Microsoft Windows 11 Pro 10.0.22621", architecture: "arm64", captureProtocol: 2,
  },
});

const EDGE_151 = "151.0.4129.59";
const EDGE_150 = "150.0.4078.105";

/** Drive the guard with a stubbed probe, recording what it reported and whether it tried to exit. */
async function runGuard(byWorker: Record<string, () => unknown>) {
  const reported: string[] = [];
  const exits: number[] = [];
  const asked: string[] = [];
  await assertOneBrowserAcross(Object.keys(byWorker), "before the run", {
    probe: async (url: string) => {
      asked.push(url);
      return byWorker[url]();
    },
    report: (text: string) => void reported.push(text),
    exit: (code: number) => void exits.push(code),
  });
  return { reported: reported.join(""), exits, asked };
}

test("a fleet split across two Edge builds is refused, and the run stops with 3", async () => {
  // The exact split this guard exists for — measured 2026-08-24, when a worker rejoined mid-run with Edge
  // auto-updated from the pinned build, and fifteen pages were captured under the wrong one.
  const { reported, exits, asked } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_150),
  });

  assert.deepEqual(exits, [3], "a split fleet must stop the run rather than write two builds into one corpus");
  assert.match(reported, /FLEET INCONSISTENT before the run/);
  assert.match(reported, /browserVersion/);
  // LOCATED, not just detected. The values are keyed by worker, so the report names which box is on which
  // build; under the defect they were all keyed `undefined` and there was no report to read at all.
  assert.match(reported, new RegExp(`\\.4=${EDGE_151.replace(/\./g, "\\.")}`));
  assert.match(reported, new RegExp(`\\.5=${EDGE_150.replace(/\./g, "\\.")}`));
  assert.deepEqual(asked, [workerUrl(4), workerUrl(5)], "every configured worker is asked, not just the first");
});

test("a matched fleet still passes", async () => {
  // The other half of the pair. A guard that refused everything would pass the test above and be just as
  // useless, and this is the control that says the new shape did not turn the check into a blanket refusal.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_151),
    [workerUrl(6)]: () => health(EDGE_151),
  });

  assert.deepEqual(exits, [], "a matched fleet must not stop the run");
  assert.equal(reported, "", "and must not print a split it does not have");
});

test("the raw /health payload the guard used to pass is still read as agreement", async () => {
  // THE OPEN-CHECK FROM THE ROW, kept as a test: the same two guests, in the two shapes. Passed raw — as
  // this caller did — `fleetConsistency` has no `worker` to key by, both values land on `undefined`, the
  // set has one member and a 151/150 split reads as `consistent: true`. This is not a demand on
  // `fleetConsistency` (whose job the shape is, is a separate row); it is the reason the caller must name
  // its guests, and it fails the day that stops being true.
  const raw = fleetConsistency([health(EDGE_151), health(EDGE_150)] as never);
  assert.equal(raw.consistent, true, "if this ever reads false, the callee learned to defend itself — say so on #2018");

  const { exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_150),
  });
  assert.deepEqual(exits, [3], "and the guard must reach the opposite verdict over the identical two guests");
});

test("a worker that does not answer contributes no mismatch", async () => {
  // Unreachable is not INCONSISTENT: a box that is asleep contributes no evidence, and treating silence as
  // a fault is how a check earns a reputation for crying wolf. Pinned because the fix rewrote the `catch`
  // that makes it true — and because a guard that exits 3 on a sleeping box is a guard operators disable.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => { throw new Error("ECONNREFUSED"); },
    [workerUrl(6)]: () => health(EDGE_151),
  });

  assert.deepEqual(exits, [], "a silent worker is not a split fleet");
  assert.equal(reported, "");
});

test("one guest left standing is not a split fleet", async () => {
  // `fleetConsistency` calls fewer than two guests trivially consistent, and that must survive the shaping:
  // a single reachable box has nothing to disagree with, however many workers were configured.
  const { exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => { throw new Error("ECONNREFUSED"); },
  });
  assert.deepEqual(exits, []);
});
