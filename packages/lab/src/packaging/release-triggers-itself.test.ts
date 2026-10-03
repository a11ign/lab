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
  return [...outside, ...publishRefusals(publishing), ...guardStepRefusals(publishing), ...calledGuardRefusals(workflow, publishing)];
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

// ---- the positive controls: each one removes ONE property from the live workflow and must be refused by NAME ----

const clone = (): Workflow => structuredClone(liveWorkflow());

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
