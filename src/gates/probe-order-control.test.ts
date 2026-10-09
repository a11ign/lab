/**
 * THE GATE CONFOUNDED ORDER WITH TIME, and a confound is fixed with a control — plan item E.
 *
 * `gate:probe-order` captured a page twice, changing the probe order AND letting time pass. So a difference
 * could be either. On `tfl.gov.uk` the clock ticked `22:43` → `22:47` and a live disruption banner appeared
 * between the two captures; the gate correctly refused to call that an ordering fault, which is why it
 * reported PAGE-MOVED and could never pass with a live page in its list.
 *
 * It now takes three — A₁, B, A₂ — so `diff(A₁,A₂)` measures what TIME alone does on that page, right then,
 * and an ordering fault is only what the treatment shows and the control does not. Same instrument
 * `gate:stability` already uses: repeat the identical thing to find the noise floor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { differencesNotExplainedBy } from "../../scripts/gate-probe-order.mjs";

const diff = (...fields: string[]) => ({ changes: fields.map((field) => ({ field })) });

test("a difference the CONTROL also shows is explained by time, not by order", () => {
  // tfl: the clock is in `structure.formFields` in both comparisons, so it is drift, not ordering.
  const ordering = differencesNotExplainedBy(diff("structure.formFields"), diff("structure.formFields"));
  assert.deepEqual(ordering, [], "a field that drifts on its own cannot be evidence about probe order");
});

test("a difference ONLY the treatment shows IS the ordering effect", () => {
  // nls.uk: the sweep opens a search panel, so the focus walk sees 10 stops instead of 150. Capturing the
  // same order twice does NOT reproduce it — the panel opens both times — so the control is silent.
  const ordering = differencesNotExplainedBy(diff("interaction.focusOrder"), diff());
  assert.deepEqual(ordering.map((c: { field: string }) => c.field), ["interaction.focusOrder"]);
});

test("THE REAL tfl CASE: a drifting field is subtracted and a real one survives beside it", () => {
  // Both at once, which is the case that matters and the one a whole-comparison subtraction would get
  // wrong. tfl drifts on formFields and links; if it ALSO had an ordering effect on focusOrder, that must
  // still be reported rather than swallowed with the drift.
  const ordering = differencesNotExplainedBy(
    diff("structure.formFields", "structure.links", "interaction.focusOrder"),
    diff("structure.formFields", "structure.links"));
  assert.deepEqual(ordering.map((c: { field: string }) => c.field), ["interaction.focusOrder"]);
});

test("THE CONTROL MUST NOT BE INERT — matched on the FIELD, never on the exact phrases", () => {
  // The failure mode to watch for, because an inert control looks exactly like a clean gate. A clock reads
  // 22:43, 22:47 and 22:51 across three captures, so the lost/gained PHRASES differ in every comparison
  // while the drifting FIELD is the same. Requiring identical phrases would explain away nothing, and the
  // gate would go on reporting drift as an ordering fault while appearing to have a control.
  const treatment = { changes: [{ field: "structure.formFields", lost: ["now at 22:43"], gained: ["now at 22:47"] }] };
  const control = { changes: [{ field: "structure.formFields", lost: ["now at 22:43"], gained: ["now at 22:51"] }] };
  assert.deepEqual(differencesNotExplainedBy(treatment, control), [],
    "the phrases differ in every comparison; matching on them would make the control do nothing");
});

test("a clean treatment stays clean — the control cannot invent a finding", () => {
  assert.deepEqual(differencesNotExplainedBy(diff(), diff("structure.links")), []);
});
