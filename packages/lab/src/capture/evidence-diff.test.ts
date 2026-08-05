// The tool that decides whether a capture optimisation costs a 2,122-capture recapture. If it says
// "safe" when evidence changed, a whole corpus silently becomes a mix of two pipelines — so the tests
// below are mostly about it refusing to say "safe".
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareCapture, summarise } from "./evidence-diff.mjs";

const capture = (over: Record<string, unknown> = {}) => ({
  transcript: ["heading, level 1, Museum 004 controls", "Print this report"],
  structure: {
    headings: ["Museum 004 controls, heading, level 1"], landmarks: [], formFields: ["Print this report, button"],
    tableCells: [], links: [], lists: [], graphics: [],
  },
  interaction: { controls: ["Print this report, button"], stateChanges: [], formChanges: [], postSubmitFields: [], focusOrder: [] },
  ...over,
});

test("an identical capture is SAME", () => {
  assert.equal(compareCapture(capture(), capture()).verdict, "SAME");
});

test("wording NVDA varies — case and whitespace — is not a difference", () => {
  const noisy = capture({ transcript: ["Heading, level 1,   Museum 004 controls", "Print this report"] });
  assert.equal(compareCapture(capture(), noisy).verdict, "SAME");
});

test("phrases heard in a different order are SAME, not a change", () => {
  // A capture is allowed to hear the same things in a different order; it is not allowed to stop
  // hearing them. That is why the transcript is compared as a set.
  const reordered = capture({ transcript: ["Print this report", "heading, level 1, Museum 004 controls"] });
  assert.equal(compareCapture(capture(), reordered).verdict, "SAME");
});

test("a lost transcript phrase is DRIFT, and the phrase is named", () => {
  const shorter = capture({ transcript: ["heading, level 1, Museum 004 controls"] });
  const result = compareCapture(capture(), shorter);
  assert.equal(result.verdict, "DRIFT");
  assert.deepEqual(result.phrases.lost, ["print this report"]);
});

test("a lost heading is CHANGED — signals read that field", () => {
  const stripped = capture({
    structure: { ...capture().structure, headings: [] },
  });
  const result = compareCapture(capture(), stripped);
  assert.equal(result.verdict, "CHANGED");
  assert.equal(result.changes[0].field, "structure.headings");
  assert.deepEqual(result.changes[0].lost, ["museum 004 controls, heading, level 1"]);
});

test("a control that stopped being found is CHANGED — this is the custom-control signal", () => {
  const noControls = capture({
    interaction: { ...capture().interaction, controls: [] },
  });
  assert.equal(compareCapture(capture(), noControls).verdict, "CHANGED");
});

test("a GAINED field value is CHANGED too — absence is evidence in this corpus", () => {
  // custom-control's bad pages prove a 4.1.2 failure by finding NO controls. A change that starts
  // finding one destroys the case just as surely as losing one.
  const extra = capture({
    interaction: { ...capture().interaction, controls: ["Print this report, button", "Cancel, button"] },
  });
  const result = compareCapture(capture(), extra);
  assert.equal(result.verdict, "CHANGED");
  assert.deepEqual(result.changes[0].gained, ["cancel, button"]);
});

test("one CHANGED capture forces a recapture, however many were SAME", () => {
  const results = [
    { comparison: compareCapture(capture(), capture()) },
    { comparison: compareCapture(capture(), capture({ structure: { ...capture().structure, headings: [] } })) },
  ];
  const summary = summarise(results);
  assert.equal(summary.evidenceChanged, true);
  assert.match(summary.recommendation, /bump CAPTURE_PROTOCOL_VERSION and recapture/i);
});

test("an all-SAME sample clears the change to ship without invalidating the cache", () => {
  const results = [1, 2, 3].map(() => ({ comparison: compareCapture(capture(), capture()) }));
  const summary = summarise(results);
  assert.equal(summary.evidenceChanged, false);
  assert.match(summary.recommendation, /safe to ship WITHOUT invalidating/);
});

test("widespread drift is not waved through as NVDA variance", () => {
  const drifted = capture({ transcript: ["heading, level 1, Museum 004 controls"] });
  const results = [1, 2, 3].map(() => ({ comparison: compareCapture(capture(), drifted) }));
  const summary = summarise(results);
  assert.equal(summary.evidenceChanged, false, "drift is not a field change");
  assert.equal(summary.driftIsWidespread, true);
  assert.match(summary.recommendation, /re-run to separate NVDA variance/);
});

test("a capture the pipeline would reject is excluded, not counted as a change", () => {
  // Diffing a capture a real run would throw away blames the change for a bad guest. The run answers
  // a rejected capture by retrying; this tool answers it by not drawing a conclusion.
  const results = [
    { comparison: compareCapture(capture(), capture()) },
    { comparison: { verdict: "REJECTED", changes: [], phrases: null } as never },
  ];
  const summary = summarise(results);
  assert.equal(summary.evidenceChanged, false);
  assert.equal(summary.compared, 1, "rejected captures must leave the denominator");
  assert.match(summary.recommendation, /1 capture\(s\) were rejected/);
});

test("rejected captures do not drag the drift share around", () => {
  // One drift out of one comparison is widespread; three rejects alongside it must not dilute that.
  const drifted = capture({ transcript: ["heading, level 1, Museum 004 controls"] });
  const results = [
    { comparison: compareCapture(capture(), drifted) },
    ...[1, 2, 3].map(() => ({ comparison: { verdict: "REJECTED", changes: [], phrases: null } as never })),
  ];
  assert.equal(summarise(results).driftIsWidespread, true);
});
