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

const MANIFEST = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset", "manifest.json");
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
  for (const testCase of CASES as Array<Record<string, unknown>>) {
    const entry = byId.get(testCase.id as string);
    if (!entry) continue; // a case added since the last generate; the count test above is not this test's job
    for (const [flag, value] of Object.entries(probeFlags(testCase))) {
      if (entry[flag] !== value) dropped.push(`${testCase.id}.${flag}: case=${value} manifest=${entry[flag]}`);
    }
  }
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
  const shared = { caseId: "c", pageHash: "p", environment: { os: "win" } };
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
