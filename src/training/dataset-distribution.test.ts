/**
 * The distribution check must catch a producer that stopped, and must not fire on a healthy export.
 *
 * Proves `corpus:distribution`. The failure it is aimed at is recorded in CLAUDE.md and cost an entire
 * corpus: `postSubmitFields` came back `[]` on **all 2,122 captures**, 604 of them with a logged crash,
 * and every check stayed green because *"counts never moved, and an empty field is not a malformed one"*.
 *
 * The distinguishing question is not "is this field empty here" — that is frequently the finding, and a
 * check that rejected it would delete the evidence several subtypes exist to catch. It is **"is this
 * field empty EVERYWHERE"**, which no page can cause and only a producer can.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { distributionProblems, MAY_BE_EMPTY_EVERYWHERE } from "./dataset-distribution.mjs";

/** A record shaped as far as the check reads it. */
function record({ label = "violation", postSubmit = ["Enter a postcode"], transcript = ["heading, level 1, Hi"] } = {}) {
  return {
    provenance: { caseId: "planted", variant: label === "clean" ? "good" : "bad" },
    target: { label, subtypes: [], criteria: [] },
    input: { transcript, structure: { headings: transcript }, interaction: { postSubmitFields: postSubmit } },
  };
}

/** A healthy pair: both labels present, every field populated somewhere. */
const HEALTHY = [record({ label: "violation" }), record({ label: "clean" })];

test("a field empty on EVERY record is reported — the 2,122-capture failure", () => {
  const broken = HEALTHY.map((r) => ({ ...r, input: { ...r.input, interaction: { postSubmitFields: [] } } }));
  const problems = distributionProblems(broken);
  assert.ok(problems.some((p) => p.includes("postSubmitFields")),
    `a probe that stopped filling its field must be named: got ${JSON.stringify(problems)}`);
  assert.ok(problems.some((p) => p.includes("ALL")),
    "and the message must say it is empty everywhere, which is what distinguishes a producer fault from "
    + "a page property");
});

test("a field empty on SOME records is NOT reported", () => {
  // The half that keeps this usable. An empty `postSubmitFields` on one page is often the finding —
  // a form that announced nothing — and a check that rejected it would delete the evidence
  // `3.3.1:validation-error-silent` exists to catch. This repo's most expensive rule: a check must never
  // reject evidence whose absence IS the finding.
  const mixed = [record({ postSubmit: [] }), record({ label: "clean" })];
  assert.deepEqual(distributionProblems(mixed).filter((p) => p.includes("postSubmitFields")), []);
});

test("a healthy export produces no problems at all", () => {
  // The control. Without it every assertion here is satisfied by a check that reports everything.
  assert.deepEqual(distributionProblems(HEALTHY), []);
});

test("an EMPTY export is a refusal, not a clean result", () => {
  // The examined-nothing failure, committed inside the check written to prevent it. Guarded explicitly
  // because `[].some(...)` is false and `Math.min()` of nothing is Infinity — an empty list sails through
  // every other assertion in the function.
  const problems = distributionProblems([]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /examined nothing/);
});

test("a single-class corpus is reported, because every accuracy number would look excellent", () => {
  const oneClass = [record({ label: "violation" }), record({ label: "violation" })];
  assert.ok(distributionProblems(oneClass).some((p) => p.includes("one class")),
    "a corpus with no negatives teaches a head to answer positive and scores perfectly doing it");
});

test("a collapsed but non-zero minority class is reported with its share", () => {
  const lopsided = [...Array(19).fill(0).map(() => record({ label: "violation" })), record({ label: "clean" })];
  const problems = distributionProblems(lopsided);
  assert.ok(problems.some((p) => p.includes("collapsed")), `got ${JSON.stringify(problems)}`);
  assert.ok(problems.some((p) => p.includes("5.0%")),
    "the share must be stated — 'collapsed' without a number is where an investigation stops");
});

test("a missing required key is reported", () => {
  const noTarget = [{ input: { transcript: ["a"] }, provenance: {} }, record({ label: "clean" })];
  assert.ok(distributionProblems(noTarget as never).some((p) => p.includes("target")));
});

test("every declared exception gives a REASON, not a blank", () => {
  // The exception list is where this check would rot: a field added here silently stops being watched.
  for (const [path, reason] of Object.entries(MAY_BE_EMPTY_EVERYWHERE)) {
    assert.ok(reason.length >= 30,
      `${path}: "${reason}" is not a reason. Say why no page in any corpus could populate it.`);
  }
});
