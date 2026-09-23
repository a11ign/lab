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
import { fleetConsistency, MUST_MATCH, REPORTED_ONLY } from "@a11ign/worker-fleet/fleet-consistency";

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
  // #2170: a gate since the fleet converged on the pin. `v24.20.0` is the pinned value
  // (`worker_node_version`, the worker role's `defaults/main.yml`) and what all ten guests reported at
  // 2026-09-23T18:02Z -- a fixture on some other build would be a fleet that does not exist.
  nodeVersion: "v24.20.0",
};

const health = (browserVersion: string,
  { omit = [] as string[], with: extra = {} as Record<string, unknown> } = {}) => ({
  ok: true, screenReader: "nvda", busy: false, code: "abc1234",
  // `with` adds a field the fixture does not carry — #2063's reported-only fields, which this object
  // deliberately does NOT hold by default: they are absent on every deployed worker, so a fixture that
  // supplied them would test the guard against a fleet that does not exist yet.
  environment: Object.fromEntries(Object.entries({ ...ENVIRONMENT, browserVersion, ...extra })
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

// --- #2063: THE REPORTED-ONLY CHANNEL REACHES NO GATE, which is the ruling's most losable clause ---

test("#2063: a fleet split on a REPORTED_ONLY field is NOT refused, and the guard is silent", async () => {
  // `ceo`'s ruling on #2063: a reported-only field "is NOT a capture gate, and this row must not make it
  // one in its first step."
  //
  // THE SUBJECT IS `displayAdapter` AND IT USED TO BE `nodeVersion` (#2170). That is not a cosmetic
  // re-pointing: `nodeVersion` graduated to `MUST_MATCH` once the fleet converged on the pin, so driving
  // this clause with it would now assert the OPPOSITE of what the file below asserts, and the ruling's
  // exemption would silently lose its only guard. `displayAdapter` is the remaining member and cannot
  // graduate -- its values differ by HARDWARE (`Intel(R) UHD Graphics 630` on nine guests,
  // `Intel(R) HD Graphics 630` on the tenth), which no provisioning run converges.
  //
  // ASSERTED IN THIS FILE because the claim is about THIS function's behaviour: `fleet-consistency.test.ts`
  // can pin that the field is in neither gating channel, and only a test beside the guard can pin that the
  // guard therefore returns. The two gating channels are `mismatches` (the browser-split refusal) and
  // `fields.coverage` (#2047's, which exits on `reported < asked` for EVERY row, not only MUST_MATCH ones).
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151, { with: { displayAdapter: "Intel(R) UHD Graphics 630" } }),
    [workerUrl(5)]: () => health(EDGE_151, { with: { displayAdapter: "Intel(R) HD Graphics 630" } }),
  });

  assert.deepEqual(exits, [], "a reported-only split must not stop a capture run");
  assert.equal(reported, "",
    "and must not print a refusal it is not making — this guard's takeaway is whether it returns, and a "
    + "warning here would read as one");

  // THE POSITIVE CONTROL, in the same shape: the SAME two guests, split on a field that IS a gate.
  // Without it, the silence above is satisfied by a guard that refuses nothing at all.
  const split = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151, { with: { displayAdapter: "Intel(R) UHD Graphics 630" } }),
    [workerUrl(5)]: () => health(EDGE_150, { with: { displayAdapter: "Intel(R) UHD Graphics 630" } }),
  });
  assert.deepEqual(split.exits, [EXIT_FLEET_INCONSISTENT]);
});

test("#2170: nodeVersion NOW refuses a split fleet, and a converged one still runs", async () => {
  // THE FIELD THAT GRADUATED, and both directions, because an exclusion assertion alone passes on a
  // comparison that compares nothing -- which is exactly what the test above used to assert about this
  // same field. Step 3 of `ceo`'s ruling on #2063: report it, pin provisioning so the fleet converges,
  // and only then may it gate. The fleet converged at 2026-09-23T18:02Z, 10 of 10 on v24.20.0 read off
  // the guests' own `/health`.
  const split = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151, { with: { nodeVersion: "v24.19.0" } }),
    [workerUrl(5)]: () => health(EDGE_151, { with: { nodeVersion: "v24.20.0" } }),
  });
  assert.deepEqual(split.exits, [EXIT_FLEET_INCONSISTENT],
    "the 5/5 split this fleet actually ran until 18:02Z would now stop a capture run");
  assert.match(split.reported, /nodeVersion/,
    "and it is NAMED, so the operator is sent to the runtime rather than to a bare refusal");

  // THE OTHER DIRECTION, and it is not the same assertion twice: a gate that refused the CONVERGED fleet
  // would stop every capture in the project, which is the harm the ruling's ordering exists to prevent.
  // The fixture already carries the pinned value on both guests.
  const converged = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_151),
  });
  assert.deepEqual(converged.exits, [], "a fleet agreeing on the pinned runtime runs");
});

test("#2170: a guest that stops REPORTING nodeVersion refuses the run, at any coverage", async () => {
  // DONE-WHEN 3 OF #2170, asserted rather than discovered. Joining `MUST_MATCH` buys a second refusal
  // for free -- #2047 made `fields.coverage` a gate as well, so `fieldCoverageGaps` exits on
  // `reported < asked` -- and that is the intended behaviour at this step: a guest rolled back to a
  // worker build that does not report its runtime is a guest whose corpus records cannot say what
  // produced them, which is the whole reason the field is here.
  const nobody = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151, { omit: ["nodeVersion"] }),
    [workerUrl(5)]: () => health(EDGE_151, { omit: ["nodeVersion"] }),
  });
  assert.deepEqual(nobody.exits, [EXIT_FLEET_INCONSISTENT], "0 of 2 reporting it stops the run");
  assert.match(nobody.reported, /nodeVersion \(0 of 2 reported it\)/);

  // AND AT PARTIAL COVERAGE, which is the rolling-deploy reading and the one a field in the third channel
  // is explicitly exempt from. `reported < asked` gates at ANY count, so 1 of 2 refuses too -- and that
  // is the difference the move actually makes, stated where somebody re-reading the channels can see it.
  const partial = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_151, { omit: ["nodeVersion"] }),
  });
  assert.deepEqual(partial.exits, [EXIT_FLEET_INCONSISTENT], "1 of 2 reporting it stops the run too");
  assert.match(partial.reported, /nodeVersion \(1 of 2 reported it\)/);
});

test("#2063: a REPORTED_ONLY field reported by 0 of N does not refuse either, at ANY coverage", async () => {
  // The clause that would be lost by accident rather than on purpose. `displayAdapter` is reported by NO
  // deployed worker, so routing it through `fields.coverage` -- the obvious place, and the one #2047 just
  // made a refusal -- would stop EVERY capture in the project immediately, including #1926's recapture.
  // That is precisely the harm the ruling forbids, reached by a filing mistake instead of a decision.
  //
  // The fixture omits every REPORTED_ONLY field, so this fleet is 0-of-2 on `displayAdapter` — which was
  // the live fleet's own state for the adapter until the worker carrying it was deployed. `nodeVersion`
  // was the other member and is a `MUST_MATCH` field since #2170, so it is in the fixture now and the
  // test above is where its 0-of-N refusal is pinned; this one is down to one field on purpose.
  const { reported, exits } = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151),
    [workerUrl(5)]: () => health(EDGE_151),
  });
  assert.deepEqual(exits, [], "a reported-only field nobody reports must not refuse a run");
  assert.equal(reported, "");

  // AND ITS CONTROL, one field over: a MUST_MATCH field at 0 of 2 DOES refuse. The pair is what separates
  // "this channel is exempt" from "the coverage rule stopped working".
  const gap = await runGuard({
    [workerUrl(4)]: () => health(EDGE_151, { omit: ["displayMode"] }),
    [workerUrl(5)]: () => health(EDGE_151, { omit: ["displayMode"] }),
  });
  assert.deepEqual(gap.exits, [EXIT_FLEET_INCONSISTENT]);
  assert.match(gap.reported, /displayMode \(0 of 2 reported it\)/);
});

test("#2063: no REPORTED_ONLY field is also a MUST_MATCH field, or the exemption is a contradiction", () => {
  // The two lists are the gate and the not-gate, so a field on both would be refused and exempted at once
  // -- and `fleetConsistency` would answer from whichever list it read first, which is not a decision
  // anybody made. #2170 is the row that MOVES a field between them; nothing should ever hold it in both.
  const onBoth = REPORTED_ONLY.map(({ path }) => path)
    .filter((path) => MUST_MATCH.some((field) => field.path === path));
  assert.deepEqual(onBoth, [], "a field cannot be both a capture gate and exempt from every gate");

  // The positive control: both lists are non-empty, so the intersection above is a real emptiness rather
  // than an artefact of one list having gone missing.
  assert.ok(MUST_MATCH.length > 0 && REPORTED_ONLY.length > 0);
});
