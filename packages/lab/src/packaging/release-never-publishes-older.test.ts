/**
 * A PUBLISH MUST FAIL WHEN A MANIFEST IS BEHIND THE REGISTRY'S LATEST (#3167, found reviewing #3131).
 *
 * The called workflow's `changeset publish` sends EVERY non-private package whose version the registry lacks. A manifest BEHIND
 * the registry's latest would be published as an older version and, with no `--tag`, could move `latest` to it, which cannot be
 * undone.
 *
 * #3717 MOVED THIS: the `plan` job that took the readings, and the `release` job that read them, are gone. The readings are the
 * `readings` step of the `guards` job and the refusal is the step after it, in the same job; `release` NEEDS `guards`, so "before
 * Publish" is now a fact about the job graph (`release-triggers-itself.test.ts`'s `guards-needed`), not an order of steps.
 *
 * WHAT THIS READS. The guards job's PARSED steps, never the text: a comment or an `echo` naming the check must satisfy nothing. The
 * guard step is found by what it DOES (it reads the readings and exits non-zero on a behind one), then RUN with `bash` against
 * fixtures, so "refuses the behind package, naming it" is observed rather than read off a regex. The readings themselves come
 * from the `readings` step's own comparison, which is run here too against a stub registry: a guard reading a field that step
 * never writes would pass its fixtures and never fire in production.
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
const GUARDS_JOB = "guards";

interface Step { name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> }
interface Workflow { jobs: Record<string, { steps?: Step[] }> }
interface Reading { name: string; manifest: string; latest: string; state: "ahead" | "behind" | "level" }

const liveWorkflow = (): Workflow => parseYaml(readFileSync(resolve(REPO, ".github/workflows/release.yml"), "utf8")) as Workflow;

/** Does this `if:` let the step run on a push? Absent means always; a step that names the dispatch is a rehearsal-only step. */
const runsOnPush = (step: Step): boolean => step.if === undefined || !/workflow_dispatch/.test(step.if);

/** The step that reads the readings and fails on a behind one: found by behaviour, so a rename does not hide it. */
const isTheGuard = (step: Step): boolean =>
  /steps\.readings\.outputs\.readings/.test(JSON.stringify(step.env ?? {})) && /process\.exit\(1\)/.test(step.run ?? "");

/** One named property per defect, so a red run says which went (the shape `release-triggers-itself.test.ts` uses). */
function refusals(steps: Step[]): string[] {
  const guards = steps.filter(isTheGuard);
  if (guards.length === 0) return ["guard-exists: no step reads the readings and fails on a behind manifest"];
  const found: string[] = [];
  if (!guards.some(runsOnPush)) found.push("guard-runs-on-push: its if: keeps it off the publishing event");
  const readingsAt = steps.findIndex((step) => step.id === "readings");
  if (readingsAt < 0) found.push("readings-exist: no step with id `readings` produces what the guard reads");
  else if (!guards.some((guard) => steps.indexOf(guard) > readingsAt)) found.push("guard-after-readings: it runs before the step that produces its input");
  return found;
}

const guardsSteps = (): Step[] => liveWorkflow().jobs[GUARDS_JOB].steps ?? [];

function runGuard(readings: Reading[] | string): { status: number | null; log: string } {
  const step = guardsSteps().find(isTheGuard);
  assert.ok(step?.run, "positive control: the guard step is found in the live workflow");
  const result = spawnSync("bash", ["-c", step.run], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, READINGS: typeof readings === "string" ? readings : JSON.stringify(readings) },
  });
  return { status: result.status, log: `${result.stdout}${result.stderr}` };
}

const reading = (name: string, manifest: string, latest: string, state: Reading["state"]): Reading => ({ name, manifest, latest, state });

test("the guards job has a guard step, on a push, after the readings it reads", () => {
  assert.deepEqual(refusals(guardsSteps()), []);
});

test("POSITIVE CONTROL: no guard step, a guard off the push, and a guard moved before its readings are each refused", () => {
  const steps = guardsSteps();
  const withoutGuard = steps.filter((step) => !isTheGuard(step));
  assert.ok(refusals(withoutGuard).some((name) => name.startsWith("guard-exists")), "a missing guard is refused");

  const rehearsalOnly = steps.map((step) => (isTheGuard(step) ? { ...step, if: "github.event_name == 'workflow_dispatch'" } : step));
  assert.deepEqual(refusals(rehearsalOnly).map((name) => name.split(":")[0]), ["guard-runs-on-push"], "a guard that skips a publishing push is refused, and only for that");

  const guard = steps.find(isTheGuard);
  assert.ok(guard);
  const early = [guard, ...steps.filter((step) => !isTheGuard(step))];
  assert.deepEqual(refusals(early).map((name) => name.split(":")[0]), ["guard-after-readings"], "a guard before its input is refused, and only for that");

  const noReadings = steps.filter((step) => step.id !== "readings");
  assert.ok(refusals(noReadings).some((name) => name.startsWith("readings-exist")), "a guard with no readings step is refused");
});

test("POSITIVE CONTROL: a comment or an echo naming the check is not the check", () => {
  const decoys: Step[] = [
    { id: "readings", run: "true" },
    { name: "Never publish older", run: "# behind the registry's latest\necho behind the registry" },
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

// ---- the readings step's own output, produced by its own shell against a stub registry -----------------------------------

const STUB_NPM = `#!/usr/bin/env node
const table = JSON.parse(process.env.STUB_REGISTRY);
const answer = table[process.argv[3]];
if (answer === undefined) { console.error("npm error code E404"); process.exit(1); }
console.log(answer);
`;

function planReadings(packages: Record<string, { name: string; version: string; private?: boolean }>, registry: Record<string, string>): Reading[] {
  const dir = mkdtempSync(join(tmpdir(), "a11y-release-older-"));
  try {
    for (const [pkg, manifest] of Object.entries(packages)) {
      mkdirSync(join(dir, "packages", pkg), { recursive: true });
      writeFileSync(join(dir, "packages", pkg, "package.json"), JSON.stringify(manifest));
    }
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin/npm"), STUB_NPM);
    chmodSync(join(dir, "bin/npm"), EXECUTABLE);
    const step = guardsSteps().find((candidate) => candidate.id === "readings");
    assert.ok(step?.run, "positive control: the readings step is found");
    const output = join(dir, "github-output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", step.run], {
      cwd: dir, encoding: "utf8",
      env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: output, STUB_REGISTRY: JSON.stringify(registry) },
    });
    assert.equal(result.status, 0, result.stderr);
    const written = /^readings=(.*)$/m.exec(readFileSync(output, "utf8"));
    assert.ok(written, "the readings step writes a `readings` output");
    return JSON.parse(written[1]) as Reading[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the readings step hands on one reading per non-private package, classed ahead, level or behind by its own comparison", () => {
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

test("END TO END: the readings for one package ahead and one behind are refused by the live guard, naming the behind one", () => {
  const readings = planReadings(
    { cli: { name: "a11ign", version: "0.1.1" }, core: { name: "@a11ign/core", version: "0.0.0" } },
    { a11ign: "0.1.0", "@a11ign/core": "0.1.0" },
  );
  const result = runGuard(readings);
  assert.notEqual(result.status, 0, result.log);
  assert.match(result.log, /@a11ign\/core@0\.0\.0 < 0\.1\.0/);
});
