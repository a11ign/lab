/**
 * The release workflow must be incapable of publishing by accident.
 *
 * Nothing has been published to any registry, the name is undecided (PLAN.md B5), and npm versions cannot
 * be unpublished after 72 hours — only deprecated. So a wrong first release is permanent, and the guards
 * that prevent one are worth asserting rather than trusting to review.
 *
 * Four independent guards, and independence is the point: any single one would be a single point of
 * failure, which is this repo's rule about a verification not sharing a failure mode with its action.
 * A change that removes one should be deliberate, and this test is what makes it deliberate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../../../..");
const workflow = readFileSync(resolve(REPO, ".github/workflows/release.yml"), "utf8");
const config = JSON.parse(readFileSync(resolve(REPO, ".changeset/config.json"), "utf8"));

/**
 * The `on:` block ALONE, not the whole file.
 *
 * The first version of this test searched the file for `^  release:` and matched the JOB named `release`,
 * reporting a trigger that does not exist. A guard that fires on the wrong text is a guard that gets
 * disabled, so it reads the block it means.
 */
const triggerBlock = (): string => {
  const start = workflow.indexOf("\non:\n");
  assert.notEqual(start, -1, "release.yml has no `on:` block at all");
  const rest = workflow.slice(start + 5);
  const end = rest.search(/^\S/m);            // the next top-level key, e.g. `jobs:`
  return end === -1 ? rest : rest.slice(0, end);
};

test("guard 1: the release workflow has no automatic trigger", () => {
  const on = triggerBlock();
  assert.match(on, /^\s{2}workflow_dispatch:/m,
    "release.yml must be dispatch-only — a push, tag or schedule trigger can fire it without a human");
  for (const trigger of ["push", "schedule", "release", "pull_request", "repository_dispatch"]) {
    assert.ok(!new RegExp(`^\\s{2}${trigger}:`, "m").test(on),
      `release.yml declares a '${trigger}' trigger, so it can start without anyone deciding to release`);
  }
});

test("guard 2: dry-run defaults to true, so the default path publishes nothing", () => {
  assert.match(workflow, /dry-run:[\s\S]{0,200}?default:\s*true/,
    "the dry-run input must default to true; a default of false makes the safe path the opt-in one");
});

test("guard 3: publishing needs an exact typed string, not a click", () => {
  assert.match(workflow, /confirm:/, "there must be a confirm input");
  assert.match(workflow, /!=\s*"publish-for-real"/,
    "the confirm value must be compared exactly — a boolean or dropdown can be clicked by mistake");
  assert.match(workflow, /if:\s*inputs\.dry-run == false && inputs\.confirm == 'publish-for-real'/,
    "the publish step itself must require both, not just the preceding check step");
});

test("guard 4: access stays restricted until the name is settled", () => {
  assert.equal(config.access, "restricted",
    "`.changeset/config.json` access must stay 'restricted' until PLAN.md B5 is closed. A correctly "
    + "confirmed run still fails at the access check, so no accidental release can claim a name.");
  assert.match(workflow, /access.*!=.*"public"/,
    "the workflow must read the access setting back and refuse, rather than assuming it");
});

test("guard 5: the consumer path must have passed for the exact commit being published", () => {
  // `action-smoke` drives the published Action the way a user does — `uses: ./`, inputs only, no repo
  // knowledge — so it is the only check in the release path that exercises the weights through a
  // consumer's route. It already runs on every push under `packages/scorer/**`, which is where the
  // weights live; what was missing is that nothing REQUIRED it. Two workflows both passing is not one
  // gating the other, and a publish could be dispatched while the consumer path was red or never ran.
  //
  // Every assertion below reads THE STEP, not the file. Two earlier versions read the file and passed
  // against mutations that broke the property: an alternation matched a `sha=` assignment that survived
  // the query losing `--commit`, and a dry-run check looked at the text BEFORE the step, so adding
  // `if: inputs.dry-run` INSIDE it changed nothing. Both were caught by mutation, never by reading.
  const from = workflow.indexOf("- name: The consumer path must have passed");
  assert.notEqual(from, -1, "the consumer-path step must exist at all");
  const step = workflow.slice(from, workflow.indexOf("- name:", from + 10));

  assert.match(step, /gh run list[\s\S]{0,200}--commit=/,
    "the QUERY must be pinned to a commit; without it a green run of any other commit satisfies this");
  assert.match(step, /--commit="\$sha"|--commit="\$\{\{ github\.sha \}\}"/,
    "and pinned to THIS commit — a check bounded to a population that excludes the thing being asked "
    + "about is this repo's most-repeated defect");

  const refusesAt = step.search(/!=\s*"success"/);
  const exitsAt = step.indexOf("exit 1");
  assert.ok(refusesAt !== -1 && exitsAt > refusesAt,
    "anything other than success must refuse — a workflow that never ran returns no conclusion, and "
    + "treating an absent result as a pass is the examined-nothing failure at the last possible moment");

  assert.doesNotMatch(step, /if:\s*inputs\.dry-run/,
    "the consumer-path check must not be skipped in dry run. A dry run exists to say whether the real "
    + "one would work, so passing here while the consumer path is red is the one lie this workflow "
    + "must not tell");
});

test("the gate runs, and is not allowed to fail softly", () => {
  assert.match(workflow, /npm run release:gate/, "a release must run the full gate");
  assert.ok(!/continue-on-error:\s*true/.test(workflow),
    "no step in the release path may continue on error — that is how a release ships past its own gate");
});

test("the npm-workspaces lockfile trap is handled", () => {
  // `changeset version` does not update package-lock.json. Without the install that follows, the lockfile
  // ships describing the PREVIOUS versions, invisible until a consumer's clean install resolves the wrong
  // tree. Asserted on the npm script, since that is the one place both CI and a human use.
  const scripts = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8")).scripts;
  assert.match(scripts["release:version"], /changeset version\s*&&\s*npm install/,
    "release:version must reinstall after versioning, or the lockfile ships stale");
});

test("every package Changesets would publish is one we mean to publish", () => {
  // A package that becomes public by accident is as bad as a publish by accident. `lab` ships nothing by
  // design — what ships is its output — and `nvda-speech` is internal.
  for (const name of ["lab", "nvda-speech"]) {
    const pkg = JSON.parse(readFileSync(resolve(REPO, `packages/${name}/package.json`), "utf8"));
    assert.equal(pkg.private, true, `packages/${name} must stay private or Changesets will version it`);
  }
});
