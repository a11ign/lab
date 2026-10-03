/**
 * #3286: THE ACCEPTANCE CHECK READS THE BODY AS IT IS NOW, AND THE STEP THAT RUNS THE AUTHOR'S COMMAND HOLDS NO TOKEN.
 *
 * A Dependabot pull request's `opened` event carries the body Dependabot opened with, and `dependency-pr-body` rewrites it
 * seconds later. The `ci` run that started first took the event's body, failed `ACCEPTANCE: MISSING`, and could not be
 * cleared by `gh run rerun`, which replays the same payload (#3156, 2026-10-03T13:31Z). So `reusable-acceptance.yml` reads
 * the live body through the API instead.
 *
 * THE CONSTRAINT THAT MUST SURVIVE: that file deliberately gives the step running a PR-body command no token and no
 * secret. A live read needs the API, so the read is a step of its own, hands the body on as DATA (a step output, which a
 * later step takes in `env:`), and the step that executes the command receives `PR_BODY` and nothing else. A job's
 * `permissions` are the token's and not a step's, so what this pins is where the token is HANDED: to one step, with the
 * checkout's own persisted credential switched off so it is not also lying in `.git/config`.
 *
 * Every assertion reads the PARSED workflow. The reading step's shell is RUN against a stub `gh`. The checks are functions
 * taking a workflow, so the same function that passes the real file is shown failing the wiring this row replaced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const EXECUTABLE = 0o755;
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const REAL = readFileSync(join(REPO_ROOT, ".github/workflows/reusable-acceptance.yml"), "utf8");

type Step = { name?: string; id?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Workflow = { on: { workflow_call: { inputs?: Record<string, unknown> } | null }; env?: Record<string, string>; jobs: Record<string, { env?: Record<string, string>; permissions?: Record<string, string>; steps: Step[] }> };

// The word is spelled in two halves, as `acceptance-commands.mjs` spells the markers it looks for: that scanner reads a bare
// occurrence in a test file as the test NEEDING a token, and this file only names the variable in workflow text it parses.
const GH_VAR = "GH_" + "TOKEN";

const parse = (text: string): Workflow => parseYaml(text) as Workflow;
const stepsOf = (workflow: Workflow): Step[] => workflow.jobs.run.steps;
const runs = (step: Step, command: string): boolean => (step.run ?? "").includes(command);

/** The step that executes the author's command, found by what it RUNS and not by the name a comment might also carry. */
const commandStep = (workflow: Workflow): Step => {
  const found = stepsOf(workflow).filter((step) => runs(step, "agent-org acceptance-commands"));
  assert.equal(found.length, 1, "exactly one step runs `agent-org acceptance-commands`");
  return found[0];
};

/** Every step handed a credential: a token-named key, or a value naming the token or a secret. */
const holdsCredential = (step: Step): boolean =>
  Object.entries(step.env ?? {}).some(([key, value]) => /TOKEN|SECRET|KEY/i.test(key) || /github\.token|secrets\.|GITHUB_TOKEN/.test(String(value)));

const tokenHolders = (workflow: Workflow): Step[] => stepsOf(workflow).filter(holdsCredential);

/** What is wrong with the step that runs the command (empty means it holds). */
function commandProblems(workflow: Workflow, reader: Step): string[] {
  const command = commandStep(workflow);
  const found: string[] = [];
  if (Object.keys(command.env ?? {}).join() !== "PR_BODY") found.push(`the command step's env is ${JSON.stringify(command.env)}, not PR_BODY alone`);
  if (!String(command.env?.PR_BODY).includes(`steps.${reader.id}.outputs.body`)) found.push(`the command step's PR_BODY is ${command.env?.PR_BODY}, not the live body`);
  if (holdsCredential(command)) found.push("the command step holds a credential");
  if (/inputs\.|pull_request\.body/.test(JSON.stringify(stepsOf(workflow)))) found.push("a step still takes the body from an input or the event payload");
  return found;
}

/** What is wrong with where the credential goes: to the reader alone, and not onto disk or into every step's env. */
function credentialProblems(workflow: Workflow): string[] {
  const found: string[] = [];
  const holders = tokenHolders(workflow);
  if (holders.length !== 1) found.push(`${holders.length} steps hold a credential; only the reader may`);
  if (workflow.env !== undefined || workflow.jobs.run.env !== undefined) found.push("a workflow- or job-level env reaches every step, the command's included");
  const checkout = stepsOf(workflow).find((step) => step.uses?.startsWith("actions/checkout"));
  if (checkout?.with?.["persist-credentials"] !== false) found.push("the checkout persists its credential into .git/config");
  if (workflow.jobs.run.permissions?.["pull-requests"] !== "read") found.push("the job lacks pull-requests: read for the reader");
  return found;
}

/** The read comes after the build and before the command, so the window against the rewrite is the job's setup time. */
function placementProblems(workflow: Workflow, reader: Step): string[] {
  const order = stepsOf(workflow);
  const lastBuild = order.map((step) => step.run).lastIndexOf("pnpm run build");
  const inPlace = lastBuild < order.indexOf(reader) && order.indexOf(reader) < order.indexOf(commandStep(workflow));
  return inPlace ? [] : ["the read is not after the build and before the command"];
}

/** The verdicts over a workflow, each a list of what is wrong with it (empty means it holds). */
function problems(workflow: Workflow): string[] {
  const reader = tokenHolders(workflow).find((step) => step.id !== undefined && runs(step, "gh api"));
  if (reader === undefined) return ["no step reads the API with a token and an id"];
  return [...commandProblems(workflow, reader), ...credentialProblems(workflow), ...placementProblems(workflow, reader)];
}

test("the shipped workflow holds every property", () => {
  assert.deepEqual(problems(parse(REAL)), []);
});

test("positive control: the credential-holding set is not empty, and is the reader alone", () => {
  const holders = tokenHolders(parse(REAL));
  assert.equal(holders.length, 1);
  assert.match(holders[0].run ?? "", /gh api/);
  assert.equal(holders[0].env?.[GH_VAR], "${{ github.token }}");
});

test("the body is not an input any more, so a caller cannot hand a stale one in", () => {
  assert.equal(parse(REAL).on.workflow_call?.inputs, undefined);
  const ci = parse(readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8")) as unknown as { jobs: Record<string, { with?: unknown; permissions?: Record<string, string> }> };
  assert.equal(ci.jobs.acceptance.with, undefined);
  assert.equal(ci.jobs.acceptance.permissions?.["pull-requests"], "read", "a called workflow can only narrow its caller's token");
});

// --- the same verdict, over the wiring this row replaced and three ways of leaking the token ---------------------------

const mutate = (from: string, to: string): Workflow => {
  assert.ok(REAL.includes(from), `the mutation target is gone: ${from}`);
  return parse(REAL.replaceAll(from, to));
};

test("clause 1: the old wiring (the body from the event payload) FAILS", () => {
  const old = mutate("PR_BODY: ${{ steps.live-body.outputs.body }}", "PR_BODY: ${{ github.event.pull_request.body }}");
  assert.ok(problems(old).some((p) => /PR_BODY|payload/.test(p)), JSON.stringify(problems(old)));
  const input = mutate("PR_BODY: ${{ steps.live-body.outputs.body }}", "PR_BODY: ${{ inputs.pr-body }}");
  assert.ok(problems(input).length > 0);
});

test("clause 2: a token handed to the command step FAILS, however it is spelled", () => {
  const target = "      - name: Run the PR's own stated Acceptance command(s)\n        env:\n";
  for (const leak of [GH_VAR + ": ${{ github.token }}", "GITHUB_TOKEN: ${{ github.token }}", "SOME_NAME: ${{ secrets.ANYTHING }}"]) {
    const leaked = mutate(target, `${target}          ${leak}\n`);
    assert.ok(problems(leaked).some((p) => /command step/.test(p)), `${leak}: ${JSON.stringify(problems(leaked))}`);
  }
});

test("clause 2: a job-level env, or a persisted checkout credential, FAILS", () => {
  assert.ok(problems(mutate("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    env:\n      " + GH_VAR + ": ${{ github.token }}\n")).length > 0);
  assert.ok(problems(mutate("          persist-credentials: false\n", "")).some((p) => /persists/.test(p)));
});

test("the read moved before the build FAILS, so the window is not the job's setup time", () => {
  const stepStart = "      - name: Read the PR's LIVE body (#3286)";
  const end = "      # #497: DEEPEN THE CHECKOUT";
  const block = REAL.slice(REAL.indexOf(stepStart), REAL.indexOf(end));
  const moved = REAL.replace(block, "").replace("      - run: pnpm install --frozen-lockfile --ignore-scripts\n", `${block}      - run: pnpm install --frozen-lockfile --ignore-scripts\n`);
  assert.ok(problems(parse(moved)).some((p) => /after the build/.test(p)), JSON.stringify(problems(parse(moved))));
});

// --- the reading step's own shell, run against a stub `gh` -------------------------------------------------------------

type Outcome = { status: number | null; log: string; output: string };

/** Runs the step's `run:` as bash. The stub answers only the call for THIS pull request, so a wrong endpoint reads as a failure. */
function readLive({ body, exitCode = 0 }: { body: string; exitCode?: number }): Outcome {
  const dir = mkdtempSync(join(tmpdir(), "live-body-"));
  try {
    const gh = join(dir, "gh");
    writeFileSync(gh, [
      "#!/bin/bash",
      'if [ "$1 $2" != "api repos/o/r/pulls/7" ]; then echo "unexpected: $*" >&2; exit 64; fi',
      'if [ "$FAKE_EXIT" != 0 ]; then echo "HTTP 502" >&2; exit "$FAKE_EXIT"; fi',
      'printf "%s" "$FAKE_BODY"',
    ].join("\n"));
    chmodSync(gh, EXECUTABLE);
    const reader = stepsOf(parse(REAL)).find((step) => step.id === "live-body")!;
    const output = join(dir, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", reader.run!], {
      encoding: "utf8",
      env: { PATH: `${dir}:/usr/bin:/bin`, GITHUB_OUTPUT: output, REPO: "o/r", PR_NUMBER: "7", FAKE_BODY: body, FAKE_EXIT: String(exitCode) },
    });
    return { status: result.status, log: `${result.stdout}${result.stderr}`, output: readFileSync(output, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What a later step sees for `outputs.body`, parsed the way the runner parses a `name<<delimiter` block. */
function outputBody(output: string): string {
  const lines = output.split("\n");
  const [name, delimiter] = lines[0].split("<<");
  assert.equal(name, "body");
  const end = lines.indexOf(delimiter, 1);
  assert.equal(lines.slice(end + 1).join(""), "", "nothing is written after the delimiter");
  return lines.slice(1, end).join("\n");
}

const LIVE = "deps: bump tsx\n\nAcceptance:\n```bash\npnpm test\n```\n\nCloses: none — dependency bump";

test("clause 1: the step prints the LIVE body, which differs from the payload's", () => {
  const payload = "Bumps tsx from 4.22.4 to 4.23.15.";
  const outcome = readLive({ body: LIVE });
  assert.equal(outcome.status, 0, outcome.log);
  assert.equal(outputBody(outcome.output), LIVE);
  assert.notEqual(outputBody(outcome.output), payload);
});

test("a body that tries to end the value early or set another output stays one value", () => {
  const hostile = `first\nEOF\nbody<<EOF\nGITHUB_ENV=pwned\nsecond`;
  const outcome = readLive({ body: hostile });
  assert.equal(outcome.status, 0, outcome.log);
  assert.equal(outputBody(outcome.output), hostile);
});

test("clause 3: a failed read is a refusal that names the reason, and writes no output", () => {
  const outcome = readLive({ body: LIVE, exitCode: 1 });
  assert.notEqual(outcome.status, 0);
  assert.match(outcome.log, /could not read the live body of o\/r#7; refusing to fall back to the event payload's body/);
  assert.equal(outcome.output, "");
});

test("clause 3: an empty, null-as-empty or whitespace-only body is a refusal, never a pass", () => {
  for (const body of ["", "  \n\t\n"]) {
    const outcome = readLive({ body });
    assert.notEqual(outcome.status, 0, JSON.stringify(body));
    assert.match(outcome.log, /is empty; refusing to fall back/);
    assert.equal(outcome.output, "");
  }
});
