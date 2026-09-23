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

import { assertOneBrowserAcross, EXIT_FLEET_INCONSISTENT } from "./capture-fleet-guard.mjs";
import { fleetConsistency, MUST_MATCH } from "@a11ign/worker-fleet/fleet-consistency";

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
 *
 * IT REPORTS EVERY `MUST_MATCH` FIELD, AND IT DID NOT USED TO (#2047). The six it named were the fields
 * that existed when #2018 wrote it, and four have been added since — so under the coverage rule this
 * fixture IS a 0-of-N fleet, and every test below would have refused for a reason none of them is about.
 * Derived from `MUST_MATCH` rather than listed, because a hand-written list is what silently decayed:
 * a field added tomorrow joins the fully-reporting fixture on its own, and the control below keeps
 * meaning "everything was asked" instead of "everything as of the day this was typed".
 *
 * `omit` is how a test builds the gap it is about, one named field at a time.
 */
const ENVIRONMENT: Record<string, unknown> = {
  browserVersion: "", screenReaderVersion: "2026.1.1", guidepupVersion: "0.31.0",
  windowsVersion: "Microsoft Windows 11 Pro 10.0.22621", architecture: "arm64", captureProtocol: 2,
  browserProfile: "adopted", screenReaderSettings: "sha256:9f2c84c2", provisionRevision: "r41",
  // The PIN and the DESKTOP are two fields with the same value here on purpose: #1561 pins the window to
  // exactly what the fleet's display mode holds, so a fixture where they differed would be a fleet that
  // does not exist. `fleet-consistency.test.ts` is where the case that they CAN differ is pinned.
  displayMode: "1024x768", windowSize: "1024x768",
};

const health = (browserVersion: string, { omit = [] as string[] } = {}) => ({
  ok: true, screenReader: "nvda", busy: false, code: "abc1234",
  environment: Object.fromEntries(Object.entries({ ...ENVIRONMENT, browserVersion })
    .filter(([field]) => !omit.includes(field))),
});

test("the fixture reports every MUST_MATCH field, so the control below means what it says", () => {
  // THE CONTROL'S OWN CONTROL. "a fully-reporting fleet still passes" is only a positive control while the
  // fixture is fully reporting, and the six-field version of it stopped being so without a single test
  // failing — the coverage question did not exist yet to notice. This is the assertion that fails on the
  // day a tenth-plus field is added, instead of the whole file quietly starting to test something else.
  //
  // ITS POSITIVE CONTROL IS THE `omit` PAIR BELOW — "a field no guest reports stops the run" and its
  // k-of-N sibling both build their fleet by taking a field back OUT of this same object, so a
  // `MUST_MATCH` entry missing here is demonstrably the thing that makes the guard refuse. An empty list
  // means every field is present, and those two tests are what prove the list can be non-empty.
  const missing = MUST_MATCH.map(({ path }) => path).filter((path) => !(path in ENVIRONMENT));
  assert.deepEqual(missing, [],
    "add the new MUST_MATCH field to ENVIRONMENT — until you do, every fixture here is a coverage gap");
});

const EDGE_151 = "151.0.4129.59";
const EDGE_150 = "150.0.4078.105";

/**
 * Drive the guard with a stubbed probe, recording what it reported and whether it tried to exit.
 *
 * `waivers` go THROUGH the guard, which is the half of #2047 a caller-side test could not reach: the
 * overrides used to be an `if (ALLOW) return;` in `capture-real-pages.mjs`, a module this test may not
 * import (its closure reaches the corpus, so the acceptance job refuses it). An override exercised only
 * at a call site CI cannot load is an override nothing tests.
 */
async function runGuard(byWorker: Record<string, () => unknown>,
  waivers: { allowMixedBrowsers?: boolean, allowUncheckedFields?: boolean } = {}) {
  const reported: string[] = [];
  const exits: number[] = [];
  const asked: string[] = [];
  await assertOneBrowserAcross(Object.keys(byWorker), "before the run", {
    ...waivers,
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

// --- #2047: THE GUARD READ `consistent` ALONE, SO A FIELD NOBODY REPORTED WAS AGREEMENT ---
//
// The sixth pass of this family and the first in the GATE. `fleetConsistency` skips an absent value
// rather than calling it a mismatch, so a field no guest answers produces no mismatches, `consistent` is
// true, and it is indistinguishable from a field every guest agreed on. #1997 and #2019 fixed that in
// `fleet:status`' headline; this caller kept reading the boolean and threw `verdict.fields` away.
//
// Measured 2026-09-22T23:5xZ on the live fleet: ten guests, `displayMode` at 0 of 10, `fleet:status`
// saying UNKNOWN and this guard returning silently on the same boxes — which per #1955 genuinely ran two
// display modes that day. Both arms of `fieldCoverageGap`'s rule are pinned below, because a gate that
// caught only the 0-of-N half would be looser than the headline it quotes.

test("a MUST_MATCH field NO guest reports stops the run, named with its reporter count", async () => {
  // #1997's half, in the gate. Three guests agreeing on every field they DO report, and none of them
  // asked about the display — the shape the live fleet was in.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151, { omit: ["displayMode"] }),
    [workerUrl(5)]: () => health(EDGE_151, { omit: ["displayMode"] }),
    [workerUrl(6)]: () => health(EDGE_151, { omit: ["displayMode"] }),
  });

  assert.deepEqual(exits, [EXIT_FLEET_INCONSISTENT],
    "a field nobody was asked about must stop the run, not read as agreement");
  // NAMED WITH ITS COUNT, never counted: `0 of 3` tells the reader the field is missing everywhere and
  // sends them to the field, which "1 field was not compared" does not.
  assert.match(reported, /displayMode \(0 of 3 reported it\)/);
  assert.match(reported, /FLEET COVERAGE UNKNOWN before the run/);
  // And it must not be reported as the thing it is not. A coverage hole is not a split.
  assert.doesNotMatch(reported, /FLEET INCONSISTENT/,
    "never asked and does not agree are different findings with different remedies");
});

test("a MUST_MATCH field only SOME guests report stops the run too", async () => {
  // #2019's half: `k of N` is a gap as much as `0 of N`, and a gate that took one guest's word for ten
  // would be the looser rule the headline stopped drawing. One box reports the display; two do not.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_151, { omit: ["displayMode"] }),
    [workerUrl(6)]: () => health(EDGE_151, { omit: ["displayMode"] }),
  });

  assert.deepEqual(exits, [EXIT_FLEET_INCONSISTENT],
    "one guest reporting a field is not the fleet having been asked");
  // `1 of 3`, not `0 of 3` — the count is what sends the reader to the BOXES rather than to the field.
  assert.match(reported, /displayMode \(1 of 3 reported it\)/);
});

test("a fully-reporting, agreeing fleet still returns silently", async () => {
  // THE POSITIVE CONTROL, and the one this fix could most easily have broken: a coverage rule applied to
  // a fixture that never reported everything would refuse every fleet, and both tests above would pass.
  // `assert.equal(reported, "")` is the whole point — silence, not a warning that happens not to exit.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_151),
    [workerUrl(6)]: () => health(EDGE_151),
  });

  assert.deepEqual(exits, [], "a fleet that agrees and was fully asked must not stop the run");
  assert.equal(reported, "", "and must not report a gap it does not have");
});

test("--allow-unchecked-fields waives the coverage refusal, loudly, through the guard", async () => {
  // Exercised THROUGH the guard rather than through a caller-side wrapper, which is the ruling's own
  // requirement: `capture-real-pages.mjs` cannot be imported here, so an override applied there is one no
  // CI job can reach — the way #2018's check shipped unable to fire in the first place.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151, { omit: ["displayMode"] }),
    [workerUrl(5)]: () => health(EDGE_151, { omit: ["displayMode"] }),
    [workerUrl(6)]: () => health(EDGE_151, { omit: ["displayMode"] }),
  }, { allowUncheckedFields: true });

  assert.deepEqual(exits, [], "the waiver must let the run proceed");
  // SILENT IS NOT AN OPTION HERE (#1989). This path writes no structured run record, so the waiver's own
  // output is the only trace that a corpus was taken without asking — it has to name the field and the
  // count, or the operator who reads the log later cannot tell what went unasked.
  assert.match(reported, /--allow-unchecked-fields/);
  assert.match(reported, /displayMode \(0 of 3 reported it\)/);
});

test("the k-of-N gap is waived by the same flag, and still names its count", async () => {
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_151, { omit: ["displayMode"] }),
    [workerUrl(6)]: () => health(EDGE_151, { omit: ["displayMode"] }),
  }, { allowUncheckedFields: true });

  assert.deepEqual(exits, []);
  assert.match(reported, /displayMode \(1 of 3 reported it\)/);
});

test("--allow-mixed-browsers does NOT waive the coverage refusal", async () => {
  // THE FOLD THE RULING REFUSED, pinned. The two waivers say different things — one is *the guests differ
  // and I accept it*, the other is *the guests were never asked* — and while `--allow-mixed-browsers` was
  // a call-site `if (ALLOW_MIXED) return;` it waived both, because skipping the call and waiving the
  // check were the same act. A fleet that is BOTH split and unasked must still stop for the second.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151, { omit: ["displayMode"] }),
    [workerUrl(5)]: () => health(EDGE_150, { omit: ["displayMode"] }),
  }, { allowMixedBrowsers: true });

  assert.deepEqual(exits, [EXIT_FLEET_INCONSISTENT],
    "accepting a browser split must not silently accept a display nobody was asked about");
  assert.match(reported, /--allow-mixed-browsers/, "the browser split is waived, and says so");
  assert.match(reported, /displayMode \(0 of 2 reported it\)/, "and the coverage gap still refuses");
});

test("--allow-mixed-browsers still waives the split it is for", async () => {
  // The other direction, so the test above cannot pass by the flag having stopped working altogether.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_150),
  }, { allowMixedBrowsers: true });

  assert.deepEqual(exits, [], "a waived browser split on a fully-reporting fleet proceeds");
  assert.match(reported, /--allow-mixed-browsers/);
  assert.doesNotMatch(reported, /FLEET INCONSISTENT/);
});

test("one guest left standing is not a coverage gap either", async () => {
  // `fleetConsistency` returns empty coverage for fewer than two guests, and that must read as "not a
  // question yet" rather than as "nothing was asked". A single box has nobody to be interchangeable
  // with, so refusing it would take the fleet offline for having one worker awake — the crying-wolf
  // failure the unreachable-guest rule above exists to avoid, arriving through the new axis.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151, { omit: ["displayMode"] }),
    [workerUrl(5)]: () => { throw new Error("ECONNREFUSED"); },
  });

  assert.deepEqual(exits, []);
  assert.equal(reported, "");
});
