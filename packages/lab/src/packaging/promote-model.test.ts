/**
 * Promotion must refuse a candidate that has not passed, and must write a MAJOR changeset when it has.
 *
 * Promoting a model is a release of `@a11y-witness/scorer` — ADR 0007: the weights are that package's API,
 * and any retrain is a major, because a consumer's build goes from passing to failing with no code change.
 * Before 2026-08-22 there was no promotion step at all and this was an undocumented manual copy, so the two
 * gates were whatever the person remembered to check.
 *
 * The bump level is asserted because it is the one thing a commit-message-driven tool could never get
 * right here: `fix(scorer): retrain` reads as a patch, and of the 14 commits that have changed the shipped
 * weights a conventional-commit parser would have called six patches, four minors and three no release.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { promote } from "../../scripts/promote-model.mjs";

const REPORT = {
  releaseEligible: true,
  dataset: { records: 1976 },
  outOfDistribution: { inDistributionFloor: 0.7, derivedFloor: 0.5587, floorSource: "calibration-set" },
  criteria: { "4.1.2": { subtypes: { "4.1.2:unnamed-control": { threshold: 0.9 } } } },
};

function candidate(training: object, acceptance: object): { dir: string; name: string } {
  const root = mkdtempSync(join(tmpdir(), "promote-"));
  const dir = join(root, "model-under-test");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "training-report.json"), JSON.stringify(training));
  writeFileSync(join(dir, "acceptance-report.json"), JSON.stringify(acceptance));
  writeFileSync(join(dir, "model.safetensors"), "not really weights");
  return { dir, name: "under-test" };
}

const run = (training: object, acceptance: object) => {
  const { dir, name } = candidate(training, acceptance);
  try {
    return promote({ candidate: dir, candidateName: name, dryRun: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("a model that passed both gates yields a MAJOR changeset for the scorer", () => {
  const { entry } = run(REPORT, { passed: true });
  assert.match(entry, /"@a11y-witness\/scorer": major/,
    "any retrain is a major — the weights are the API");
});

test("the provenance ADR 0007 requires is filled in from the report, not left to memory", () => {
  const { entry } = run(REPORT, { passed: true });
  for (const expected of ["1976", "0.7", "0.5587", "calibration-set", "4.1.2:unnamed-control", "0.9"]) {
    assert.ok(entry.includes(expected), `changelog entry is missing ${expected}`);
  }
});

test("a candidate that is not releaseEligible is refused, and the reason is named", () => {
  assert.throws(
    () => run({ ...REPORT, releaseEligible: false, releaseBlockedBy: ["4.1.2 recall"] }, { passed: true }),
    /not releaseEligible[\s\S]*4\.1\.2 recall/);
});

test("a candidate that failed held-out acceptance is refused", () => {
  assert.throws(
    () => run(REPORT, { passed: false, failureReasons: ["3.3.2: acceptance false positives"] }),
    /did not pass held-out acceptance[\s\S]*3\.3\.2/);
});

test("a candidate with no acceptance report at all is refused, not assumed good", () => {
  const root = mkdtempSync(join(tmpdir(), "promote-"));
  const dir = join(root, "model-bare");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "training-report.json"), JSON.stringify(REPORT));
  assert.throws(() => promote({ candidate: dir, candidateName: "bare", dryRun: true }),
    /acceptance report is missing/);
});

test("a dry run writes nothing", () => {
  // The guard on the guard: a dry run that copied weights would be worse than no dry run, because it
  // would be trusted.
  const { dir, name } = candidate(REPORT, { passed: true });
  const before = readdirSync(dir).sort();
  promote({ candidate: dir, candidateName: name, dryRun: true });
  assert.deepEqual(readdirSync(dir).sort(), before);
  rmSync(dir, { recursive: true, force: true });
});

test("a candidate WORSE than the shipped model is refused, even if it passed both gates", () => {
  // The gap this closes: `releaseEligible` and `passed` are absolute bars — "good enough" — and a
  // candidate can clear both while losing ground on a criterion nobody looked at. Measured on the first
  // candidate this was applied to: identical recall, and 3.3.2:placeholder-only precision 1.000 -> 0.368.
  const shipped = {
    criteria: { "3.3.2": { subtypes: { "3.3.2:placeholder-only":
      { threshold: 0.45, development: { precision: 1, recall: 1 } } } } },
  };
  const worse = {
    ...REPORT,
    criteria: { "3.3.2": { subtypes: { "3.3.2:placeholder-only":
      { threshold: 0.5, development: { precision: 0.368, recall: 0.913 } } } } },
  };
  const { dir, name } = candidate(worse, { passed: true });
  assert.throws(
    () => promote({ candidate: dir, candidateName: name, dryRun: true, shippedReport: shipped }),
    /WORSE than the shipped model[\s\S]*3\.3\.2:placeholder-only precision 1\.000 -> 0\.368/);
  rmSync(dir, { recursive: true, force: true });
});

test("a NEW head is coverage, not a regression", () => {
  // Blocking on a head the shipped model lacks would make adding a criterion impossible.
  const shipped = { criteria: {} };
  const { dir, name } = candidate({
    ...REPORT,
    criteria: { "2.4.2": { subtypes: { "2.4.2:route-title-stale":
      { threshold: 0.3, development: { precision: 0.8, recall: 0.7 } } } } },
  }, { passed: true });
  const { entry } = promote({ candidate: dir, candidateName: name, dryRun: true, shippedReport: shipped });
  assert.match(entry, /major/);
  rmSync(dir, { recursive: true, force: true });
});

test("a deliberate regression is allowed, and SAID SO in the changelog", () => {
  const shipped = {
    criteria: { "3.3.2": { subtypes: { "3.3.2:placeholder-only":
      { threshold: 0.45, development: { precision: 1, recall: 1 } } } } },
  };
  const worse = {
    ...REPORT,
    criteria: { "3.3.2": { subtypes: { "3.3.2:placeholder-only":
      { threshold: 0.5, development: { precision: 0.368, recall: 0.913 } } } } },
  };
  const { dir, name } = candidate(worse, { passed: true });
  const { entry } = promote({ candidate: dir, candidateName: name, dryRun: true,
    shippedReport: shipped, acceptRegression: true });
  assert.match(entry, /Accepted with a known regression/,
    "an accepted regression must appear in the changelog — hiding it is worse than blocking it");
  rmSync(dir, { recursive: true, force: true });
});

test("noise below the tolerance is not a regression", () => {
  const shipped = {
    criteria: { "1.1.1": { subtypes: { "1.1.1:missing-alt":
      { threshold: 0.25, development: { precision: 1, recall: 1 } } } } },
  };
  const jitter = {
    ...REPORT,
    criteria: { "1.1.1": { subtypes: { "1.1.1:missing-alt":
      { threshold: 0.3, development: { precision: 0.999, recall: 1 } } } } },
  };
  const { dir, name } = candidate(jitter, { passed: true });
  promote({ candidate: dir, candidateName: name, dryRun: true, shippedReport: shipped });
  rmSync(dir, { recursive: true, force: true });
});
