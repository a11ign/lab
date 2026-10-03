// no-token: gh -- nothing here spawns `gh`: the hook tests put a stub `gh` on PATH, and the workflow tests only READ the YAML, naming
// GH_TOKEN as a string to check that a job declares it.
/**
 * #3246: A11IGN'S OWN INVARIANTS ABOUT A11IGN'S OWN TREE, which agent-org's suite used to assert and no longer does.
 *
 * #3233 deleted them from agent-org (a11ign/agent-org commit `be28e232`; the text of each is in that commit's PARENT) because the tool's gate
 * read a11ign at `main`, so a11ign merging reddened it. The wiring they pinned is a11ign's: its workflows, its pre-push hook, its
 * `package.json` scripts, its `host.json`, its declaration and its units. A guard that lives HERE is read where the thing it guards changes.
 *
 * Each test carries the number the row gave its assertion, in square brackets, and the original title after it. Where a test needs the TOOL
 * (a constant the workflow must agree with, a reader the declaration must satisfy), it imports it from the pinned dependency rather than
 * retyping it: two lists of one fact is how these guards drifted before.
 *
 * CLOSED, NOT CARRIED (the row: "one no longer true of a11ign is closed with the reason"):
 *   - acceptance-commands "every suite script's population is real" (>= 180 files, `row-claim-live.test.ts`): every suite script here already
 *     runs through `assert-glob-not-empty.mjs --min=`, which is the floor, and `row-claim-live.test.ts` left with the tool. A second floor
 *     typed here would be the same number written twice.
 *   - acceptance-commands "#510/#497" (`// requires: history`), "#2724 board:settle", "#731", "#967", "#2221", "#2192": each named an a11ign
 *     file only as the REAL fixture for the tool's classifier, and the classifier now runs over a fixture project. What they asserted was the
 *     tool's behaviour; nothing was asserted about the a11ign file beyond its existence.
 *   - trunk-revert-guard "#1040 ACCEPTANCE" x2 and the skip-line test: dead scaffolding that skipped by name on a shallow clone; the acceptance
 *     tests now build their merges, so the skip path cannot occur.
 *   - host-units "#1858 every unit is discovered": covered by [41] and [42], which pin the ten names exactly.
 *
 * POSITIVE CONTROLS come from a11ign's own tree (`.claude/rules/guards-and-assertions.md`): where a population is walked, the test names the
 * member it must find, or runs the same helper over a fixture that is known to offend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { localImports, stripComments } from "../../../guards/src/local-import-closure.mjs";
import { SPAWNS_GH, SUITE_SCRIPTS } from "agent-org/src/acceptance-commands.mjs";
import { GUARDED_WORKFLOWS } from "agent-org/src/board-schedule-liveness.mjs";
import { parseHostConfig, parseUnitsDeclaration, templateValues } from "agent-org/src/host-config.mjs";
import { copyDriftReading, readDeclaredCopies } from "agent-org/src/org-health.mjs";
import { MAX_RECORDED_PARENT_FAILURES, RECHECK_ANNOTATION_TITLE, RECHECK_JOB } from "agent-org/src/trunk-red.mjs";
import { drainedRoles } from "agent-org/src/wake.mjs";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const TOOL = join(ROOT, "node_modules/agent-org");

/**
 * `host-units.mjs` is loaded by a path built here, not by an import declaration or an `import("...")` type, and that is deliberate. The acceptance
 * walk charges `history` to any file whose closure names that module, because it carries `addedOnSomeRef` (a `git log --all` / shallow-clone
 * question). Nothing below calls it: every function taken is pure text-and-JSON reading. A static import would put this file in
 * `work-gate.test.ts`'s pinned "history-requirement population" (#2174) and make every run of it ask for `History: full` over a question it
 * never puts to git. The module's JSDoc types are not visible through a computed path, so the eight members used are typed here.
 */
interface RepoDeps { repoRoot: string; scripts: Record<string, string> }
interface HostUnits {
  SHIPPED_DIR: string;
  declaredProjectKeys(root: string): Set<string>;
  entriesFromCommand(command: string, deps: RepoDeps): string[];
  execCommands(unitText: string): string[];
  ghSpawnReachedFrom(entry: string, deps: RepoDeps): string | null;
  packageScripts(repoRoot: string): Record<string, string>;
  shippedUnits(dir: string, deps: { projectUnitsDir: string; prefix: string; declaredKeys: Set<string> }): string[];
  unitEntryPoints(unitText: string, deps: RepoDeps): string[];
}
const hostUnits = await import(pathToFileURL(join(TOOL, "src/host-units.mjs")).href) as HostUnits;
const { SHIPPED_DIR, declaredProjectKeys, entriesFromCommand, execCommands, ghSpawnReachedFrom, packageScripts, shippedUnits, unitEntryPoints } = hostUnits;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// --- workflows ----------------------------------------------------------------------------------------------------------------------

interface Step { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; "continue-on-error"?: boolean }
interface Job { needs?: string | string[]; if?: string; uses?: string; permissions?: Record<string, string>; env?: Record<string, string>; steps?: Step[] }
interface Workflow {
  on: Record<string, unknown>;
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}

const WORKFLOWS = ".github/workflows";
const EXECUTABLE = 0o755;
/** A walk over fewer workflows or jobs than this repository has is a broken walk, and an emptiness assertion over it would pass. */
const MIN_WORKFLOWS = 5;
/** lint, typecheck, the unscoped suite, pytest. */
const RED_JOB_COMMAND_COUNT = 4;
const MIN_REASON_LENGTH = 20;
const OWN_UNIT_COUNT = 10;
/** corpus-release, lab-watch and fleet-watch: the own services that spawn `gh`. */
const MIN_DECLARING_SERVICES = 3;
const workflowText = (name: string) => read(`${WORKFLOWS}/${name}`);
const workflow = (name: string) => parse(workflowText(name)) as Workflow;
const workflowFiles = () => readdirSync(join(ROOT, WORKFLOWS)).filter((file) => /\.ya?ml$/.test(file));
const runsOf = (job: Job) => (job.steps ?? []).map((step) => step.run ?? "").join("\n");

/** The text with whole-line and trailing YAML comments removed: a workflow that only MENTIONS a thing in prose neither satisfies nor fails a check. */
const withoutComments = (text: string) => text.split("\n").filter((line) => !line.trim().startsWith("#"))
  .map((line) => line.replace(/\s+#.*$/, "")).join("\n");

/** The step of `job` whose `name` contains `fragment`; asserting it exists, so a renamed step reads as a missing one and not as a pass. */
function stepNamed(job: Job, fragment: string): Step {
  const step = (job.steps ?? []).find((candidate) => candidate.name?.includes(fragment));
  assert.ok(step, `no step is named like "${fragment}"`);
  return step;
}

// --- hold: auto-arm.yml and ci.yml --------------------------------------------------------------------------------------------------

test("[1] THE PER-PR ARM PATH GOES THROUGH THE PREDICATE -- it is the path that merged #625, and it ran `gh pr merge --auto` from three lines of bash that read nothing", () => {
  const doc = workflow("auto-arm.yml");
  const armJob = Object.values(doc.jobs).find((job) => /pnpm exec agent-org arm-pr\b/.test(runsOf(job)));
  assert.ok(armJob, "a job must call the script that reads the hold");
  const armIndex = (armJob.steps ?? []).findIndex((step) => /pnpm exec agent-org arm-pr\b/.test(step.run ?? ""));
  assert.ok((armJob.steps ?? []).slice(0, armIndex).some((step) => step.uses?.startsWith("actions/checkout")),
    "a job that runs a repository script needs a checkout BEFORE it -- this one did not have one before");
  // Stricter than the original, which named the one retired spelling: no step of ANY job arms by hand, since a bash arm reads no hold.
  assert.doesNotMatch(withoutComments(workflowText("auto-arm.yml")), /gh pr merge\b[^\n]*--auto/,
    "the unconditional bash arm must be gone, not merely accompanied");
});

test("[2] ci.yml re-runs on `labeled` and `unlabeled`, or the gate's hold refusal never fires on a green PR", () => {
  const types = (workflow("ci.yml").on.pull_request as { types?: string[] }).types ?? [];
  assert.ok(types.length > 0, "the pull_request types list must be findable, or this asserts nothing");
  for (const type of ["labeled", "unlabeled", "edited", "opened", "synchronize", "reopened"]) {
    assert.ok(types.includes(type), `\`${type}\` is missing from ci.yml's pull_request types: ${types.join(", ")}`);
  }
});

// --- board-report.yml ---------------------------------------------------------------------------------------------------------------

test("[3] board-report.yml publishes the Discussion, and its token CANNOT create a release", () => {
  const code = withoutComments(workflowText("board-report.yml"));
  assert.match(code, /pnpm exec agent-org board:document --discussion\b/);
  assert.match(code, /^\s*discussions:\s*write\s*$/m);
  assert.match(code, /^\s*contents:\s*read\s*$/m,
    "contents: read is what a checkout needs; write is what a release draft needs, and this job makes none");
  assert.doesNotMatch(code, /^\s*contents:\s*write\s*$/m);
  assert.doesNotMatch(code, /--release\b/);
  assert.doesNotMatch(code, /\bgh release\b/);
});

test("[4] the republish precondition asks for today's DISCUSSION through the one lookup, not a release", () => {
  assert.match(withoutComments(workflowText("board-report.yml")), /pnpm exec agent-org board-discussion --exists\b/);
});

// --- trunk.yml and nightly.yml: the sweeps ------------------------------------------------------------------------------------------

test("[5] #909: close-rows-sweep.mjs IS wired to trunk.yml's push, as the closeRows job, with a dispatch path for one PR", () => {
  const doc = workflow("trunk.yml");
  const dispatch = doc.on.workflow_dispatch as { inputs?: Record<string, { required?: boolean }> } | undefined;
  assert.deepEqual((doc.on.push as { branches: string[] }).branches, ["main"]);
  assert.ok(dispatch, "workflow_dispatch must exist, or #394's criterion 1 has no trigger");
  assert.equal(dispatch.inputs?.pr?.required, false,
    "the `pr` input is optional: a bare dispatch runs the gate (the #417 sweep's use), a dispatch with pr closes one PR's rows");
  const job = doc.jobs.closeRows;
  assert.ok(job, "trunk.yml carries a closeRows job");
  assert.ok(!job.needs, "closeRows does not wait on the gate: a red push still closes the rows its PR declared");
  const run = runsOf(job);
  assert.match(run, /pnpm exec agent-org close-rows-sweep --window=60/, "the push path sweeps the last hour, idempotently");
  assert.match(run, /pnpm exec agent-org close-rows-for-merged-pr "\$DISPATCH_PR"/, "the dispatch path closes the named PR's rows");
  assert.match(run, /if \[ -n "\$DISPATCH_PR" \]/, "and the two are chosen by whether a pr was given");
});

test("[6] #417's sweep is hourly on nightly.yml's :37 cron since #909, and also runs on workflow_dispatch", () => {
  const doc = workflow("nightly.yml");
  const schedule = (doc.on.schedule as { cron: string }[] | undefined) ?? [];
  assert.ok(schedule.some((entry) => entry.cron === "37 * * * *"), "the hourly cron the sweep rides");
  assert.ok("workflow_dispatch" in doc.on, "a manual kick for exercising the sweep on demand");
  for (const name of ["gateSweep", "closeRowsSweep"]) {
    const job = doc.jobs[name];
    assert.ok(job, `must carry ${name}`);
    assert.match(String(job.if ?? ""), /schedule == '37 \* \* \* \*'/, `${name} runs on the hourly cron`);
    assert.match(String(job.if ?? ""), /workflow_dispatch/, `${name} runs on a hand dispatch too`);
    assert.ok(!job.needs, "the two halves are independent -- one failing must not block the other");
  }
  assert.match(runsOf(doc.jobs.gateSweep), /pnpm exec agent-org trunk-sweep\b/);
  assert.match(runsOf(doc.jobs.closeRowsSweep), /pnpm exec agent-org close-rows-sweep --window=120/,
    "a 120-minute window against an hourly schedule is DELIBERATE overlap, so one missed tick cannot lose a row; "
    + "this pins the number so a future edit cannot narrow it to the schedule interval");
});

test("[7] trunk.yml carries workflow_dispatch, so nightly.yml's gateSweep can trigger a real gate run", () => {
  const { on } = workflow("trunk.yml");
  assert.ok("push" in on, "the original push trigger must still be there -- this ADDS a path, it does not replace the one that works for human merges");
  assert.ok("workflow_dispatch" in on, "without this, the gate sweep has nothing to trigger and the gate half of #417 does nothing");
});

test("[8] trunk.yml's trunkRecheck falls back to a computed before-sha when github.event.before is absent -- the workflow_dispatch case this PR adds", () => {
  assert.match(workflowText("trunk.yml"), /git rev-parse HEAD\^1/,
    "github.event.before only exists on a real push event; without a fallback, a sweep-triggered run would recheck against an empty parent");
});

// --- trunk.yml: the watchdogs ride the push and never a cron ------------------------------------------------------------------------

/**
 * A watchdog moved onto a cron is disabled by the same 60-day inactivity it watches for, and the change would look like tidying a
 * push-triggered step into the nightly file. One property, asserted for [9] and [10] (the row: "one a11ign test could cover the invariant
 * for all three"; `npm-token-liveness.test.ts` holds the third).
 */
function assertFiresOnPushNeverOnCron(doc: Workflow): void {
  assert.ok(!("schedule" in doc.on), "trunk.yml must never gain a `schedule:` trigger: a scheduled watchdog dies in the same breath as the jobs it guards");
  assert.ok("push" in doc.on, "it must trigger on push, which cannot be disabled by inactivity because a push IS the activity");
}

test("[9] the workflow that runs this has no schedule key -- it must fire on push, never on a cron", () => {
  const doc = workflow("trunk.yml");
  assertFiresOnPushNeverOnCron(doc);
  const step = stepNamed(doc.jobs.watchdogs, "Was the pull request that produced this commit actually tested?");
  assert.match(step.run ?? "", /pnpm exec agent-org workflow:liveness --sha=/);
  assert.equal(step["continue-on-error"], true,
    "this step's finding is about a commit that already merged -- it must never fail the push that happens to trigger it");
});

test("[10] the check does NOT run on a schedule, which is the property it exists for", () => {
  const doc = workflow("trunk.yml");
  assertFiresOnPushNeverOnCron(doc);
  assert.match(runsOf(doc.jobs.watchdogs), /pnpm exec agent-org board:liveness --post --issue=20/,
    "the board watchdog step must still be in trunk.yml -- a watchdog in no workflow has silently stopped");
  assert.doesNotMatch(workflowText("nightly.yml"), /board-schedule-liveness\.mjs/,
    "the board watchdog must not ALSO be in nightly.yml -- a cron copy would look like it covers the gap");
});

test("[11] #590 every workflow the watchdog's HEADER names is one its code actually guards", () => {
  // DERIVED FROM THE HEADER, never a second hand-written list: a second list is exactly what the first constant became.
  const header = workflowText("trunk.yml").split("\n").filter((line) => line.trimStart().startsWith("#")).join("\n");
  const named = [...new Set([...header.matchAll(/`(board-[a-z-]+\.yml)`/g)].map((match) => match[1]))];
  assert.ok(named.length >= 2, "PRECONDITION, not the count: the header must still name the workflows it guards, so the loop below walks something");
  for (const name of named) {
    assert.ok((GUARDED_WORKFLOWS as readonly string[]).includes(name),
      `${name} is named in trunk.yml's header but is not in the tool's GUARDED_WORKFLOWS -- the header claiming more than the code guards is the defect #590 was filed for`);
  }
});

// --- a job whose tests can reach `gh` declares GH_TOKEN ------------------------------------------------------------------------------

/** Every string anywhere under `value`: a `run` block, a `with:` input, an `env` value. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringsIn);
}

interface JobFacts { where: string; globs: string[]; hasToken: boolean }

/** Each job of `file`, the quoted `packages/**.test.ts` globs it names, and whether it (or its workflow, or any step) declares GH_TOKEN. */
function jobFactsOf(file: string): JobFacts[] {
  const doc = workflow(file);
  return Object.entries(doc.jobs).map(([name, job]) => ({
    where: `${file}:${name}`,
    globs: stringsIn(job).flatMap((text) => [...text.matchAll(/["'](packages\/[^"'\s]*\.test\.ts)["']/g)].map((match) => match[1])),
    hasToken: [doc.env, job.env, ...(job.steps ?? []).map((step) => step.env)].some((env) => env?.GH_TOKEN !== undefined),
  }));
}

/** The files a shell glob like `packages/lab/src/packaging/board-*.test.ts` names. A glob with a `**`, a variable or a missing directory names none. */
function filesMatching(glob: string): string[] {
  const dir = join(ROOT, dirname(glob));
  if (/[$*]/.test(dirname(glob)) || !existsSync(dir)) return [];
  const pattern = new RegExp(`^${basename(glob).replace(/\./g, "\\.").replace(/\*/g, "[^/]*")}$`);
  return readdirSync(dir).filter((name) => pattern.test(name)).map((name) => join(dir, name));
}

/**
 * The tool is a DEPENDENCY now (#2975), so a test of ours reaches `gh` through `import ... from "agent-org/src/x.mjs"`, a bare specifier the
 * local-import closure does not follow. Without this edge `board-document-chrome-resolver.test.ts` reads as reaching nothing and the guard
 * below walks a population that has quietly lost its only member.
 */
function toolImports(file: string): string[] {
  const code = stripComments(readFileSync(file, "utf8"));
  return [...code.matchAll(/(?:from|import)\s*\(?\s*["'](agent-org\/[^"']+)["']/g)]
    .map((match) => join(ROOT, "node_modules", match[1])).filter((path) => existsSync(path));
}

/** Can a `gh` spawn be reached from `entry` through any depth of local imports, including the ones into the installed tool? */
function reachesGh(entry: string): boolean {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    if (SPAWNS_GH.test(readFileSync(file, "utf8"))) return true;
    pending.push(...localImports(file), ...toolImports(file));
  }
  return false;
}

/** The jobs among `jobs` that run a test which can reach `gh` and declare no token. */
function tokenlessJobs(jobs: JobFacts[]): string[] {
  return jobs.filter((job) => !job.hasToken && job.globs.flatMap(filesMatching).some(reachesGh)).map((job) => job.where);
}

const allJobFacts = () => workflowFiles().flatMap(jobFactsOf);
const CHROME_RESOLVER = join(ROOT, "packages/lab/src/packaging/board-document-chrome-resolver.test.ts");

test("[14] ci.yml parses into real jobs -- a scrape that finds nothing must FAIL, not pass vacuously", () => {
  const names = Object.keys(workflow("ci.yml").jobs);
  assert.ok(names.length >= MIN_WORKFLOWS, `only ${names.length} job(s) parsed out of ci.yml; the scrape has broken`);
  assert.ok(names.includes("board"), "the `board` job must be found by name");
  assert.ok(names.includes("ts"), "the `ts` job must be found by name");
});

test("[13] board-document-chrome-resolver.test.ts reaches `gh` only TRANSITIVELY -- the premise this guard rests on", () => {
  // It takes `resolveChromeBinary` from the tool's `board-document.mjs`, which shells to `gh release` further down the same module: no `gh` in
  // the test file itself, only in what it imports. Re-derived for a dependency: the import is a bare `agent-org/...` specifier, so the premise
  // holds only through `toolImports`, and a walk without that edge would find it false.
  assert.ok(existsSync(CHROME_RESOLVER), "board-document-chrome-resolver.test.ts must exist for this guard to mean anything");
  assert.doesNotMatch(readFileSync(CHROME_RESOLVER, "utf8"), SPAWNS_GH,
    "it names a `gh` spawn directly -- if that is now true, grepping the test files alone would suffice and this walker's reason for existing has changed");
  assert.ok(reachesGh(CHROME_RESOLVER), "it must reach a `gh` spawn through its imports; if it no longer does, this guard is protecting nothing");
});

test("[12] every ci.yml job whose tests can reach a `gh` spawn declares GH_TOKEN", () => {
  // a11ign's live form: ci.yml's jobs CALL the reusable workflows, so the jobs that name test globs are in those files, and the walk covers every workflow.
  const jobs = allJobFacts();
  const board = jobs.find((job) => job.where === "reusable-board.yml:run");
  // POSITIVE CONTROL, from this tree: the board job names globs, they resolve to files, one of them reaches `gh`, and the job declares a token.
  assert.ok(board, "reusable-board.yml carries the job that runs the board tests");
  const files = board.globs.flatMap(filesMatching);
  assert.ok(files.length > 0, `the board job's globs resolved to no file: ${JSON.stringify(board.globs)}`);
  assert.ok(files.some(reachesGh), "none of the board job's tests reaches a `gh` spawn, so this guard walks a population with nothing to find");
  assert.ok(board.hasToken, "the board job reaches `gh` and must declare GH_TOKEN");
  assert.deepEqual(tokenlessJobs(jobs), [],
    "these jobs run tests that can reach a `gh` spawn and declare no GH_TOKEN. `gh` fails in Actions without it, and the failure names the "
    + "env var rather than the test, so it reads as a broken test. Add `env: { GH_TOKEN: ${{ github.token }} }` to the job.");
});

test("[12] control: the same walk flags a job that reaches `gh` with no token, and clears it once the token is declared", () => {
  const offender: JobFacts = { where: "fixture.yml:board", globs: ["packages/lab/src/packaging/board-document-chrome-resolver.test.ts"], hasToken: false };
  assert.deepEqual(tokenlessJobs([offender]), ["fixture.yml:board"]);
  assert.deepEqual(tokenlessJobs([{ ...offender, hasToken: true }]), []);
});

// --- scripts/git-hooks/pre-push: the #386 armed-PR guard ----------------------------------------------------------------------------

/** The exact `#386` block, extracted between its own markers -- never retyped. */
function armedPrGuardBlock(): string {
  const match = /# BEGIN #386 ARMED-PR PUSH GUARD.*\n([\s\S]*?)# END #386 ARMED-PR PUSH GUARD/.exec(read("scripts/git-hooks/pre-push"));
  assert.ok(match, "expected to find the #386 armed-pr-push-guard block, bounded by its own markers");
  assert.match(match[1], /merge-guard --armed-check=/, "and it is the block that asks the tool");
  return match[1];
}

interface Verdict { status: number; stdout: string; stderr: string }

/**
 * Runs ONLY the extracted block in a throwaway tree, with a shell FUNCTION named `pnpm` shadowing the real binary: the real
 * `pnpm exec agent-org merge-guard --armed-check=` needs a live PR in the armed-and-green state, which no PR holds for as long as a test run.
 * The guard asks `command -v gh` and `[ -e node_modules/.bin/agent-org ]`, so the tree gets a stub `gh` on PATH (a machine without one would
 * otherwise skip every case) and the tool's bin only when `installed`.
 */
function runArmedGuardBlock(branch: string, stub: { exitCode: number; output: string },
  { env = {}, installed = true }: { env?: Record<string, string>; installed?: boolean } = {}): Verdict {
  const tree = mkdtempSync(join(tmpdir(), "armed-pr-guard-"));
  try {
    mkdirSync(join(tree, "bin"));
    writeFileSync(join(tree, "bin/gh"), "#!/bin/sh\n");
    chmodSync(join(tree, "bin/gh"), EXECUTABLE);
    if (installed) {
      mkdirSync(join(tree, "node_modules/.bin"), { recursive: true });
      writeFileSync(join(tree, "node_modules/.bin/agent-org"), "");
    }
    const script = `set -euo pipefail\nfailed=()\nskipped=()\nBRANCH="${branch}"\n`
      + `pnpm() { echo '${stub.output.replace(/'/g, "'\\''")}'; exit ${stub.exitCode}; }\n`
      + `${armedPrGuardBlock()}\necho A11Y_REACHED_END\nprintf '%s\\n' "\${skipped[@]:-}" >&2`;
    // `spawnSync`, never `execFileSync`: the latter returns stdout ALONE on success, and the override message prints to stderr and still exits 0.
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8", cwd: tree, env: { PATH: `${tree}/bin:${process.env.PATH ?? ""}`, ...env } });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

test("[15] WIRING: the CLI refusing (non-zero) makes the hook exit non-zero, printing the CLI's own message", () => {
  const result = runArmedGuardBlock("agent/some-branch", { exitCode: 1, output: "REFUSING: #123 is armed and its gate is already green" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REFUSING: #123 is armed and its gate is already green/);
  assert.match(result.stderr, /A11Y_ALLOW_ARMED_PUSH/, "the override must be named in the refusal");
});

test("[16] WIRING: the CLI allowing (exit 0) lets the hook continue past the guard", () => {
  const result = runArmedGuardBlock("agent/some-branch", { exitCode: 0, output: "" });
  assert.equal(result.status, 0, `expected the block to fall through, got: ${result.stderr}`);
  assert.match(result.stdout, /A11Y_REACHED_END/);
});

test("[17] WIRING: A11Y_ALLOW_ARMED_PUSH skips the lookup entirely and prints the reason", () => {
  // The stub would exit 1 if called: the override short-circuits BEFORE the CLI runs, and is not merely a refusal ignored afterwards.
  const result = runArmedGuardBlock("agent/some-branch", { exitCode: 1, output: "REFUSING" }, { env: { A11Y_ALLOW_ARMED_PUSH: "confirmed with dispatcher" } });
  assert.equal(result.status, 0, `expected the override to skip the check entirely, got: ${result.stderr}`);
  assert.match(result.stderr, /armed-pr-push-guard overridden: confirmed with dispatcher/);
  assert.match(result.stdout, /A11Y_REACHED_END/);
});

test("[18] WIRING: a tree without the pinned tool installed SKIPS the guard, naming why -- never a refusal that reads as 'this branch is armed'", () => {
  const result = runArmedGuardBlock("agent/some-branch", { exitCode: 1, output: "REFUSING" }, { installed: false });
  assert.equal(result.status, 0, `expected the missing tool to skip, got: ${result.stderr}`);
  assert.match(result.stderr, /agent-org is not installed in this tree/);
  assert.match(result.stdout, /A11Y_REACHED_END/);
});

test("[19] WIRING: main is skipped -- the guard never even shells out for it", () => {
  // A stub that would exit 1 if invoked proves `main` never reaches the CLI call at all, not merely that it happens to allow it.
  const result = runArmedGuardBlock("main", { exitCode: 1, output: "REFUSING" });
  assert.equal(result.status, 0, `expected main to be skipped entirely, got: ${result.stderr}`);
  assert.match(result.stdout, /A11Y_REACHED_END/);
});

// --- trunk.yml: one contract with the gate, and a recheck that only reads ---------------------------------------------------------------

const trunk = () => workflow("trunk.yml");

test("[20] trunk.yml's job and annotation are the names the gate reads (one contract, two files)", () => {
  const job = trunk().jobs[RECHECK_JOB];
  assert.ok(job, `trunk.yml must carry a job named ${RECHECK_JOB}`);
  const writes = runsOf(job);
  assert.ok(writes.includes(`::notice title=${RECHECK_ANNOTATION_TITLE}::`), "the annotation title the workflow writes must be the one the gate looks for");
  assert.ok(writes.includes("RECHECK_RESULT="), "and the key the gate parses");
  assert.ok(writes.includes(`head -${MAX_RECORDED_PARENT_FAILURES}`), "and the bound on how many parent failures ride along");
});

test("[21] the recheck job READS: no write grant, no PAT, and it runs on either job's failure only", () => {
  const job = trunk().jobs[RECHECK_JOB];
  assert.deepEqual(job.permissions, { contents: "read" }, "it pushes nothing and opens nothing: a job that only reads must not hold a scope that could");
  assert.doesNotMatch(JSON.stringify(job), /A11IGN_BOT_TOKEN|secrets\./, "the PAT existed to open a revert pull request, and this job has nothing to open");
  assert.match(String(job.if), /needs\.trunkGate\.result == 'failure' \|\| needs\.trunkBuildTest\.result == 'failure'/);
});

test("[22] the answer is recorded even when an earlier step died, and an unreadable answer is `unknown`", () => {
  const step = (trunk().jobs[RECHECK_JOB].steps ?? []).find((candidate) => (candidate.run ?? "").includes("::notice title="));
  assert.ok(step, "the step that writes the notice must exist");
  assert.equal(step.if, "always()", "an earlier failure must still leave an answer");
  assert.match(step.run ?? "", /\*\) RECHECK_RESULT=unknown/, "anything that is not pass|fail|unknown is unknown");
});

/** The commands the red job (`trunkBuildTest`'s reusable workflow) runs for its verdict, read from that workflow and not retyped here. */
function redJobBattery(): string[] {
  const reusable = workflow("reusable-build-test.yml");
  return Object.values(reusable.jobs).flatMap((job) => job.steps ?? []).map((step) => (step.run ?? "").trim())
    .filter((run) => /^(pnpm run (lint|typecheck|test:all)|PYTHONDONTWRITEBYTECODE=1 pytest\b.*)$/.test(run));
}

/** The parent re-check's COMMANDS: its comments name `npm test` to explain why it is gone, and must not count as running it. */
function parentCommands(): string {
  const step = stepNamed(trunk().jobs[RECHECK_JOB], "parent fail the same check");
  return (step.run ?? "").split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
}

test("[23] POSITIVE CONTROL: the red job's battery was found, all four commands, and so was the parent step", () => {
  const battery = redJobBattery();
  assert.equal(battery.length, RED_JOB_COMMAND_COUNT, `lint, typecheck, the unscoped suite, pytest; found: ${JSON.stringify(battery)}`);
  assert.ok(battery.includes("pnpm run test:all"), "the unscoped suite is the one that covers every package");
  assert.ok(parentCommands().length > 0);
});

test("[24] the parent re-check runs EVERY command the red job ran, so a red in agent-org or lab cannot re-check green", () => {
  const commands = parentCommands();
  for (const command of redJobBattery()) {
    assert.ok(commands.includes(command), `the parent re-check does not run \`${command}\` -- it would answer a narrower question`);
  }
  assert.doesNotMatch(commands, /\bp?npm test\b/, "`pnpm test` is `test:ts`, whose glob excludes the packages the unscoped suite covers");
});

test("[25] a parent that does not build is UNKNOWN, never a pass: the build's failure is not swallowed", () => {
  const commands = parentCommands();
  assert.match(commands, /if ! pnpm run build[^\n]*; then[\s\S]*?result=unknown/);
  assert.doesNotMatch(commands, /pnpm run build[^\n]*\|\| true/);
});

// --- trunk.yml: nothing reverts ---------------------------------------------------------------------------------------------------------

// THE DELETED NAMES ARE SPELT IN PIECES, ON PURPOSE: a `git grep` for them over `.github packages docs` must print nothing, and a test that
// named them whole would be the one thing it found.
const DELETED_SCRIPT = ["trunk-revert", ".mjs"].join("");
const DELETED_JOB = ["decide", "Revert"].join("");
const DELETED_NAMES = new RegExp(`${DELETED_SCRIPT.replace(".", "\\.")}|${DELETED_JOB}`);

test("[26] POSITIVE CONTROL: the workflow walk found the workflows, trunk.yml among them", () => {
  assert.ok(workflowFiles().length >= MIN_WORKFLOWS, "the walk found too few workflows for an emptiness assertion over it to mean anything");
  assert.ok(workflowFiles().includes("trunk.yml"));
});

test("[27] POSITIVE CONTROL: the deleted-names pattern matches the names it spells in pieces, and not the guard beside them", () => {
  assert.ok(DELETED_NAMES.test(`run: node packages/agent-org/src/${DELETED_SCRIPT}`));
  assert.ok(DELETED_NAMES.test(`${DELETED_JOB}:`));
  assert.ok(!DELETED_NAMES.test("run: node packages/agent-org/src/trunk-revert-guard.mjs"),
    "the guard reverts nothing and is still wired -- matching it would make the walk below refuse trunk.yml");
});

test("[28] NO WORKFLOW calls `git revert`, pushes or opens a `revert/` branch, or names the deleted script", () => {
  const offenders: string[] = [];
  for (const file of workflowFiles()) {
    // Comments are HISTORY and may name the retired thing; only what a step would RUN counts.
    const code = workflowText(file).split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
    if (/git\s+revert\b/.test(code)) offenders.push(`${file}: git revert`);
    if (/revert\/[\w$-]/.test(code)) offenders.push(`${file}: a revert/ branch`);
    if (/gh\s+pr\s+create[^\n]*revert/i.test(code)) offenders.push(`${file}: a revert pull request`);
    if (DELETED_NAMES.test(code)) offenders.push(`${file}: the deleted revert path`);
  }
  assert.deepEqual(offenders, []);
});

test("[29] the revert script and its token test are GONE, and the guard that reverts nothing is still wired", () => {
  // The tool-side half (its `src` has no revert script and does have the guard) is the tool's, and stays in agent-org.
  assert.ok(!existsSync(join(ROOT, "packages/lab/src/packaging/trunk-revert-token.test.ts")));
  assert.match(runsOf(trunk().jobs.trunkGate), /pnpm exec agent-org trunk-revert-guard\b/);
});

test("[30] trunk.yml runs trunk-revert-guard.mjs INSIDE trunkGate, not as a separate job", () => {
  const runs = runsOf(trunk().jobs.trunkGate);
  assert.match(runs, /pnpm exec agent-org trunk-revert-guard\b/,
    "the guard must run as a step inside trunkGate -- a refusal there is what makes trunkRecheck fire and the gate's `trunk-red` cause wake a fixer");
  assert.match(runs, /--merge=\$\{\{ github\.sha \}\}/, "it must check the commit THIS push actually landed, not an inferred or default ref");
});

test("[31] C3 ACCEPTANCE: trunk-revert-guard.mjs's step has no continue-on-error -- its failure must reach the job", () => {
  const step = (trunk().jobs.trunkGate.steps ?? []).find((candidate) => (candidate.run ?? "").includes("agent-org trunk-revert-guard"));
  assert.ok(step, "the step running the guard must exist");
  assert.equal(step["continue-on-error"], undefined,
    "continue-on-error on this step would make a REFUSE verdict invisible to trunkRecheck: a guard whose wrongness is absorbed by another mechanism");
});

test("[32] C3 ACCEPTANCE: trunkRecheck fires on trunkGate's or trunkBuildTest's failure, and ONLY those", () => {
  const { jobs } = trunk();
  const needs = Array.isArray(jobs.trunkRecheck?.needs) ? jobs.trunkRecheck.needs : [jobs.trunkRecheck?.needs];
  assert.ok(needs.includes("trunkGate"), "trunkRecheck must declare trunkGate among its needs, or GitHub cannot resolve `needs.trunkGate.result` at all");
  assert.ok(needs.includes("trunkBuildTest"), "trunkRecheck must also declare trunkBuildTest, where the real build/test suite runs");
  assert.ok(jobs.trunkBuildTest?.uses, "trunkBuildTest must call a reusable workflow, not carry its own steps");
  // `always() &&` IS REQUIRED: an `if:` with no status-check function carries an implicit `success()`, which is false exactly when a needed job
  // failed, so `needs.trunkGate.result == 'failure'` alone never fired (0 of 5 real failures reached this job when it was measured).
  assert.equal(jobs.trunkRecheck.if, "always() && (needs.trunkGate.result == 'failure' || needs.trunkBuildTest.result == 'failure')");
});

// --- the declaration: wake roster, copies, organisation scopes ---------------------------------------------------------------------------

const projectDeclaration = () => JSON.parse(read(".agent-org/project.json")) as {
  code: { key: string; repo: string }[];
  tracker: { key: string; repo: string }[];
  units: { prefix: string; boardReportWorkflow: string; own: string[] };
};

test("[33] #2324: `npm run spawn:cycles` is wired to that command", () => {
  const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
  assert.equal(scripts["spawn:cycles"], "agent-org spawn:cycles");
});

test("[34] #2505: the real sessions.json marks NO role drained, and the reader still finds the mark in a roster that has one", () => {
  const path = join(ROOT, ".agent-org/roles/sessions.json");
  assert.deepEqual(drainedRoles(path), [], "the standing engineers are retired, so nothing is being drained");
  // The control for that emptiness, from this tree: the same roster with the mark on its engineer role is found by the same reader.
  const roster = JSON.parse(readFileSync(path, "utf8")) as { live: { name: string; role: string; drain?: boolean }[] };
  const engineers = roster.live.filter((session) => session.role === "engineer");
  assert.ok(engineers.length > 0, "the real roster holds an engineer role to mark");
  const dir = mkdtempSync(join(tmpdir(), "wiring-roster-"));
  try {
    const marked = join(dir, "sessions.json");
    writeFileSync(marked, JSON.stringify({ live: roster.live.map((session) => (session.role === "engineer" ? { ...session, drain: true } : session)) }));
    assert.deepEqual(drainedRoles(marked), engineers.map((session) => session.name));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * `gh repo list a11ign --limit 100 --json name,isArchived`, RECORDED 2026-10-03 (read-only, as `a11ign-ai-workers`; the 2026-10-02 recording
 * the tool's test held is the same nine). A recording and not a list written here: the organisation's repositories are a fact GitHub holds and a
 * declaration is checked AGAINST it.
 */
const RECORDED_ORGANISATION = [
  "a11ign", "agent-org", "screenreader-worker", "corpus-backups", "auth-capture-check", "documents", "control", "lab", "screenreader-fleet",
].map((name) => ({ name, isArchived: false }));

/**
 * THE SHRINK-ONLY EXEMPTION LIST: a repository that is not a declared scope, and why. An entry leaves when the repository is declared (a declared
 * one is refused as redundant) and never joins without a reason; the ceiling is the count it was recorded at, so a longer list fails.
 */
const EXEMPT: Record<string, string> = {
  "corpus-backups": "release storage only: 0 pull requests, all or open (measured 2026-10-02, `gh pr list -R a11ign/corpus-backups --state all`)",
  "control": "a layer repository (#2612) whose issues live on a11ign/a11ign; 0 pull requests measured 2026-10-02",
  "lab": "a layer repository (#2612) whose issues live on a11ign/a11ign; 0 pull requests measured 2026-10-02",
  "screenreader-fleet": "a layer repository (#2612) whose issues live on a11ign/a11ign; 0 pull requests measured 2026-10-02",
  "auth-capture-check": "a private test bed (#2561) whose pull requests are workflow-run vehicles, NOT work to review or merge; 7 open on "
    + "2026-10-02, the same class, routed to product-manager on #2969 rather than declared here",
};
const EXEMPTION_CEILING = 5;

/** The non-archived repositories of `organisation` that are neither a declared scope nor exempt: the offenders. */
function undeclared(organisation: { name: string; isArchived: boolean }[], declared: Set<string>): string[] {
  return organisation.filter((repo) => !repo.isArchived && !declared.has(repo.name) && !(repo.name in EXEMPT)).map((repo) => repo.name);
}

function declaredRepositories(): Set<string> {
  const { code, tracker } = projectDeclaration();
  return new Set([...code, ...tracker].map(({ repo }) => repo).filter((repo) => repo.startsWith("a11ign/")).map((repo) => repo.slice("a11ign/".length)));
}

test("[35] (1) every non-archived repository in the organisation is a declared scope or a named exemption, and `agent-org` is a scope", () => {
  const declared = declaredRepositories();
  // POSITIVE CONTROLS: the recording holds `agent-org` and the declaration reads it -- or "nobody is undeclared" is two empty lists agreeing.
  assert.ok(RECORDED_ORGANISATION.some((repo) => repo.name === "agent-org"), "the recording holds agent-org");
  assert.ok(declared.has("agent-org") && declared.has("a11ign"), "and the declaration names both");
  assert.deepEqual(undeclared(RECORDED_ORGANISATION, declared), []);
  // NEGATIVE CONTROL, through the same function: a repository nobody declared goes red, and an archived one is not asked about.
  assert.deepEqual(undeclared([...RECORDED_ORGANISATION, { name: "nobody-declared", isArchived: false }], declared), ["nobody-declared"]);
  assert.deepEqual(undeclared([{ name: "nobody-declared", isArchived: true }], declared), []);
  // THE LIST ONLY SHRINKS: every exemption has a reason, names a repository that exists, and is not also declared.
  for (const [name, reason] of Object.entries(EXEMPT)) {
    assert.ok(reason.length > MIN_REASON_LENGTH, `${name} needs a reason`);
    assert.ok(RECORDED_ORGANISATION.some((repo) => repo.name === name), `${name} is exempt but is in no recording: delete the entry`);
    assert.equal(declared.has(name), false, `${name} is declared: delete its exemption`);
  }
  assert.ok(Object.keys(EXEMPT).length <= EXEMPTION_CEILING, "the exemption list is shrink-only");
});

/** What `readDeclaredCopies` returns for each copy the tool's `lib/` declares. */
interface CopyPair { original: string; copy: string; originalText: string | null; copyText: string; allowedLines: number | null }
const declaredCopies = () => (readDeclaredCopies({ root: ROOT }) ?? []) as CopyPair[];

test("[36] control: the real tree's declared copies are discovered, every original is readable, and the pair set is CLEAN", () => {
  const pairs = declaredCopies();
  // The count is derived a second way, by a plain scan for a line opening with the header's first words, and asserted EQUAL: a floor is
  // satisfied by 19, by 58 and by 157.
  const lib = join(TOOL, "src/lib");
  const headed = readdirSync(lib).filter((name) => /^\/\/ COPIED FROM `/m.test(readFileSync(join(lib, name), "utf8")));
  assert.ok(headed.length > 0, "the scan is not empty: the tree's copies are what the control compares");
  assert.equal(pairs.length, headed.length, `discovery found ${pairs.length} pairs and a scan of lib/ finds ${headed.length} headed files`);
  assert.deepEqual(pairs.filter((pair) => pair.originalText === null).map((pair) => pair.copy), [],
    "an unreadable original would make 'clean' mean 'not asked'");
  const reading = copyDriftReading({ pairs });
  assert.equal(reading.status, "clear", reading.detail);
});

test("[37] control: the REAL isolation-gate pair with ONE BYTE changed in the original trips, naming both paths -- and the same byte in the copy trips too", () => {
  const ISOLATION = "src/lib/isolation-gate.mjs";
  const pairs = declaredCopies();
  const real = pairs.find((pair) => pair.copy === ISOLATION);
  assert.ok(real, "the pair #2921 edited by hand is among the declared copies");
  assert.equal(real.original, "packages/guards/src/isolation-gate.mjs", "and its original is a11ign's own file");
  assert.ok(real.originalText !== null && real.originalText.includes("const "), "the byte this mutates must exist");
  const changedOriginal = pairs.map((pair) => (pair === real ? { ...pair, originalText: (real.originalText as string).replace("const ", "cnst ") } : pair));
  const reading = copyDriftReading({ pairs: changedOriginal });
  assert.equal(reading.status, "tripped");
  assert.match(reading.detail, /src\/lib\/isolation-gate\.mjs against packages\/guards\/src\/isolation-gate\.mjs/);
  const changedCopy = pairs.map((pair) => (pair === real ? { ...pair, copyText: pair.copyText.replace("const ", "cnst ") } : pair));
  assert.equal(copyDriftReading({ pairs: changedCopy }).status, "tripped");
  assert.equal(copyDriftReading({ pairs: changedCopy.filter((pair) => pair.copy !== ISOLATION) }).status, "clear",
    "the other pairs are untouched, so the trip is the one pair's");
});

// --- host.json and the project's units ----------------------------------------------------------------------------------------------

const hostConfig = () => parseHostConfig(read(".agent-org/host.json"), ".agent-org/host.json");
const unitsDeclaration = () => parseUnitsDeclaration(read(".agent-org/project.json"), ".agent-org/project.json");
const UNITS = ".agent-org/units";
const unitNames = () => readdirSync(join(ROOT, UNITS)).sort();
const unitText = (name: string) => read(`${UNITS}/${name}`);
/** A home-directory path, however it continues: what "the unit names a host" means in text. */
const HOME_LITERAL = /\/home\/[A-Za-z_][\w.-]*/;

test("[38] #2620: a11ign's host.json says every path the tool used to hard-code", () => {
  const host = hostConfig();
  assert.deepEqual(templateValues(host, unitsDeclaration()), {
    home: "/home/agent", binDir: "/home/agent/.local/bin", checkout: "/home/agent/repos/a11y-witness",
    workersDir: "/home/agent/workers", leadsDir: "/home/agent/leads", prefix: "a11ign-",
  });
});

test("[39] #2620: the constants `wake.mjs` still spells out (rows 3b and 3c) equal what host.json says", () => {
  const wake = readFileSync(join(TOOL, "src/wake.mjs"), "utf8");
  const constant = (name: string) => new RegExp(`export const ${name} = "([^"]+)"`).exec(wake)?.[1];
  const host = hostConfig();
  assert.equal(constant("WORKERS_GH_CONFIG_DIR"), `${host.gh.workers}/gh`);
  assert.equal(constant("HOST_REPOS"), dirname(templateValues(host, unitsDeclaration()).checkout));
});

test("[40] #2620: the project's own services still name their own host (the scan CAN see the literal)", () => {
  assert.match("Environment=HOME=/home/agent", HOME_LITERAL);
  const carrying = unitNames().filter((name) => HOME_LITERAL.test(unitText(name)));
  assert.deepEqual(carrying, projectDeclaration().units.own.filter((name) => name.endsWith(".service")).sort(),
    "a timer names no path, and the literal belongs in the project's own units, which is where it is");
});

test("[41] the 10 units in a11ign's .agent-org/units equal the `units.own` list in its declaration, and none are stray", () => {
  const { own } = unitsDeclaration();
  assert.equal(own.length, OWN_UNIT_COUNT, "POSITIVE CONTROL: ten units are declared, so the equality below is not two empty lists");
  assert.deepEqual(unitNames(), [...own].sort());
});

test("[42] #2620: NO UNIT IS RENAMED -- a11ign's own units still carry the names they had", () => {
  assert.deepEqual(unitNames(), [
    "a11ign-corpus-release-nightly.service", "a11ign-corpus-release-nightly.timer",
    "a11ign-corpus-snapshot.service", "a11ign-corpus-snapshot.timer",
    "a11ign-fleet-watch.service", "a11ign-fleet-watch.timer",
    "a11ign-lab-watch.service", "a11ign-lab-watch.timer",
    "a11ign-weekly-review.service", "a11ign-weekly-review.timer", // #3319: the weekly outsider review's clock
  ]);
});

/** Run the tool's board-report dispatcher in `cwd` with a stub `gh` first on PATH that records its arguments, one call per line. */
function dispatch(cwd: string): { status: number | null; calls: string[]; stderr: string } {
  const bin = mkdtempSync(join(tmpdir(), "dispatch-bin-"));
  try {
    const log = join(bin, "calls");
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1" in run) echo 4242;; esac\n`);
    chmodSync(join(bin, "gh"), EXECUTABLE);
    const done = spawnSync("bash", [join(SHIPPED_DIR, "board-report-dispatch.sh")], { cwd, encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}` } });
    return { status: done.status, calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [], stderr: done.stderr };
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

test("[43] with a11ign's real declaration the dispatcher issues `workflow run board-report.yml --repo a11ign/a11ign`", () => {
  const home = dispatch(ROOT);
  assert.equal(home.status, 0, home.stderr);
  assert.equal(home.calls[0], "workflow run board-report.yml --repo a11ign/a11ign");
  // The workflow it names is a workflow this tree has: a declaration naming a file that is not there dispatches nothing.
  assert.ok(workflowFiles().includes(projectDeclaration().units.boardReportWorkflow), "and the declared workflow exists");
});

test("[44] #2901: the chairman-messaging units are listed exactly when a11ign's declaration holds `messaging`", () => {
  const keys = declaredProjectKeys(ROOT);
  assert.ok(keys.has("units") && keys.has("causes"), "POSITIVE CONTROL: the declaration is readable and holds its other keys");
  const listed = shippedUnits(SHIPPED_DIR, { projectUnitsDir: join(ROOT, UNITS), prefix: projectDeclaration().units.prefix, declaredKeys: keys })
    .filter((unit: string) => /^a11ign-chairman-(watch|listen)\./.test(unit));
  assert.equal(listed.length > 0, keys.has("messaging"), `the trio is listed exactly when the key is present; listed: ${JSON.stringify(listed)}`);
});

// --- a11ign's own units -------------------------------------------------------------------------------------------------------------

const WATCHERS = { lab: "packages/control/src/lab-watch.mjs", fleet: "packages/control/src/fleet-watch.mjs" };
const ownServices = () => projectDeclaration().units.own.filter((name) => name.endsWith(".service"));
const ownTimers = () => projectDeclaration().units.own.filter((name) => name.endsWith(".timer"));
const scriptsOfRoot = () => packageScripts(ROOT);
/** The `GH_CONFIG_DIR` a unit declares, or null when it declares none. */
const declaredAccount = (name: string) => /^Environment=GH_CONFIG_DIR=(.*)$/m.exec(unitText(name))?.[1] ?? null;

test("[45] #1911: the corpus-release unit reads fleet.env, the only place a unit can get A11Y_PVE_KEY", () => {
  // The `-` leaves a missing file to corpus-release-nightly.mjs's own refusal, which names it.
  assert.match(unitText("a11ign-corpus-release-nightly.service"), /^EnvironmentFile=-%h\/\.config\/a11ign\/fleet\.env$/m);
});

test("[46] #2230: each watcher ships as a pair, so `host:install` has something to install", () => {
  for (const name of Object.keys(WATCHERS)) {
    for (const unit of [`a11ign-${name}-watch.service`, `a11ign-${name}-watch.timer`]) {
      assert.ok(projectDeclaration().units.own.includes(unit), `${unit} must ship: a script nothing schedules is the state #2230 ended`);
      assert.ok(existsSync(join(ROOT, UNITS, unit)), `${unit} is declared but not on disk`);
    }
  }
});

test("[47] #2230: each service runs its watcher WITH `--post`, and the command resolves to the script", () => {
  for (const [name, script] of Object.entries(WATCHERS)) {
    const service = unitText(`a11ign-${name}-watch.service`);
    assert.match(service, new RegExp(`^ExecStart=%h/\\.local/bin/pnpm run ${name}:watch -- --post$`, "m"),
      "without --post the unit is installed, enabled, active, exits 0 or 1 every hour and writes to the journal alone");
    const command = execCommands(service).find((candidate: string) => candidate.includes("watch")) as string;
    assert.deepEqual(entriesFromCommand(command, { repoRoot: ROOT, scripts: scriptsOfRoot() }), [join(ROOT, script)],
      "a renamed or missing npm script leaves the unit syntactically perfect and starting nothing");
    // THE EXIT CONTRACT (docs/gate-exit-codes.md): ATTENTION (1) is a posted finding, not a failed unit; CANNOT_ASK (2) must stay a failed one.
    assert.match(service, /^SuccessExitStatus=0 1$/m, `${name}: 0 and 1 are success, and NOT 2`);
    assert.match(service, /^Environment=GH_CONFIG_DIR=\/home\/agent\/workers\/gh$/m, `${name}: it posts as the workers account, declared rather than inherited (#1974)`);
    assert.doesNotMatch(service, /^\[Install\]$/m, `${name}: no [Install] -- WantedBy=default.target would fire it at every boot`);
  }
});

/** The own services whose entry point reaches a `gh` spawn, read by the tool's own reader. */
function servicesSpendingGh(): string[] {
  return ownServices().filter((name) => unitEntryPoints(unitText(name), { repoRoot: ROOT, scripts: scriptsOfRoot() })
    .some((entry: string) => ghSpawnReachedFrom(entry, { repoRoot: ROOT, scripts: scriptsOfRoot() }) !== null));
}

test("[48] #1974: every own service that spawns `gh` declares which account, and both watchers are among them", () => {
  const spending = servicesSpendingGh();
  // THE CONTROL IS THE MEMBERSHIP, not a floor: a count of 3 is met by three wrong units.
  for (const expected of ["a11ign-corpus-release-nightly.service", "a11ign-fleet-watch.service", "a11ign-lab-watch.service"]) {
    assert.ok(spending.includes(expected), `${expected} reaches a gh spawn and must be charged for an identity; charged: ${JSON.stringify(spending)}`);
  }
  assert.deepEqual(spending.filter((name) => declaredAccount(name) === null), [],
    "a unit reaching a `gh` spawn with no Environment=GH_CONFIG_DIR= line inherits `~/.config/gh` -- a person's account -- and spends a human's rate limit");
});

test("[49] #2000: which own timers run their service at `host:install`, and which do not", () => {
  const requiring = ownTimers().filter((name) => /^Requires=/m.test(unitText(name))).sort();
  assert.deepEqual(requiring, ["a11ign-corpus-release-nightly.timer", "a11ign-corpus-snapshot.timer"],
    "`Requires=` in a timer's [Unit] is an ordinary start dependency, so `enable --now` starts the service too, once, at install time. Adding "
    + "another entry means that service runs during `host:install`: say so in the unit and check it is a run you want unattended");
  assert.deepEqual(ownTimers().filter((name) => !requiring.includes(name)).sort(), ["a11ign-fleet-watch.timer", "a11ign-lab-watch.timer", "a11ign-weekly-review.timer"],
    "the watchers `--post`, so a firing at every `host:install` would put a comment on #928 each time; they are activated by name alone ON PURPOSE. "
    + "The weekly review files a row, which is idempotent by ISO week but still not something an install should do (#3319)");
});

test("[50] #2230: the watcher timers are CALENDAR timers, hourly, and off the org-watch minute", () => {
  // The org watch runs from nightly.yml on every hourly cron it declares; derived, so moving that cron moves this.
  const nightlyMinutes = ((workflow("nightly.yml").on.schedule as { cron: string }[]) ?? [])
    .map((entry) => entry.cron.split(" ")).filter(([, hour]) => hour === "*").map(([minute]) => minute.padStart(2, "0"));
  assert.ok(nightlyMinutes.includes("37"), "POSITIVE CONTROL: nightly.yml's hourly minute was found");
  const minutes: Record<string, string> = {};
  for (const name of Object.keys(WATCHERS)) {
    const timer = unitText(`a11ign-${name}-watch.timer`);
    const minute = /^OnCalendar=\*-\*-\* \*:(\d\d):00$/m.exec(timer)?.[1];
    assert.ok(minute, `${name}: an hourly calendar expression`);
    minutes[name] = minute;
    assert.match(timer, /^Persistent=true$/m, `${name}: a missed hour is read at next opportunity`);
  }
  assert.equal(new Set([...Object.values(minutes), ...nightlyMinutes]).size, 2 + nightlyMinutes.length, `distinct minutes: ${JSON.stringify(minutes)}`);
  assert.ok(!Object.values(minutes).includes("00"), ":00 is where every other clock fires (#965)");
});

/** Every `.mjs` directly under a package's `src/` that exports `ORG_READING_ISSUE`: "this file posts on #928" as it looks in this tree. */
function orgReadingWatchers(dirs: string[]): string[] {
  return dirs.flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith(".mjs")).map((name) => join(dir, name))
    .filter((path) => /^export const ORG_READING_ISSUE\b/m.test(readFileSync(path, "utf8")))).sort();
}

/** The watchers that no unit starts and no workflow step invokes -- the state #2230 found. */
function watchersWithNoCaller(watchers: string[], callers: { unitTexts: string[]; workflowTexts: string[] }): string[] {
  const startedByUnit = new Set(callers.unitTexts.flatMap((text) => unitEntryPoints(text, { repoRoot: ROOT, scripts: scriptsOfRoot() })));
  const workflowLines = callers.workflowTexts.flatMap((text) => text.split("\n")).filter((line) => !line.trim().startsWith("#"));
  const startedByWorkflow = (path: string) => workflowLines.some((line) => line.includes(basename(path))
    || entriesFromCommand(line.replace(/^\s*(-\s*)?run:\s*/, "").trim(), { repoRoot: ROOT, scripts: scriptsOfRoot() }).includes(path));
  return watchers.filter((path) => !startedByUnit.has(path) && !startedByWorkflow(path));
}

const realCallers = () => ({
  unitTexts: unitNames().map(unitText),
  workflowTexts: workflowFiles().map(workflowText),
});

test("[51] #2230: every script that posts on #928 has a caller -- a watcher nothing runs is not a watcher", () => {
  const dirs = readdirSync(join(ROOT, "packages")).map((name) => join(ROOT, "packages", name, "src")).filter((dir) => existsSync(dir));
  const watchers = orgReadingWatchers(dirs);
  // THE POPULATION'S OWN CONTROL: "watchers with no caller" passes when the scan finds no watchers, so the population is pinned to the two it contains.
  assert.deepEqual(watchers.map((path) => basename(path)), ["fleet-watch.mjs", "lab-watch.mjs"],
    "a new --posting watcher is welcome, and this list is where it says so");
  assert.deepEqual(watchersWithNoCaller(watchers, realCallers()), [],
    "each must be started by a unit or a workflow step -- these two need the lab's credential, so they are host units");
});

test("[52] #2230: POSITIVE CONTROL -- the guard flags a watcher with no unit and no workflow step", () => {
  const dir = mkdtempSync(join(tmpdir(), "watcher-guard-"));
  try {
    const orphan = join(dir, "orphan-watch.mjs");
    writeFileSync(orphan, "export const ORG_READING_ISSUE = 928;\n");
    writeFileSync(join(dir, "not-a-watcher.mjs"), "export const OTHER = 1;\n");
    assert.deepEqual(orgReadingWatchers([dir]), [orphan], "discriminated by the export, not the directory");
    assert.deepEqual(watchersWithNoCaller([orphan], realCallers()), [orphan], "no unit and no workflow step of a11ign's names it, so it is the finding");
    assert.deepEqual(watchersWithNoCaller([orphan], { unitTexts: [`[Service]\nExecStart=/usr/bin/node ${orphan}\n`], workflowTexts: [] }), [],
      "and a unit that starts it clears it");
    assert.deepEqual(watchersWithNoCaller([orphan], { unitTexts: [], workflowTexts: ["      # node orphan-watch.mjs\n"] }), [orphan],
      "a COMMENT naming it in a workflow is not a caller");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[53] #2332: the corpus release runs as the LEADS account, and nothing a11ign ships declares the person's", () => {
  const release = unitText("a11ign-corpus-release-nightly.service");
  assert.match(release, /^Environment=GH_CONFIG_DIR=\/home\/agent\/leads\/gh$/m,
    "a11ign-ai-leads has push (not admin) on a11ign/corpus-backups, which is all `gh release create` needs");
  assert.doesNotMatch(release, /THE HUMAN ONE, AND THAT IS THE RIGHT ANSWER/, "the comment that argued for the person's account must not survive beside the line that removed it");
  // THE POPULATION, NAMED: the emptiness below is worth what this says about its input.
  const declaring = ownServices().filter((name) => declaredAccount(name) !== null);
  assert.ok(declaring.length >= MIN_DECLARING_SERVICES, `too few own services declare an account: ${JSON.stringify(declaring)}`);
  assert.deepEqual(declaring.filter((name) => /^$|\.config\/gh/.test(declaredAccount(name) as string)), [],
    "no own unit declares the person's config, or an empty one (which the wrapper reads as a shell with no workspace: the person)");
});

test("[54] #2332: host.json declares exactly the three decision-holders as the leads, each with its role (a fourth id needs a ruling, not an edit)", () => {
  assert.deepEqual(hostConfig().gh.leadsWorkspaces, [
    { id: "w6", role: "ceo" }, { id: "w2", role: "product-manager" }, { id: "w5", role: "orchestrator" },
  ]);
});

// --- the root package.json and the row template -----------------------------------------------------------------------------------------

test("[55] a11ign's package.json still defines every name the tool charges as a whole-suite command", () => {
  const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
  const charged = [...SUITE_SCRIPTS] as string[];
  // The control: the tool's list is the one this tree's four suite scripts belong to, so the loop is not over a different population.
  for (const known of ["test:ts", "test:org", "test:all", "test"]) assert.ok(charged.includes(known), `the tool no longer charges ${known}`);
  for (const name of charged) {
    assert.equal(typeof scripts[name], "string",
      `\`${name}\` is not a script in package.json -- a name that no longer exists charges nothing and reads as a command that needs nothing`);
  }
});

test("[56] #2099: the row template DECLARES the field -- a mechanism no filer is told about is the prose it replaced", () => {
  const template = read(".github/ISSUE_TEMPLATE/backlog-row.yml");
  assert.match(template, /Hand-run: <who runs it and why>/);
  assert.match(template, /acceptance job/i);
  // #2118: and it names where the output goes, for the identical reason -- the filer is told in the one document they read when they write the Acceptance.
  assert.match(template, /## Hand-run output/);
});
