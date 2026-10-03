/**
 * A PUBLISH MUST FAIL WHEN A MANIFEST IS BEHIND THE REGISTRY'S LATEST (#3167, found reviewing #3131).
 *
 * `plan` picks `publish` when ONE package is strictly ahead of the registry, but `changeset publish` then sends EVERY
 * non-private package whose manifest version the registry lacks. A manifest BEHIND the registry's latest would be
 * published as an older version and, with no `--tag`, could move `latest` to it, which cannot be undone.
 *
 * WHAT THIS READS. The publishing job's PARSED steps, never the text: a comment or an `echo` naming the check must
 * satisfy nothing. The guard step is found by what it DOES (it reads the plan's `readings` and exits non-zero on a
 * behind one), then RUN with `bash` against fixtures, so "refuses the behind package, naming it" is observed rather
 * than read off a regex. The readings themselves come from `plan`'s own comparison, which is run here too against a
 * stub registry: a guard reading a field `plan` never writes would pass its fixtures and never fire in production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = resolve(import.meta.dirname, "../../../..");
const EXECUTABLE = 0o755;
const PUBLISHING_JOB = "release";

interface Step { name?: string; if?: string; run?: string; env?: Record<string, string> }
interface Workflow { jobs: Record<string, { steps?: Step[] }> }
interface Reading { name: string; manifest: string; latest: string; state: "ahead" | "behind" | "level" }

const liveWorkflow = (): Workflow => parseYaml(readFileSync(resolve(REPO, ".github/workflows/release.yml"), "utf8")) as Workflow;

const publishesOn = (step: Step): boolean => /needs\.plan\.outputs\.mode == 'publish'/.test(step.if ?? "");

/** The step that reads the plan's readings and fails on a behind one: found by behaviour, so a rename does not hide it. */
const isTheGuard = (step: Step): boolean =>
  /needs\.plan\.outputs\.readings/.test(JSON.stringify(step.env ?? {})) && /process\.exit\(1\)/.test(step.run ?? "");

const isPublish = (step: Step): boolean => /^pnpm exec changeset publish\b/.test(step.run ?? "");

/** One named property per defect, so a red run says which went (the shape `release-triggers-itself.test.ts` uses). */
function refusals(steps: Step[]): string[] {
  const guards = steps.map((step, index) => ({ step, index })).filter(({ step }) => isTheGuard(step));
  const publishAt = steps.findIndex(isPublish);
  if (publishAt < 0) return ["one-publish-step: the publishing job has no changeset publish step"];
  if (guards.length === 0) return ["guard-exists: no step reads the plan's readings and fails on a behind manifest"];
  const found: string[] = [];
  if (!guards.some(({ step }) => publishesOn(step))) found.push("guard-runs-on-publish: its if: is not the plan's `publish` mode");
  if (!guards.some(({ index }) => index < publishAt)) found.push("guard-before-publish: it runs after `Publish`, when latest has already moved");
  return found;
}

const publishingSteps = (): Step[] => liveWorkflow().jobs[PUBLISHING_JOB].steps ?? [];

function runGuard(readings: Reading[] | string): { status: number | null; log: string } {
  const step = publishingSteps().find(isTheGuard);
  assert.ok(step?.run, "positive control: the guard step is found in the live workflow");
  const result = spawnSync("bash", ["-c", step.run], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, READINGS: typeof readings === "string" ? readings : JSON.stringify(readings) },
  });
  return { status: result.status, log: `${result.stdout}${result.stderr}` };
}

const reading = (name: string, manifest: string, latest: string, state: Reading["state"]): Reading => ({ name, manifest, latest, state });

test("the publishing job has a guard step, on the publish mode, before Publish", () => {
  assert.deepEqual(refusals(publishingSteps()), []);
});

test("POSITIVE CONTROL: no guard step, a guard off the publish mode, and a guard moved after Publish are each refused", () => {
  const steps = publishingSteps();
  const withoutGuard = steps.filter((step) => !isTheGuard(step));
  assert.ok(refusals(withoutGuard).some((name) => name.startsWith("guard-exists")), "a missing guard is refused");

  const rehearsalOnly = steps.map((step) => (isTheGuard(step) ? { ...step, if: "needs.plan.outputs.mode == 'rehearsal'" } : step));
  assert.ok(refusals(rehearsalOnly).some((name) => name.startsWith("guard-runs-on-publish")), "a guard that skips a publish is refused");

  const guard = steps.find(isTheGuard);
  assert.ok(guard);
  const moved = [...steps.filter((step) => !isTheGuard(step)), guard];
  assert.ok(refusals(moved).some((name) => name.startsWith("guard-before-publish")), "a guard moved after Publish is refused");
  assert.equal(refusals(moved).some((name) => name.startsWith("guard-exists")), false, "and only its own property goes");
});

test("POSITIVE CONTROL: a comment or an echo naming the check is not the check", () => {
  const decoys: Step[] = [
    { name: "Never publish older", if: "needs.plan.outputs.mode == 'publish'", run: "# behind the registry's latest\necho behind the registry" },
    { name: "Publish", if: "needs.plan.outputs.mode == 'publish'", run: "pnpm exec changeset publish" },
  ];
  assert.ok(refusals(decoys).some((name) => name.startsWith("guard-exists")));
});

test("a fixture with one package ahead and one behind is REFUSED, naming the package that is behind", () => {
  const result = runGuard([reading("a11ign", "0.1.1", "0.1.0", "ahead"), reading("@a11ign/core", "0.0.0", "0.1.0", "behind")]);
  assert.notEqual(result.status, 0, result.log);
  assert.match(result.log, /Behind the registry: @a11ign\/core@0\.0\.0 < 0\.1\.0/);
  assert.doesNotMatch(result.log, /Behind the registry:.*a11ign@0\.1\.1/, "the package that is ahead is not named as behind");
});

test("a fixture with every package ahead or level passes, and the log names each with its manifest and the registry's latest", () => {
  const result = runGuard([reading("a11ign", "0.1.1", "0.1.0", "ahead"), reading("@a11ign/core", "0.1.0", "0.1.0", "level")]);
  assert.equal(result.status, 0, result.log);
  assert.match(result.log, /a11ign@0\.1\.1 \(latest on the registry: 0\.1\.0/);
  assert.match(result.log, /@a11ign\/core@0\.1\.0 \(latest on the registry: 0\.1\.0/);
});

test("no readings, or unreadable ones, is CANNOT_TELL and fails: absence of a behind package is not proof of none", () => {
  for (const readings of ["", "[]", "not json"]) {
    const result = runGuard(readings);
    assert.notEqual(result.status, 0, `readings ${JSON.stringify(readings)} must fail`);
  }
  assert.match(runGuard("[]").log, /CANNOT_TELL/);
});

// ---- `plan`'s own readings, produced by its own shell against a stub registry ---------------------------------------

const STUB_NPM = `#!/usr/bin/env node
const table = JSON.parse(process.env.STUB_REGISTRY);
const answer = table[process.argv[3]];
if (answer === undefined) { console.error("npm error code E404"); process.exit(1); }
console.log(answer);
`;

function planReadings(packages: Record<string, { name: string; version: string; private?: boolean }>, registry: Record<string, string>): Reading[] {
  const dir = mkdtempSync(join(tmpdir(), "a11y-release-older-"));
  try {
    mkdirSync(join(dir, ".changeset"), { recursive: true });
    for (const [pkg, manifest] of Object.entries(packages)) {
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
      env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: output, EVENT: "push", DRY_RUN: "", STUB_REGISTRY: JSON.stringify(registry) },
    });
    assert.equal(result.status, 0, result.stderr);
    const written = /^readings=(.*)$/m.exec(readFileSync(output, "utf8"));
    assert.ok(written, "plan writes a `readings` output");
    return JSON.parse(written[1]) as Reading[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("plan hands on one reading per non-private package, classed ahead, level or behind by its own comparison", () => {
  const readings = planReadings(
    {
      cli: { name: "a11ign", version: "0.1.1" },
      core: { name: "@a11ign/core", version: "0.0.0" },
      same: { name: "@a11ign/same", version: "0.1.0" },
      lab: { name: "lab", version: "9.9.9", private: true },
    },
    { a11ign: "0.1.0", "@a11ign/core": "0.1.0", "@a11ign/same": "0.1.0" },
  );
  const byName = Object.fromEntries(readings.map((r) => [r.name, r.state]));
  assert.deepEqual(byName, { a11ign: "ahead", "@a11ign/core": "behind", "@a11ign/same": "level" }, "private packages are not read");
});

test("END TO END: plan's readings for one package ahead and one behind are refused by the live guard, naming the behind one", () => {
  const readings = planReadings(
    { cli: { name: "a11ign", version: "0.1.1" }, core: { name: "@a11ign/core", version: "0.0.0" } },
    { a11ign: "0.1.0", "@a11ign/core": "0.1.0" },
  );
  const result = runGuard(readings);
  assert.notEqual(result.status, 0, result.log);
  assert.match(result.log, /@a11ign\/core@0\.0\.0 < 0\.1\.0/);
});
