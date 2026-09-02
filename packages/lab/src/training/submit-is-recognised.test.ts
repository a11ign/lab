import test from "node:test";
import assert from "node:assert/strict";
import { CASES } from "./case-matrix.mjs";
import { probeKindFor } from "@a11y-witness/nvda-worker/capture-pure";

/**
 * A case whose finding needs a SUBMIT must carry a button the probe recognises as one.
 *
 * `probeKindFor` tests `SUBMIT_RE` BEFORE it asks whether the task names the control, so a button whose
 * label misses that list falls through to `probeTaskButton` — which the capture then stamps
 * `kind: "taskButton"`, and every consumer gating on `kind === "submit"` correctly ignores it.
 *
 * MEASURED 2026-09-02, and it cost a full chain: two of sixteen new 3.3.3 cases used "Confirm booking"
 * and "Create account". `\bbook\b` does not match "booking", and "create" is not on the list at all, so
 * both were probed as task buttons and `rules:gate` reported the rule catching 26 of 34 records. The rule
 * was right and the pages were wrong.
 *
 * Widening the consumers to accept `taskButton` would have been the easy fix and a bad one: that kind
 * exists to mark a NON-SUBMIT button the task names, and accepting it is how apache.org's search toggle
 * came to be reported as a form submitted with invalid input and no error announced.
 *
 * So the constraint belongs at authoring time. This runs offline in milliseconds against the real
 * `probeKindFor` — not a copy of `SUBMIT_RE`, which would be the same fact written twice.
 */
const NEEDS_SUBMIT = new Set(["validation-error-silent", "error-remedy-missing"]);

test("every case whose signal needs a submit is probed AS a submit", () => {
  const wrong: string[] = [];
  let checked = 0;
  for (const testCase of CASES as Array<Record<string, unknown>>) {
    const signal = testCase.badSignal as { type?: string; control?: string } | undefined;
    if (!signal?.type || !NEEDS_SUBMIT.has(signal.type) || !signal.control) continue;
    checked++;
    // What NVDA announces for that button: its name, then its role.
    const announced = `${signal.control}, button`;
    const kind = probeKindFor(announced, { probeForms: true, task: String(testCase.task ?? "") });
    if (kind !== "submit") wrong.push(`${testCase.id}: "${signal.control}" probes as ${kind ?? "nothing"}`);
  }
  assert.ok(checked > 20, `expected to find the submit-dependent cases, checked only ${checked}`);
  assert.deepEqual(wrong, [],
    "these buttons are not recognised as submits, so the capture stamps kind:\"taskButton\" and every " +
    "consumer gating on a submit ignores the evidence. Use a label SUBMIT_RE matches — note it is " +
    "word-bounded, so \"booking\" does not match \"book\".");
});
