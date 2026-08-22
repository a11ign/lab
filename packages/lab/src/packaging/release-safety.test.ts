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
