/**
 * #909 (The CI Reset, step 4): THE WORKFLOW COUNT, ASSERTED AGAINST THE DIRECTORY AND NAMED.
 *
 * The plan said 8, the row said 10, and both were inherited from a table rather than derived from the
 * decisions that followed it: ceo ruled on #901 that the two board workflows stay (seven London-clock runs a
 * day pinned by board-schedule.test.ts), and on #909 that auto-arm.yml stays (drafts cannot be armed, and it
 * hosts the arming sweep's non-push triggers; its update-branch job went in #3046 and the file stayed). So the number is what the directory holds after
 * trunk-guard.yml, trunk-sweep.yml and close-rows.yml collapsed into trunk.yml: thirteen, each named here so
 * a fourteenth arriving is a failure with a name rather than a number. The fourteenth arrived with #2519's
 * registry gate, named below with its reason. The fifteenth is `dependency-pr-body.yml` (#3137, ADR 0041 decision 4): the one narrow way
 * a dependency pull request passes the body checks. The sixteenth is `weekly-review.yml` (#3183): the schedule that files the weekly outsider review row. The seventeenth is `ci-health.yml` (#3212): the schedule that reads the chairman's CI targets and comments them on #928. The eighteenth is `mutation-comment.yml` (#3282, decided on #3213): the survivors of a pull request's own changed lines as a NON-BLOCKING comment, in two jobs so the one that runs the pull request's code holds no write token. The nineteenth is `token-reach.yml` (#3717): the probe that once lived in `release.yml`, moved out when the version pull request that held the bot token went. (`agent-org-bump.yml`, once named the nineteenth, #3450, was deleted by #3534: there is no pin to bump. A workflow once named `agent-org-extraction.yml`, ADR 0040 decision 6's one-time push of
 * `agent-org` into its own repository, left with the directory in #2976: it had done its one push.) A row that removes or
 * adds one moves this list in the same commit and says why.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = fileURLToPath(new URL("../../../../.github/workflows/", import.meta.url));

const THE_NINETEEN = [
  "action-smoke.yml",
  "auto-arm.yml",           // arms drafts on ready_for_review; the arming sweep and the stalled report
  "board-report.yml",       // London-clock editions, kept by #901's ruling
  "board-summary-check.yml",
  "capture-regression.yml",
  "ci-health.yml",          // #3212: reads the CI targets weekly and comments the table on #928; a schedule, never a gate, `issues: write` only
  "ci.yml",                 // the one required check, `gate`
  "consumer-gate.yml",
  "dependency-pr-body.yml", // #3137: a fixed body fragment on a minor or patch Dependabot pull request, so the Acceptance and Closes checks read it
  "mutation-comment.yml",   // #3282: survivors of the changed lines as a non-blocking comment; the job that runs the PR's code holds `contents: read` only
  "nightly.yml",            // coverage, ready-audit, doc-report, the org watch, and #417's hourly sweeps
  "registry-consumer-gate.yml", // #2519: install what the registry SERVES into an empty directory; daily, after `release`, on demand
  "release.yml",
  "reusable-acceptance.yml",
  "reusable-board.yml",
  "reusable-build-test.yml",
  "token-reach.yml",        // #3710/#3717: the daily read of whether the bot token reaches the repository; moved out of release.yml with the version pull request, `permissions: {}`
  "trunk.yml",              // #909: gate, revert-on-red, close-rows and the watchdogs, on every push to main
  "weekly-review.yml",      // #3183: files ONE row a week for the outsider review; a schedule, never a gate, `issues: write` only
];

test("#909: the workflow directory holds exactly the nineteen named here, no more and no fewer", () => {
  const onDisk = readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  assert.deepEqual(onDisk, [...THE_NINETEEN].sort(),
    "a workflow arrived or left without this list moving in the same commit -- name it here with its reason");
  assert.equal(onDisk.length, 19);
});

test("#909: the three collapsed workflows are gone, and the one that replaced them exists", () => {
  const onDisk = new Set(readdirSync(WORKFLOWS_DIR));
  for (const gone of ["trunk-guard.yml", "trunk-sweep.yml", "close-rows.yml"]) {
    assert.ok(!onDisk.has(gone), `${gone} was folded into trunk.yml by #909`);
  }
  assert.ok(onDisk.has("trunk.yml"));
});
