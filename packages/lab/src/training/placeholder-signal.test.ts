/**
 * A signal about ONE FIELD must not reason about the whole page.
 *
 * `placeholderOnlyIsPresent` used to begin `if (formFields.length > 0) return false` — if the form sweep
 * announced any named field anywhere, the page could not be the placeholder case. That is ADR 0015's defect
 * in the signal layer: every real page has at least one labelled field, so the corpus could not contain a
 * page carrying both a labelled field and a placeholder-only one. That separation is precisely what taught
 * the scorer heads to veto, and here it was enforced by the checker itself.
 *
 * The third case below is the one that used to be impossible. It is also the page furniture this corpus is
 * about to grow: a labelled reference field injected into every case, which under the old predicate would
 * have silently blinded every `placeholder-only` case rather than failing loudly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { signalMatches } from "./case-matrix.mjs";

const SIGNAL = { type: "placeholder-only", placeholder: "example value" };

/** Announcements taken from the corpus captures, not invented — see the doc comment on the predicate. */
const capture = (formFields: string[], transcript: string[]) =>
  ({ structure: { formFields }, transcript, interaction: {} });

test("the BAD announcement — the placeholder standing in for a name — still fires", () => {
  assert.equal(signalMatches(capture([], ["form, Example value, edit"]), SIGNAL), true);
});

test("the GOOD announcement — a real name, the placeholder trailing as the value — stays silent", () => {
  assert.equal(
    signalMatches(capture(["Booking reference, edit, Example value"], ["edit, Example value"]), SIGNAL),
    false,
    "a named field carrying the placeholder as its VALUE is the conformant page and must not fire",
  );
});

test("a page with BOTH a labelled field and a placeholder-only one fires — the case that was impossible", () => {
  assert.equal(
    signalMatches(
      capture(["Reference lookup, edit"], ["Reference lookup, edit", "form, Example value, edit"]),
      SIGNAL,
    ),
    true,
    "the old page-level guard returned false here, so a corpus page could never carry both — which is the "
    + "separation ADR 0015 measured as 225 free vetoes",
  );
});

test("a page with no placeholder text at all stays silent", () => {
  assert.equal(signalMatches(capture(["Reference lookup, edit"], ["Reference lookup, edit"]), SIGNAL), false);
});

test("an empty placeholder never fires, or the signal would match any edit field on any page", () => {
  assert.equal(signalMatches(capture([], ["form, Example value, edit"]), { type: "placeholder-only" }), false);
});
