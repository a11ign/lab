/**
 * Every probe a case asks for must survive the trip to the manifest — and to the capture request.
 *
 * This exists because the same defect happened THREE times inside one feature, in one session. Adding
 * `probeFocus` needed it forwarded at three hops that each enumerate case fields by hand:
 *
 *   `pair()` in case-matrix.mjs        builds the case
 *   generate-screenreader-dataset.mjs  writes the manifest
 *   capture-screenreader-dataset.mjs   builds the capture request FROM THE MANIFEST
 *
 * Two were done and the middle one missed. Because the runner reads the manifest rather than `CASES`, the
 * flag arrived as `undefined`, the focus probe never ran, and both captures came back with an empty
 * `focusOrder` and no diagnostic — a case asking for a probe and being silently ignored. Nothing failed;
 * the capture simply carried no evidence, which is indistinguishable from a page that had none.
 *
 * `pair()` already carried a scar comment about this exact shape happening to `alsoFails`: "a case declaring
 * `alsoFails` without this line is silently dropped -- which it was, and the count read 0 while three case
 * definitions carried it". A third instance means the answer is a guard, not a third careful edit.
 *
 * Asserted over `probe*` by PREFIX rather than a list of names, so a fourth probe is covered the day it is
 * added rather than the day somebody remembers this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CASES } from "./case-matrix.mjs";
import { cacheKey } from "./capture-cache.mjs";
import { datasetRoot } from "../dataset-paths.mjs";

const MANIFEST = resolve(datasetRoot(), "manifest.json");
const probeFlags = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith("probe")));

test("at least one case asks for each probe, or the flag is decoration", () => {
  // A flag no case sets cannot be shown to work, and this suite would pass over it in silence.
  const asked = new Set<string>();
  for (const testCase of CASES as Array<Record<string, unknown>>) {
    for (const [flag, value] of Object.entries(probeFlags(testCase))) if (value === true) asked.add(flag);
  }
  for (const flag of ["probeForms", "probeTables", "probeFocus"]) {
    assert.ok(asked.has(flag), `no case sets ${flag}: it cannot be validated, and a capture will never run it`);
  }
});

test("the manifest carries every probe flag its case declares", () => {
  if (!existsSync(MANIFEST)) {
    // Skips LOUDLY rather than passing quietly, the same rule the pre-push hook follows for `runs/`.
    console.log(`  SKIPPED: no manifest at ${MANIFEST} — run \`npm run training:generate\` to cover this`);
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { cases: Array<Record<string, unknown>> };
  const byId = new Map(manifest.cases.map((c) => [c.id as string, c]));

  const dropped: string[] = [];
  let compared = 0;
  for (const testCase of CASES as Array<Record<string, unknown>>) {
    const entry = byId.get(testCase.id as string);
    if (!entry) continue; // a case added since the last generate; the count test above is not this test's job
    for (const [flag, value] of Object.entries(probeFlags(testCase))) {
      if (value === true) compared += 1;
      if (entry[flag] !== value) dropped.push(`${testCase.id}.${flag}: case=${value} manifest=${entry[flag]}`);
    }
  }

  // The `continue` above is the whole risk. A manifest whose ids no longer match — a rename, a regenerate
  // against a different case list — skips EVERY case, leaves `dropped` empty, and passes having compared
  // nothing. That is the exact shape this file was written about: a probe silently not running looks
  // identical to a page with nothing to report. Measured 764 probe-asking cases when this was added.
  assert.ok(compared >= 100,
    `only ${compared} probe flags were compared against the manifest (${byId.size} entries, ${CASES.length} `
    + "cases) — the ids have stopped matching, so this test is passing over an unexamined manifest");

  assert.deepEqual(dropped, [],
    "a probe a case asked for did not reach the manifest, so the capture will silently not run it");
});

test("the capture runner reads every probe flag out of the manifest", () => {
  // The third hop, checked as SOURCE rather than behaviour because running it needs a live worker. Weaker
  // than the round-trip above and still worth having: this is the hop that was missed.
  const runner = readFileSync(
    resolve(process.cwd(), "packages/lab/src/training/capture-screenreader-dataset.mjs"), "utf8");
  for (const flag of ["probeForms", "probeTables", "probeFocus"]) {
    assert.match(runner, new RegExp(`${flag}:\\s*testCase\\.${flag}`),
      `capture-screenreader-dataset.mjs never forwards ${flag} to the capture request`);
  }
});

test("a probe flag that is FALSE must not change the capture cache key", () => {
  // Nearly a full recapture. `captureOptions()` IS the cache key, and `JSON.stringify` omits an `undefined`
  // property while serialising `false` — so the moment the generator began writing `probeFocus` explicitly,
  // an unconditional `probeFocus: testCase.probeFocus` changed the key for all 1,061 cases that do not use
  // the probe. Measured at the time: e511cc88941f207a became b50b03e6e7be45b0. That is 2,122 captures and
  // hours of fleet time spent recording nothing new.
  //
  // The rule this encodes: a flag only belongs in the key when it is actually SENT, and absent must equal
  // false, which is what `capture-core`'s `!!opts.probeFocus` already assumes.
  // A REAL environment field. This said `{ os: "win" }`, which `environmentKey` never reads -- it DERIVES
  // `os` from `windowsVersion` and `architecture`. Harmless here, since all three keys shared it and the
  // assertions are about options, but a fixture naming a field the code ignores is the sort of thing a
  // later reader copies into a test where it matters.
  const shared = { caseId: "c", pageHash: "p", environment: { windowsVersion: "10.0.26100", architecture: "x64" } };
  const options = (extra: Record<string, unknown>) =>
    ({ task: "t", steps: 150, probeForms: false, probeTables: false, ...extra, reuseScreenReader: true });

  const absent = cacheKey({ ...shared, options: options({}) });
  const explicitlyFalse = cacheKey({ ...shared, options: options({ probeFocus: false }) });
  const explicitlyTrue = cacheKey({ ...shared, options: options({ probeFocus: true }) });

  assert.notEqual(explicitlyFalse, absent,
    "sanity: a serialised false DOES change the key — which is why captureOptions must omit it");
  assert.notEqual(explicitlyTrue, absent, "asking for a probe is different evidence and must re-key");
});

test("captureOptions omits a falsy probe flag rather than sending it", () => {
  // Source-level, because the function is not exported and the behaviour above is what matters. Checks the
  // spread form is present and the unconditional form is not.
  const runner = readFileSync(
    resolve(process.cwd(), "packages/lab/src/training/capture-screenreader-dataset.mjs"), "utf8");
  assert.match(runner, /\.\.\.\(testCase\.probeFocus \? \{ probeFocus: true \} : \{\}\)/,
    "probeFocus must be spread in only when true, or every non-focus case re-keys");
});

/**
 * THE SAME ROUND TRIP ON THE ACCEPTANCE PATH, which had the identical defect and no guard.
 *
 * The header above records the corpus hops and says the answer to a third instance "is a guard, not a
 * third careful edit". The guard was written for one of two pipelines. The acceptance path has the same
 * three-hop shape —
 *
 *   `pair()` in acceptance-matrix.mjs        builds the case
 *   generate-screenreader-acceptance.mjs     writes the manifest
 *   capture-screenreader-dataset.mjs         builds the capture request FROM THE MANIFEST
 *
 * — and BOTH of its first two hops enumerated `probeForms` and `probeTables` by name. Measured
 * 2026-09-05: seven corpus subtypes had no held-out acceptance coverage, and the reason was not that
 * nobody had written the cases. They could not be written. 3.2.1 and 3.2.2 were among them, and their
 * mapping was downgraded that same day — so the gate was blind to the two heads whose behaviour had just
 * moved.
 *
 * A fix reaching one call site when the behaviour reaches several is this repo's most expensive recurring
 * shape, and this is its fourth instance INSIDE the feature whose own comment records the first three.
 */
test("an acceptance case's probe flags survive to the manifest, not just probeForms and probeTables", async () => {
  const { ALL_ACCEPTANCE_CASES } = await import("./acceptance-matrix.mjs") as unknown as {
    ALL_ACCEPTANCE_CASES: Array<Record<string, unknown>>;
  };

  // The flags a case can ask for are discovered from the CORPUS, which is the side that has always
  // forwarded them all -- so a new probe is covered here the day it is added rather than the day somebody
  // remembers this file. Asserting against a hand-written list is the defect one layer out.
  const known = new Set<string>();
  for (const c of CASES as Array<Record<string, unknown>>) {
    for (const k of Object.keys(probeFlags(c))) known.add(k);
  }
  assert.ok(known.size > 2, `expected the corpus to exercise more than probeForms/probeTables, got ${[...known]}`);

  // Every probe an acceptance case sets must be a real flag, and must survive `pair()`.
  const asked = new Set<string>();
  for (const c of ALL_ACCEPTANCE_CASES) {
    for (const [flag, value] of Object.entries(probeFlags(c))) if (value === true) asked.add(flag);
  }
  const unknown = [...asked].filter((f) => !known.has(f)).sort();
  assert.deepEqual(unknown, [],
    `acceptance cases ask for probes no corpus case uses, so nothing proves they work: ${unknown.join(", ")}`);

  // THE ASSERTION THAT WOULD HAVE CAUGHT IT: a probe beyond the two that were hardcoded must reach the
  // case object. Before the fix this set was empty however many probes a case declared.
  const beyondTheHardcodedTwo = [...asked].filter((f) => f !== "probeForms" && f !== "probeTables");
  assert.ok(beyondTheHardcodedTwo.length > 0,
    "no acceptance case carries a probe other than probeForms/probeTables. Either none needs one -- in "
    + "which case seven subtypes are still unmeasurable -- or `pair()` has gone back to enumerating them.");
});
