/**
 * Promotion must refuse a candidate that has not passed, and must write a BREAKING changeset when it has:
 * `minor` while every public package is 0.x, `major` from 1.0 (#1396).
 *
 * Promoting a model is a release of `@a11ign/scorer` — ADR 0007: the weights are that package's API,
 * and any retrain is breaking, because a consumer's build goes from passing to failing with no code change.
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

import { promote, promotionLevel, publicPackageVersions } from "../../scripts/promote-model.mjs";

/** Every public package before version one, as the tree reads during the first publish. */
const ALL_ZERO = { "a11ign": "0.0.0", "@a11ign/evidence": "0.0.0", "@a11ign/judge": "0.0.0",
  "@a11ign/nvda-worker": "0.0.0", "@a11ign/scorer": "0.0.0", "@a11ign/worker-fleet": "0.0.0" };

/** The real `.changeset/`, because the name used to be computed from what is in it. */
const CHANGESET_DIR = new URL("../../../../.changeset/", import.meta.url).pathname;

const HEAD = {
  head: "subtype_4_1_2_state_change_silent",
  threshold: 0.85,
  development: { records: 1685, positive: 62, precision: 1, recall: 1, falsePositive: 0 },
};

/** A candidate that has earned promotion. Shaped as the trainer writes it, minus the verdict it used to
 *  stamp — `releasability()` computes that now, from these facts plus the acceptance report. */
const REPORT = {
  dataset: { records: 1976 },
  outOfDistribution: { inDistributionFloor: 0.7, derivedFloor: 0.5587, floorSource: "calibration-set" },
  representation: { encoder: "all-MiniLM-L6-v2" },
  criteria: { "4.1.2": { subtypes: { "4.1.2:state-change-silent": HEAD } } },
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

const run = (training: object, acceptance: object, versions: Record<string, string> = ALL_ZERO) => {
  const { dir, name } = candidate(training, acceptance);
  try {
    return promote({ candidate: dir, candidateName: name, dryRun: true, versions });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("#1396 while every public package is 0.x, a model that passed both gates yields a MINOR changeset", () => {
  const { entry } = run(REPORT, { passed: true }, ALL_ZERO);
  assert.match(entry, /^"@a11ign\/scorer": minor$/m,
    "a retrain is breaking, and under 0.x breaking is a minor -- a major here is what made the first publish 1.0.0");
  assert.doesNotMatch(entry, /": major/);
  assert.match(entry, /\*\*Minor, because no public package has reached 1\.0/, "the changelog says why it is a minor");
});

test("#1396 once ANY public package is 1.x, the same promotion yields a MAJOR changeset", () => {
  const { entry } = run(REPORT, { passed: true }, { ...ALL_ZERO, "@a11ign/judge": "1.0.0" });
  assert.match(entry, /^"@a11ign\/scorer": major$/m, "any retrain is a major from 1.0 — the weights are the API");
  assert.match(entry, /\*\*Major, and not because the API changed/);
});

test("#1396 promotionLevel: the boundary is the first 1.x, and no versions at all is a refusal", () => {
  assert.equal(promotionLevel({ a: "0.0.0" }), "minor");
  assert.equal(promotionLevel({ a: "0.9.12", b: "0.1.0" }), "minor");
  assert.equal(promotionLevel({ a: "0.9.12", b: "1.0.0" }), "major");
  assert.equal(promotionLevel({ a: "2.3.4" }), "major");
  assert.throws(() => promotionLevel({}), /no public package versions were read/,
    "an empty read must not satisfy 'every version is below 1' and silently choose minor");
});

test("#1396 publicPackageVersions reads the real tree: exactly the six public packages, and today that is a minor", () => {
  const versions = publicPackageVersions();
  // A WRITTEN expectation, not the directory listing re-read: a seventh public package, or one that went
  // private, should make this fail so somebody decides what it means for the release level.
  assert.deepEqual(Object.keys(versions).sort(), Object.keys(ALL_ZERO).sort());
  assert.equal(promotionLevel(versions), "minor");
});

test("the provenance ADR 0007 requires is filled in from the report, not left to memory", () => {
  const { entry } = run(REPORT, { passed: true });
  for (const expected of ["1976", "0.7", "0.5587", "calibration-set", "4.1.2:state-change-silent", "0.85"]) {
    assert.ok(entry.includes(expected), `changelog entry is missing ${expected}`);
  }
});

test("a candidate with an uncalibrated head is refused, and the head is named", () => {
  // Was "refused because releaseEligible is false" — a self-declared verdict the trainer could not know.
  // Now it is refused because a head the MODEL decides has false positives at its threshold, which is a
  // fact in the report rather than a claim about it.
  assert.throws(
    () => run({
      ...REPORT,
      criteria: { "3.3.2": { subtypes: { "3.3.2:placeholder-only":
        { threshold: 0.5, development: { positive: 23, precision: 0.368, recall: 0.913, falsePositive: 36 } } } } },
    }, { passed: true }),
    /not releasable[\s\S]*placeholder-only: 36 false positive/);
});

test("a candidate that failed held-out acceptance is refused", () => {
  assert.throws(
    () => run(REPORT, { passed: false, failureReasons: ["3.3.2: acceptance false positives"] }),
    /acceptance failed[\s\S]*3\.3\.2/);
});

test("a candidate with no acceptance report at all is refused, not assumed good", () => {
  const root = mkdtempSync(join(tmpdir(), "promote-"));
  const dir = join(root, "model-bare");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "training-report.json"), JSON.stringify(REPORT));
  assert.throws(() => promote({ candidate: dir, candidateName: "bare", dryRun: true }),
    /acceptance has not been run/);
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

test("a candidate worse on the FIXED held-out set is refused, even having passed its own gates", () => {
  // Compared on acceptance, not development — a development split describes the corpus a model was trained
  // on, and comparing two models' own splits reports the harder corpus as a regression. Thirteen of
  // sixteen blockers on the first real candidate were that artefact.
  const shippedAcceptance = { passed: true,
    criteria: { "3.3.2": { modelEvaluated: true, precision: 1, recall: 1 } } };
  const { dir, name } = candidate(REPORT, { passed: true,
    criteria: { "3.3.2": { modelEvaluated: true, precision: 0.4, recall: 1 } } });
  assert.throws(
    () => promote({ candidate: dir, candidateName: name, dryRun: true,
      shippedReport: REPORT, shippedAcceptance }),
    /not releasable[\s\S]*3\.3\.2 held-out precision 1\.000 -> 0\.400/);
  rmSync(dir, { recursive: true, force: true });
});

test("a NEW head is coverage, not a regression", () => {
  // Blocking on a head the shipped model lacks would make adding a criterion impossible.
  const shipped = { criteria: {} };
  const { dir, name } = candidate({
    ...REPORT,
    criteria: { "2.4.2": { subtypes: { "2.4.2:route-title-stale":
      { threshold: 0.3, development: { positive: 30, precision: 0.8, recall: 0.7, falsePositive: 0 } } } } },
  }, { passed: true });
  const { entry } = promote({ candidate: dir, candidateName: name, dryRun: true, shippedReport: shipped,
    versions: ALL_ZERO });
  assert.match(entry, /^"@a11ign\/scorer": minor$/m, "promoted, not refused");
  rmSync(dir, { recursive: true, force: true });
});

test("a deliberate regression is allowed, and SAID SO in the changelog", () => {
  const shipped = {
    criteria: { "3.3.2": { subtypes: { "3.3.2:placeholder-only":
      { threshold: 0.45, development: { positive: 20, precision: 1, recall: 1, falsePositive: 0 } } } } },
  };
  const worse = {
    ...REPORT,
    criteria: { "3.3.2": { subtypes: { "3.3.2:placeholder-only":
      { threshold: 0.5, development: { positive: 23, precision: 0.368, recall: 0.913, falsePositive: 0 } } } } },
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
      { threshold: 0.25, development: { positive: 76, precision: 1, recall: 1, falsePositive: 0 } } } } },
  };
  const jitter = {
    ...REPORT,
    criteria: { "1.1.1": { subtypes: { "1.1.1:missing-alt":
      { threshold: 0.3, development: { positive: 76, precision: 0.999, recall: 1, falsePositive: 0 } } } } },
  };
  const { dir, name } = candidate(jitter, { passed: true });
  promote({ candidate: dir, candidateName: name, dryRun: true, shippedReport: shipped });
  rmSync(dir, { recursive: true, force: true });
});

test("the changeset is named for WHAT IS PROMOTED, never for a count of unrelated changesets", () => {
  // REPRODUCING THE FAULT, because the previous scheme's docstring claimed it could not collide.
  //
  // It named the file `promote-<candidate>-<count of .md in .changeset/ + 1>.md`, on the assumption that
  // the count only grows. It does not: `changeset version` CONSUMES changesets at release, and an
  // unrelated one moves the number without having anything to do with a promotion. Measured on this repo
  // 2026-08-27 -- five changesets on disk, so the next promotion computed `promote-candidate-6.md`, a
  // TRACKED file already holding an earlier promotion's release note. The lab's dirty
  // `M .changeset/promote-candidate-6.md` was that overwrite, presenting as an edit rather than a loss.
  //
  // The changeset is the only record of why weights moved, so losing one loses a release's reason while
  // the tree still looks tidy -- which is why nothing caught it.
  const before = run(REPORT, { passed: true, evaluated: 90, falsePositive: 0, falseNegative: 0 });

  // AN UNRELATED CHANGESET APPEARS. Under the old scheme this alone moved the name; under the new one it
  // cannot, because the name is a function of the release and of nothing else.
  const intruder = join(CHANGESET_DIR, "zz-unrelated-fixture.md");
  writeFileSync(intruder, '---\n"@a11ign/scorer": patch\n---\n\nnot a promotion\n');
  try {
    const after = run(REPORT, { passed: true, evaluated: 90, falsePositive: 0, falseNegative: 0 });
    assert.equal(after.target, before.target,
      "an unrelated changeset must not move the name -- that is exactly how one promotion came to "
        + "overwrite another's release note");
  } finally {
    rmSync(intruder, { force: true });
  }

  // A HASH, not a small integer. The distinction matters: `-6` is reachable by counting to six, and
  // therefore reachable again.
  assert.match(before.target, /promote-under-test-[0-9a-f]{8}\.md$/,
    "the suffix must identify the release, not enumerate the directory");

  // DIFFERENT WEIGHTS, DIFFERENT NAME. Idempotence is only half the property -- a scheme that returned a
  // constant would pass the assertion above and lose every note but the last.
  const moved = JSON.parse(JSON.stringify(REPORT));
  moved.criteria["4.1.2"].subtypes["4.1.2:state-change-silent"].threshold = 0.9;
  const other = run(moved, { passed: true, evaluated: 90, falsePositive: 0, falseNegative: 0 });
  assert.notEqual(other.target, before.target,
    "two different promotions must never land on one filename");
});
