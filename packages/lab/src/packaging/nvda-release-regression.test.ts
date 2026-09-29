/**
 * The verdict, tested against inputs the lab has never produced -- the same reason `releasability.test.ts`
 * exists for the scorer's version of this question.
 *
 * Proves the DECISION half of `gate:nvda-release`. The WIRING half -- reading captures off disk, printing
 * the verdict, exiting non-zero -- is `nvda-release-gate-refuses.test.ts`, and `gates-are-proven.test.ts`
 * records that split rather than letting this file's tests imply it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { nvdaReleaseRegression } from "./nvda-release-regression.mjs";

/** A minimal usable capture -- NVDA, a non-empty non-blank transcript, nothing console-shaped. */
const capture = (over: Record<string, unknown> = {}) => ({
  screenReader: "NVDA",
  transcript: ["heading, level 1, Museum 004 controls", "Print this report"],
  structure: {
    headings: ["Museum 004 controls, heading, level 1"], landmarks: [], formFields: [],
    tableCells: [], links: [], lists: [], graphics: [],
  },
  interaction: { controls: [], stateChanges: [], formChanges: [], postSubmitFields: [], focusOrder: [] },
  ...over,
});

const pair = (over: Record<string, unknown> = {}) =>
  ({ id: "acceptance-museum-controls", variant: "good", shipped: capture(), candidate: capture(), ...over });

test("identical shipped and candidate readings are releasable", () => {
  const v = nvdaReleaseRegression({ pairs: [pair()] });
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
  assert.deepEqual(v.blockers, []);
});

test("no pairs at all is NOT a pass -- nothing compared is not nothing regressed", () => {
  const v = nvdaReleaseRegression({ pairs: [] });
  assert.equal(v.releasable, false);
  assert.match(v.blockers[0], /nothing was compared/);
});

test("NOT CAPTURED and UNUSABLE are different blockers, and neither reads like the other", () => {
  const notCaptured = nvdaReleaseRegression({ pairs: [pair({ candidate: null })] });
  const unusable = nvdaReleaseRegression({
    pairs: [pair({ candidate: capture({ transcript: ["blank", "blank"] }) })],
  });
  assert.match(notCaptured.blockers[0], /not captured by this candidate/);
  assert.match(unusable.blockers[0], /UNUSABLE/);
  assert.notDeepEqual(notCaptured.blockers, unusable.blockers,
    "'nobody read this' and 'somebody read the wrong thing' must never look the same");
});

test("a candidate capture NVDA never actually read (console focus) is UNUSABLE, not a silent pass", () => {
  const consoleCapture = capture({
    transcript: ["one thing NVDA said"],
    diagnostics: [{ event: "documentReady", title: "C: Windows SYSTEM 32 cmd dot exe" }],
  });
  const v = nvdaReleaseRegression({ pairs: [pair({ candidate: consoleCapture })] });
  assert.equal(v.releasable, false);
  assert.match(v.blockers[0], /console window/);
});

test("a case with no shipped reading is NEW COVERAGE, a note rather than a blocker", () => {
  const v = nvdaReleaseRegression({ pairs: [pair({ shipped: null })] });
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
  assert.match(v.notes.join(" "), /no shipped reading stored yet/);
});

test("an unusable shipped reading is a NOTE, not the candidate's fault", () => {
  const v = nvdaReleaseRegression({
    pairs: [pair({ shipped: capture({ transcript: ["blank"] }) })],
  });
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
  assert.match(v.notes.join(" "), /shipped reading is UNUSABLE/);
});

test("a lost heading against the shipped reading is CHANGED and BLOCKS", () => {
  const stripped = capture({ structure: { ...capture().structure, headings: [] } });
  const v = nvdaReleaseRegression({ pairs: [pair({ candidate: stripped })] });
  assert.equal(v.releasable, false);
  assert.match(v.blockers[0], /evidence CHANGED/);
  assert.match(v.blockers[0], /structure\.headings/);
});

test("transcript DRIFT alone does not block -- NVDA's own wording variance, named in a note", () => {
  const drifted = capture({ transcript: ["heading, level 1, Museum 004 controls"] });
  const v = nvdaReleaseRegression({ pairs: [pair({ candidate: drifted })] });
  assert.equal(v.releasable, true, JSON.stringify(v.blockers));
  assert.match(v.notes.join(" "), /DRIFT only/);
});

/** A `titleSource` diagnostic mark -- what `documentIdentity` (`@a11ign/evidence/document-identity`) reads. */
const titleMark = (title: string) => ({ event: "titleSource", source: "document", title });

test("a DIFFERENT DOCUMENT blocks -- no field-level comparison between them means anything", () => {
  const shipped = capture({ diagnostics: [titleMark("Example A")] });
  const candidate = capture({ diagnostics: [titleMark("Sign in - Example")] });
  const v = nvdaReleaseRegression({ pairs: [pair({ shipped, candidate })] });
  assert.equal(v.releasable, false);
  assert.match(v.blockers[0], /DIFFERENT DOCUMENTS/);
});

test("multiple pairs each contribute their own verdict, not a single collapsed one", () => {
  const clean = pair({ id: "case-a" });
  const broken = pair({ id: "case-b", candidate: capture({ structure: { ...capture().structure, headings: [] } }) });
  const v = nvdaReleaseRegression({ pairs: [clean, broken] });
  assert.equal(v.releasable, false);
  assert.equal(v.blockers.length, 1);
  assert.match(v.blockers[0], /case-b\.good/);
});
