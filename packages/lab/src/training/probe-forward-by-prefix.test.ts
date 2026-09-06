/**
 * `captureOptions()`'s catch-all `probe*`-by-prefix forward (architecture-audit.md §5's residual item)
 * has to satisfy two things at once: it must not move a single existing capture's cache key, and it must
 * actually forward a probe field this function does not name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureOptions, NAMED_PROBE_FLAGS } from "./capture-screenreader-dataset.mjs";
import { CASES } from "./case-matrix.mjs";

test("the real corpus uses no probe* field outside the named list -- the fix moves zero cache keys today", () => {
  // If this ever fails, it is not a bug in the fix: it means a case now legitimately uses a NEW probe
  // field, which the catch-all will correctly forward for the first time -- and that IS a cache-key
  // change, deliberately, for exactly the cases that ask for it. This test exists so that change is
  // seen and decided rather than arriving silently underneath a routine case-matrix edit.
  const unnamed = new Set<string>();
  for (const testCase of CASES as Record<string, unknown>[]) {
    for (const key of Object.keys(testCase)) {
      if (key.startsWith("probe") && !NAMED_PROBE_FLAGS.has(key)) unnamed.add(key);
    }
  }
  assert.deepEqual([...unnamed], [],
    `case-matrix.mjs now declares probe* field(s) outside NAMED_PROBE_FLAGS: ${[...unnamed].join(", ")}. `
    + "This will change the cache key for every case using them -- confirm that is intended (a real, "
    + "new probe) before recapturing, and add the name to NAMED_PROBE_FLAGS once it is a first-class "
    + "field this function documents explicitly.");
});

test("every case's captureOptions() is unchanged by the catch-all -- sampled, not assumed", () => {
  // Vacuity guard for the sample itself.
  assert.ok(CASES.length >= 100, `only ${CASES.length} cases on disk -- sample too small to mean anything`);
  // The catch-all can only ever ADD keys already excluded by NAMED_PROBE_FLAGS -- proven directly rather
  // than diffed against a pre-fix snapshot, since none exists to diff against.
  for (const testCase of CASES.slice(0, 200) as Record<string, unknown>[]) {
    const options = captureOptions(testCase);
    const extra = Object.keys(options).filter((key) => key.startsWith("probe") && !NAMED_PROBE_FLAGS.has(key));
    assert.deepEqual(extra, [],
      `case ${(testCase as { id?: string }).id ?? "?"}: captureOptions() now includes unnamed probe `
      + `field(s) ${extra.join(", ")} -- see the corpus-wide test above for whether that is expected`);
  }
});

test("a probe field NOT in the named list is still forwarded -- the capability this fix adds", () => {
  const withNovelProbe = captureOptions({ task: "t", probeElementsList: true }) as Record<string, unknown>;
  assert.equal(withNovelProbe.probeElementsList, true,
    "a probe* field this function does not name by hand must still reach the request body, or a future "
    + "probe added to a case will silently never reach the worker -- the exact architecture-audit.md §5 "
    + "defect this fix exists to close");
});

test("a falsy unnamed probe field is still omitted -- the cache-key convention extends to the catch-all", () => {
  const withFalsyProbe = captureOptions({ task: "t", probeElementsList: false });
  assert.ok(!("probeElementsList" in withFalsyProbe),
    "an unnamed probe field that is false/absent must be OMITTED, not sent as false -- sending it would "
    + "re-key every case that does not use it, the exact recapture the omit-when-false convention "
    + "(comments on the ten named fields) exists to prevent");
});

test("the ten named fields keep their own omit-when-false behaviour, unaffected by the catch-all", () => {
  const bare = captureOptions({ task: "t" });
  for (const field of ["probeFocus", "probeOrder", "probeDialog", "probeFocusReveal", "probeArrows",
    "probeTyping", "probeFocusContext", "probeNavigation"]) {
    assert.ok(!(field in bare), `${field} must be omitted when the case does not set it`);
  }
  // probeForms/probeTables are the two ALWAYS-present fields, by design (present since before the
  // omit-when-false convention existed) -- `undefined` here, not absent, which is what an untouched case
  // has always produced.
  assert.equal(bare.probeForms, undefined);
  assert.equal(bare.probeTables, undefined);
});
