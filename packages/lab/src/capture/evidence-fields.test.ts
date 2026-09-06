import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { EVIDENCE_FIELDS } from "./evidence-diff.mjs";
import { runsRoot } from "../dataset-paths.mjs";

/**
 * `evidence:check` DECIDES WHETHER 2,122 CACHED CAPTURES SURVIVE, and it compares a hand-written list of
 * fields. A field a criterion reads but this list omits makes the gate report SAME for a change that
 * altered the evidence — the most expensive wrong answer this tool can give.
 *
 * It has already happened once, at a sibling tool, and CLAUDE.md records it: "`repeat-capture` compared
 * ten fields and not `formChanges` or `postSubmitFields` — the two carrying interaction evidence. Ten
 * fields watched, and the ones this fault lives in were not among them."
 *
 * Then again here. `routeChange` — the declared channel for 2.4.1 and 2.4.2, the single-page-app
 * transition a static analyser structurally cannot reach — and `postSubmitNames` were both absent, while
 * capture-core's own protocol note says criteria read the latter.
 *
 * So the list is checked against what captures ACTUALLY carry, rather than against anyone's memory.
 */
/**
 * Fields deliberately not compared, each with the reason. Anything else new must be classified, which is
 * the point: a field arriving with no decision attached fails this test rather than being ignored.
 */
const NOT_EVIDENCE: Record<string, string> = {
  "interaction.navigatedOnSubmit": "a boolean about what the PROBE did, not what NVDA announced; it "
    + "flips with probe order rather than with the page, so comparing it would report drift for a change "
    + "in how the capture was driven",
};

/** Every `structure.*` / `interaction.*` key present across the captures on disk. */
function fieldsOnDisk(): Set<string> {
  const runs = runsRoot();
  const found = new Set<string>();
  if (!existsSync(runs)) return found;
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      // `rejected/` holds captures the pipeline REFUSED — self-contradictory ones kept for diagnosis, not
      // evidence. Counting them here made this file report a field as "arrived" on the strength of a
      // capture that was thrown away, which is the same class as reading the wrapper as the capture.
      // Found 2026-09-01 when the PENDING retirement guard fired on three rejected attempts.
      if (entry.isDirectory()) { if (entry.name !== "rejected") walk(path); continue; }
      if (!entry.name.endsWith(".json")) continue;
      let capture: Record<string, Record<string, unknown>>;
      try {
        capture = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        continue;
      }
      for (const group of ["structure", "interaction"]) {
        for (const key of Object.keys(capture?.[group] ?? {})) found.add(`${group}.${key}`);
      }
    }
  };
  walk(runs);
  return found;
}

test("every evidence field a capture carries is compared, or explicitly excluded", () => {
  const onDisk = fieldsOnDisk();
  if (onDisk.size === 0) {
    // An honest skip, not a silent pass: `runs/` is gitignored and CI cannot see it.
    assert.ok(true, "no corpus on disk (runs/ is gitignored; local-only gate)");
    return;
  }
  // ANTI-VACUITY. Without it a corpus of one truncated capture would satisfy this test having checked
  // almost nothing — the failure this whole file is about, one level up.
  assert.ok(onDisk.size >= 10,
    `only ${onDisk.size} evidence field(s) found on disk; the capture shape or the corpus has changed`);

  const compared = new Set((EVIDENCE_FIELDS as [string, string][]).map((f) => f.join(".")));
  const unaccounted = [...onDisk].filter((f) => !compared.has(f) && !(f in NOT_EVIDENCE)).sort();
  assert.deepEqual(unaccounted, [],
    "these fields exist on captures and evidence:check neither compares nor excludes them, so a change "
    + `that altered them would report SAME: ${unaccounted.join(", ")}`);
});

test("EVIDENCE_FIELDS names each field ONCE — a duplicate is invisible to the test above", () => {
  // `["interaction", "focusEvents"]` was listed twice for a while, harmlessly in itself (`compared` above
  // is built through a `Set`, so a duplicate collapses before that test ever runs and it examines nothing
  // it did not already examine once). That is exactly backwards: the ONE test built to watch this list
  // could not see a defect inside it. A duplicate costs nothing today and is a real risk the moment two
  // entries for the same field are given DIFFERENT flattening comments describing different behaviour —
  // which one a reader trusts becomes luck.
  const fields = (EVIDENCE_FIELDS as [string, string][]).map((f) => f.join("."));
  const seen = new Set<string>();
  const duplicated = [...new Set(fields.filter((f) => (seen.has(f) ? true : (seen.add(f), false))))].sort();
  assert.deepEqual(duplicated, [], `listed more than once in EVIDENCE_FIELDS: ${duplicated.join(", ")}`);
});

/**
 * Fields declared in code whose first capture does not exist yet, each naming what closes it.
 *
 * THIS ESCAPE EXISTS BECAUSE THE TWO GUARDS HERE ARE MUTUALLY EXCLUSIVE DURING BOOTSTRAP, which is a real
 * gap in them rather than an inconvenience. A field is always written in code before any capture carries
 * it: list it and the phantom check fires, omit it and the sibling check fires the moment the first
 * capture lands. Between a protocol bump and the recapture that follows, neither state is reachable.
 *
 * Deliberately shaped like `NO_FIXTURE` in `signal-predicates-discriminate.test.ts` — a named entry with a
 * reason that says what closes it — because an exemption with no closure condition is where findings go to
 * die, which `gate:probe-order`'s `stale` verdict exists to prevent one layer up.
 *
 * An entry here is WRONG the moment its captures exist: the guard below fails on a pending field that has
 * arrived, so this list cannot quietly outlive its reason.
 */
const PENDING_CAPTURE: Record<string, string> = {
  // EMPTY, and every entry that was ever here was retired BY THIS GUARD rather than by anyone remembering.
  //
  // `arrowNavigation` went when `radio-group-arrows-inert` was captured. `typedFeedback` took three
  // attempts across one day, and the sequence is the useful part: it was listed as "no case uses it"
  // while `validation-live-silent` stayed withdrawn CONTAMINATED; it was briefly deleted when a 3.2.2
  // PROOF case captured it, then restored when that case was removed for being BLIND; and it is gone for
  // good now that 28 shipping `input-context-change-*` cases ask for `probeTyping` as their own evidence.
  //
  // `interaction.focusEvents` (added 2026-09-05, listed here while 2.4.7's F55 detector shipped ahead of
  // its recapture) was retired 2026-09-06 by this exact guard: the protocol-15 recapture landed and
  // `runs/` now carries the field, at which point this test failed with the field's own name rather than
  // needing anyone to remember to delete the entry.
  //
  // Each retired state is different — "nothing can make it fire", "one throwaway made it fire", "a
  // shipping case depends on it", "the recapture that was already scheduled landed" — and the guard
  // distinguished them every time, which is the whole reason an exemption list is worth having rather than
  // a comment.
};

test("nothing is compared that no capture actually carries", () => {
  // The other direction. A field in the list that captures never have compares [] to [] for ever —
  // coverage that looks real and examines nothing, which is how the count in a report becomes a lie.
  const onDisk = fieldsOnDisk();
  if (onDisk.size === 0) return;
  const phantom = (EVIDENCE_FIELDS as [string, string][])
    .map((f) => f.join(".")).filter((f) => !onDisk.has(f) && !(f in PENDING_CAPTURE)).sort();
  assert.deepEqual(phantom, [],
    `these are compared but appear on no capture, so they contribute nothing: ${phantom.join(", ")}`);
});

test("a field waiting for its first capture is removed from PENDING once it arrives", () => {
  // An exemption that outlives its reason is indistinguishable from a bug somebody decided to live with.
  // This fails the moment the capture exists, which is the only thing that makes the list above safe.
  const onDisk = fieldsOnDisk();
  if (onDisk.size === 0) return;
  const arrived = Object.keys(PENDING_CAPTURE).filter((f) => onDisk.has(f)).sort();
  assert.deepEqual(arrived, [],
    "these are listed as awaiting their first capture and captures now carry them — delete the entry, or "
    + `the exemption hides a real phantom later: ${arrived.join(", ")}`);
  for (const [field, why] of Object.entries(PENDING_CAPTURE)) {
    assert.ok(why.includes("Closes when"), `${field}: an exemption must say what closes it`);
  }
});

import { compareCapture } from "./evidence-diff.mjs";

test("a routeChange whose title stopped moving is CHANGED, not SAME", () => {
  // `routeChange` is an OBJECT, and `fieldValues` originally handled arrays only — so listing it without
  // flattening would compare [] to [] for ever: a field that appears covered and examines nothing, which
  // is worse than leaving it out. This is the 2.4.2 failure itself (the route moves, the title does not),
  // so it is the exact difference the gate must not miss.
  const before = { transcript: [], interaction: {
    routeChange: { titleBefore: "Home", titleAfter: "Bookings - Home" } } };
  const after = { transcript: [], interaction: {
    routeChange: { titleBefore: "Home", titleAfter: "Home" } } };
  const verdict = compareCapture(before, after);
  assert.equal(verdict.verdict, "CHANGED", JSON.stringify(verdict));
  assert.ok(verdict.changes.some((c: { field: string }) => c.field === "interaction.routeChange"),
    "the change must be attributed to routeChange by name");
});

test("an identical routeChange is SAME", () => {
  const route = { control: "Bookings, link", titleBefore: "Home", titleAfter: "Bookings - Home" };
  const verdict = compareCapture(
    { transcript: [], interaction: { routeChange: { ...route } } },
    { transcript: [], interaction: { routeChange: { ...route } } });
  assert.equal(verdict.verdict, "SAME", JSON.stringify(verdict));
});


test("a formChanges entry whose announcement vanished is CHANGED, not SAME", () => {
  // The defect this file's object branch was written to fix, one shape along. `String({...})` is
  // "[object Object]", so mapping over a list of objects made every entry identical and compared the list
  // BY COUNT -- in the one gate that decides whether 2,122 cached captures may be kept, on the channel
  // carrying 3.3.1, 4.1.2 and 4.1.3. Measured on the real function before the fix: SAME.
  const mk = (after: string) =>
    ({ interaction: { formChanges: [{ control: "Submit", kind: "submit", after }] } });
  assert.equal(compareCapture(mk("Error: name is required"), mk("")).verdict, "CHANGED");
  assert.equal(compareCapture(mk("Error: name is required"), mk("Error: name is required")).verdict, "SAME");
});

test("reordering an entry's KEYS is not an evidence change", () => {
  // Keys are sorted before joining, so a field-order change in capture-core cannot read as the page
  // announcing something different. Without the sort this gate would demand a recapture for a refactor,
  // and a gate that cries wolf is one people pass `--allow` to.
  const a = { interaction: { stateChanges: [{ control: "Menu", before: "collapsed", after: "expanded" }] } };
  const b = { interaction: { stateChanges: [{ after: "expanded", control: "Menu", before: "collapsed" }] } };
  assert.equal(compareCapture(a, b).verdict, "SAME");
});

test("a field that STOPPED being recorded is an evidence change", () => {
  // `undefined` is written out rather than dropped. A probe that quietly stopped filling `kind` is
  // exactly the regression this gate exists to catch, and dropping absent keys would hide it.
  const withKind = { interaction: { formChanges: [{ control: "Submit", kind: "submit" }] } };
  const without = { interaction: { formChanges: [{ control: "Submit" }] } };
  assert.equal(compareCapture(withKind, without).verdict, "CHANGED");
});

test("focusEvents.scriptRemovedFocus content changing, SAME count, is CHANGED not SAME", () => {
  // `focusEvents` is an OBJECT (like `routeChange`) whose `scriptRemovedFocus` field is an ARRAY of
  // findings -- the first object-shaped field to hold one. Before the object branch learned to flatten a
  // nested array per element, `normalise` would `String()` it whole: `String([{...}])` is
  // `"[object Object]"` regardless of which control the finding names, so two DIFFERENT findings at the
  // SAME count would have compared SAME. This is the `formChanges`/`stateChanges` defect arriving through
  // the shape `fieldValues`'s object branch, not its array branch, has to handle.
  const before = { interaction: { focusEvents: { asked: true, checked: true, events: 4,
    scriptRemovedFocus: [{ id: 1, name: "Coupon code", heldMs: 2 }] } } };
  const after = { interaction: { focusEvents: { asked: true, checked: true, events: 4,
    scriptRemovedFocus: [{ id: 1, name: "Voucher code", heldMs: 2 }] } } };
  const verdict = compareCapture(before, after);
  assert.equal(verdict.verdict, "CHANGED", JSON.stringify(verdict));
  assert.ok(verdict.changes.some((c: { field: string }) => c.field === "interaction.focusEvents"),
    "the change must be attributed to focusEvents by name");
});

test("focusEvents with an EMPTY scriptRemovedFocus on both sides is SAME", () => {
  const clean = { interaction: { focusEvents: { asked: true, checked: true, events: 4, scriptRemovedFocus: [] } } };
  assert.equal(compareCapture(clean, { ...clean }).verdict, "SAME");
});
