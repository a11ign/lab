// no-token: gh -- parses the workflow files in the tree and fixtures of its own; no `gh` or network is reached
/**
 * #3885: NO WORKFLOW CHECKS OUT ANOTHER REPOSITORY'S TREE AND RUNS TESTS IN IT.
 *
 * The `agentOrg` job of `ci.yml` copied a11ign/agent-org at `main` into this repository and ran that repository's whole suite, and `gate` needed it. So an
 * agent-org merge turned every a11ign pull request red: #3097 (16 tests, two queue entries ejected, every agent-org PR blocked about 50 minutes) and
 * agent-org#312 (a test importing a file the job never laid, #3879). Every repository is independently deployable; the tool's tests run in ITS CI,
 * before it releases. The jobs that run an `agent-org` COMMAND resolve the newest RELEASED tag through `scripts/agent-org-newest-tag.mjs` and stay.
 *
 * WHAT IS REFUSED: a job with an `actions/checkout` step naming a `repository:` other than this one (or an inline `git clone` / `gh repo clone`), and in the
 * same job a step whose `run:` invokes a test runner. WHAT IS NOT: a checkout of another repository to READ, and the newest-tag script, which clones
 * the tool to run a command of it and is not a checkout step.
 * COVERS: every `.github/workflows/*.yml`, discovered from the directory, so a workflow added tomorrow is read without anyone listing it.
 *
 * POSITIVE CONTROLS: a fixture shaped like the deleted job is refused; the same job with the tests removed, with an own-repository checkout, and with a
 * `${{ github.repository }}` checkout are not (so the detector is neither blind nor trigger-happy). The population floor below is the control for the
 * emptiness of the tree's own offenders.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOWS = join(REPO, ".github/workflows");

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

const OWN_REPOSITORY = "${{ github.repository }}";
/** A runner invocation, read on `run:` lines with their comments removed: `node --test`, rstest, pytest, `pnpm [run] test*`, vitest, jest. */
const TEST_RUNNER = /(?:^|[\s;&|(])(?:node\b[^\n]*\s--test\b|rstest\b|pytest\b|vitest\b|jest\b|(?:pnpm|npm|yarn)(?:\s+run)?\s+test\S*)/m;
/** The rest of a `git clone` line, and of a `gh repo clone` line (whose first argument is `owner/name`). `trunk.yml` clones `.` to test a parent commit of THIS repository, which is not the class. */
const GIT_CLONE = /\bgit\s+clone\b([^\n]*)/g;
const GH_CLONE = /\bgh\s+repo\s+clone\s+(?:-\S+\s+)*(\$\{\{[^}]*\}\}|\S+)/g;
/** A URL: `.`, `./x`, `/tmp/x` and `$DIR` are a tree already on the runner, and `--depth 1` is a flag. */
const REMOTE_URL = /^(?:(?:https?|ssh):\/\/|git@)/;
const codeOf = (run: string) => run.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");

function checksOutAnother(step: Step): boolean {
  if (step.uses?.startsWith("actions/checkout")) {
    const repository = step.with?.repository;
    return typeof repository === "string" && repository !== OWN_REPOSITORY;
  }
  if (step.run === undefined) return false;
  const code = codeOf(step.run);
  const gitSources = [...code.matchAll(GIT_CLONE)].flatMap(([, args]) => args.trim().split(/\s+/));
  const ghSources = [...code.matchAll(GH_CLONE)].map(([, source]) => source);
  return gitSources.some((token) => REMOTE_URL.test(token)) || ghSources.some((source) => source.replace(/\s+/g, "") !== OWN_REPOSITORY.replace(/\s+/g, ""));
}

/** Every `<job>` of `workflow` that lays another repository's tree and runs a test runner in the same job. */
function jobsRunningAnotherRepositorysTests(workflow: Workflow): string[] {
  return Object.entries(workflow.jobs ?? {})
    .filter(([, job]) => (job.steps ?? []).some(checksOutAnother))
    .filter(([, job]) => (job.steps ?? []).some((step) => step.run !== undefined && TEST_RUNNER.test(codeOf(step.run))))
    .map(([name]) => name);
}

const fixture = (checkout: string, run: string): Workflow => parseYaml(`
jobs:
  suite:
    steps:
      - uses: actions/checkout@v7
      - uses: actions/checkout@v7
        with:
${checkout}
      - run: |
${run}
`) as Workflow;

const THE_DELETED_JOB_RUN = "          node --import tsx --test \"packages/agent-org/src/**/*.test.ts\"";
const ANOTHER = "          repository: a11ign/agent-org\n          path: agent-org";

test("CONTROL: a job shaped like the deleted `agentOrg` job (another repository's checkout, then its tests) is refused", () => {
  assert.deepEqual(jobsRunningAnotherRepositorysTests(fixture(ANOTHER, THE_DELETED_JOB_RUN)), ["suite"]);
});

test("CONTROL: each other runner shape the detector names is refused too, so no one of them is a blind spot", () => {
  for (const run of ["pnpm test", "pnpm run test:ts", "npx rstest run", "python -m pytest", "npm test", "npx vitest"]) {
    assert.deepEqual(jobsRunningAnotherRepositorysTests(fixture(ANOTHER, `          ${run}`)), ["suite"], run);
  }
});

test("CONTROL: an inline clone of another repository followed by its tests is refused", () => {
  const workflow = parseYaml("jobs:\n  suite:\n    steps:\n      - run: |\n          gh repo clone a11ign/agent-org\n          node --test tool/**/*.test.mjs\n") as Workflow;
  assert.deepEqual(jobsRunningAnotherRepositorysTests(workflow), ["suite"]);
});

test("CONTROL: a clone of a local path (what `trunk.yml`'s parent re-check does) followed by tests is not refused, a URL clone is", () => {
  // Built from parts: `control-plane-checkout-is-one-fact.test.ts` reads every `git clone <url> <dir>` in a source file as a site that enters a directory.
  const gitClone = (...args: string[]) => ["git", "clone", ...args].join(" ");
  const cloning = (clone: string) => parseYaml(`jobs:\n  suite:\n    steps:\n      - run: |\n          ${clone}\n          pnpm run test:all\n`) as Workflow;
  assert.deepEqual(jobsRunningAnotherRepositorysTests(cloning(gitClone("--quiet", ".", "/tmp/parent"))), []);
  assert.deepEqual(jobsRunningAnotherRepositorysTests(cloning(gitClone("https://github.com/a11ign/agent-org", "tool"))), ["suite"]);
  assert.deepEqual(jobsRunningAnotherRepositorysTests(cloning(gitClone("--depth", "1", "git@github.com:a11ign/agent-org.git", "tool"))), ["suite"]);
  assert.deepEqual(jobsRunningAnotherRepositorysTests(cloning("gh repo clone a11ign/agent-org tool")), ["suite"]);
  assert.deepEqual(jobsRunningAnotherRepositorysTests(cloning("gh repo clone ${{ github.repository }} tool")), []);
});

test("CONTROL: the same checkout with no test runner, an own-repository checkout, and `github.repository` are not refused", () => {
  assert.deepEqual(jobsRunningAnotherRepositorysTests(fixture(ANOTHER, "          cat agent-org/README.md")), [], "a checkout to READ is allowed");
  assert.deepEqual(jobsRunningAnotherRepositorysTests(fixture(ANOTHER, "          # node --test is only named in this comment\n          echo hi")), [], "a comment is not a runner");
  assert.deepEqual(jobsRunningAnotherRepositorysTests(fixture(`          repository: ${OWN_REPOSITORY}`, THE_DELETED_JOB_RUN)), []);
  assert.deepEqual(jobsRunningAnotherRepositorysTests(fixture("          path: .", THE_DELETED_JOB_RUN)), [], "no `repository:` is this repository");
});

const FLOOR = 10;

test("no workflow in the tree lays another repository's tree and runs tests in it (#3885)", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => name.endsWith(".yml"));
  assert.ok(files.length >= FLOOR && files.includes("ci.yml"), `only ${files.length} workflows were found, so an empty offender list would prove nothing`);
  const offenders = files.flatMap((file) =>
    jobsRunningAnotherRepositorysTests(parseYaml(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow).map((job) => `${file}:${job}`));
  assert.deepEqual(offenders, [], "a job lays another repository's tree and runs tests in it: that couples the two CIs, so one merge there turns every pull request here red");
});
