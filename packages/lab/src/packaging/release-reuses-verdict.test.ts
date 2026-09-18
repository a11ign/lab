/**
 * #1308: the release job's "Coverage — the whole-repo threshold" step re-runs 301s of coverage that
 * `nightly.yml`'s own `coverage` job already spent on the EXACT same sha, when it did. This pins
 * `coverageVerdictDecision`, the whole of that call: reuse only a SUCCESSFUL verdict for THIS sha, never
 * the latest one, never a run-level rollup that some other nightly job (`gateSweep`, `closeRowsSweep`,
 * `watch`) could have failed for a reason that says nothing about coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageVerdictDecision } from "../../../../scripts/release-reuses-verdict.mjs";

const RELEASE_SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const PARENT_SHA = "9988776655443322119988776655443322119988";

test("a successful nightly verdict for THIS sha means reuse, no run -- the positive control", () => {
  const decision = coverageVerdictDecision({
    releaseSha: RELEASE_SHA,
    candidates: [{ sha: RELEASE_SHA, conclusion: "success" }],
  });
  assert.deepEqual(decision, { reuse: true, sha: RELEASE_SHA });
});

test("no verdict for this sha at all means run", () => {
  const decision = coverageVerdictDecision({ releaseSha: RELEASE_SHA, candidates: [] });
  assert.equal(decision.reuse, false);
  assert.match(decision.reason, /no nightly coverage verdict recorded/);
  assert.match(decision.reason, new RegExp(RELEASE_SHA));
});

test("a verdict for a DIFFERENT sha, such as the parent, means run -- not the latest run, the right one", () => {
  // Nightly ran against the PARENT commit last night; this release's own sha has never been covered.
  // A decision that matched "the most recent candidate" instead of the exact sha would wrongly reuse this.
  const decision = coverageVerdictDecision({
    releaseSha: RELEASE_SHA,
    candidates: [{ sha: PARENT_SHA, conclusion: "success" }],
  });
  assert.equal(decision.reuse, false);
  assert.match(decision.reason, new RegExp(RELEASE_SHA));
});

test("a FAILED nightly verdict for this sha means run, not reuse", () => {
  const decision = coverageVerdictDecision({
    releaseSha: RELEASE_SHA,
    candidates: [{ sha: RELEASE_SHA, conclusion: "failure" }],
  });
  assert.equal(decision.reuse, false);
  assert.match(decision.reason, /did not succeed/);
  assert.match(decision.reason, /failure/);
});

test("a skipped run for this sha does not shadow a successful one for the SAME sha -- found by running "
  + "this against the real repo: nightly's hourly org-watch tick also touches the coverage job (skipped) "
  + "beside the one real daily run (success), both against the same main-tip sha", () => {
  const decision = coverageVerdictDecision({
    releaseSha: RELEASE_SHA,
    candidates: [
      { sha: RELEASE_SHA, conclusion: "skipped" },
      { sha: RELEASE_SHA, conclusion: "success" },
    ],
  });
  assert.deepEqual(decision, { reuse: true, sha: RELEASE_SHA });
});

test("every entry for this sha is skipped (nightly never actually ran coverage that day) means run", () => {
  const decision = coverageVerdictDecision({
    releaseSha: RELEASE_SHA,
    candidates: [{ sha: RELEASE_SHA, conclusion: "skipped" }],
  });
  assert.equal(decision.reuse, false);
  assert.match(decision.reason, /did not succeed/);
  assert.match(decision.reason, /skipped/);
});

test("multiple candidates: matches by sha, not by position or recency", () => {
  const decision = coverageVerdictDecision({
    releaseSha: RELEASE_SHA,
    candidates: [
      { sha: PARENT_SHA, conclusion: "success" },
      { sha: RELEASE_SHA, conclusion: "success" },
    ],
  });
  assert.deepEqual(decision, { reuse: true, sha: RELEASE_SHA });
});
