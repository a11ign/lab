import { test } from "node:test";
import assert from "node:assert/strict";

import { comparable } from "./repeat-capture.mjs";
import { EVIDENCE_FIELDS } from "../capture/evidence-diff.mjs";

/**
 * TWO TOOLS ASK THE SAME QUESTION.
 *
 *   `gate:stability` (repeat-capture)  — does this page capture the SAME evidence twice?
 *   `evidence:check` (evidence-diff)   — did my change alter the evidence?
 *
 * Both mean "every field a dataset signal can read". Until 2026-09-06 each kept its OWN list and its OWN
 * flatten, and they drifted repeatedly: `repeat-capture` missed `formChanges`/`postSubmitFields`, then
 * `controls`, while `evidence-diff` separately missed `routeChange`/`postSubmitNames` — three lists, three
 * different holes, pinned equal by this file because neither copy could be deleted at the time.
 *
 * **That stopped being true.** `atMs` (a wall-clock key inside `focusEvents.log`) was excluded in
 * `evidence-diff.mjs`'s deny-list, and `gate:stability` failed identically two hours later because
 * `repeat-capture.mjs`'s own flatten had never heard of the fix. That is what "pin them equal with a
 * test" costs: the test proves two things AGREE, never that either is CORRECT, and it cannot propagate a
 * fix from one side to the other. `comparable()` (`repeat-capture.mjs`) now imports `EVIDENCE_FIELDS` and
 * `fieldValues` from `evidence-diff.mjs` directly — CLAUDE.md's first remedy, "delete a copy" — so there
 * is one list and one flatten, and this file's two "compares every field" tests are now a regression
 * guard against reintroducing a second one, not a test that two independent lists happen to agree.
 */

/** The fields `comparable()` produces, from a capture carrying every channel. */
function stabilityFields(): Set<string> {
  const everyChannel = {
    transcript: ["x"],
    structure: {
      headings: [], landmarks: [], formFields: [], graphics: [], links: [], lists: [], tableCells: [],
      frames: [],
    },
    interaction: {
      controls: [], stateChanges: [], formChanges: [], postSubmitFields: [], focusOrder: [],
      postSubmitNames: [], routeChange: { titleBefore: "a", titleAfter: "b" },
      dialogEscape: { focusBefore: "a", announced: "", focusAfter: "a" },
      arrowNavigation: { focusBefore: "a", announced: "", focusAfter: "a" },
      typedFeedback: { typed: true, echoed: "1", announced: "" },
      focusEvents: { asked: true, checked: true, events: 0, scriptRemovedFocus: [] },
    },
  };
  return new Set(Object.keys(comparable(everyChannel) as Record<string, unknown>));
}

/** What `evidence:check` compares, by bare field name (it keys on `[group, name]`). */
const evidenceFields = (): Set<string> =>
  new Set((EVIDENCE_FIELDS as [string, string][]).map(([, name]) => name));

test("gate:stability compares every field evidence:check does", () => {
  const missing = [...evidenceFields()].filter((f) => !stabilityFields().has(f)).sort();
  assert.deepEqual(missing, [],
    "evidence:check treats these as evidence and gate:stability does not compare them, so instability "
    + `in them is invisible to the gate that must pass before a corpus run: ${missing.join(", ")}`);
});

test("evidence:check compares every field gate:stability does", () => {
  // The other direction, and not symmetry for its own sake: a field one tool watches and the other does
  // not means a change can be called evidence-neutral while the stability gate sees it move, or vice
  // versa. `transcript` is the one legitimate difference — evidence-diff compares it separately, as a
  // SET with the drift named, because NVDA varies its order between runs.
  const missing = [...stabilityFields()]
    .filter((f) => f !== "transcript" && !evidenceFields().has(f)).sort();
  assert.deepEqual(missing, [],
    `gate:stability compares these and evidence:check does not: ${missing.join(", ")}`);
});

test("an object-shaped field is flattened, not compared as an opaque object", () => {
  // `routeChange` is `{control, titleBefore, titleAfter, ...}`. Listing it without flattening compares
  // two objects and reports them as differing wholesale, so the one field that moved is not named — and
  // a title that stopped changing IS the 2.4.2 failure. The identical trap caught `evidence-diff.mjs`.
  //
  // VALUES ARE LOWERCASED as of the `evidence-diff.mjs` unification (2026-09-06) -- `comparable()` now
  // calls that module's own `fieldValues()`, which runs every value through `normalise()` (its own stated,
  // deliberately crude choice: lowercase and whitespace-collapse, no more). Keys are untouched.
  const flattened = (comparable({
    interaction: { routeChange: { titleBefore: "Home", titleAfter: "Bookings" } },
  }) as Record<string, unknown>).routeChange;
  assert.deepEqual(flattened, ["titleBefore=home", "titleAfter=bookings"]);
});

test("an absent routeChange is an empty list, never a crash or a phantom difference", () => {
  const flattened = (comparable({ interaction: {} }) as Record<string, unknown>).routeChange;
  assert.deepEqual(flattened, []);
});

test("focusEvents.scriptRemovedFocus content changing at the SAME count is not read as stable", () => {
  // `focusEvents` is an object whose `scriptRemovedFocus` is an ARRAY of findings -- the same nested
  // shape `evidence-diff.mjs` had to learn to flatten. Before `flatten()` here recursed into an array
  // value, `${v}` on `scriptRemovedFocus` called `toString()` on the array of objects, which is
  // `"[object Object]"` regardless of which control the finding names, so two DIFFERENT findings at the
  // same count would have compared equal.
  const withEvents = (name: string) => (comparable({
    interaction: { focusEvents: { asked: true, checked: true, events: 4,
      scriptRemovedFocus: [{ id: 1, name, heldMs: 2 }] } },
  }) as Record<string, unknown>).focusEvents;
  assert.notDeepEqual(withEvents("Coupon code"), withEvents("Voucher code"));
});

test("a focus log differing ONLY in atMs timestamps is STABLE, not VARIES -- the incident this unit fixes", () => {
  // MEASURED 2026-09-06: `gate:stability` failed with `VARIES focusEvents counts 5,5,5,5,5` -- identical
  // counts, differing content -- on both canaries that declare `probeFocus: true`. `evidence-diff.mjs` had
  // just excluded `atMs` for the identical field and this file never learned of the fix, because it had
  // its own, unaware flatten. `comparable()` now reads the SAME `NOT_EVIDENCE_KEYS` deny-list via
  // `fieldValues()`, so this is the direct regression test for the incident, not just for the mechanism --
  // see `evidence-diff.test.ts`'s "a focus log differing ONLY in timestamps" for the sibling proof.
  const log = [
    { type: "focusin", id: 0, name: "Contact name", atMs: 3211 },
    { type: "focusout", id: 0, name: "Contact name", atMs: 5161 },
  ];
  const later = log.map((e) => ({ ...e, atMs: e.atMs + 37 }));
  const flatten = (l: typeof log) => {
    const result = comparable({ interaction: { focusEvents: { asked: true, checked: true, log: l } } });
    return (result as Record<string, unknown>).focusEvents;
  };
  assert.deepEqual(flatten(log), flatten(later),
    "every capture starts its clock afresh, so comparing atMs makes the log unequal to itself on every run");
});

test("a focus log differing in WHO or ORDER still VARIES, even with atMs excluded", () => {
  // The half that stops the exclusion becoming the defect it fixes -- `focusLossEvidence` computes
  // `heldMs` from DIFFERENCES between adjacent entries, never from an absolute value, so excluding `atMs`
  // must hide nothing a rule actually reads.
  const log = [
    { type: "focusin", id: 0, name: "Contact name", atMs: 3211 },
    { type: "focusout", id: 0, name: "Contact name", atMs: 5161 },
  ];
  const flatten = (l: typeof log) => {
    const result = comparable({ interaction: { focusEvents: { asked: true, checked: true, log: l } } });
    return (result as Record<string, unknown>).focusEvents;
  };
  const renamed = [log[0], { ...log[1], name: "Something else" }];
  assert.notDeepEqual(flatten(log), flatten(renamed), "a control that stopped receiving focus must still register");

  const reordered = [log[1], log[0]];
  assert.notDeepEqual(flatten(log), flatten(reordered),
    "ORDER is the whole of F55's signature, so a reordered log must never read as stable");
});
