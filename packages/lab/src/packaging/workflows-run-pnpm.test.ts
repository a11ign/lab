/**
 * THE WORKFLOWS RUN pnpm, NOT ONLY INSTALL WITH IT (#2891, row 4 of 10 of "Finish the move to pnpm", #57).
 *
 * #2298/#2301 moved the INSTALL; `ci-installs-with-pnpm.test.ts` pins that. A job can install with pnpm and then
 * spell `npm run build`, which resolves the same scripts through a different tool, or `npx tsc`, which finds a
 * binary by npm's rules rather than the lockfile's. This pins the running, against the PARSED workflows: a step is a
 * step, and the same text in a YAML comment or a shell comment runs nothing, so a history note that names
 * `npm run build` does not fail.
 *
 * TWO GROUPS STAY npm, each named below and each with a comment in its workflow saying why:
 *
 *   - `release.yml`'s publish. No step spells `npm publish`: the step is `pnpm exec changeset publish`, and pnpm shells
 *     out to npm at the far end, because trusted publishing is bound to npm's OIDC and the provenance is npm's to sign.
 *     It is pinned here as a step that must stay pnpm's and name its npm hand-off in a comment.
 *   - `registry-consumer-gate.yml`'s consumer half. The row named `npm install a11ign`; that command runs inside
 *     `scripts/registry-consumer-gate.mjs` (which `no-npm-spawn.test.ts` pins), not in a step. What IS a step is what
 *     the consumer types AFTER the install, three steps that call `npx` in the clean directory. That job installs
 *     nothing from the repository, so there is no pnpm project for `pnpm exec` to resolve in, `pnpm dlx` is the run-time
 *     fetch the move forbids, and a gate that ran the consumer's commands through pnpm would test a different consumer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const WORKFLOWS = fileURLToPath(new URL("../../../../.github/workflows/", import.meta.url));
interface Step { name?: string; run?: string }
interface Workflow { jobs?: Record<string, { steps?: Step[] }> }

/** `npm` subcommands that have a pnpm spelling, and `npx`. `npm publish`, `view` and `pack` are not here: see the header. */
const NPM_RUNNING = /\b(npm (run|test|exec|ci|install|i|x|start)|npx)\b/;

/** The steps that may spell npm, by file and step name. The count is pinned below: a fourth is a decision, not a drift. */
const STAYS_NPM: { file: string; step: string; why: string }[] = [
  { file: "registry-consumer-gate.yml", step: "Set up NVDA", why: "the consumer's clean directory has no pnpm project; the pinned installer reads that directory's guidepup manifest" },
  { file: "registry-consumer-gate.yml", step: "Set up the local scorer from the installed package", why: "the bin is the one the consumer's npm install linked" },
  { file: "registry-consumer-gate.yml", step: "npx a11ign <url>, from the clean install", why: "this IS the consumer's command, quoted verbatim in the row's Acceptance" },
];

/** A step's shell lines with blank and comment lines dropped: a command named only in prose runs nothing. */
const codeLines = (step: Step): string[] =>
  (step.run ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));

interface RunStep { file: string; job: string; label: string; name?: string; lines: string[] }

/** Every step that has a `run:`, from the workflow text. A step without a name is labelled by its position. */
function runSteps(file: string, text: string): RunStep[] {
  const doc = parse(text) as Workflow;
  return Object.entries(doc.jobs ?? {}).flatMap(([job, { steps = [] }]) =>
    steps.flatMap((step, i) => step.run === undefined ? [] : [{
      file, job, name: step.name, label: step.name ?? `step ${i + 1}`, lines: codeLines(step),
    }]));
}

const npmLines = (s: RunStep): string[] => s.lines.filter((l) => NPM_RUNNING.test(l));
const isException = (s: RunStep): boolean => STAYS_NPM.some((e) => e.file === s.file && e.step === s.name);

/** One refusal per offending line, naming the file, the job, the step and the line. */
function refusals(file: string, text: string): string[] {
  return runSteps(file, text).filter((s) => !isException(s))
    .flatMap((s) => npmLines(s).map((l) => `${s.file}:${s.job}: step "${s.label}" runs \`${l}\``));
}

const realWorkflows = (): { file: string; text: string }[] =>
  readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).map((file) => ({ file, text: readFileSync(join(WORKFLOWS, file), "utf8") }));
const realSteps = (): RunStep[] => realWorkflows().flatMap(({ file, text }) => runSteps(file, text));

/** Below this the scan has broken rather than the repo shrunk. Measured 2026-10-01 at 137 `run:` steps across 15 workflows (parsed with `yaml`; the row asked for at least 80). */
const MIN_RUN_STEPS = 80;

const fixture = (run: string): string => `jobs:\n  build:\n    steps:\n      - name: Build\n        run: ${run}\n`;

test("#2891: a step that runs `npm run` is refused, naming the file, the job and the step", () => {
  assert.deepEqual(refusals("fixture.yml", fixture("npm run build")), ['fixture.yml:build: step "Build" runs `npm run build`']);
});

test("#2891: `npx`, `npm test`, `npm exec` and `npm ci` are refused too, and the pnpm spellings are not", () => {
  for (const cmd of ["npx tsc --build", "npm test", "npm exec tsc", "npm ci"]) {
    assert.equal(refusals("fixture.yml", fixture(cmd)).length, 1, `${cmd} should be refused`);
  }
  for (const cmd of ["pnpm run build", "pnpm test", "pnpm exec tsc --build", "pnpm install --frozen-lockfile"]) {
    assert.deepEqual(refusals("fixture.yml", fixture(cmd)), [], `${cmd} is pnpm's`);
  }
});

test("#2891: the same text in a YAML comment or a shell comment is not a step and passes", () => {
  const text = [
    "# run: npm run build, kept as a history note",
    "jobs:",
    "  build:",
    "    steps:",
    "      # - run: npx tsc",
    "      - name: Build",
    "        run: |",
    "          # npm run build used to be here",
    "          pnpm run build",
    "",
  ].join("\n");
  assert.deepEqual(refusals("fixture.yml", text), []);
});

test("#2891: an unnamed step is refused by its position, and one line in a multi-line step is found", () => {
  const text = "jobs:\n  a:\n    steps:\n      - uses: x\n      - run: |\n          echo hi\n          npm run lint\n";
  assert.deepEqual(refusals("fixture.yml", text), ['fixture.yml:a: step "step 2" runs `npm run lint`']);
});

test("#2891: an exception is for ITS file and ITS step only", () => {
  const [{ file, step }] = STAYS_NPM;
  const text = `jobs:\n  j:\n    steps:\n      - name: ${step}\n        run: npx --yes thing\n`;
  assert.deepEqual(refusals(file, text), [], "the named step in the named file is allowed");
  assert.equal(refusals("ci.yml", text).length, 1, "the same step name in another file is not");
  assert.equal(refusals(file, text.replace(step, "Some other step")).length, 1, "another step in the same file is not");
});

test("#2891: no `run:` step in any workflow spells npm, outside the named exceptions", () => {
  const steps = realSteps();
  assert.ok(steps.length >= MIN_RUN_STEPS, `only ${steps.length} run steps found; the scan is broken`);
  assert.deepEqual(realWorkflows().flatMap(({ file, text }) => refusals(file, text)), [],
    "a job that installs with pnpm and runs through npm resolves the same scripts by a different tool");
});

test("#2891: the exceptions are exactly the consumer gate's three, each one live, each with a reason", () => {
  assert.equal(STAYS_NPM.length, 3, "a fourth npm step is a decision for the row, not a drift");
  assert.deepEqual([...new Set(STAYS_NPM.map((e) => e.file))], ["registry-consumer-gate.yml"]);
  const steps = realSteps();
  for (const e of STAYS_NPM) {
    assert.ok(e.why.length > 0);
    const hits = steps.filter((s) => s.file === e.file && s.name === e.step);
    assert.equal(hits.length, 1, `${e.file} has no single step named "${e.step}"; the exception is dead or ambiguous`);
    assert.ok(npmLines(hits[0]).length > 0, `"${e.step}" no longer spells npm: delete its exception rather than keep a dead one`);
  }
});

test("#2891: each exception carries its comment in the workflow, and so does release.yml's publish", () => {
  const consumer = readFileSync(join(WORKFLOWS, "registry-consumer-gate.yml"), "utf8");
  assert.equal((consumer.match(/# STAYS `npx` \(#2891/g) ?? []).length, STAYS_NPM.length, "one `STAYS npx` comment per exception");
  const release = readFileSync(join(WORKFLOWS, "release.yml"), "utf8");
  assert.match(release, /# THE ONE DELIBERATE npm IN THIS FILE \(#2891/, "a reader seeing npm there must be told it is deliberate");
});

test("#2891: release.yml publishes through `pnpm exec changeset publish`, and no step there spells `npm publish`", () => {
  const steps = realSteps().filter((s) => s.file === "release.yml");
  const publish = steps.filter((s) => s.name === "Publish");
  assert.equal(publish.length, 1, "positive control: the publish step is found");
  assert.match(publish[0].lines.join("\n"), /^pnpm exec changeset publish/m);
  assert.deepEqual(steps.flatMap((s) => s.lines.filter((l) => /\bnpm publish\b/.test(l))), [],
    "the hand-off to npm happens inside pnpm; a step that spells it bypasses the rehearsed path");
});
