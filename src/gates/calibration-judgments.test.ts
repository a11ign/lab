/**
 * THE CALIBRATION SWEEP KEEPS THE EVIDENCE IT SCORED FROM (#4293, for #4241).
 *
 * `calibrate-abstention.ts` built each page's findings -- `wcag`, the quoted `evidence`, `mapping` -- to
 * derive its outcomes, and stored only the criteria, so the 395 referrals could not be re-read per page.
 * `calibration-judgments.json` is the same findings, written beside the sweep.
 *
 * Under `src/gates/` and not beside the script, because the lab's every-test-file check reaches no test
 * under `scripts/` (lab#31). The scorer is Python, so each fixture hands `scoredPage` the record
 * `score.py` would have printed; everything past that line is the script's own code.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { calibrationJudgmentsPath, scoredPage, writeCalibrationJudgments } from "../../scripts/calibrate-abstention.ts";

const SCORED_AT = "2026-10-08T22:00:00.000Z";

/** A scorer record that fires 2.4.4 (link purpose) with the evidence to back it, so a finding is written. */
const FIRING_RECORD = {
  scores: { "2.4.4": 0.93 },
  predictions: { "2.4.4": true },
  novelty: { nearestTrainingCosine: 0.81 },
};
/** A scorer record that fires nothing. */
const SILENT_RECORD = { scores: { "2.4.4": 0.02 }, predictions: { "2.4.4": false }, novelty: { nearestTrainingCosine: 0.64 } };

/** `click here` is also what the link-purpose RULE flags, so the quiet page quotes a link that names its target. */
const capture = (url: string, link: string) => ({
  url,
  transcript: [`link, ${link}`],
  structure: { links: [link] },
  interaction: {},
});

const FIXTURE_PAGES = [
  { entry: { capture: capture("https://example.test/bad", "click here"), publishedClaim: "conformant" }, record: FIRING_RECORD, claimExcludes: [] },
  { entry: { capture: capture("https://example.test/good", "Read the 2025 annual report"), publishedClaim: "conformant" }, record: SILENT_RECORD, claimExcludes: ["2.4.4"] },
];

const results = () => FIXTURE_PAGES.map(scoredPage);
const scratch = () => mkdtempSync(join(tmpdir(), "calibration-judgments-"));
interface JudgmentRecord { url: string; claim: string; findings: { wcag: string; evidence: string; mapping?: string }[]; cantTell: string[]; predicted: string[] }
const written = (outDir: string): { scoredAt: string; pages: JudgmentRecord[] } => JSON.parse(readFileSync(calibrationJudgmentsPath(outDir), "utf8"));

test("a two-page sweep writes two records, each carrying url and claim", () => {
  const outDir = scratch();
  writeCalibrationJudgments(results(), { outDir, scoredAt: SCORED_AT });
  const file = written(outDir);
  assert.equal(file.scoredAt, SCORED_AT);
  assert.deepEqual(file.pages.map((p) => [p.url, p.claim]), [
    ["https://example.test/bad", "conformant"],
    ["https://example.test/good", "conformant"],
  ]);
});

test("positive control: a page whose scoring yields a finding writes its wcag and a NON-EMPTY evidence string", () => {
  const outDir = scratch();
  writeCalibrationJudgments(results(), { outDir, scoredAt: SCORED_AT });
  const [finding] = written(outDir).pages[0].findings;
  assert.match(finding.wcag, /^2\.4\.4/);
  assert.equal(typeof finding.evidence, "string");
  assert.ok(finding.evidence.length > 0, "the quoted announcement is the whole point of the file");
  assert.equal(finding.mapping, undefined, "a model finding carries no mapping, and the file must not invent one");
});

test("a page with no findings keeps its record, with findings: []", () => {
  const outDir = scratch();
  writeCalibrationJudgments(results(), { outDir, scoredAt: SCORED_AT });
  const quiet = written(outDir).pages[1];
  assert.equal(quiet.url, "https://example.test/good");
  assert.deepEqual(quiet.findings, []);
});

test("the cantTell and predicted lists equal the ones the sweep stores for the same page", () => {
  const outDir = scratch();
  const sweepPages = results().map((r) => r.page);
  writeCalibrationJudgments(results(), { outDir, scoredAt: SCORED_AT });
  const pages = written(outDir).pages;
  assert.deepEqual(pages.map((p) => p.cantTell), sweepPages.map((p) => p.cantTell));
  assert.deepEqual(pages.map((p) => p.predicted), sweepPages.map((p) => p.predicted));
  assert.ok(pages[0].cantTell.length > 0, "positive control: the firing page IS referred, so the equality is not over two empty lists");
});

test("the sweep's own row is unchanged: no findings key, and the keys in the order PLAN.md's numbers were read in", () => {
  const [{ page }] = results();
  assert.deepEqual(Object.keys(page), ["url", "claim", "cosine", "predicted", "cantTell", "claimExcludes"]);
});

test("abstention-sweep.json already in the directory is left byte-for-byte as it was", () => {
  const outDir = scratch();
  const sweep = join(outDir, "abstention-sweep.json");
  const before = JSON.stringify({ model: "shipped", calibrationPages: 2, scored: results().map((r) => r.page), rows: [] }, null, 2);
  writeFileSync(sweep, before);
  writeCalibrationJudgments(results(), { outDir, scoredAt: SCORED_AT });
  assert.equal(readFileSync(sweep, "utf8"), before);
});

test("a named model writes its own file, and the shipped model's is not overwritten", () => {
  const outDir = scratch();
  writeCalibrationJudgments(results(), { outDir, scoredAt: SCORED_AT });
  const shipped = readFileSync(calibrationJudgmentsPath(outDir), "utf8");
  const candidate = writeCalibrationJudgments(results().slice(0, 1), { outDir, model: "/tmp/candidate", scoredAt: SCORED_AT });
  assert.notEqual(candidate, calibrationJudgmentsPath(outDir));
  assert.equal(readFileSync(calibrationJudgmentsPath(outDir), "utf8"), shipped);
});
