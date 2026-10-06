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
 * #3717 REWROTE GUARDS 1 AND 2 AGAIN, AND THE SEVEN STAY SEVEN. `release.yml` is a caller of the one reusable per-merge workflow
 * (a11ign/toolchain, #3712) and has no `plan` job and no version pull request. Guard 1 is now "a publish is reached only through the
 * ONE call, on a push to `main`, and the called workflow refuses any other ref in its first job"; guard 2 is "a dispatch runs the guards
 * and stops: the call's job is `if: push`" (the `dry-run` input went with the mode it chose). Guard 3 is unchanged in what it says and
 * stronger in what backs it: no job here holds a write but the call's, and none holds `A11IGN_BOT_TOKEN`. Guard 4's read-back moved
 * into the `guards` job and the called `publish` job reads it again. WHICH GUARD MOVED WHERE is in `release-triggers-itself.test.ts`.
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
  on: Record<string, unknown> & { push?: { branches?: string[]; paths?: string[] }; workflow_dispatch?: unknown };
  jobs: Record<string, { needs?: string[]; if?: string; uses?: string; steps?: { name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> }[] }>;
};

test("guard 1: a publish is reached only through the ONE call, and only on a push to main", () => {
  // The old guard read the plan's mode. There is no plan now: the called workflow refuses a ref that is not `main` in its first job and
  // reads what the tags consumed, so what stays true HERE is that the call is the only way to a publish and a push is the only way to the call.
  assert.deepEqual(parsed.on.push?.branches, ["main"], "the push trigger names main and nothing else");
  for (const trigger of ["schedule", "release", "pull_request", "repository_dispatch"]) {
    assert.ok(!(trigger in parsed.on), `release.yml declares a '${trigger}' trigger, so it can start on something that is not a merge`);
  }
  const callers = Object.entries(parsed.jobs).filter(([, job]) => /^a11ign\/toolchain\/\.github\/workflows\/release-per-merge\.yml@[0-9a-f]{40}$/.test(job.uses ?? ""));
  assert.deepEqual(callers.map(([name]) => name), ["release"], "exactly one job calls the reusable workflow, pinned by full sha");
  assert.match(callers[0][1].if ?? "", /github\.event_name == 'push'/, "the call runs on a push and on nothing else");
  assert.ok(!Object.values(parsed.jobs).some((job) => (job.steps ?? []).some((step) => /changeset publish|npm publish|pnpm publish(?! --dry-run)/.test(step.run ?? ""))),
    "no step in this file publishes: the publish is the called workflow's, where an `id-token` job under the `npm-publish` environment holds it");
});

test("guard 2: a dispatch never publishes -- it runs the guards, and the call's job does not run on it", () => {
  assert.notEqual(parsed.on.workflow_dispatch, undefined, "the rehearsal is kept (#3717): the one non-merge trigger a person may start");
  assert.ok(!("inputs" in ((parsed.on.workflow_dispatch as Record<string, unknown> | null) ?? {})),
    "a dispatch takes no input: the `dry-run` input chose a mode, there is no mode, and an input that does nothing reads as a control");
  assert.match(parsed.jobs.release.if ?? "", /^github\.event_name == 'push'$/, "the call's job is `if: push`, so a dispatch stops after the guards");
});

test("guard 3: nothing in the workflow writes main or opens a pull request, so a change can only arrive through the required review", () => {
  // The property itself is `release-triggers-itself.test.ts`'s `no-branch-push` and `no-bot-token`, with their positive controls. What this
  // pins is the OTHER half: the typed-confirmation machinery and the version pull request are gone, so a leftover cannot read as a live guard.
  assert.doesNotMatch(workflow, /inputs\.confirm|publish-for-real(?!`)/,
    "release.yml still reads a typed confirmation that no input supplies");
  assert.ok(!/^\s+- name: Commit the version bump back to main/m.test(workflow), "the direct commit-back step must stay gone");
  assert.ok(!("version-pr" in parsed.jobs) && !("plan" in parsed.jobs), "the version pull request job and the plan job are gone");
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

test("guards 5, 6 and 7 are not skippable: the call needs all three and the guards job, and none has an `if`", () => {
  // The `release` job's OWN `needs:` is what enforces them -- a job with an unsatisfied `needs:` is skipped/failed by GitHub regardless of any `if:`
  // on its steps. The guard jobs carry no `if:` (#3717: with no `plan` there is no mode to skip on), so a rehearsal runs the guards it exists to rehearse.
  const needs = parsed.jobs.release.needs ?? [];
  for (const job of ["action-smoke", "capture-regression", "consumer-gate", "guards"]) {
    assert.ok(needs.includes(job), `the call must need ${job}, so a red ${job} stops a publish`);
    assert.equal(parsed.jobs[job].if, undefined, `${job} must run on a push and on a dispatch alike`);
  }
});

test("a dispatch rehearses with every guard, and the provenance request still names provenance, before anything publishes", () => {
  const rehearsal = parsed.jobs.guards.steps?.find((step) => /release-publish-rehearsal\.mjs/.test(step.run ?? ""));
  assert.equal(rehearsal?.if, undefined, "the provenance request runs on every run, a real one included: nothing else here can read the called workflow's publish");
  assert.equal(rehearsal?.env?.NPM_CONFIG_PROVENANCE, "true");
});

test("the gate runs, and is not allowed to fail softly", () => {
  assert.match(workflow, /pnpm run release:gate:ci/, "a release must run the part of the gate a runner can prove");
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
  // design — what ships is its output. (`nvda-speech` left with the worker in #3447.)
  for (const name of ["lab"]) {
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
  const GUARDS_RUN_AS_JOBS = 3;                 // guards 5, 6 and 7 in the file header; the reusable per-merge call is remote and has no file here
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
  const calls = Object.entries(release.jobs).filter(([, job]) => typeof job.uses === "string" && job.uses.startsWith("./"));
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
