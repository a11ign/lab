/**
 * #2975 (cut-over 4 of 6): a workflow step that runs `pnpm exec agent-org <command>` runs the tool FROM `node_modules`, so the job must have
 * installed the pinned dependency in an earlier step. The jobs that used to run `node packages/agent-org/src/<x>.mjs` needed a checkout and
 * nothing else (`auto-arm.yml`'s `sweep` says so in as many words), so each of them gained an install, and a job added or reordered later can
 * lose it without any other test noticing: the step then fails `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`/"Command not found" on the next run
 * of that one trigger, which for a sweep is a Sunday-night discovery.
 *
 * `--frozen-lockfile` is required with it, because an install that can rewrite the lockfile resolves `^0.1.0` afresh and runs a release
 * nobody pinned (the pin is the lockfile's resolved commit, not the range).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), "../../../../.github/workflows");

type Job = { steps?: Array<{ run?: string; name?: string }> };
type Workflow = { jobs?: Record<string, Job> };

/** A step that runs the tool: `agent-org <command>` in COMMAND position (line start, or after `;`, `&&`, `||`, `|`, `(`, `then`, `do`), with or without `pnpm exec`. */
const RUNS_THE_TOOL = /(^|&&|\|\||;|\||\(|\bthen\b|\bdo\b)\s*(pnpm exec\s+)?agent-org\s+[a-z]/m;
/** A step that installs from the frozen lockfile, on the same line. */
const INSTALLS_PINNED = /\bpnpm install\b(?=[^\n]*--frozen-lockfile)/;

/** `job.step` of every step that runs the tool with no earlier step in its job that installs from the frozen lockfile. */
export function toolStepsWithoutInstall(doc: Workflow): string[] {
  const offenders: string[] = [];
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    let installed = false;
    for (const [index, step] of (job.steps ?? []).entries()) {
      const run = step.run ?? "";
      if (RUNS_THE_TOOL.test(run) && !installed) offenders.push(`${jobName}.steps[${index}]`);
      if (INSTALLS_PINNED.test(run)) installed = true;
    }
  }
  return offenders;
}

const realWorkflows = () => readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))
  .map((file) => ({ file, doc: parseYaml(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow }));

const toolSteps = (doc: Workflow) => Object.values(doc.jobs ?? {})
  .flatMap((job) => (job.steps ?? []).filter((step) => RUNS_THE_TOOL.test(step.run ?? "")));

test("every workflow step that runs `agent-org` has an earlier step in its job that installs from the frozen lockfile", () => {
  const offenders = realWorkflows().flatMap(({ file, doc }) => toolStepsWithoutInstall(doc).map((where) => `${file}: ${where}`));
  assert.deepEqual(offenders, [],
    "these steps run the tool from node_modules in a job that never installed it -- add `pnpm install --frozen-lockfile --ignore-scripts` "
    + "(with `--filter .` when the job needs only the tool) ABOVE the first step that runs it");
});

test("the control: the real workflows run the tool in many steps, so an empty offender list above is a reading and not a miss", () => {
  const count = realWorkflows().reduce((sum, { doc }) => sum + toolSteps(doc).length, 0);
  assert.ok(count >= 15, "too few steps read as running the tool: the pattern is broken, not the workflows");
});

test("the control: the walk flags a job with no install, flags one that installs AFTER the tool, and passes one that installs first", () => {
  const job = (...runs: string[]): Workflow => ({ jobs: { j: { steps: runs.map((run) => ({ run })) } } });
  const tool = "pnpm exec agent-org merge-guard --ci-gate 1";
  const install = "pnpm install --frozen-lockfile --ignore-scripts --filter .";
  assert.deepEqual(toolStepsWithoutInstall(job(tool)), ["j.steps[0]"], "no install at all");
  assert.deepEqual(toolStepsWithoutInstall(job(tool, install)), ["j.steps[0]"], "the install comes too late to help the step above it");
  assert.deepEqual(toolStepsWithoutInstall(job("pnpm install --ignore-scripts", tool)), ["j.steps[1]"], "an install that may rewrite the lockfile is not the pin");
  assert.deepEqual(toolStepsWithoutInstall(job(install, tool)), [], "an install first is clean");
  assert.deepEqual(toolStepsWithoutInstall(job("echo agent-org is a word in prose")), [], "prose that names the tool runs nothing");
});
