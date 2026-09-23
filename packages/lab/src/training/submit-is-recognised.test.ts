import test from "node:test";
import assert from "node:assert/strict";
import { CASES } from "./case-matrix.mjs";
import { probeKindFor } from "@a11ign/nvda-worker/capture-pure";

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
 * #1918 (protocol 21): a real submit the name misses is now also recognised by the `submit` event it
 * dispatches (`formChanges[].submitted`, `isSubmitActivation`). That covers the held-out and real pages this
 * file cannot author. It does not replace this check: the training corpus should still probe its submits as
 * submits, and a capture that could not measure the event keeps reading the name alone.
 *
 * So the constraint belongs at authoring time. This runs offline in milliseconds against the real
 * `probeKindFor` — not a copy of `SUBMIT_RE`, which would be the same fact written twice.
 */
const NEEDS_SUBMIT = new Set(["validation-error-silent", "error-remedy-missing"]);

/**
 * #2070: THE ONE EXEMPTION, AND WHY IT DOES NOT WEAKEN THE CHECK ABOVE.
 *
 * Training carried 143 of 143 `3.3.1:validation-error-silent` cases probed `submit`, while the acceptance
 * set carries a task-NAMED submit at 1 in 6 (`acceptance-b2-error-vessel`, "Apply for a berth"). A case
 * held out against a shape training holds none of is not testing generalisation. So 24 cases are now
 * declared `form-error-taskname-*` and are deliberately probed as task buttons.
 *
 * The exemption is read from the case's DECLARED ID, never from what `probeKindFor` returns. That
 * distinction is the whole of it: the incident this file was written for is a case that MEANT
 * "book"/"create" and missed `SUBMIT_RE` by ACCIDENT, and an exemption derived from the classifier's own
 * answer would have swallowed exactly that accident -- every future slip would exempt itself. Intent and
 * observation are kept as two separate facts, and `case-matrix.test.ts` pins the two sets EQUAL in both
 * directions, so neither a mis-prefixed id nor an accidental task name can hide in the gap.
 *
 * An id prefix is how this file already separates declarations from expansions (`+also-`,
 * `+with-component`, `form-error-calibration-`), so this adds a convention rather than a mechanism.
 *
 * `task` and NOT merely "anything but submit": a control `probeKindFor` returns null for is never pressed
 * at all, so the page would produce no form change, and the case would be dead rather than held out.
 */
const TASK_NAMED_ID = /^form-error-taskname-/;
const declaresTaskNamedSubmit = (testCase: Record<string, unknown>) => TASK_NAMED_ID.test(String(testCase.id));

test("every case whose signal needs a submit is probed AS a submit", () => {
  const wrong: string[] = [];
  let checked = 0;
  for (const testCase of CASES as Array<Record<string, unknown>>) {
    const signal = testCase.badSignal as { type?: string; control?: string } | undefined;
    if (!signal?.type || !NEEDS_SUBMIT.has(signal.type) || !signal.control) continue;
    if (declaresTaskNamedSubmit(testCase)) continue;
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
    "word-bounded, so \"booking\" does not match \"book\". A case that MEANS to carry a task-named " +
    "submit is declared `form-error-taskname-*` (#2070) and is checked by the test below instead.");
});

test("#2070: a case declaring a task-named submit really is probed as a task button", () => {
  const declared = (CASES as Array<Record<string, unknown>>).filter(declaresTaskNamedSubmit);
  // The positive control for the emptiness assertion below, named rather than assumed: without this the
  // whole test passes on a corpus where nothing carries the prefix at all.
  assert.ok(declared.length >= 20,
    `only ${declared.length} cases are declared task-named -- the 3.3.1 task-named population is gone`);
  const wrong = declared
    .map((testCase) => {
      const signal = testCase.badSignal as { control?: string };
      const kind = probeKindFor(`${signal.control}, button`, {
        probeForms: true,
        task: String(testCase.task ?? ""),
      });
      return kind === "task" ? null : `${testCase.id}: "${signal.control}" probes as ${kind ?? "nothing"}`;
    })
    .filter((line): line is string => line !== null);
  assert.deepEqual(wrong, [],
    "these ids declare a task-named submit but the real probeKindFor disagrees. A name matching " +
    "SUBMIT_RE reads `submit` (so the case is an ordinary one wearing the prefix); a name sharing no word " +
    "with its task reads nothing at all, and a button nothing presses produces no evidence whatsoever.");
});
