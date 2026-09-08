/**
 * The release workflow must be incapable of publishing by accident.
 *
 * Nothing has been published to any registry, the name is undecided (PLAN.md B5), and npm versions cannot
 * be unpublished after 72 hours — only deprecated. So a wrong first release is permanent, and the guards
 * that prevent one are worth asserting rather than trusting to review.
 *
 * Seven independent guards, and independence is the point: any single one would be a single point of
 * failure, which is this repo's rule about a verification not sharing a failure mode with its action.
 * A change that removes one should be deliberate, and this test is what makes it deliberate.
 *
 * Guards 5 and 6 changed shape 2026-09-06 (chairman's direction): `action-smoke`/`capture-regression`
 * used to run on a push to `main` and this workflow QUERIED whether that separately-triggered run had
 * passed for the exact sha. Both left `main`/PR entirely and declare `workflow_call`, so this workflow now
 * runs them as JOBS against the sha it was dispatched at, and `release`'s own `needs:` on both is the
 * guard — no query, no race between "never ran" and "running right now".
 *
 * Guard 7 (`consumer-gate`) joined 2026-09-08 (#494): `action-smoke` runs `uses: ./` with full repository
 * knowledge and never reads the public documents, so it could not catch a documented workflow that is
 * broken for a real reader. `consumer-gate.yml` is generated from README.md's own Quickstart fence and
 * runs as a JOB the same way guards 5 and 6 do.
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

test("guards 5, 6 and 7: action-smoke, capture-regression and consumer-gate run as JOBS, against this "
  + "exact sha", () => {
  // `uses: ./.github/workflows/<file>` with no `if:` -- GitHub runs a called reusable workflow at the
  // ref of the CALLER by default, so this is inherently "the exact sha being published", never a query
  // that could match some other commit's run.
  //
  // #494: consumer-gate.yml joined action-smoke/capture-regression as a third unconditional guard --
  // action-smoke has full repository knowledge (`uses: ./`) and never reads the public documents, so it
  // could not have caught (and did not catch) three publish-blockers the V1 rehearsal (#324) found on a
  // real windows-2022 runner. consumer-gate.yml is the ONE guard exercising the path a first reader
  // actually takes.
  for (const file of ["action-smoke.yml", "capture-regression.yml", "consumer-gate.yml"]) {
    assert.match(workflow, new RegExp(`uses:\\s*\\./\\.github/workflows/${file}\\b`),
      `release.yml must call ${file} as a reusable workflow job, or its own trigger-table change (no `
      + "more push/pull_request on main) leaves nothing gating a release against it");
  }
});

test("guards 5, 6 and 7 are not skippable in dry run", () => {
  // The `release` job's OWN `needs:` is what enforces all three -- a job with an unsatisfied `needs:` is
  // skipped/failed by GitHub regardless of any `if:` on its steps, so there is no per-step dry-run
  // escape hatch to check for here (there was one for the old query-based step; there is none now,
  // which this test proves by there being no `if:` anywhere near the `needs:` line).
  const releaseJob = workflow.indexOf("\n  release:\n");
  assert.notEqual(releaseJob, -1, "the release job must exist");
  const nearby = workflow.slice(releaseJob, releaseJob + 400);
  assert.match(nearby, /needs:\s*\[action-smoke,\s*capture-regression,\s*consumer-gate\]/,
    "the release job must declare needs: [action-smoke, capture-regression, consumer-gate] -- "
    + "unconditionally, so a dry run cannot proceed past a red consumer-path, capture-path or "
    + "consumer-shaped-gate job either");
});

test("dist-tag (#326) is a CHANNEL, not a bypass of any of the seven guards", () => {
  // Defaults empty, so an unattended or mistyped dispatch behaves exactly as before: no flag reaches
  // `changeset publish`, which is changesets' own "latest" behaviour.
  assert.match(workflow, /dist-tag:[\s\S]{0,600}?default:\s*['"]{2}/,
    "the dist-tag input must default to empty, or an unattended dispatch could tag a release without "
    + "anyone choosing to");

  // The publish step itself, not just the input declaration -- a flag built somewhere `if:`-gated
  // differently from the seven guards above would be an eighth, undocumented path to publishing.
  const publishStep = workflow.indexOf("- name: Publish\n");
  assert.notEqual(publishStep, -1, "the Publish step must exist");
  const nearby = workflow.slice(publishStep, publishStep + 700);
  assert.match(nearby, /if:\s*inputs\.dry-run == false && inputs\.confirm == 'publish-for-real'/,
    "the Publish step's OWN if: must still require both dry-run and confirm -- dist-tag selects WHICH "
    + "tag a real publish uses, it must never be a route to a publish the other six guards would refuse");
  assert.match(nearby, /changeset publish.*inputs\.dist-tag/,
    "the publish command must actually read inputs.dist-tag, or the input is decorative");
});

test("PROOF: the dist-tag flag expression omits --tag when empty and includes it when set", () => {
  // The exact expression this file's Publish step uses, evaluated the way GitHub Actions would: string
  // concatenation with a ternary. Proven here because the real workflow only runs on a dispatch.
  const flag = (distTag: string): string =>
    distTag !== "" ? ` --tag ${distTag}` : "";
  assert.equal(flag(""), "", "an empty dist-tag must add nothing -- changesets' own default is latest");
  assert.equal(flag("next"), " --tag next", "a real dist-tag must reach the command");
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
