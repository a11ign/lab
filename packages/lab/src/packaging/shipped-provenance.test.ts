/**
 * The release must be able to say which model it ships.
 *
 * Written after finding that it could not: the shipped weights reported 2485 records while the only two
 * pending changesets described 2403, and were byte-identical to each other. Both conditions are invisible
 * to every other check in this repo — a changeset is prose, and the test named `changeset-provenance`
 * asserts how a row RENDERS, never that the row describes what is in `packages/scorer/models/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { provenanceProblems } from "./shipped-provenance.mjs";

/** Stands in for `provenanceLines`, which the CLI injects. Shape, not content, is what matters here. */
const render = (training: { dataset?: { records?: number } }) =>
  `- records: \`${training.dataset?.records}\``;

const REPORT = { dataset: { records: 2487 } };
const entryFor = (records: number) => `---\n"@a11y-witness/scorer": major\n---\n\n- records: \`${records}\`\n`;

const check = (changesets: Array<{ name: string; text: string }>, changelog: string | null = null) =>
  provenanceProblems({ shippedReport: REPORT, changesets, changelog, renderProvenance: render });

test("a changeset describing the shipped weights is a pass", () => {
  assert.deepEqual(check([{ name: "promote-candidate-a1b2c3d4.md", text: entryFor(2487) }]), []);
});

test("a changeset describing DIFFERENT weights is refused, and the shipped provenance is printed", () => {
  // THE LIVE DEFECT. Shipped 2485, the only entries said 2403 -- so the first release would have
  // published weights whose provenance nothing states, beside an entry for a model that never shipped.
  const problems = check([{ name: "promote-candidate-6.md", text: entryFor(2403) }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no pending changeset and no published CHANGELOG/);
  // It must print what the weights ARE, or the reader has to go and derive it to act on the refusal.
  assert.match(problems[0], /records: `2487`/, "the refusal must name the provenance it wanted stated");
});

test("two byte-identical entries are one release note twice", () => {
  // `changeset version` renders every pending entry, so a duplicate publishes the same note twice under
  // one version. It is also the fingerprint of the naming bug that produced it: a filename derived from a
  // COUNT of the directory reuses a number the moment anything is consumed or added.
  const text = entryFor(2487);
  const problems = check([
    { name: "promote-candidate-4.md", text },
    { name: "promote-candidate-6.md", text },
  ]);
  assert.equal(problems.length, 1, "the provenance itself is stated, so ONLY the duplicate is a problem");
  assert.match(problems[0], /promote-candidate-6\.md is byte-identical to promote-candidate-4\.md/);
});

test("a PUBLISHED changelog satisfies it, so a released tree with nothing pending is correct", () => {
  // The steady state after a release: changesets are consumed, and the provenance lives in CHANGELOG.md.
  // Without this branch the gate would refuse every tree that had just released, which is how a check
  // gets switched off rather than fixed.
  assert.deepEqual(check([], `## 1.0.0\n\n${render(REPORT)}\n`), []);
});

test("an empty tree with nothing published anywhere is refused, not passed", () => {
  // A check that examines nothing must never report success. Here the weights exist and NOTHING accounts
  // for them, which is the strongest form of the defect rather than the absence of one.
  const problems = check([], null);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no pending changeset/);
});

test("a partial match does not count as stated", () => {
  // The failure mode worth catching: an entry with the right corpus size and a stale encoder hash
  // describes a model nobody can rebuild, and is more misleading than no entry at all because it looks
  // answered. Asserting the whole rendered block, rather than any one row, is what makes that fail.
  const wider = (training: { dataset?: { records?: number } }) =>
    `- records: \`${training.dataset?.records}\`\n- encoder: \`abc123\``;
  const problems = provenanceProblems({
    shippedReport: REPORT,
    changesets: [{ name: "p.md", text: "- records: `2487`\n- encoder: `STALE`" }],
    changelog: null,
    renderProvenance: wider,
  });
  assert.equal(problems.length, 1, "a right-records/wrong-encoder entry must not satisfy the gate");
});

test("no training report at all is a refusal that says so", () => {
  const problems = provenanceProblems({
    shippedReport: null, changesets: [], changelog: null, renderProvenance: render,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /refusal, not a pass/);
});

// --- SUPERSEDED entries: the duplicate check's neighbour, missed by exactly one line ------------------

/** A promotion note carrying a feature-schema line, which is what `promote:model` writes. */
const schemaEntry = (records: number, schema: string) =>
  `---\n"@a11y-witness/scorer": major\n---\n\n- records: \`${records}\`\n`
  + `- feature schema: \`${schema}\`\n`;

const SCHEMA_REPORT = { dataset: { records: 2487 }, representation: { schema: "v18" } };
const checkSchema = (changesets: Array<{ name: string; text: string }>) =>
  provenanceProblems({ shippedReport: SCHEMA_REPORT, changesets, changelog: null, renderProvenance: render });

test("a promotion note for a schema the shipped weights do not carry is refused as superseded", () => {
  // THE LIVE DEFECT, 2026-09-06. Two `major` promotion notes on the real tree, differing in ONE line —
  // `screenreader-structured-v17` against `-v18` — with the shipped weights stamped v18. The
  // byte-identical check above passed them, because they are not byte-identical; they are one line apart.
  // `changeset version` renders every pending entry, so a first publish would carry two "Retrained scorer
  // weights" notes under one version, one describing a model no consumer will ever hold.
  //
  // Keyed on the FEATURE SCHEMA because that field decides whether the weights can score at all:
  // `score.py` refuses a representation mismatch outright, so an entry naming another schema describes
  // weights this tree could not run.
  const problems = checkSchema([
    { name: "promote-candidate-current.md", text: schemaEntry(2487, "v18") },
    { name: "promote-candidate-stale.md", text: schemaEntry(2487, "v17") },
  ]);
  assert.equal(problems.length, 1, "the current entry states the provenance, so ONLY the stale one is a problem");
  assert.match(problems[0], /promote-candidate-stale\.md is a promotion note for feature schema v17/);
  assert.match(problems[0], /shipped weights are v18/);
});

test("one entry naming the shipped schema is a pass, so the check does not fire on an ordinary promotion", () => {
  assert.deepEqual(checkSchema([{ name: "promote-candidate-x.md", text: schemaEntry(2487, "v18") }]), []);
});

test("a changeset with no feature-schema line at all is not a promotion note and is left alone", () => {
  // This repo's hand-written changesets carry no schema line. Treating their absence as a mismatch would
  // refuse every ordinary release note -- a guard firing on the population it was never about.
  assert.deepEqual(
    provenanceProblems({
      shippedReport: SCHEMA_REPORT,
      changesets: [
        { name: "promote-candidate-x.md", text: schemaEntry(2487, "v18") },
        { name: "quiet-melons-smile.md", text: "---\n\"a11y-witness\": patch\n---\n\nA hand-written note.\n" },
      ],
      changelog: null,
      renderProvenance: render,
    }),
    [],
  );
});
