/**
 * #3137 — A DEPENDENCY PULL REQUEST GETS A NARROW, DECLARED WAY THROUGH THE TWO BODY CHECKS, AND NO OTHER PULL REQUEST DOES.
 *
 * `.github/workflows/dependency-pr-body.yml` is a `pull_request_target` workflow, the one trigger whose token can WRITE to
 * a pull request Dependabot opened, and the one that is dangerous if it ever runs the pull request's own code or text. So
 * this pins the three things that make it safe, and then RUNS the script it carries:
 *
 *   1. the job runs only for Dependabot;
 *   2. no step checks anything out, so no byte of the pull request head is on the runner;
 *   3. no `run:` line interpolates the title or body (`${{ }}` in a shell is text the author chose, executed).
 *
 * The body it writes is read by the SAME `checkBody` the CI `acceptance` job and `pr-open` use (the shipped Acceptance
 * and Closes readers), with the command's run injected: this asks whether the declaration is well-formed, and the
 * command itself is exercised by its own test.
 *
 * `violations()` is the instrument and is run on the real file AND on fixtures that each break one property, because a
 * checker that has never said no is not known to be able to. The positive control for the body readers is the same: a
 * duplicated `Acceptance:` section and a missing `Closes` are each refused by them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { checkBody } from "agent-org/src/pr-open.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const WORKFLOW = ".github/workflows/dependency-pr-body.yml";
const BOT = "dependabot[bot]";
const EXECUTABLE = 0o755;

interface Step { uses?: string; run?: string; env?: Record<string, string> }
interface Job { if?: string; steps?: Step[] }
interface Workflow { on?: Record<string, unknown>; jobs?: Record<string, Job> }

const read = (): Workflow => parseYaml(readFileSync(resolve(REPO, WORKFLOW), "utf8")) as Workflow;

/** An expression in a shell line is the author's text becoming code: the title, the body, or the head's branch name. */
const AUTHOR_TEXT = /\$\{\{[^}]*github\.(event\.pull_request\.(title|body|head)|head_ref)[^}]*\}\}/;

function violations(workflow: Workflow): string[] {
  const jobs = Object.entries(workflow.jobs ?? {});
  if (!jobs.length) return ["no job"];
  const found: string[] = [];
  if (!Object.keys(workflow.on ?? {}).includes("pull_request_target")) found.push("not triggered by `pull_request_target`");
  for (const [name, job] of jobs) {
    if (!job.if?.includes(`github.actor == '${BOT}'`)) found.push(`job \`${name}\` does not run only for ${BOT}`);
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith("actions/checkout")) found.push(`job \`${name}\` checks out (${step.uses})`);
      if (step.run && AUTHOR_TEXT.test(step.run)) found.push(`job \`${name}\` interpolates the title, body or head into a \`run:\` line`);
    }
  }
  return found;
}

const withStep = (patch: (step: Step) => Step, job: Partial<Job> = {}): Workflow => {
  const wf = read();
  const [[name, original]] = Object.entries(wf.jobs!);
  wf.jobs = { [name]: { ...original, ...job, steps: [patch(original.steps![0]), ...original.steps!.slice(1)] } };
  return wf;
};

test("the workflow runs only for Dependabot, checks nothing out, and puts no author text in a shell", () => {
  assert.deepEqual(violations(read()), []);
});

test("violations() refuses each fixture that breaks one property (the positive controls for the test above)", () => {
  const checkout = withStep((s) => s, {});
  checkout.jobs![Object.keys(checkout.jobs!)[0]].steps!.unshift({ uses: "actions/checkout@v4" });
  assert.match(violations(checkout).join("\n"), /checks out/);

  const interpolates = withStep((s) => ({ ...s, run: `${s.run}\necho \${{ github.event.pull_request.title }}` }));
  assert.match(violations(interpolates).join("\n"), /interpolates the title/);

  const body = withStep((s) => ({ ...s, run: `echo "\${{ github.event.pull_request.body }}"` }));
  assert.match(violations(body).join("\n"), /interpolates the title, body or head/);

  const anyActor = withStep((s) => s, { if: "github.event.pull_request.draft == false" });
  assert.match(violations(anyActor).join("\n"), /does not run only for/);

  const wrongTrigger = read();
  wrongTrigger.on = { pull_request: {} };
  assert.match(violations(wrongTrigger).join("\n"), /pull_request_target/);

  assert.deepEqual(violations({}), ["no job"]);
});

test("the title and number reach the script as environment variables, not as expression text", () => {
  const step = Object.values(read().jobs!)[0].steps![0];
  assert.equal(step.env?.PR_TITLE, "${{ github.event.pull_request.title }}");
  assert.doesNotMatch(step.run!, /\$\{\{/);
});

// ---- running the script the workflow carries, against a stub `gh` ----

/** The owner's own list, read from the repository: the workflow reads it at the base commit and must not carry a copy. */
const OWNED = (JSON.parse(readFileSync(resolve(REPO, "docs/owned-path-facts.json"), "utf8")) as { owned: string[] }).owned;

interface Outcome { status: number | null; log: string; body: string | null; patched: boolean }

/** Runs the workflow's own script. `gh` is a stub that answers the files call and copies the `body=@file` it is given. */
function runScript({ title, files, owned = OWNED }: { title: string; files: string[]; owned?: string[] }): Outcome {
  const dir = mkdtempSync(join(tmpdir(), "dep-pr-body-"));
  try {
    const gh = join(dir, "gh");
    writeFileSync(gh, [
      "#!/bin/sh",
      'case "$*" in',
      '  *"/files"*) printf "%s\\n" "$FAKE_FILES" ;;',
      '  *owned-path-facts*) printf "%s\\n" "$FAKE_OWNED" ;;',
      '  *PATCH*) touch "$DIR/patched"; for a in "$@"; do case "$a" in body=@*) cp "${a#body=@}" "$DIR/body";; esac; done ;;',
      "esac",
    ].join("\n"));
    chmodSync(gh, EXECUTABLE);
    const script = Object.values(read().jobs!)[0].steps![0].run!;
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: { PATH: `${dir}:/usr/bin:/bin`, DIR: dir, FAKE_FILES: files.join("\n"), FAKE_OWNED: owned.join("\n"), BASE_SHA: "abc123", PR_TITLE: title, PR_NUMBER: "7", REPO: "o/r",
        A11IGN_BOT_TOKEN: "stub", FALLBACK_TOKEN: "stub" },
    });
    const exists = (name: string) => spawnSync("test", ["-e", join(dir, name)]).status === 0;
    return { status: result.status, log: `${result.stdout}${result.stderr}`, patched: exists("patched"),
      body: exists("body") ? readFileSync(join(dir, "body"), "utf8") : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MANIFESTS = ["package.json", "packages/lab/package.json", "pnpm-lock.yaml"];
const MINOR = "deps: bump yaml from 2.8.1 to 2.8.2";

/** The shipped readers over a body, with the Acceptance command's run injected and recorded. */
function shippedVerdict(body: string) {
  const ran: string[] = [];
  const verdict = checkBody(body, { run: (command: string) => { ran.push(command); return 0; } });
  return { ...verdict, ran };
}

test("a minor bump of the manifests gets a body the shipped Acceptance and Closes readers accept", () => {
  const out = runScript({ title: MINOR, files: MANIFESTS });
  assert.equal(out.status, 0, out.log);
  assert.ok(out.body, `no body was written: ${out.log}`);
  const verdict = shippedVerdict(out.body);
  assert.equal(verdict.ok, true, verdict.lines.join("\n"));
  assert.deepEqual(verdict.ran.length, 1, "the Acceptance command is read once");
  assert.match(verdict.ran[0], /^pnpm exec rstest run --config=scripts\/rstest\/rstest\.config\.mjs --include packages\/lab\/src\/packaging\/one-package-manager\.test\.ts$/);
  assert.match(out.body, /^Closes: none -- dependency update by dependabot\[bot\] \(ADR 0041\)$/m);
  // the versions are the title's own: a fragment saying `2.8 to 2.8` for 2.8.1 -> 2.8.2 reads as no change at all (#3155)
  assert.match(out.body, /bump yaml from 2\.8\.1 to 2\.8\.2\./);
  assert.equal((out.body.match(/^Acceptance:/gm) ?? []).length, 1);
});

test("the readers REFUSE a duplicated Acceptance section and a missing Closes (the positive controls for the test above)", () => {
  const good = runScript({ title: MINOR, files: MANIFESTS }).body!;
  const acceptance = /^Acceptance:\n.*\n/m.exec(good)![0];
  const duplicated = shippedVerdict(good.replace(acceptance, `${acceptance}\n${acceptance}`));
  assert.equal(duplicated.ok, false, "a duplicated Acceptance section must be refused");
  const noCloses = shippedVerdict(good.replace(/^Closes:.*$/m, ""));
  assert.equal(noCloses.ok, false, "a body with no Closes must be refused");
});

test("the owned paths are the owner's list, and a path that only shares a prefix is not owned (positive control for the cases below)", () => {
  assert.ok(OWNED.includes("packages/nvda-worker/"), "the list this test reads must carry the NVDA worker");
  const out = runScript({ title: MINOR, files: [...MANIFESTS, "packages/nvda-worker-notes/package.json"] });
  assert.ok(out.body, `a sibling directory sharing the prefix was treated as owned: ${out.log}`);
});

const WRITES_NOTHING: [string, { title: string; files: string[]; owned?: string[] }, RegExp][] = [
  ["a major bump", { title: "deps: bump typescript from 5.9.3 to 6.0.3", files: MANIFESTS }, /major bump/],
  ["a 0.x minor bump, which is the breaking one below 1.0", { title: "deps: bump agent-org from 0.1.4 to 0.2.0", files: MANIFESTS }, /major bump/],
  ["a pull request touching more than the manifests and the lockfile", { title: MINOR, files: [...MANIFESTS, "scripts/x.mjs"] }, /other than the manifests/],
  ["a bump of the NVDA driver, which touches an owned path", { title: MINOR, files: [...MANIFESTS, "packages/nvda-worker/package.json"] }, /owned path \(packages\/nvda-worker\/\)/],
  ["a pull request whose owned-path list cannot be read, because not being able to ask is not a pass", { title: MINOR, files: MANIFESTS, owned: [] }, /owned-path list could not be read/],
  ["a pull request touching no file the API lists", { title: MINOR, files: [] }, /other than the manifests/],
  ["a title that is not the dependency shape", { title: "deps: tidy up", files: MANIFESTS }, /not 'deps: bump/],
  ["a title carrying shell syntax", { title: "deps: bump yaml from 2.8.1 to 2.8.2; touch pwned", files: MANIFESTS }, /not 'deps: bump/],
  ["a title with a command substitution", { title: "deps: bump $(touch pwned) from 2.8.1 to 2.8.2", files: MANIFESTS }, /not 'deps: bump/],
];

for (const [name, input, why] of WRITES_NOTHING) {
  test(`${name} is left with the body it has, and the log says why`, () => {
    const out = runScript(input);
    assert.equal(out.status, 0, out.log);
    assert.equal(out.patched, false, "the body must not be edited");
    assert.match(out.log, why);
    assert.doesNotMatch(out.log, /pwned/, "the log must not echo an unvalidated title");
  });
}
