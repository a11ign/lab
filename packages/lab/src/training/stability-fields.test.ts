import { test } from "node:test";
import assert from "node:assert/strict";

import { comparable } from "./repeat-capture.mjs";
import { EVIDENCE_FIELDS } from "../capture/evidence-diff.mjs";

/**
 * TWO TOOLS ASK THE SAME QUESTION and each keeps its own list of what to look at.
 *
 *   `gate:stability` (repeat-capture)  — does this page capture the SAME evidence twice?
 *   `evidence:check` (evidence-diff)   — did my change alter the evidence?
 *
 * Both mean "every field a dataset signal can read", both say so in a comment, and both had holes.
 * `repeat-capture` compared ten fields and missed `formChanges` and `postSubmitFields` — which let an
 * intermittent contaminant into the corpus with every canary reported stable. That was fixed for those
 * two and `interaction.controls` stayed missing, though every one of 5,304 captures carries it.
 * `evidence-diff` separately missed `routeChange` and `postSubmitNames`.
 *
 * Three tools, three different lists, and no two agreed. A fact stated twice with nothing comparing the
 * copies is this repo's most-recorded defect, and the remedy when neither copy can be deleted is to pin
 * them equal.
 */

/** The fields `comparable()` produces, from a capture carrying every channel. */
function stabilityFields(): Set<string> {
  const everyChannel = {
    transcript: ["x"],
    structure: {
      headings: [], landmarks: [], formFields: [], graphics: [], links: [], lists: [], tableCells: [],
    },
    interaction: {
      controls: [], stateChanges: [], formChanges: [], postSubmitFields: [], focusOrder: [],
      postSubmitNames: [], routeChange: { titleBefore: "a", titleAfter: "b" },
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
  const flattened = (comparable({
    interaction: { routeChange: { titleBefore: "Home", titleAfter: "Bookings" } },
  }) as Record<string, unknown>).routeChange;
  assert.deepEqual(flattened, ["titleBefore=Home", "titleAfter=Bookings"]);
});

test("an absent routeChange is an empty list, never a crash or a phantom difference", () => {
  const flattened = (comparable({ interaction: {} }) as Record<string, unknown>).routeChange;
  assert.deepEqual(flattened, []);
});
