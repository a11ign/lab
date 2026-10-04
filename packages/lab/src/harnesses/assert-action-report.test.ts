/**
 * The smoke test's assertions, tested.
 *
 * These predicates decide whether `action-smoke.yml` passes, and that workflow is the only thing that
 * checks the adoption path end to end. When they lived inline in YAML they could not be exercised at all
 * — so a wrong assertion passed or failed for the wrong reason, eight minutes at a time.
 *
 * The cases below are the four outcomes that matter, and two of them are the ones a naive check gets
 * backwards: an empty findings list is CORRECT on a conformant page and WRONG on an inaccessible one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accusationFailure, activationCount, contractFailure, findingsFor, ruleLayerFailure,
} from "./assert-action-report.mjs";

const CONFORMANT = {
  url: "https://www.w3.org/WAI/demos/bad/after/survey.html",
  captureVerified: true,
  verdict: { findings: [] },
  outcomes: [{ criterion: "1.1.1", outcome: "passed" }],
  interaction: { formChanges: [{ control: "submit, button", kind: "submit", after: "" }], stateChanges: [] },
};

const INACCESSIBLE = {
  url: "https://www.w3.org/WAI/demos/bad/before/home.html",
  captureVerified: true,
  verdict: {
    findings: [
      { wcag: "1.1.1 Non-text Content", evidence: "33 of 39 images expose no accessible name" },
      { wcag: "2.4.4 Link Purpose (In Context)", evidence: "Click here, link" },
    ],
  },
  interaction: { formChanges: [], stateChanges: [{ control: "menu, button", after: "expanded" }] },
};

test("a usable report passes the contract", () => {
  assert.equal(contractFailure(CONFORMANT), null);
  assert.equal(contractFailure(INACCESSIBLE), null);
});

test("the contract names what is missing, rather than failing opaquely", () => {
  assert.match(String(contractFailure({ verdict: { findings: [] } })), /no url/);
  assert.match(String(contractFailure({ url: "x" })), /verdict\.findings/);
  assert.match(String(contractFailure({ url: "x", verdict: { findings: [] }, captureVerified: false })),
    /evidence was rejected/);
});

test("an ABSENT captureVerified is not a rejection", () => {
  // "We did not report it" and "we rejected it" must never be the same answer — the distinction this
  // project enforces from the capture gates upward. An older report without the field must still pass.
  assert.equal(contractFailure({ url: "x", verdict: { findings: [] } }), null);
});

test("activation counts both channels, because probe-forms and the disclosure probe differ", () => {
  // `formChanges` comes from the form probes, `stateChanges` from the disclosure probe, which runs
  // unconditionally. Counting only one would report zero on a page whose sole control is a disclosure.
  assert.equal(activationCount(CONFORMANT), 1);
  assert.equal(activationCount(INACCESSIBLE), 1);
  assert.equal(activationCount({ interaction: { formChanges: [], stateChanges: [] } }), 0);
  assert.equal(activationCount({}), 0);
});

test("activation is found whether the interaction is nested under capture or top level", () => {
  // The CLI has written it both ways; a check that only knew one shape would report "no control
  // activated" on a perfectly good run, which is precisely the false alarm that gets a gate deleted.
  assert.equal(activationCount({ capture: { interaction: { formChanges: [{}], stateChanges: [] } } }), 1);
});

test("findings are matched on the criterion PREFIX, not the whole label", () => {
  // The report carries "1.1.1 Non-text Content"; the flag says "1.1.1". Exact matching would silently
  // find nothing and the inaccessible-page guard would pass having examined nothing.
  assert.equal(findingsFor(INACCESSIBLE, "1.1.1").length, 1);
  assert.equal(findingsFor(INACCESSIBLE, "2.4.4").length, 1);
  assert.equal(findingsFor(INACCESSIBLE, "4.1.2").length, 0);
  assert.equal(findingsFor(CONFORMANT, "1.1.1").length, 0);
});

test("a malformed report yields no findings rather than throwing", () => {
  assert.deepEqual(findingsFor({}, "1.1.1"), []);
  assert.deepEqual(findingsFor({ verdict: {} }, "1.1.1"), []);
});

test("ruleBased: null is refused -- the axe layer was requested and did not run", () => {
  // FOUND 2026-09-06: this was the report the Action produced on EVERY run, because
  // chromium.launch() needs the bundled browser and the Action skips downloading it on purpose.
  // Nothing here asserted ruleBased at all, so this exact report passed the smoke test silently.
  assert.match(String(ruleLayerFailure({ ...CONFORMANT, ruleBased: null })), /did not run/);
});

test("ruleBased: [] is CORRECT -- a scan that ran and found nothing must not be refused", () => {
  // The same distinction `pageContext` (cli.ts) exists to preserve: null means "did not run", an empty
  // array means "ran and found nothing". Refusing an empty array here would fail every conformant page.
  assert.equal(ruleLayerFailure({ ...CONFORMANT, ruleBased: [] }), null);
});

test("ruleBased holding real findings is correct too", () => {
  assert.equal(ruleLayerFailure({ ...INACCESSIBLE, ruleBased: [{ rule: "image-alt" }] }), null);
});

test("ruleBased missing entirely (an older report shape) is named, not confused with null", () => {
  assert.match(String(ruleLayerFailure({ ...CONFORMANT })), /neither an array of findings nor null/);
});

// The report a failing action-smoke run produced on the conformant page (#3373): the scorer's 1.1.1 finding
// is present in `verdict.findings` and the criterion's outcome is `cantTell`.
const REFERRED_ONLY = {
  ...CONFORMANT,
  verdict: { findings: [{ wcag: "1.1.1 Non-text Content (A)", evidence: "Sunny Spells, graphic" }] },
  outcomes: [{ criterion: "1.1.1", outcome: "cantTell" }],
};

const ASSERTED = {
  ...REFERRED_ONLY,
  outcomes: [{ criterion: "1.1.1", outcome: "failed" }],
};

test("a REFERRED 1.1.1 is not an accusation, though it is a finding", () => {
  assert.equal(findingsFor(REFERRED_ONLY, "1.1.1").length, 1);
  assert.equal(accusationFailure(REFERRED_ONLY, "1.1.1"), null);
});

test("an ASSERTED 1.1.1 on a conformant page is refused, naming what was announced", () => {
  assert.match(String(accusationFailure(ASSERTED, "1.1.1")), /1\.1\.1 claimed .*Sunny Spells, graphic/);
});

test("the accusation is read from the criterion asked about, not from any failure", () => {
  const otherFailed = { ...REFERRED_ONLY, outcomes: [{ criterion: "2.5.8", outcome: "failed" }] };
  assert.equal(accusationFailure(otherFailed, "1.1.1"), null);
  // exact match: "1.4.1" must not be accused by "1.4.10"
  assert.equal(accusationFailure({ outcomes: [{ criterion: "1.4.10", outcome: "failed" }] }, "1.4.1"), null);
});

test("a clean page and an inapplicable criterion are not accusations", () => {
  assert.equal(accusationFailure(CONFORMANT, "1.1.1"), null);
  assert.equal(accusationFailure({ outcomes: [{ criterion: "1.1.1", outcome: "inapplicable" }] }, "1.1.1"), null);
});

test("a report with no outcomes is refused, not read as 'nothing asserted'", () => {
  // Absence is not proof: a report shape that lost `outcomes` must not pass the smoke for that reason.
  assert.match(String(accusationFailure({ verdict: { findings: [] } }, "1.1.1")), /no outcomes/);
  assert.match(String(accusationFailure({ outcomes: null }, "1.1.1")), /no outcomes/);
});
