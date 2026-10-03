/**
 * The release workflow must be incapable of publishing by accident.
 *
 * `a11ign@0.1.0` and five `@a11ign/*` packages shipped on 2026-09-19T09:39:12Z, and npm versions cannot
 * be unpublished after 72 hours — only deprecated. So a wrong release is permanent, and the guards that
 * prevent one are worth asserting rather than trusting to review.
 *
 * #2052: until 2026-09-23 this paragraph said nothing had been published and the name was undecided,
 * while guard 4's own body below already recorded the opposite WITH its evidence — the file guarding the
 * publish disagreed with itself about the fact being guarded, and the docblock is the half a reader meets
 * first. `release-header-currency.test.ts` is the guard against that recurring.
 *
 * Seven independent guards, and independence is the point: any single one would be a single point of
 * failure, which is this repo's rule about a verification not sharing a failure mode with its action.
 * A change that removes one should be deliberate, and this test is what makes it deliberate.
 *
 * #3131 REWROTE GUARDS 1 TO 3, DELIBERATELY, and the seven stay seven. Guard 1 was "dispatch only, no push trigger":
 * the chairman's direction of 2026-10-03 (#928, ADR 0041) is that a merge that carries a changeset releases, so the
 * push trigger is now required (`release-triggers-itself.test.ts` pins it) and guard 1 is the narrower claim that only
 * ONE push can publish. Guard 2 was "dry-run defaults to true": it still does, and a dispatch that sets it false is
 * now refused outright. DROPPED: guard 3, the typed `publish-for-real`. Its job was to stop an accident, and the
 * approving review `main` requires (#2022) plus the queue do it now, checked by the platform; what replaces it as guard
 * 3 is that nothing in the workflow writes `main`, so the version bump can only arrive through that review. `dist-tag`
 * went with the confirmation: it only ever rode a typed, real dispatch, and no dispatch publishes.
 *
 * Guards 5 and 6 changed shape 2026-09-06 (chairman's direction): `action-smoke`/`capture-regression`
 * used to run on a push to `main` and this workflow QUERIED whether that separately-triggered run had
 * passed for the exact sha. Both left `main`/PR entirely and declare `workflow_call`, so this workflow now
 * runs them as JOBS against the sha it runs at, and `release`'s own `needs:` on both is the
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
import { parse as parseYaml } from "yaml";

const REPO = resolve(import.meta.dirname, "../../../..");
const workflow = readFileSync(resolve(REPO, ".github/workflows/release.yml"), "utf8");
const config = JSON.parse(readFileSync(resolve(REPO, ".changeset/config.json"), "utf8"));

const parsed = parseYaml(workflow) as {
  on: { push?: { branches?: string[] }; workflow_dispatch?: { inputs?: Record<string, { default?: unknown }> } };
  jobs: Record<string, { needs?: string[]; if?: string; steps?: { name?: string; if?: string; run?: string; env?: Record<string, string> }[] }>;
};

test("guard 1: only ONE push can publish -- the one where nothing is pending and a version is ahead of the registry", () => {
  // The old guard said "no push trigger at all". The trigger is required now (#3131); what stays true is that a
  // trigger alone starts nothing that publishes: `plan` decides the mode, and the publish step reads only the mode.
  assert.deepEqual(parsed.on.push?.branches, ["main"], "the push trigger names main and nothing else");
  for (const trigger of ["schedule", "release", "pull_request", "repository_dispatch"]) {
    assert.ok(!(trigger in parsed.on), `release.yml declares a '${trigger}' trigger, so it can start on something that is not a merge`);
  }
  const publish = parsed.jobs.release.steps?.find((step) => /^pnpm exec changeset publish\b/.test(step.run ?? ""));
  assert.equal(publish?.if, "needs.plan.outputs.mode == 'publish'", "the publish step reads the plan's mode, never an input");
  const plan = parsed.jobs.plan.steps?.find((step) => /mode=publish/.test(step.run ?? ""))?.run ?? "";
  assert.match(plan, /\[ "\$pending" -gt 0 \]; then mode=version-pr\s+elif \[ "\$ahead" -gt 0 \]; then mode=publish/,
    "publish is reached only when nothing is pending (the version-pr branch is tested first) AND a version is ahead");
});

test("guard 2: a dispatch never publishes -- dry-run defaults to true, and false is refused", () => {
  assert.equal(parsed.on.workflow_dispatch?.inputs?.["dry-run"]?.default, true,
    "the dry-run input must default to true; a default of false makes the safe path the opt-in one");
  assert.ok(!("confirm" in (parsed.on.workflow_dispatch?.inputs ?? {})), "the typed confirmation was removed on purpose (#3131); its job is guard 3's");
  const plan = parsed.jobs.plan.steps?.find((step) => /mode=rehearsal/.test(step.run ?? ""))?.run ?? "";
  assert.match(plan, /DRY_RUN" != "true"[\s\S]{0,200}exit 1/, "a dispatch that sets dry-run false must be refused, not quietly rehearsed");
});

test("guard 3: nothing in the workflow writes main, so the version bump can only arrive through the required review", () => {
  // The property itself is `release-triggers-itself.test.ts`'s `no-push-to-main`, with its positive controls. What this
  // pins is the OTHER half: the typed-confirmation machinery is gone, so a leftover cannot read as a live guard.
  assert.doesNotMatch(workflow, /inputs\.confirm|publish-for-real(?!`)/,
    "release.yml still reads a typed confirmation that no input supplies");
  assert.ok(!/^\s+- name: Commit the version bump back to main/m.test(workflow), "the direct commit-back step must stay gone");
});

test("guard 4: access is public now that the name is settled", () => {
  // Until 2026-09-14 this asserted "restricted": PLAN.md B5 ("the name, and the first publish") was
  // open, and a correctly confirmed run still failed at the workflow's access check so no accidental
  // release could claim a name. The name is settled -- the repository is a11ign (README.md:1-6, the
  // rename record), the six packages are `@a11ign/*`, and the chairman's order for the first publish
  // (0.1.0 x6, dist-tag `next`) is recorded on #915 (comments 5656137309 and 5659162882). A scoped
  // package publishes only with access=public, so the flip is what lets that run proceed (#1530).
  assert.equal(config.access, "public",
    "`.changeset/config.json` access must read 'public': the name is settled (PLAN.md B5, #1530) and a "
    + "scoped package cannot publish otherwise. The workflow still refuses on anything but 'public'.");
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

test("guards 5, 6 and 7 are not skippable: the publishing job needs all three, and they run on the publish and the rehearsal", () => {
  // The `release` job's OWN `needs:` is what enforces all three -- a job with an unsatisfied `needs:` is
  // skipped/failed by GitHub regardless of any `if:` on its steps. The guard jobs carry an `if:` of their own now
  // (#3131: on a push that only opens a version pull request they have nothing to prove), and it must name BOTH of
  // the modes that run the release job, or a rehearsal would skip the guards it exists to rehearse.
  const needs = parsed.jobs.release.needs ?? [];
  for (const job of ["action-smoke", "capture-regression", "consumer-gate"]) {
    assert.ok(needs.includes(job), `the release job must need ${job}, so a red ${job} stops a publish and a rehearsal alike`);
    const condition = parsed.jobs[job].if ?? "";
    assert.match(condition, /== 'publish'/, `${job} must run on the publishing push`);
    assert.match(condition, /== 'rehearsal'/, `${job} must run on a rehearsal`);
  }
});

test("a dispatch rehearses with every guard, and its dry-run publish hand-off still names provenance", () => {
  const rehearsal = parsed.jobs.release.steps?.find((step) => /release-publish-rehearsal\.mjs/.test(step.run ?? ""));
  assert.equal(rehearsal?.if, "inputs.dry-run == true", "the rehearsal runs on a dispatch, and a real publish does not also rehearse itself");
  assert.equal(rehearsal?.env?.NPM_CONFIG_PROVENANCE, "true");
});

test("the gate runs, and is not allowed to fail softly", () => {
  assert.match(workflow, /npm run release:gate/, "a release must run the full gate");
  assert.ok(!/continue-on-error:\s*true/.test(workflow),
    "no step in the release path may continue on error — that is how a release ships past its own gate");
});

test("the workspaces lockfile trap is handled", () => {
  // `changeset version` does not update the lockfile. Without the install that follows, the lockfile
  // ships describing the PREVIOUS versions, and the next frozen install refuses the release commit.
  // Asserted on the npm script, since that is the one place both CI and a human use. pnpm's, since #2301.
  const scripts = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8")).scripts;
  assert.match(scripts["release:version"], /changeset version\s*&&\s*(?:pnpm|node scripts\/pnpm\.mjs) install --lockfile-only/,
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

test("#1251: every permission a called workflow's job requests is granted by its calling job", () => {
  // GitHub validates a reusable-workflow call BEFORE any job exists: a nested job requesting a permission
  // the caller did not grant fails the whole run as `startup_failure`, with the reason readable only on
  // the run page. consumer-gate.yml is generated from README's Quickstart fence, so a README edit (as on
  // 2026-09-09, `pull-requests: write` for the PR-comment step) changes what the call requests without
  // touching this file -- and nothing on the PR path dispatches release.yml, so the first dispatch found
  // it (run 34749848689). Parsed, not grepped: a permission block is structure, and the comparison is
  // per scope, per job, with `none < read < write`.
  const GUARDS_RUN_AS_JOBS = 3;                 // guards 5, 6 and 7 in the file header
  const rank: Record<string, number> = { none: 0, read: 1, write: 2 };
  // `permissions:` has a scalar spelling too (`write-all`, `read-all`), which parses to a string. A
  // block this reader cannot expand must REFUSE, not read as "no block": the two look identical to a
  // loop over scopes, and only one of them is safe (worker-judge's second mutation on #1252).
  const scopesOf = (perms: unknown, where: string): Record<string, string> => {
    if (perms === undefined) return {};
    assert.ok(perms !== null && typeof perms === "object",
      `${where} spells permissions as '${String(perms)}', which this guard cannot expand per scope -- ` +
      "write it as a map, or teach the guard the scalar spelling");
    return perms as Record<string, string>;
  };
  const release = parseYaml(workflow) as { jobs: Record<string, { uses?: string; permissions?: unknown }> };
  const calls = Object.entries(release.jobs).filter(([, job]) => typeof job.uses === "string");
  assert.equal(calls.length, GUARDS_RUN_AS_JOBS, "release.yml calls three local workflows (guards 5, 6 and 7)");
  for (const [callerName, caller] of calls) {
    const path = (caller.uses as string).replace(/^\.\//, "");
    const called = parseYaml(readFileSync(resolve(REPO, path), "utf8")) as
      { permissions?: unknown; jobs: Record<string, { permissions?: unknown }> };
    const granted = scopesOf(caller.permissions, `release.yml job '${callerName}'`);
    for (const [jobName, job] of Object.entries(called.jobs)) {
      // A workflow-level `permissions:` applies to every job that does not declare its own, and a
      // single-job consumer workflow spells it there as often as on the job. Reading only the job
      // block passed, comparing nothing, when the block was moved up a level (worker-judge, #1252).
      // GitHub REPLACES the workflow block with a job's own rather than merging; this spread merges,
      // so it can demand a grant a job does not strictly need -- deliberately: over-requesting fails
      // closed, and the alternative misses a scope the job inherits.
      const requested = {
        ...scopesOf(called.permissions, `${path} (workflow level)`),
        ...scopesOf(job.permissions, `${path} job '${jobName}'`),
      };
      for (const [scope, level] of Object.entries(requested)) {
        assert.ok((rank[granted[scope] ?? "none"] ?? 0) >= (rank[level] ?? 0),
          `${path} job '${jobName}' requests '${scope}: ${level}' but release.yml's '${callerName}' job ` +
          `grants '${scope}: ${granted[scope] ?? "none"}' -- GitHub refuses the whole release at startup`);
      }
    }
  }
});
