import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { EVIDENCE_FIELDS } from "./evidence-diff.mjs";

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
const ROOT = join(import.meta.dirname, "../../../..");

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
  const runs = join(ROOT, "runs");
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
  // `arrowNavigation` was here and this guard RETIRED IT the moment `radio-group-arrows-inert` was
  // captured, which is the design working rather than anyone remembering.
  //
  // `typedFeedback` is still here and the reason has NARROWED, which is worth the words because the entry
  // was briefly deleted and put back. It was "no case uses it": `validation-live-silent` was withdrawn
  // CONTAMINATED, because a polite live region does not announce while NVDA is echoing keystrokes. On
  // 2026-09-02 a 3.2.2 proof case did use it — the probe now reads the page title either side of the
  // typing, and one captured pair showed "Archive search" against "Results for 123456", which is that
  // criterion's failure observed (known-gaps §23). The case was then removed: its signal could never
  // fire, so `check-signals` correctly called it BLIND, and a corpus case that cannot discriminate is
  // worse than none.
  //
  // So the field is PROVEN and still uncaptured by any shipping case, and those are different from both
  // "not written" and "cannot fire". It closes when 3.2.2 ships, which needs the protocol bump §23 states.
  "interaction.typedFeedback":
    "the probe is verified and its 3.2.2 title evidence was proved on a real capture (known-gaps §23), "
    + "but no shipping case asks for it: the proof case was removed because its signal could not fire, "
    + "and validation-live-silent stays withdrawn because a polite live region is silent during typing "
    + "echo. Closes when 3.2.2 ships.",
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
