/**
 * THE RELEASE STARTS ITSELF ON THE MERGE, THROUGH ONE CALL, AND OPENS NO PULL REQUEST (#3717, child of #928, ADR 0041).
 *
 * `release.yml` used to be ~770 lines of its own: a `plan` job that read the registry to pick one of four modes, a `version-pr`
 * job that opened the "Version packages" pull request with `A11IGN_BOT_TOKEN`, and a `release` job on that pull request's merge.
 * It is now a CALLER (#3131 was written around the pull request, and this row supersedes its remaining readings): a push to
 * `main` that carries a changeset reaches ONE call to the reusable per-merge workflow in a11ign/toolchain (#3712, shown to
 * publish by OIDC from a caller by #3713's real merge), and every guard about WHAT is published is a job that call `needs:`.
 *
 * WHAT THIS PARSES, AND WHY. A workflow is a structure, so every check below reads the parsed YAML: a step that merely ECHOES
 * `git push origin main`, or a comment that names `A11IGN_BOT_TOKEN`, must satisfy nothing. `refusals()` returns one NAMED property
 * per defect, so a red run says which property went, and each property has a fixture below that makes it go (the positive
 * controls the row asks for): a guard nobody has seen refuse is not known to refuse. The OLD workflow is kept as
 * `scripts/fixtures/release-before-3717.yml` and must be refused for each property it breaks.
 *
 * WHICH GUARD MOVED WHERE (the row asks). Each used to be a step of the one `release` job; the called workflow takes no steps of
 * the caller's, so a guard is a job it WAITS FOR. The seven numbered in the file header: 5, 6 and 7 are called workflows, as
 * before; 1 to 4 moved into the called workflow's own refusals or stayed as steps of `guards` (see `GUARDS`). DROPPED, with why:
 * the `plan` job and its four modes (the called workflow subtracts what the tags consumed, so nothing here needs to ask the
 * registry what is pending), `version-pr` and its pull request body (no pull request), the rehearsal-only `release:version`
 * and `changeset status` pair (the called workflow versions on a detached commit; `status` stays for a dispatch), and the
 * `Publish` step and the `contents: write` that came with it (they are the called workflow's now, and `release` is the only job
 * that holds `contents: write` and `id-token: write`).
 *
 * `release-safety.test.ts` keeps the guards about what a dispatch may do and what the called workflows need;
 * this file is the other half: what STARTS a release and what the guards must still contain.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = resolve(import.meta.dirname, "../../../..");
const WORKFLOW_PATH = ".github/workflows/release.yml";
/** Today's workflow before this row, kept so each property it breaks is SEEN to be refused. */
const BEFORE_PATH = "scripts/fixtures/release-before-3717.yml";

interface Step { name?: string; id?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; "continue-on-error"?: unknown }
interface Job {
  needs?: string | string[]; if?: string; environment?: string; uses?: string; permissions?: Record<string, string>;
  with?: Record<string, unknown>; secrets?: unknown; concurrency?: unknown; steps?: Step[];
}
interface Workflow {
  on?: { push?: { branches?: string[]; paths?: string[] }; workflow_dispatch?: unknown } & Record<string, unknown>;
  concurrency?: { group?: string; "cancel-in-progress"?: unknown };
  jobs: Record<string, Job>;
}

const load = (path: string): string => readFileSync(resolve(REPO, path), "utf8");
const liveWorkflow = (): Workflow => parseYaml(load(WORKFLOW_PATH)) as Workflow;
const beforeWorkflow = (): Workflow => parseYaml(load(BEFORE_PATH)) as Workflow;
const clone = (): Workflow => structuredClone(liveWorkflow());

/** The one job that calls the reusable workflow, and so the only one that publishes. Named, not discovered. */
const PUBLISHING_JOB = "release";
/** The job whose steps are the guards about what is published. */
const GUARDS_JOB = "guards";
const CALLED = /^a11ign\/toolchain\/\.github\/workflows\/release-per-merge\.yml@(.+)$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Does this `if:` let the step run on a push to main (a publishing event)? Absent means always. A step that names the dispatch, or is
 * constant false, is a rehearsal-only step and no guard; any other condition (the coverage step's reuse of nightly's verdict) is
 * about the step's own work, and the step is still the guard.
 */
const runsOnPush = (step: Step): boolean => step.if === undefined || !/workflow_dispatch|^\s*(\$\{\{\s*)?false\b/.test(step.if);

/** Each guard that must be a step of the `guards` job, as a predicate over one step, found by what it DOES. */
const GUARDS: Record<string, (step: Step) => boolean> = {
  "access-check": (step) => /config\.json/.test(step.run ?? "") && /\.access/.test(step.run ?? "") && /!=\s*"public"/.test(step.run ?? ""),
  "manifest-repository-check": (step) => /node scripts\/manifest-repository-check\.mjs/.test(step.run ?? ""),
  "packed-install-check": (step) => /pnpm run gate:isolation/.test(step.run ?? ""),
  "provenance-request": (step) => step.env?.NPM_CONFIG_PROVENANCE === "true" && /release-publish-rehearsal\.mjs/.test(step.run ?? ""),
  "release-gate-ci": (step) => /pnpm run release:gate:ci/.test(step.run ?? ""),
  "gate-scope-statement": (step) => /node scripts\/release-gate-scope\.mjs/.test(step.run ?? ""),
  "consumer-gate-current": (step) => /node scripts\/generate-consumer-gate\.mjs --check/.test(step.run ?? ""),
  "hold-3126": (step) => step.env?.A11Y_CHECK_RELEASE_HOLD === "1",
  "qualification-verdict": (step) => /node scripts\/release-reads-qualification\.mjs/.test(step.run ?? ""),
  "coverage": (step) => /^pnpm run coverage\b/m.test(step.run ?? ""),
  "never-older-than-the-registry": (step) =>
    /steps\.readings\.outputs\.readings/.test(JSON.stringify(step.env ?? {})) && /process\.exit\(1\)/.test(step.run ?? "") && /behind/.test(step.run ?? ""),
};
const GUARD_STEPS = 11;

/** The guards that are called workflows, run as jobs against this sha (guards 5, 6 and 7 of the file header). */
const CALLED_GUARDS: Record<string, string> = {
  "action-smoke": "action-smoke.yml",
  "capture-regression": "capture-regression.yml",
  "consumer-gate": "consumer-gate.yml",
};
const CALLED_GUARD_JOBS = 3;

/**
 * The one job that may hold `pull-requests: write`, and why: `consumer-gate.yml` is generated from README's Quickstart fence, which
 * grants it for the Action's PR-comment step, and a called workflow may not request more than its caller grants (#1251). It is NOT
 * a version pull request: nothing here opens one. #3718's release-shape cell reads it as one anyway, which is on #3717 for the rule.
 */
const PULL_REQUESTS_WRITE_ALLOWED = ["consumer-gate"];

const needsOf = (job: Job): string[] => (Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : []);

/** Every line of every `run:` in the workflow, with where it is, comments dropped. */
function runLines(workflow: Workflow): { job: string; step: string; line: string }[] {
  return Object.entries(workflow.jobs).flatMap(([job, body]) =>
    (body.steps ?? []).flatMap((step) =>
      (step.run ?? "").split("\n").map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
        .map((line) => ({ job, step: step.name ?? step.uses ?? "(unnamed)", line }))));
}

function triggerRefusals(workflow: Workflow): string[] {
  const on = workflow.on;
  const found: string[] = [];
  if (!on?.push?.branches?.includes("main")) found.push("push-trigger-on-main: no `push` trigger naming `main`");
  // EXACTLY the changeset directory: a release is due when a changeset arrives. The manifests and the lockfile were in the filter only because
  // the version pull request's merge changed them, and `main` is never written now, so a trigger on them would release on a dependency bump.
  if (JSON.stringify(on?.push?.paths) !== JSON.stringify([".changeset/**"])) found.push("push-trigger-on-changesets: the push trigger is not filtered to exactly `.changeset/**`");
  if (on?.workflow_dispatch === undefined) found.push("dispatch-kept: `workflow_dispatch` is gone, and it is the rehearsal");
  return found;
}

function concurrencyRefusals(workflow: Workflow): string[] {
  const found: string[] = [];
  if (workflow.concurrency?.group === undefined) found.push("concurrency-group: `concurrency` has no group");
  if (workflow.concurrency?.["cancel-in-progress"] !== false) {
    found.push("concurrency-never-cancels: `cancel-in-progress` must be the boolean false, so a release in flight is never cancelled");
  }
  return found;
}

/** What the version pull request was made of, each one a defect now: the job, the action, the branch push, the PR, the token. */
function noVersionPullRequestRefusals(workflow: Workflow): string[] {
  const found: string[] = [];
  if (workflow.jobs["version-pr"] !== undefined) found.push("no-version-pr-job: a job named `version-pr` is here");
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  if (steps.some((step) => /^changesets\/action(@|$)/.test(step.uses ?? ""))) found.push("no-changesets-action: a step uses `changesets/action`");
  for (const { job, step, line } of runLines(workflow)) {
    if (/\bgit\s+push\b/.test(line)) found.push(`no-branch-push: ${job} / ${step}: ${line}`);
    if (/\bgh\s+pr\s+(create|edit)\b|\/pulls\b/.test(line)) found.push(`no-pull-request-creation: ${job} / ${step}: ${line}`);
  }
  if (/A11IGN_BOT_TOKEN/.test(JSON.stringify(workflow))) found.push("no-bot-token: `A11IGN_BOT_TOKEN` is read here, and nothing here opens a pull request");
  const granting = Object.entries(workflow.jobs)
    .filter(([name, job]) => job.permissions?.["pull-requests"] === "write" && !PULL_REQUESTS_WRITE_ALLOWED.includes(name)).map(([name]) => name);
  if (granting.length > 0) found.push(`no-pull-requests-write: ${granting.join(", ")} grants \`pull-requests: write\``);
  return found;
}

/** The call: one job, a full-sha pin (a moving ref would change what every release does with no pull request here), kind npm, the required check. */
function callRefusals(workflow: Workflow): string[] {
  const publishing = workflow.jobs[PUBLISHING_JOB];
  const callers = Object.entries(workflow.jobs).filter(([, job]) => CALLED.test(job.uses ?? ""));
  const found: string[] = [];
  if (callers.length !== 1 || callers[0][0] !== PUBLISHING_JOB) {
    return [`calls-the-reusable-workflow: ${callers.length} jobs call release-per-merge.yml (${callers.map(([name]) => name).join(", ")}), expected exactly \`${PUBLISHING_JOB}\``];
  }
  const ref = CALLED.exec(publishing.uses ?? "")?.[1] ?? "";
  if (!FULL_SHA.test(ref)) found.push(`pinned-by-full-sha: the call is pinned to '${ref}', not a 40-hex commit`);
  if (publishing.with?.kind !== "npm") found.push(`kind-npm: \`with.kind\` is ${JSON.stringify(publishing.with?.kind)}, and this repository publishes to npm`);
  if (publishing.with?.["gate-check"] !== "gate") found.push(`gate-check: \`with.gate-check\` is ${JSON.stringify(publishing.with?.["gate-check"])}, and the required check is \`gate\``);
  return found;
}

function publishingJobRefusals(workflow: Workflow): string[] {
  const publishing = workflow.jobs[PUBLISHING_JOB];
  const found: string[] = [];
  if (!/['"]push['"]/.test(publishing.if ?? "")) found.push(`publish-on-push-only: the call's if is ${JSON.stringify(publishing.if)}, so a dispatch could reach it`);
  if (publishing.permissions?.["id-token"] !== "write") found.push("oidc: the calling job lacks `id-token: write`, and a called workflow can never gain a permission");
  if (publishing.permissions?.contents !== "write") found.push("tags: the calling job lacks `contents: write`, which the called workflow's tags need");
  if (publishing.secrets !== undefined || /secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/.test(JSON.stringify(publishing))) {
    found.push("no-stored-token: the calling job references a secret or a registry token, so OIDC would never be exercised");
  }
  return [...found, ...otherJobsRefusals(workflow)];
}

/** Only the call may hold `id-token` or `contents: write`, or name an environment: the called workflow's `publish` job owns the OIDC claim. */
function otherJobsRefusals(workflow: Workflow): string[] {
  const found: string[] = [];
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name === PUBLISHING_JOB) continue;
    if (job.permissions?.["id-token"] !== undefined) found.push(`id-token-only-on-the-call: ${name} requests \`id-token\``);
    if (job.permissions?.contents === "write") found.push(`contents-write-only-on-the-call: ${name} requests \`contents: write\``);
    // The environment names the OIDC claim; a second one here would claim a deployment for nothing.
    if (job.environment !== undefined) found.push(`no-environment-here: ${name} declares an environment, which is the called workflow's`);
  }
  return found;
}

/** The step that upgrades npm: it installs `npm@^11.5.1`, the floor npm's trusted publishing documents (#3180). */
const isNpmUpgrade = (step: Step): boolean => /^npm install -g\s+"?npm@\^11\.5\.1"?/m.test(step.run ?? "");

function npmUpgradeRefusals(guards: Job): string[] {
  const steps = guards.steps ?? [];
  const upgrades = steps.filter(isNpmUpgrade);
  if (upgrades.length !== 1) return [`npm-upgrade: ${upgrades.length} steps install npm ^11.5.1, expected exactly 1 (trusted publishing needs 11.5.1+)`];
  const at = steps.indexOf(upgrades[0]);
  const using = steps.findIndex((step) => GUARDS["provenance-request"](step));
  const found = using !== -1 && using < at ? [`npm-upgrade-before-provenance: the upgrade is step ${at} but the provenance request runs at step ${using}, on npm 10`] : [];
  return runsOnPush(upgrades[0]) ? found : [...found, "npm-upgrade-on-push: its if: keeps it off the publishing event"];
}

function guardStepRefusals(guards: Job): string[] {
  const steps = guards.steps ?? [];
  const found = Object.entries(GUARDS).flatMap(([name, isGuard]) => {
    const present = steps.filter(isGuard);
    if (present.length === 0) return [`guard-${name}: no step in the \`${GUARDS_JOB}\` job is the ${name} guard`];
    return present.some(runsOnPush) ? [] : [`guard-${name}: it exists but its if: keeps it off the publishing event`];
  });
  const verdict = steps.find(GUARDS["qualification-verdict"]);
  // ONLY a rehearsal may continue past a stop: a publishing push that reads `wait` must stop the release.
  if (verdict !== undefined && verdict["continue-on-error"] !== "${{ github.event_name == 'workflow_dispatch' }}") {
    found.push(`qualification-stops-a-publish: the verdict step's continue-on-error is ${JSON.stringify(verdict["continue-on-error"])}, not the dispatch-only expression`);
  }
  return found;
}

/** The called-workflow guards AND the `guards` job must all be jobs the call waits for, or a red one stops nothing. */
function calledGuardRefusals(workflow: Workflow): string[] {
  const publishing = workflow.jobs[PUBLISHING_JOB];
  const found = Object.entries(CALLED_GUARDS).flatMap(([job, file]) => {
    const called = workflow.jobs[job];
    const refusals: string[] = [];
    if (called?.uses !== `./.github/workflows/${file}`) refusals.push(`guard-${job}: no job \`${job}\` calls ${file}`);
    else if (called.if !== undefined) refusals.push(`guard-${job}: it has an if: (${called.if}), so it can skip on a publish`);
    if (!needsOf(publishing).includes(job)) refusals.push(`guard-${job}: the calling job does not need ${job}, so a red ${job} cannot stop it`);
    return refusals;
  });
  if (workflow.jobs[GUARDS_JOB] === undefined) found.push(`guards-job: no job named ${GUARDS_JOB}`);
  else if (!needsOf(publishing).includes(GUARDS_JOB)) found.push(`guards-needed: the calling job does not need ${GUARDS_JOB}, so none of its steps stops a publish`);
  return found;
}

/**
 * The properties of the per-merge release, each one NAMED. An empty list is the pass; a fixture must make a specific name appear.
 */
function refusals(workflow: Workflow): string[] {
  const outside = [...triggerRefusals(workflow), ...concurrencyRefusals(workflow), ...noVersionPullRequestRefusals(workflow)];
  if (workflow.jobs[PUBLISHING_JOB] === undefined) return [...outside, `publishing-job: no job named ${PUBLISHING_JOB}`];
  const guards = workflow.jobs[GUARDS_JOB] ?? {};
  return [...outside, ...callRefusals(workflow), ...publishingJobRefusals(workflow), ...calledGuardRefusals(workflow), ...guardStepRefusals(guards), ...npmUpgradeRefusals(guards)];
}

const names = (found: string[]): string[] => found.map((refusal) => refusal.split(":")[0]);

test("guards are declared: the lists the checks loop over are not empty, which is the positive control for every loop", () => {
  assert.equal(Object.keys(GUARDS).length, GUARD_STEPS, "the guards the row names, kept as steps of the guards job");
  assert.equal(Object.keys(CALLED_GUARDS).length, CALLED_GUARD_JOBS, "guards 5, 6 and 7 of the file header");
});

test("the live release.yml has every property: it starts itself on a changeset, calls the one workflow, and keeps its guards", () => {
  assert.deepEqual(refusals(liveWorkflow()), []);
});

test("the call passes exactly the inputs the called workflow declares and this repository needs", () => {
  const publishing = liveWorkflow().jobs[PUBLISHING_JOB];
  assert.deepEqual(Object.keys(publishing.with ?? {}).sort(), ["gate-check", "kind"],
    "an input the called workflow does not declare fails at startup, and one it does is a decision this row should make");
});

// ---- POSITIVE CONTROLS: today's workflow, refused for each property it breaks ------------------------------------------------

test("POSITIVE CONTROL (the row's): today's release.yml, kept as a fixture, is REFUSED for each property the per-merge shape breaks", () => {
  const found = names(refusals(beforeWorkflow()));
  for (const property of [
    "no-version-pr-job", "no-pull-request-creation", "no-bot-token",
    "calls-the-reusable-workflow", "guards-job", "push-trigger-on-changesets",
  ]) {
    assert.ok(found.includes(property), `the fixture (today's workflow) must be refused for '${property}'; it was refused for: ${[...new Set(found)].join(", ")}`);
  }
});

test("POSITIVE CONTROL: a version pull request job is refused, naming it, and only for that", () => {
  const withVersionPr = clone();
  withVersionPr.jobs["version-pr"] = { steps: [{ name: "x", run: "true" }] };
  assert.deepEqual(names(refusals(withVersionPr)), ["no-version-pr-job"]);
});

test("POSITIVE CONTROL: changesets/action is refused, naming it, and only for that", () => {
  const withAction = clone();
  withAction.jobs[GUARDS_JOB].steps!.push({ uses: "changesets/action@v1" });
  assert.deepEqual(names(refusals(withAction)), ["no-changesets-action"]);
});

test("POSITIVE CONTROL: a branch push, and a bare `git push` (which on a checkout of main pushes main), are each refused", () => {
  for (const line of ["git push origin release/version-packages", "git push", "git push origin HEAD:main"]) {
    const pushing = clone();
    pushing.jobs[GUARDS_JOB].steps!.push({ run: line });
    assert.deepEqual(names(refusals(pushing)), ["no-branch-push"], line);
  }
});

test("NEGATIVE CONTROL: a step that only ECHOES or comments the words does not count as a push, and a comment names nothing", () => {
  const echoing = clone();
  echoing.jobs[GUARDS_JOB].steps!.push({ run: "# git push origin main\ntrue" });
  assert.deepEqual(refusals(echoing), []);
});

test("POSITIVE CONTROL: opening a pull request is refused, and so is reading the bot token", () => {
  const opening = clone();
  opening.jobs[GUARDS_JOB].steps!.push({ run: "gh pr create --title x --body y" });
  assert.deepEqual(names(refusals(opening)), ["no-pull-request-creation"]);
  const token = clone();
  token.jobs[GUARDS_JOB].steps!.push({ env: { A11IGN_BOT_TOKEN: "${{ secrets.A11IGN_BOT_TOKEN }}" }, run: "true" });
  assert.deepEqual(names(refusals(token)), ["no-bot-token"]);
});

test("POSITIVE CONTROL: `pull-requests: write` on any job but the consumer gate's is refused, naming it", () => {
  const granting = clone();
  granting.jobs[GUARDS_JOB].permissions = { ...granting.jobs[GUARDS_JOB].permissions, "pull-requests": "write" };
  assert.deepEqual(names(refusals(granting)), ["no-pull-requests-write"]);
});

test("POSITIVE CONTROL: no push trigger, a push trigger on another branch, and a catch-all push are each refused", () => {
  const none = clone();
  none.on = { workflow_dispatch: {} };
  assert.ok(names(refusals(none)).includes("push-trigger-on-main"));
  const other = clone();
  other.on = { ...other.on, push: { branches: ["release"], paths: [".changeset/**"] } };
  assert.deepEqual(names(refusals(other)), ["push-trigger-on-main"]);
  const catchAll = clone();
  catchAll.on = { ...catchAll.on, push: { branches: ["main"] } };
  assert.deepEqual(names(refusals(catchAll)), ["push-trigger-on-changesets"]);
});

test("POSITIVE CONTROL: the call pinned to a moving ref, with another kind or another required check, is refused for that and only that", () => {
  const moving = clone();
  moving.jobs[PUBLISHING_JOB].uses = "a11ign/toolchain/.github/workflows/release-per-merge.yml@main";
  assert.deepEqual(names(refusals(moving)), ["pinned-by-full-sha"]);
  const tag = clone();
  tag.jobs[PUBLISHING_JOB].with = { ...tag.jobs[PUBLISHING_JOB].with, kind: "tag" };
  assert.deepEqual(names(refusals(tag)), ["kind-npm"]);
  const check = clone();
  check.jobs[PUBLISHING_JOB].with = { ...check.jobs[PUBLISHING_JOB].with, "gate-check": "ts" };
  assert.deepEqual(names(refusals(check)), ["gate-check"]);
});

test("POSITIVE CONTROL: a second job that calls the reusable workflow, or none, is refused", () => {
  const two = clone();
  two.jobs.second = { uses: two.jobs[PUBLISHING_JOB].uses, with: { kind: "npm", "gate-check": "gate" } };
  assert.ok(names(refusals(two)).includes("calls-the-reusable-workflow"));
  const none = clone();
  none.jobs[PUBLISHING_JOB].uses = "./.github/workflows/consumer-gate.yml";
  assert.ok(names(refusals(none)).includes("calls-the-reusable-workflow"));
});

test("POSITIVE CONTROL: a call that a dispatch can reach, a stored token, and a missing id-token or contents grant are each refused", () => {
  const dispatchable = clone();
  delete dispatchable.jobs[PUBLISHING_JOB].if;
  assert.deepEqual(names(refusals(dispatchable)), ["publish-on-push-only"]);
  const stored = clone();
  stored.jobs[PUBLISHING_JOB].secrets = { NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" };
  assert.deepEqual(names(refusals(stored)), ["no-stored-token"]);
  const noOidc = clone();
  delete noOidc.jobs[PUBLISHING_JOB].permissions!["id-token"];
  assert.deepEqual(names(refusals(noOidc)), ["oidc"]);
  const noTags = clone();
  noTags.jobs[PUBLISHING_JOB].permissions!.contents = "read";
  assert.deepEqual(names(refusals(noTags)), ["tags"]);
});

test("POSITIVE CONTROL: id-token or contents: write on a guard job, and an environment on any job but the call, are refused, naming the job", () => {
  const oidc = clone();
  oidc.jobs[GUARDS_JOB].permissions = { ...oidc.jobs[GUARDS_JOB].permissions, "id-token": "write" };
  assert.deepEqual(names(refusals(oidc)), ["id-token-only-on-the-call"]);
  const write = clone();
  write.jobs[GUARDS_JOB].permissions = { ...write.jobs[GUARDS_JOB].permissions, contents: "write" };
  assert.deepEqual(names(refusals(write)), ["contents-write-only-on-the-call"]);
  const environment = clone();
  environment.jobs[GUARDS_JOB].environment = "npm-publish";
  assert.deepEqual(names(refusals(environment)), ["no-environment-here"]);
});

test("POSITIVE CONTROL: concurrency missing, or set to cancel, is refused", () => {
  const missing = clone();
  delete missing.concurrency;
  assert.ok(names(refusals(missing)).includes("concurrency-group"));
  const cancelling = clone();
  cancelling.concurrency = { group: "release", "cancel-in-progress": true };
  assert.deepEqual(names(refusals(cancelling)), ["concurrency-never-cancels"]);
  const quoted = clone();
  quoted.concurrency = { group: "release", "cancel-in-progress": "false" };
  assert.deepEqual(names(refusals(quoted)), ["concurrency-never-cancels"], "the STRING 'false' is truthy to GitHub's expression engine");
});

// ---- the guards: each one is a job the call needs ---------------------------------------------------------------------------

test("POSITIVE CONTROL: each called-workflow guard removed from the call's needs, or deleted, or made skippable, is refused naming it", () => {
  for (const job of Object.keys(CALLED_GUARDS)) {
    const unneeded = clone();
    unneeded.jobs[PUBLISHING_JOB].needs = needsOf(unneeded.jobs[PUBLISHING_JOB]).filter((need) => need !== job);
    assert.deepEqual(names(refusals(unneeded)), [`guard-${job}`], `${job} dropped from needs`);
    const deleted = clone();
    delete deleted.jobs[job];
    assert.ok(names(refusals(deleted)).includes(`guard-${job}`), `${job} deleted`);
    const skippable = clone();
    skippable.jobs[job].if = "github.event_name == 'workflow_dispatch'";
    assert.deepEqual(names(refusals(skippable)), [`guard-${job}`], `${job} given an if:`);
  }
});

test("POSITIVE CONTROL: the guards job dropped from the call's needs, or deleted, is refused, and its steps then guard nothing", () => {
  const unneeded = clone();
  unneeded.jobs[PUBLISHING_JOB].needs = needsOf(unneeded.jobs[PUBLISHING_JOB]).filter((need) => need !== GUARDS_JOB);
  assert.deepEqual(names(refusals(unneeded)), ["guards-needed"]);
  const deleted = clone();
  delete deleted.jobs[GUARDS_JOB];
  assert.ok(names(refusals(deleted)).includes("guards-job"));
});

function withoutGuard(name: string): Workflow {
  const workflow = clone();
  const steps = workflow.jobs[GUARDS_JOB].steps!;
  workflow.jobs[GUARDS_JOB].steps = steps.filter((step) => !GUARDS[name](step));
  assert.notEqual(workflow.jobs[GUARDS_JOB].steps.length, steps.length, `the live guards job has a ${name} step to remove`);
  return workflow;
}

test("POSITIVE CONTROL: each guard step deleted from the guards job is refused, naming that guard and no other", () => {
  for (const name of Object.keys(GUARDS)) {
    const found = names(refusals(withoutGuard(name))).filter((property) => property.startsWith("guard-"));
    assert.deepEqual(found, [`guard-${name}`], `deleting ${name} must be refused as that guard`);
  }
});

test("POSITIVE CONTROL: a guard step moved to a dispatch-only `if` is refused as keeping it off the publishing event", () => {
  for (const name of Object.keys(GUARDS)) {
    const workflow = clone();
    workflow.jobs[GUARDS_JOB].steps = workflow.jobs[GUARDS_JOB].steps!.map((step) => (GUARDS[name](step) ? { ...step, if: "github.event_name == 'workflow_dispatch'" } : step));
    assert.ok(names(refusals(workflow)).includes(`guard-${name}`), name);
  }
});

test("POSITIVE CONTROL: a verdict that may continue past a stop on a publishing push is refused", () => {
  const soft = clone();
  const verdict = soft.jobs[GUARDS_JOB].steps!.find(GUARDS["qualification-verdict"])!;
  verdict["continue-on-error"] = true;
  assert.deepEqual(names(refusals(soft)), ["qualification-stops-a-publish"]);
});

test("the guards job's own steps never continue on error (the verdict's expression is the one allowed exception)", () => {
  const soft = (liveWorkflow().jobs[GUARDS_JOB].steps ?? []).filter((step) => step["continue-on-error"] !== undefined && !GUARDS["qualification-verdict"](step));
  assert.deepEqual(soft.map((step) => step.name), [], "no guard may continue on error: that is how a release ships past its own gate");
});

// ---- the npm floor (#3180), moved with the provenance request it serves -------------------------------------------------------

const EXECUTABLE = 0o755;
const upgradeStep = (workflow: Workflow): Step => workflow.jobs[GUARDS_JOB].steps!.find(isNpmUpgrade)!;
const upgradeNames = (workflow: Workflow): string[] => names(npmUpgradeRefusals(workflow.jobs[GUARDS_JOB]));

test("POSITIVE CONTROL (#3180): the upgrade step is in the live guards job to begin with, once, so the controls below have something to break", () => {
  assert.equal((liveWorkflow().jobs[GUARDS_JOB].steps ?? []).filter(isNpmUpgrade).length, 1);
  assert.deepEqual(upgradeNames(liveWorkflow()), []);
});

test("POSITIVE CONTROL (#3180): the upgrade step deleted, moved AFTER the provenance request, or kept off the publishing event, is refused", () => {
  const deleted = clone();
  deleted.jobs[GUARDS_JOB].steps = deleted.jobs[GUARDS_JOB].steps!.filter((step) => !isNpmUpgrade(step));
  assert.deepEqual(upgradeNames(deleted), ["npm-upgrade"]);
  const late = clone();
  const steps = late.jobs[GUARDS_JOB].steps!;
  late.jobs[GUARDS_JOB].steps = [...steps.filter((step) => !isNpmUpgrade(step)), upgradeStep(late)];
  assert.deepEqual(upgradeNames(late), ["npm-upgrade-before-provenance"]);
  const dispatchOnly = clone();
  upgradeStep(dispatchOnly).if = "github.event_name == 'workflow_dispatch'";
  assert.deepEqual(upgradeNames(dispatchOnly), ["npm-upgrade-on-push"]);
});

test("POSITIVE CONTROL (#3180): a step that only COMMENTS the install, or a floor below 11.5.1, is not the upgrade", () => {
  const commented = clone();
  upgradeStep(commented).run = '# npm install -g "npm@^11.5.1"\ntrue';
  assert.deepEqual(upgradeNames(commented), ["npm-upgrade"]);
  const lowered = clone();
  upgradeStep(lowered).run = 'npm install -g "npm@^10.9.0"';
  assert.deepEqual(upgradeNames(lowered), ["npm-upgrade"]);
});

/** Runs the live upgrade step with a fake `npm` that installs nothing and reports `version`. */
function runUpgrade(version: string): { status: number | null; log: string; installArgs: string } {
  const dir = mkdtempSync(join(tmpdir(), "a11y-npm-floor-"));
  try {
    mkdirSync(join(dir, "bin"));
    const fake = `#!/bin/sh\ncase "$1" in install) echo "$@" > "$RECORD"; exit 0;; --version) echo "$FAKE_NPM_VERSION"; exit 0;; esac\nexit 99\n`;
    writeFileSync(join(dir, "bin/npm"), fake);
    chmodSync(join(dir, "bin/npm"), EXECUTABLE);
    const record = join(dir, "install-args");
    writeFileSync(record, "");
    const result = spawnSync("bash", ["-eo", "pipefail", "-c", upgradeStep(liveWorkflow()).run!], {
      cwd: dir, encoding: "utf8",
      env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, FAKE_NPM_VERSION: version, RECORD: record },
    });
    return { status: result.status, log: `${result.stdout}${result.stderr}`, installArgs: readFileSync(record, "utf8").trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("#3180: the upgrade step installs npm ^11.5.1 and passes only at or above 11.5.1", () => {
  for (const version of ["11.5.1", "11.5.2", "11.10.0", "12.0.0"]) {
    const { status, installArgs } = runUpgrade(version);
    assert.equal(status, 0, `${version} meets the floor`);
    assert.equal(installArgs, "install -g npm@^11.5.1");
  }
});

test("POSITIVE CONTROL (#3180): the upgrade step run against an npm below 11.5.1 FAILS, naming the version, before anything publishes", () => {
  for (const version of ["10.9.0", "11.4.9", "11.5.0", "9.0.0"]) {
    const { status, log } = runUpgrade(version);
    assert.equal(status, 1, `${version} is below the floor`);
    assert.ok(log.includes(`npm ${version} is below 11.5.1`), log);
  }
});

// ---- the readings step's own shell, RUN against a fixture tree and a stub registry --------------------------------------------
//
// The readings are what the qualification verdict and the refusal to publish older both read, and they were `plan`'s until #3717. The
// structural checks above prove what the YAML says; they cannot prove the shell it carries decides correctly. This takes the step's
// `run:` out of the PARSED workflow and executes it with `bash`, in a temporary tree holding the manifests a case describes, with a
// stub `npm` standing in for the registry. Nothing here reaches the network, and the stub is what makes "the registry did not answer"
// something a test can cause.

type Registry = Record<string, string>;
const STUB_NPM = `#!/usr/bin/env node
const table = JSON.parse(process.env.STUB_REGISTRY);
const answer = table[process.argv[3]];
if (answer === undefined || answer === "E404") { console.error("npm error code E404"); process.exit(1); }
if (answer === "DOWN") { console.error("npm error code ECONNREFUSED"); process.exit(1); }
console.log(answer);
`;
type Readings = { name: string; manifest: string; latest: string; state: string }[];

function runReadings(packages: Record<string, { name: string; version: string; private?: boolean }>, registry: Registry): { status: number | null; readings: Readings | null; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "a11y-release-readings-"));
  try {
    for (const [pkg, manifest] of Object.entries(packages)) {
      mkdirSync(join(dir, "packages", pkg), { recursive: true });
      writeFileSync(join(dir, "packages", pkg, "package.json"), JSON.stringify(manifest));
    }
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin/npm"), STUB_NPM);
    chmodSync(join(dir, "bin/npm"), EXECUTABLE);
    const step = liveWorkflow().jobs[GUARDS_JOB].steps?.find((candidate) => candidate.id === "readings");
    assert.ok(step?.run, "positive control: the readings step is found");
    const output = join(dir, "github-output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", step.run], {
      cwd: dir, encoding: "utf8",
      env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: output, STUB_REGISTRY: JSON.stringify(registry) },
    });
    const written = /^readings=(.*)$/m.exec(readFileSync(output, "utf8"));
    return { status: result.status, readings: written ? (JSON.parse(written[1]) as Readings) : null, log: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const ONE_PACKAGE = (version: string) => ({ cli: { name: "a11ign", version } });

test("READINGS: a manifest NEWER than the registry's latest is ahead, level is level, and one BEHIND is behind (main reads 0.0.0 beside a published 0.1.0)", () => {
  assert.deepEqual(runReadings(ONE_PACKAGE("0.2.0"), { a11ign: "0.1.0" }).readings?.map((r) => r.state), ["ahead"]);
  assert.deepEqual(runReadings(ONE_PACKAGE("0.1.0"), { a11ign: "0.1.0" }).readings?.map((r) => r.state), ["level"]);
  assert.deepEqual(runReadings(ONE_PACKAGE("0.0.0"), { a11ign: "0.1.0" }).readings?.map((r) => r.state), ["behind"]);
});

test("READINGS: a package the registry has never heard of, or holds only as the name reservation, reads as 0.0.0, so 0.0.0 is never ahead of it", () => {
  assert.deepEqual(runReadings(ONE_PACKAGE("0.1.0"), {}).readings?.map((r) => [r.state, r.latest]), [["ahead", "0.0.0"]]);
  assert.deepEqual(runReadings(ONE_PACKAGE("0.0.0"), { a11ign: "0.0.0-reserved.0" }).readings?.map((r) => r.state), ["level"]);
});

test("READINGS: any OTHER prerelease on the registry, and a registry that does not answer, are CANNOT_TELL and fail the step, never `not published`", () => {
  for (const latest of ["0.1.0-beta.1", "DOWN"]) {
    const { status, readings, log } = runReadings(ONE_PACKAGE("0.1.0"), { a11ign: latest });
    assert.notEqual(status, 0, latest);
    assert.equal(readings, null, "a failed reading writes nothing the guards could read as a pass");
    assert.match(log, /CANNOT_TELL/, latest);
  }
});

test("READINGS: a private package is never read, so it is never a reason to refuse", () => {
  const { readings } = runReadings({ ...ONE_PACKAGE("0.1.0"), lab: { name: "@a11ign/lab", version: "0.0.0", private: true } }, { a11ign: "0.1.0" });
  assert.deepEqual(readings?.map((r) => r.name), ["a11ign"]);
});
