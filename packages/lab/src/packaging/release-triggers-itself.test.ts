/**
 * THE RELEASE STARTS ITSELF, AND WRITES NOTHING TO `main` (#3131, child of #928, ADR 0041).
 *
 * `release.yml` used to start only on `workflow_dispatch` and publish only on a typed `publish-for-real`; its last
 * step then pushed the version bump straight to `main`, which `main`'s required review (#2022) refuses. The ruled
 * design is two events in one file: a push to `main` that leaves a changeset pending opens the version pull request,
 * and the push that pull request's merge makes (nothing pending, a version ahead of the registry) publishes.
 * Nobody types and nobody pushes `main`.
 *
 * WHAT THIS PARSES, AND WHY IT PARSES. A workflow is a structure, so every check below reads the parsed YAML: a step
 * that merely ECHOES `git push origin main`, or a comment that names `id-token: write`, must satisfy nothing, and a
 * step whose `if:` says `rehearsal` must not count as a guard that runs on a publish. `refusals()` returns one NAMED
 * property per defect, so a red run says which property went, and each property has a fixture below that makes it go
 * (the positive controls the row asks for): a guard nobody has seen refuse is not known to refuse.
 *
 * `release-safety.test.ts` keeps the guards about what a dispatch may do and what the called workflows need;
 * this file is the other half: what STARTS a release and what the publishing job must still contain.
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
/** The script the `version-pr` job runs; it is the only thing here that pushes, so its push is read too. */
const BUMP_SCRIPT_PATH = "scripts/release-commit-version-bump.mjs";

interface Step { name?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, unknown> }
interface Job { needs?: string | string[]; if?: string; uses?: string; permissions?: Record<string, string>; env?: Record<string, string>; steps?: Step[] }
interface Workflow {
  on?: { push?: { branches?: string[] }; workflow_dispatch?: unknown } | Record<string, unknown>;
  concurrency?: { group?: string; "cancel-in-progress"?: unknown };
  jobs: Record<string, Job>;
}

const load = (path: string): string => readFileSync(resolve(REPO, path), "utf8");
const liveWorkflow = (): Workflow => parseYaml(load(WORKFLOW_PATH)) as Workflow;
const bumpScript = (): string => load(BUMP_SCRIPT_PATH);

/** The job that publishes. Named, not discovered: a second job that publishes would be a defect to find. */
const PUBLISHING_JOB = "release";

/**
 * Each guard the row (design 2) says must STILL be in the publishing job, as a predicate over one step. The population
 * is declared so that "all present" cannot pass over an empty list: `guards are declared` below pins the count.
 */
const GUARDS: Record<string, (step: Step) => boolean> = {
  "access-check": (step) => /config\.json/.test(step.run ?? "") && /\.access/.test(step.run ?? "") && /!=\s*"public"/.test(step.run ?? ""),
  "manifest-repository-check": (step) => /node scripts\/manifest-repository-check\.mjs/.test(step.run ?? ""),
  "packed-install-check": (step) => /pnpm run gate:isolation/.test(step.run ?? ""),
  "provenance-request": (step) => step.env?.NPM_CONFIG_PROVENANCE === "true" && /changeset publish/.test(step.run ?? ""),
  "release-gate-ci": (step) => /pnpm run release:gate:ci/.test(step.run ?? ""),
  "gate-scope-statement": (step) => /node scripts\/release-gate-scope\.mjs/.test(step.run ?? ""),
  "hold-3126": (step) => step.env?.A11Y_CHECK_RELEASE_HOLD === "1",
};

const GUARD_STEPS = 7;
const CALLED_GUARD_JOBS = 3;

/** The jobs whose success the publishing job must wait for: guards 5, 6 and 7, run as called workflows. */
const CALLED_GUARDS: Record<string, string> = {
  "action-smoke": "action-smoke.yml",
  "capture-regression": "capture-regression.yml",
  "consumer-gate": "consumer-gate.yml",
};

const needsOf = (job: Job): string[] => (Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : []);

/**
 * Does this `if:` let the step run when the mode is `publish`? Absent means always. Present must NAME `publish`: a step
 * guarded `== 'rehearsal'` is a rehearsal-only step and is no guard on a publishing push, however it is named.
 */
const runsOnPublish = (step: Step): boolean => step.if === undefined || /['"]publish['"]/.test(step.if);

/** Every line of every `run:` in the workflow, with where it is, comments dropped. */
function runLines(workflow: Workflow): { job: string; step: string; line: string }[] {
  return Object.entries(workflow.jobs).flatMap(([job, body]) =>
    (body.steps ?? []).flatMap((step) =>
      (step.run ?? "").split("\n").map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
        .map((line) => ({ job, step: step.name ?? step.uses ?? "(unnamed)", line }))));
}

/**
 * Where `git push` appears. A `run:` line that spells it at all is refused (the version commit is pushed by the script,
 * which is read separately), and the script's own push must name a ref that is not `main`.
 */
function pushesToMain(workflow: Workflow, script: string): string[] {
  const inline = runLines(workflow).filter(({ line }) => /\bgit\s+push\b/.test(line))
    .map(({ job, step, line }) => `${job} / ${step}: ${line}`);
  const pushArgs = [...script.matchAll(/git\(\[\s*"push"([^\]]*)\]\)/g)].map((match) => match[1]);
  const toMain = pushArgs.filter((args) => !/VERSION_BRANCH/.test(args) || /\bmain\b/.test(args))
    .map((args) => `${BUMP_SCRIPT_PATH}: git push${args}`);
  return [...inline, ...toMain];
}

type On = { push?: { branches?: string[] }; workflow_dispatch?: unknown };

function triggerRefusals(workflow: Workflow, script: string): string[] {
  const on = workflow.on as On | undefined;
  const found: string[] = [];
  if (!on?.push?.branches?.includes("main")) found.push("push-trigger-on-main: no `push` trigger naming `main`");
  if (on?.workflow_dispatch === undefined) found.push("dispatch-kept: `workflow_dispatch` is gone, and it is the rehearsal");
  return [...found, ...pushesToMain(workflow, script).map((offence) => `no-push-to-main: ${offence}`)];
}

function concurrencyRefusals(workflow: Workflow): string[] {
  const found: string[] = [];
  if (workflow.concurrency?.group === undefined) found.push("concurrency-group: `concurrency` has no group");
  if (workflow.concurrency?.["cancel-in-progress"] !== false) {
    found.push("concurrency-never-cancels: `cancel-in-progress` must be the boolean false, so a release in flight is never cancelled");
  }
  return found;
}

function publishRefusals(publishing: Job): string[] {
  const found: string[] = [];
  const publish = (publishing.steps ?? []).filter((step) => /^pnpm exec changeset publish\b/.test(step.run ?? ""));
  if (publish.length !== 1) found.push(`one-publish-step: ${publish.length} steps run changeset publish, expected exactly 1`);
  for (const step of publish) {
    const keyedToThePlan = /needs\.plan\.outputs\.mode == 'publish'/.test(step.if ?? "") && !/inputs\./.test(step.if ?? "");
    if (!keyedToThePlan) found.push(`publish-only-on-the-publishing-event: the publish step's if is ${JSON.stringify(step.if)}, not the plan's \`publish\` mode`);
  }
  if (publishing.permissions?.["id-token"] !== "write") found.push("oidc: the publishing job lacks `id-token: write`");
  if (/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/.test(JSON.stringify(publishing))) {
    found.push("no-stored-token: the publishing job references a secret or a registry token, so OIDC would never be exercised");
  }
  return found;
}

/** The step that upgrades npm: it installs `npm@^11.5.1`, the floor npm's trusted publishing documents (#3180). */
const isNpmUpgrade = (step: Step): boolean => /^npm install -g\s+"?npm@\^11\.5\.1"?/m.test(step.run ?? "");

/** The steps that talk to the registry through npm, which must find the upgraded one: the publish and its rehearsal. */
const NPM_USERS = [/^pnpm exec changeset publish\b/, /release-publish-rehearsal\.mjs/];

function npmUpgradeRefusals(publishing: Job): string[] {
  const steps = publishing.steps ?? [];
  const upgrades = steps.filter(isNpmUpgrade);
  if (upgrades.length !== 1) return [`npm-upgrade: ${upgrades.length} steps install npm ^11.5.1, expected exactly 1 (trusted publishing needs 11.5.1+)`];
  const at = steps.indexOf(upgrades[0]);
  const found = NPM_USERS.flatMap((user) => {
    const using = steps.findIndex((step) => user.test(step.run ?? ""));
    return using !== -1 && using < at ? [`npm-upgrade-before-publish: the upgrade is step ${at} but ${user} runs at step ${using}, on npm 10`] : [];
  });
  return runsOnPublish(upgrades[0]) ? found : [...found, "npm-upgrade-on-publish: its if: keeps it off the publishing event"];
}

function guardStepRefusals(publishing: Job): string[] {
  const steps = publishing.steps ?? [];
  return Object.entries(GUARDS).flatMap(([name, isGuard]) => {
    const present = steps.filter(isGuard);
    if (present.length === 0) return [`guard-${name}: no step in the publishing job is the ${name} guard`];
    return present.some(runsOnPublish) ? [] : [`guard-${name}: it exists but its if: keeps it off the publishing event`];
  });
}

function calledGuardRefusals(workflow: Workflow, publishing: Job): string[] {
  return Object.entries(CALLED_GUARDS).flatMap(([job, file]) => {
    const called = workflow.jobs[job];
    const found: string[] = [];
    if (called?.uses !== `./.github/workflows/${file}`) found.push(`guard-${job}: no job \`${job}\` calls ${file}`);
    else if (!runsOnPublish(called)) found.push(`guard-${job}: its if: keeps it off the publishing event`);
    if (!needsOf(publishing).includes(job)) found.push(`guard-${job}: the publishing job does not need ${job}, so a red ${job} cannot stop it`);
    return found;
  });
}

/**
 * The properties of the self-starting release, each one NAMED. An empty list is the pass; a fixture must make a specific
 * name appear.
 */
function refusals(workflow: Workflow, script: string): string[] {
  const publishing = workflow.jobs[PUBLISHING_JOB];
  const outside = [...triggerRefusals(workflow, script), ...concurrencyRefusals(workflow)];
  if (publishing === undefined) return [...outside, `publishing-job: no job named ${PUBLISHING_JOB}`];
  return [...outside, ...publishRefusals(publishing), ...npmUpgradeRefusals(publishing), ...guardStepRefusals(publishing), ...calledGuardRefusals(workflow, publishing)];
}

test("guards are declared: the lists the checks loop over are not empty, which is the positive control for every loop", () => {
  assert.equal(Object.keys(GUARDS).length, GUARD_STEPS, "the guards of design 2: access, manifest repo, packed install, provenance, gate:ci, gate scope, hold");
  assert.equal(Object.keys(CALLED_GUARDS).length, CALLED_GUARD_JOBS, "guards 5, 6 and 7 of the file header");
});

test("the live release.yml has every property: it starts itself, writes nothing to main, and keeps its guards", () => {
  assert.deepEqual(refusals(liveWorkflow(), bumpScript()), []);
});

test("the plan decides the mode, and a dispatch can never reach `publish`", () => {
  const plan = liveWorkflow().jobs.plan;
  const decide = plan?.steps?.find((step) => /mode=publish/.test(step.run ?? ""));
  assert.ok(decide?.run, "positive control: the step that writes the mode is found");
  const run = decide.run;
  const dispatchBranch = run.indexOf('"workflow_dispatch"');
  const dispatchExit = run.indexOf("exit 0", dispatchBranch);
  assert.ok(dispatchBranch !== -1 && dispatchExit !== -1, "the dispatch branch must end in an exit");
  assert.ok(run.indexOf("mode=publish") > dispatchExit, "`mode=publish` is written only after the dispatch branch has exited");
  assert.match(run, /mode=rehearsal/, "a dispatch gets the rehearsal");
  assert.match(run, /DRY_RUN" != "true"[\s\S]{0,200}exit 1/, "a dispatch that sets dry-run false is REFUSED, not quietly rehearsed");
  assert.equal(plan.permissions?.contents, "read", "planning reads; it is not the job that may write anything");
});

test("the version pull request is the only write: a branch, with a token that lets CI run on it", () => {
  const workflow = liveWorkflow();
  const versionPr = workflow.jobs["version-pr"];
  assert.ok(versionPr, "a `version-pr` job exists");
  assert.match(versionPr.if ?? "", /mode == 'version-pr'/);
  const text = JSON.stringify(versionPr);
  assert.match(text, /release:version/, "it applies the changesets with `release:version`, which refreshes the lockfile too");
  assert.match(text, /release-commit-version-bump\.mjs/, "it commits through the script that pushes the version branch");
  assert.match(text, /A11IGN_BOT_TOKEN/, "a pull request opened with GITHUB_TOKEN starts no workflow, so CI would never report on it");
  assert.doesNotMatch(text, /github\.token/, "and it must not fall back to GITHUB_TOKEN");
  assert.equal(versionPr.permissions?.contents, "read", "the token, not the job's grant, is what writes the branch");
  assert.match(bumpScript(), /VERSION_BRANCH = "release\/version-packages"/);
  assert.match(text, /--head release\/version-packages/, "the pull request is opened from the branch the script pushes");
  assert.match(text, /Closes: none — a version pull request finishes no row/, "a malformed body does not merge: `Closes` is declared, em dash included");
  assert.equal((text.match(/Acceptance:/g) ?? []).length, 1, "exactly one Acceptance section: a duplicated one cost four red runs");
});

// ---- #3131 done-when 5: the version pull request signs off the owned paths it always touches ----

interface OwnedFact { id: string; states: string[] }
const ownedFacts = (): OwnedFact[] => (JSON.parse(load("docs/owned-path-facts.json")) as { facts: OwnedFact[] }).facts;

/** The body the `version-pr` job opens the pull request with: the heredoc between `<<'BODY'` and its terminator. */
function versionPrBody(workflow: Workflow): string {
  const run = (workflow.jobs["version-pr"].steps ?? []).map((step) => step.run ?? "").find((text) => text.includes("<<'BODY'")) ?? "";
  return run.split("<<'BODY'\n")[1]?.split(/^\s*BODY\s*$/m)[0] ?? "";
}

/**
 * The facts a body leaves unstated, read as `owned-path-signoff` reads them: some line names the fact and says one of its
 * states as a whole word. The version pull request always touches `packages/nvda-worker/{CHANGELOG.md,package.json}`, which
 * is owned, so a template that states none of them makes `ownedPaths` red on a pull request nobody may push to (#3353).
 */
function unstatedOwnedFacts(body: string, facts: OwnedFact[]): string[] {
  const lines = body.split("\n");
  return facts
    .filter((fact) => !lines.some((line) => line.includes(fact.id) && fact.states.some((state) => new RegExp(`\\b${state}\\b`, "i").test(line))))
    .map((fact) => fact.id);
}

test("the version pull request's body states every owned-path fact, so `ownedPaths` can pass on it", () => {
  const facts = ownedFacts();
  assert.ok(facts.length > 0, "the fact list is read: an empty one would make the assertion below pass over nothing");
  const body = versionPrBody(liveWorkflow());
  assert.ok(body.includes("Closes: none"), "the body was extracted: it is the template, not an empty string");
  assert.deepEqual(unstatedOwnedFacts(body, facts), [], "every fact in docs/owned-path-facts.json is stated in the template");
});

test("POSITIVE CONTROL (#3131): a template that states no fact is refused naming all of them, and one missing a fact names that one", () => {
  const facts = ownedFacts();
  // Built from the fact list, not from the live template, so this control breaks only when the CHECK does.
  const stating = (omit: (fact: OwnedFact) => string | null): string =>
    ["Closes: none", ...facts.map((fact) => omit(fact) ?? "")].join("\n");
  const stated = (fact: OwnedFact): string => `${fact.id}: ${fact.states[0]}`;
  assert.deepEqual(unstatedOwnedFacts(stating(stated), facts), [], "the fixture is complete to begin with");
  assert.deepEqual(unstatedOwnedFacts(stating(() => null), facts), facts.map((fact) => fact.id));
  assert.deepEqual(unstatedOwnedFacts(stating((fact) => (fact.id === "provisionRevision" ? null : stated(fact))), facts), ["provisionRevision"]);
  assert.deepEqual(unstatedOwnedFacts(stating((fact) => (fact.id === "environmentKey" ? fact.id : stated(fact))), facts), ["environmentKey"],
    "naming a fact without saying one of its states does not state it");
});

// ---- the positive controls: each one removes ONE property from the live workflow and must be refused by NAME ----

const clone = (): Workflow => structuredClone(liveWorkflow());

/**
 * #3170: what the `version-pr` job must do with a dependency pull request's accepted entry. Named properties, as in
 * `refusals()`, so a red run says which one went. `compile` must run in THIS job (the publishing job never writes
 * entries), after the install, before `release:version` has spent the changesets, and on a checkout that holds the tags.
 */
function compileStepProblems(workflow: Workflow): string[] {
  const steps = workflow.jobs["version-pr"]?.steps ?? [];
  const at = (match: (step: Step) => boolean): number => steps.findIndex(match);
  const compile = at((step) => /node scripts\/dependency-changeset\.mjs compile(\s|$)/.test(step.run ?? ""));
  if (compile < 0) return ["compile-step-missing: the version-pr job never runs `dependency-changeset.mjs compile`"];
  const install = at((step) => /pnpm install/.test(step.run ?? ""));
  const version = at((step) => /pnpm run release:version/.test(step.run ?? ""));
  const problems: string[] = [];
  if (install < 0 || compile < install) problems.push("compile-before-install: it runs before the install");
  if (version < 0 || compile > version) problems.push("compile-after-release-version: `changeset version` has already spent the changesets");
  return [...problems, ...compileContextProblems(workflow)];
}

/** The two properties of the SURROUNDINGS: the checkout holds the tags, and no publishing step writes entries. */
function compileContextProblems(workflow: Workflow): string[] {
  const checkout = workflow.jobs["version-pr"]?.steps?.find((step) => /^actions\/checkout@/.test(step.uses ?? ""));
  const publishing = workflow.jobs[PUBLISHING_JOB]?.steps ?? [];
  return [
    ...(checkout?.with?.["fetch-depth"] === 0 ? [] : ["checkout-has-no-tags: a shallow checkout holds no release tag, so compile reads nothing moved"]),
    ...(publishing.some((step) => /dependency-changeset\.mjs compile/.test(step.run ?? "")) ? ["compile-in-publishing-job: entries are written in version-pr, never where a publish happens"] : []),
  ];
}

test("the version-pr job writes the dependency entry after install and before release:version, on a checkout with tags (#3170)", () => {
  assert.deepEqual(compileStepProblems(liveWorkflow()), []);
});

/** Position of the live compile step, so the controls below move or remove exactly that step. */
const compileIndex = (workflow: Workflow): number => workflow.jobs["version-pr"].steps!.findIndex((step) => /dependency-changeset\.mjs compile/.test(step.run ?? ""));

test("POSITIVE CONTROL (#3170): the compile step is in the live job to begin with, so the controls below have something to break", () => {
  assert.ok(compileIndex(liveWorkflow()) > 0);
});

test("POSITIVE CONTROL (#3170): the compile step deleted is refused, naming it", () => {
  const workflow = clone();
  workflow.jobs["version-pr"].steps!.splice(compileIndex(workflow), 1);
  assert.deepEqual(compileStepProblems(workflow).map((p) => p.split(":")[0]), ["compile-step-missing"]);
});

test("POSITIVE CONTROL (#3170): the compile step moved after release:version is refused, and only for that", () => {
  const workflow = clone();
  const steps = workflow.jobs["version-pr"].steps!;
  const [compile] = steps.splice(compileIndex(workflow), 1);
  steps.splice(steps.findIndex((step) => /pnpm run release:version/.test(step.run ?? "")) + 1, 0, compile);
  assert.deepEqual(compileStepProblems(workflow).map((p) => p.split(":")[0]), ["compile-after-release-version"]);
});

test("POSITIVE CONTROL (#3170): the compile step moved before the install is refused, and only for that", () => {
  const workflow = clone();
  const steps = workflow.jobs["version-pr"].steps!;
  const [compile] = steps.splice(compileIndex(workflow), 1);
  steps.splice(steps.findIndex((step) => /pnpm install/.test(step.run ?? "")), 0, compile);
  assert.deepEqual(compileStepProblems(workflow).map((p) => p.split(":")[0]), ["compile-before-install"]);
});

test("POSITIVE CONTROL (#3170): a shallow checkout is refused, and only for that", () => {
  const workflow = clone();
  const checkout = workflow.jobs["version-pr"].steps!.find((step) => /^actions\/checkout@/.test(step.uses ?? ""))!;
  delete checkout.with!["fetch-depth"];
  assert.deepEqual(compileStepProblems(workflow).map((p) => p.split(":")[0]), ["checkout-has-no-tags"]);
});

test("POSITIVE CONTROL (#3170): compile in the publishing job is refused, and only for that", () => {
  const workflow = clone();
  workflow.jobs[PUBLISHING_JOB].steps!.push({ name: "Compile", run: "node scripts/dependency-changeset.mjs compile" });
  assert.deepEqual(compileStepProblems(workflow).map((p) => p.split(":")[0]), ["compile-in-publishing-job"]);
});


test("POSITIVE CONTROL: no push trigger is refused, naming it", () => {
  const workflow = clone();
  workflow.on = { workflow_dispatch: {} };
  assert.ok(refusals(workflow, bumpScript()).some((name) => name.startsWith("push-trigger-on-main")));
});

test("POSITIVE CONTROL: a push trigger on another branch is refused too", () => {
  const workflow = clone();
  workflow.on = { push: { branches: ["next"] }, workflow_dispatch: {} };
  assert.ok(refusals(workflow, bumpScript()).some((name) => name.startsWith("push-trigger-on-main")));
});

test("POSITIVE CONTROL: a direct `git push` to main, in a step, is refused, naming it", () => {
  const workflow = clone();
  workflow.jobs[PUBLISHING_JOB].steps?.push({ name: "Commit the bump back", run: "git push origin HEAD:main" });
  const refused = refusals(workflow, bumpScript());
  assert.ok(refused.some((name) => name.startsWith("no-push-to-main") && name.includes("HEAD:main")), refused.join("\n"));
});

test("POSITIVE CONTROL: a bare `git push` is refused too, because on a checkout of main it pushes main", () => {
  const workflow = clone();
  workflow.jobs["version-pr"].steps?.push({ name: "Push", run: "git push" });
  assert.ok(refusals(workflow, bumpScript()).some((name) => name.startsWith("no-push-to-main")));
});

test("POSITIVE CONTROL: the script pushing HEAD:main again is refused, which is the old defect", () => {
  const old = bumpScript().replace(/git\(\[\s*"push"[^\]]*\]\)/, 'git(["push", "origin", "HEAD:main"])');
  assert.notEqual(old, bumpScript(), "the fixture must actually change the script, or this proves nothing");
  assert.ok(refusals(liveWorkflow(), old).some((name) => name.startsWith("no-push-to-main")));
});

test("NEGATIVE CONTROL: a step that only ECHOES the words does not count as a push, and a comment names nothing", () => {
  const workflow = clone();
  workflow.jobs[PUBLISHING_JOB].steps?.push({ name: "Say", run: 'echo "we no longer git-push to main"\n# git push origin main' });
  assert.deepEqual(refusals(workflow, bumpScript()), []);
});

test("POSITIVE CONTROL: the consumer-gate removed from the publishing job's needs is refused, naming it", () => {
  const workflow = clone();
  workflow.jobs[PUBLISHING_JOB].needs = needsOf(workflow.jobs[PUBLISHING_JOB]).filter((job) => job !== "consumer-gate");
  assert.ok(refusals(workflow, bumpScript()).some((name) => name.startsWith("guard-consumer-gate") && name.includes("does not need")));
});

test("POSITIVE CONTROL: the consumer-gate job itself deleted is refused, naming it", () => {
  const workflow = clone();
  delete workflow.jobs["consumer-gate"];
  assert.ok(refusals(workflow, bumpScript()).some((name) => name.startsWith("guard-consumer-gate") && name.includes("no job")));
});

test("POSITIVE CONTROL: a guard job that skips on a publish is refused", () => {
  const workflow = clone();
  workflow.jobs["action-smoke"].if = "needs.plan.outputs.mode == 'rehearsal'";
  assert.ok(refusals(workflow, bumpScript()).some((name) => name.startsWith("guard-action-smoke") && name.includes("publishing event")));
});

/** The live workflow with one guard's step(s) taken out of the publishing job; provenance lives ON the publish step, so it loses its env instead. */
function withoutGuard(name: string, isGuard: (step: Step) => boolean): { workflow: Workflow; removed: boolean } {
  const workflow = clone();
  const job = workflow.jobs[PUBLISHING_JOB];
  const before = job.steps?.length ?? 0;
  job.steps = (job.steps ?? []).filter((step) => !isGuard(step) || /changeset publish/.test(step.run ?? ""));
  const publish = job.steps.find((step) => /changeset publish/.test(step.run ?? ""));
  if (name === "provenance-request" && publish) delete publish.env;
  return { workflow, removed: job.steps.length < before || name === "provenance-request" };
}

test("POSITIVE CONTROL: each guard step deleted from the publishing job is refused, naming that guard", () => {
  for (const [name, isGuard] of Object.entries(GUARDS)) {
    const { workflow, removed } = withoutGuard(name, isGuard);
    assert.ok(removed, `the fixture for ${name} must remove something`);
    assert.ok(refusals(workflow, bumpScript()).some((refusal) => refusal.startsWith(`guard-${name}`)), `${name} was not refused`);
  }
});

test("POSITIVE CONTROL: a guard step moved to a rehearsal-only `if` is refused as keeping it off the publishing event", () => {
  const workflow = clone();
  const hold = workflow.jobs[PUBLISHING_JOB].steps?.find(GUARDS["hold-3126"]);
  assert.ok(hold, "the hold step is found");
  hold.if = "needs.plan.outputs.mode == 'rehearsal'";
  assert.ok(refusals(workflow, bumpScript()).some((name) => name.startsWith("guard-hold-3126") && name.includes("publishing event")));
});

test("POSITIVE CONTROL: a publish step keyed to an input (the typed-confirmation shape) is refused", () => {
  const workflow = clone();
  const publish = workflow.jobs[PUBLISHING_JOB].steps?.find((step) => /changeset publish/.test(step.run ?? ""));
  assert.ok(publish, "the publish step is found");
  publish.if = "inputs.dry-run == false && inputs.confirm == 'publish-for-real'";
  assert.ok(refusals(workflow, bumpScript()).some((name) => name.startsWith("publish-only-on-the-publishing-event")));
});

test("POSITIVE CONTROL: a registry token on the publishing job, and a missing id-token, are each refused", () => {
  const withToken = clone();
  const publish = withToken.jobs[PUBLISHING_JOB].steps?.find((step) => /changeset publish/.test(step.run ?? ""));
  assert.ok(publish, "the publish step is found");
  publish.env = { ...publish.env, NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" };
  assert.ok(refusals(withToken, bumpScript()).some((name) => name.startsWith("no-stored-token")));

  const noOidc = clone();
  delete noOidc.jobs[PUBLISHING_JOB].permissions?.["id-token"];
  assert.ok(refusals(noOidc, bumpScript()).some((name) => name.startsWith("oidc")));
});

test("POSITIVE CONTROL: concurrency missing, or set to cancel, is refused", () => {
  const missing = clone();
  delete missing.concurrency;
  assert.ok(refusals(missing, bumpScript()).some((name) => name.startsWith("concurrency")));

  const cancelling = clone();
  cancelling.concurrency = { group: "release", "cancel-in-progress": true };
  assert.ok(refusals(cancelling, bumpScript()).some((name) => name.startsWith("concurrency-never-cancels")));
  const quoted = clone();
  quoted.concurrency = { group: "release", "cancel-in-progress": "false" };
  assert.ok(refusals(quoted, bumpScript()).some((name) => name.startsWith("concurrency-never-cancels")),
    "the STRING 'false' is truthy to GitHub's expression engine; only the boolean is a promise");
});

// ---- the plan step's own shell, RUN against a fixture tree and a stub registry ----------------------------------------
//
// The structural checks above prove what the YAML says; they cannot prove the shell it carries decides correctly. This
// takes the plan step's `run:` out of the PARSED workflow and executes it with `bash`, in a temporary tree holding the
// changesets and manifests a case describes, with a stub `npm` standing in for the registry. Nothing here reaches the
// network, and the stub is what makes "the registry did not answer" something a test can cause.

type Registry = Record<string, string | "E404" | "DOWN">;
interface PlanCase {
  event: "push" | "workflow_dispatch";
  dryRun?: string;
  /** file name under `.changeset/` -> its text */
  changesets?: Record<string, string>;
  /** package dir -> manifest fields */
  packages: Record<string, { name: string; version: string; private?: boolean }>;
  registry: Registry;
}
const A_RELEASE = '---\n"a11ign": minor\n---\n\nSays what changed.\n';
const EMPTY = "---\n---\n\nThe version pull request.\n";
const STUB_NPM = `#!/usr/bin/env node
const table = JSON.parse(process.env.STUB_REGISTRY);
const answer = table[process.argv[3]];
if (answer === undefined || answer === "E404") { console.error("npm error code E404"); process.exit(1); }
if (answer === "DOWN") { console.error("npm error code ECONNREFUSED"); process.exit(1); }
console.log(answer);
`;

function runPlan(plan: PlanCase): { status: number | null; mode: string | null; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "a11y-release-plan-"));
  try {
    mkdirSync(join(dir, ".changeset"), { recursive: true });
    writeFileSync(join(dir, ".changeset/README.md"), "# Changesets\n");
    for (const [name, text] of Object.entries(plan.changesets ?? {})) writeFileSync(join(dir, ".changeset", name), text);
    for (const [pkg, manifest] of Object.entries(plan.packages)) {
      mkdirSync(join(dir, "packages", pkg), { recursive: true });
      writeFileSync(join(dir, "packages", pkg, "package.json"), JSON.stringify(manifest));
    }
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin/npm"), STUB_NPM);
    chmodSync(join(dir, "bin/npm"), EXECUTABLE);
    const step = liveWorkflow().jobs.plan.steps?.find((candidate) => /mode=publish/.test(candidate.run ?? ""));
    assert.ok(step?.run, "positive control: the plan step is found");
    const output = join(dir, "github-output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", step.run], {
      cwd: dir, encoding: "utf8",
      env: {
        PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: output, EVENT: plan.event, DRY_RUN: plan.dryRun ?? "",
        STUB_REGISTRY: JSON.stringify(plan.registry),
      },
    });
    const written = /^mode=(.*)$/m.exec(readFileSync(output, "utf8"));
    return { status: result.status, mode: written ? written[1] : null, log: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const EXECUTABLE = 0o755;
const ONE_PACKAGE = (version: string) => ({ cli: { name: "a11ign", version } });

test("PLAN: a pending changeset that names a release asks for the version pull request, whatever the registry says", () => {
  const ahead = runPlan({ event: "push", changesets: { "a.md": A_RELEASE }, packages: ONE_PACKAGE("0.1.1"), registry: { a11ign: "0.1.0" } });
  assert.equal(ahead.mode, "version-pr", "pending is tested BEFORE ahead: the version pull request must consume the changesets first");
  const level = runPlan({ event: "push", changesets: { "a.md": A_RELEASE }, packages: ONE_PACKAGE("0.1.0"), registry: { a11ign: "0.1.0" } });
  assert.equal(level.mode, "version-pr");
});

test("PLAN: nothing pending and a version NEWER than the registry's latest publishes", () => {
  const plan = runPlan({ event: "push", packages: ONE_PACKAGE("0.1.1"), registry: { a11ign: "0.1.0" } });
  assert.equal(plan.mode, "publish", plan.log);
  assert.match(plan.log, /AHEAD of the registry: a11ign@0\.1\.1/, "the log says which package made it publish");
});

test("PLAN: the EMPTY changeset the version pull request carries is not pending, or every version pull request would ask for another", () => {
  const plan = runPlan({ event: "push", changesets: { "version-packages.md": EMPTY }, packages: ONE_PACKAGE("0.1.1"), registry: { a11ign: "0.1.0" } });
  assert.equal(plan.mode, "publish", plan.log);
  const nothing = runPlan({ event: "push", changesets: { "version-packages.md": EMPTY }, packages: ONE_PACKAGE("0.1.0"), registry: { a11ign: "0.1.0" } });
  assert.equal(nothing.mode, "nothing", nothing.log);
});

test("PLAN: nothing pending and nothing newer is `nothing`, and a manifest BEHIND the registry is not ahead (main reads 0.0.0 beside a published 0.1.0)", () => {
  assert.equal(runPlan({ event: "push", packages: ONE_PACKAGE("0.1.0"), registry: { a11ign: "0.1.0" } }).mode, "nothing");
  const behind = runPlan({ event: "push", packages: ONE_PACKAGE("0.0.0"), registry: { a11ign: "0.1.0" } });
  assert.equal(behind.mode, "nothing", "`changeset publish` would publish 0.0.0 because the registry lacks it; `plan` must not ask it to");
  assert.match(behind.log, /not ahead of the registry: a11ign@0\.0\.0 \(latest there: 0\.1\.0\)/);
});

test("PLAN: a package the registry has never heard of is ahead at 0.1.0 and never at the 0.0.0 placeholder", () => {
  assert.equal(runPlan({ event: "push", packages: ONE_PACKAGE("0.1.0"), registry: {} }).mode, "publish");
  assert.equal(runPlan({ event: "push", packages: ONE_PACKAGE("0.0.0"), registry: {} }).mode, "nothing");
});

test("PLAN: a private package is never a reason to publish", () => {
  const plan = runPlan({ event: "push", packages: { lab: { name: "lab", version: "9.9.9", private: true } }, registry: {} });
  assert.equal(plan.mode, "nothing", plan.log);
});

test("PLAN: a registry that does not answer is CANNOT_TELL and fails the job, never `not published`", () => {
  const plan = runPlan({ event: "push", packages: ONE_PACKAGE("0.1.1"), registry: { a11ign: "DOWN" } });
  assert.notEqual(plan.status, 0, "an unanswered registry must fail the job");
  assert.equal(plan.mode, null, "and no mode may be written, or the jobs after it would run on a guess");
  assert.match(plan.log, /CANNOT_TELL/);
});

test("PLAN: a dispatch rehearses, however much is pending or ahead, and a dispatch with dry-run false is refused", () => {
  const busy = { changesets: { "a.md": A_RELEASE }, packages: ONE_PACKAGE("0.1.1"), registry: { a11ign: "0.1.0" } };
  assert.equal(runPlan({ event: "workflow_dispatch", dryRun: "true", ...busy }).mode, "rehearsal");
  const refused = runPlan({ event: "workflow_dispatch", dryRun: "false", ...busy });
  assert.notEqual(refused.status, 0);
  assert.equal(refused.mode, null, "a refused dispatch writes no mode");
  assert.match(refused.log, /never publishes/);
});

// ---- npm 11.5.1 for trusted publishing (#3180) -----------------------------------------------------------------------
//
// The job runs the npm that ships with Node 22 (10.x) and publishes with no `NODE_AUTH_TOKEN`; npm documents 11.5.1 as the
// floor for the OIDC exchange. The structure is pinned by `npmUpgradeRefusals`; the floor is pinned by RUNNING the step's
// shell against a fake npm, because a regex over `sort -V -C` proves a spelling and not a decision.

const upgradeStep = (workflow: Workflow): Step => workflow.jobs[PUBLISHING_JOB].steps!.find(isNpmUpgrade)!;
const upgradeIndex = (workflow: Workflow): number => workflow.jobs[PUBLISHING_JOB].steps!.findIndex(isNpmUpgrade);
const refusalNames = (workflow: Workflow): string[] => npmUpgradeRefusals(workflow.jobs[PUBLISHING_JOB]).map((r) => r.split(":")[0]);

test("POSITIVE CONTROL (#3180): the upgrade step is in the live publishing job to begin with, once, so the controls below have something to break", () => {
  assert.equal(liveWorkflow().jobs[PUBLISHING_JOB].steps!.filter(isNpmUpgrade).length, 1);
  assert.deepEqual(refusalNames(liveWorkflow()), []);
});

test("POSITIVE CONTROL (#3180): the upgrade step deleted is refused", () => {
  const workflow = clone();
  workflow.jobs[PUBLISHING_JOB].steps!.splice(upgradeIndex(workflow), 1);
  assert.deepEqual(refusalNames(workflow), ["npm-upgrade"]);
});

test("POSITIVE CONTROL (#3180): the upgrade step AFTER `Publish` is refused, and only for that", () => {
  const workflow = clone();
  const steps = workflow.jobs[PUBLISHING_JOB].steps!;
  const [upgrade] = steps.splice(upgradeIndex(workflow), 1);
  steps.splice(steps.findIndex((step) => /^pnpm exec changeset publish\b/.test(step.run ?? "")) + 1, 0, upgrade);
  assert.deepEqual(refusalNames(workflow), ["npm-upgrade-before-publish"]);
});

test("POSITIVE CONTROL (#3180): the upgrade step kept off the publishing event is refused", () => {
  const workflow = clone();
  upgradeStep(workflow).if = "needs.plan.outputs.mode == 'rehearsal'";
  assert.deepEqual(refusalNames(workflow), ["npm-upgrade-on-publish"]);
});

test("POSITIVE CONTROL (#3180): a step that only COMMENTS the install, or a floor below 11.5.1, is not the upgrade", () => {
  const commented = clone();
  upgradeStep(commented).run = '# npm install -g "npm@^11.5.1"\ntrue\n';
  assert.deepEqual(refusalNames(commented), ["npm-upgrade"]);
  const lowered = clone();
  upgradeStep(lowered).run = upgradeStep(lowered).run!.replace("^11.5.1", "^11.0.0");
  assert.deepEqual(refusalNames(lowered), ["npm-upgrade"]);
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
