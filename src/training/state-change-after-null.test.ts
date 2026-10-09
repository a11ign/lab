/**
 * #1616: two lab readers of a FAILED re-read (`after: null`, `error` set, `capture-probes.mjs:2343`).
 *
 * - `signal-predicates.mjs`'s `interactionTextParts` carried the `null` into the text list. No exported predicate emitted
 *   the word -- `flattenCapture` filters non-strings, and `placeholderOnlyIsPresent`'s `String(value)` needs an "edit"
 *   role that "null" never parses to -- so the defect was latent. It is fixed where done-when 2 puts it, and tested
 *   through a named export (`@a11ign/lab` is private).
 * - The capture harness's `capturedText` printed it as the word "null" in its summary line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { interactionTextParts } from "./signal-predicates.mjs";
import { capturedText } from "../harnesses/captured-text.mjs";

const ERRORED = { control: "Delivery options, button, collapsed", after: null, afterSource: "focus", error: "reportFocus timed out after 6000ms" };
const MEASURED = { control: "FAQ, button, collapsed", after: "FAQ, button, expanded", afterSource: "focus" };
const interaction = (stateChanges: unknown[]) => ({ controls: [], stateChanges, formChanges: [], postSubmitFields: [] });

test("#1616 the signal predicates' text parts drop a failed re-read's null and keep its control", () => {
  assert.deepEqual(interactionTextParts({ interaction: interaction([ERRORED]) }), ["Delivery options, button, collapsed"]);
});

test("#1616 CONTROL: a measured re-read still contributes both halves to the text parts", () => {
  assert.deepEqual(interactionTextParts({ interaction: interaction([MEASURED]) }), ["FAQ, button, collapsed", "FAQ, button, expanded"]);
});

test("#1616 the capture harness's captured text names the error instead of printing null", () => {
  const text = capturedText({ transcript: [], structure: { headings: [], landmarks: [], formFields: [] }, interaction: interaction([ERRORED, MEASURED]) });
  assert.doesNotMatch(text, /\bnull\b/, "the harness summary printed the word null");
  assert.match(text, /Delivery options, button, collapsed \[re-read failed: reportFocus timed out after 6000ms\]/);
  assert.match(text, /FAQ, button, collapsed FAQ, button, expanded/, "the control: a measured pair still prints");
});
