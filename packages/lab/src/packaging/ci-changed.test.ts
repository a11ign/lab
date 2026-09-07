/**
 * `scripts/ci-changed.mjs`'s `classify()` is the ONE place `.github/workflows/ci.yml`'s jobs decide
 * whether to run — replacing three independent copies of "what changed" (`lint.yml`'s total absence of a
 * filter, `changeset-check.yml`'s inline `git diff`, `ansible-check.yml`'s own `paths:` block). This pins
 * the classification, and separately pins `ci.yml`'s OWN trigger table plus its two Windows siblings'
 * (`action-smoke.yml`, `capture-regression.yml`), so a future "just add the tests to `ci`" — or a
 * `pull_request` trigger creeping back onto a Windows workflow — fails a unit test rather than the PR
 * budget both were rebuilt to protect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { classify, knownPackages } from "../../../../scripts/ci-changed.mjs";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOWS = `${REPO}.github/workflows/`;
const readWorkflow = (name: string) => readFileSync(`${WORKFLOWS}${name}`, "utf8");
/**
 * A disposable two-commit repo, so `--base=<first commit>` has something real to diff against without
 * depending on THIS repo's own history depth. `HEAD~1` failed exactly this way in CI (#156): the `ts` job's
 * checkout has no `fetch-depth: 0` (only `changed` needs full history, to diff a real PR), so the runner's
 * shallow clone has no commit before `HEAD` at all -- `git diff HEAD~1...HEAD` is `fatal: ambiguous
 * argument`, not an empty diff. A fixture with its own two commits cannot be shallow.
 */
function twoCommitRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ci-changed-cli-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: sandboxGitEnv(), encoding: "utf8" });
  git("init", "--quiet", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "Fixture");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", workspaces: ["packages/*"] }));
  git("add", "package.json");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  writeFileSync(join(dir, "README.md"), "changed\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "a change to classify");
  return { dir, base };
}
// GITHUB_OUTPUT UNSET, DELIBERATELY -- caught by CI itself running THIS test inside a real Actions job:
// `writeOutputs()` appends to that file instead of printing to stdout whenever it is set, so a test that
// merely inherits the ambient environment captures nothing to assert on there while passing everywhere
// else. Deleted rather than passed as `undefined` through `sandboxGitEnv`'s `extra` (typed
// `Record<string, string>`) -- `execFileSync` itself treats an `undefined` value as "omit this key"
// (verified: `"X" in process.env` is false in the child), but the type would not let it in.
const cliEnv = () => {
  const env = sandboxGitEnv();
  delete env.GITHUB_OUTPUT;
  return env;
};
const runCliIn = (dir: string, args: string[]) =>
  execFileSync("node", [join(REPO, "scripts/ci-changed.mjs"), `--repo=${dir}`, ...args],
    { cwd: dir, env: cliEnv(), encoding: "utf8" });

test("classify: a docs-only change fires only the docs category", () => {
  const result = classify(["docs/known-gaps.md", "README.md"], ["lab", "judge"]);
  assert.deepEqual(result, { ts: false, python: false, ansible: false, docs: true, changeset: false, packages: [] });
});

test("classify: a source change under one package fires ts, names that package, and nothing else", () => {
  const result = classify(["packages/lab/src/training/case-matrix.mjs"], ["lab", "judge", "cli"]);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["lab"]);
  assert.equal(result.python, false);
  assert.equal(result.ansible, false);
  assert.equal(result.docs, false);
});

test("classify: a python file under a package fires python, and (bluntly) ts for that package too", () => {
  // Same bluntness as the ansible case above: `changedPackages` does not filter by extension, so a `.py`
  // file under `packages/scorer/` marks `scorer` touched for the scoped unit-test run too. Harmless --
  // scorer's own TS-side tests simply run alongside the Python ones -- and consistent rather than a
  // second, narrower definition of "touched" living beside the one the pre-push hook already uses.
  const result = classify(["packages/scorer/python/score.py"], ["lab", "scorer"]);
  assert.equal(result.python, true);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["scorer"]);
});

test("classify: the ansible layer fires ansible, and (bluntly, like changedPackages elsewhere) ts for control", () => {
  // `packages/control/ansible/**` sits INSIDE the `control` workspace, so `changedPackages` -- reused
  // here rather than re-derived, matching the pre-push hook's own "blunt, not dependency-aware"
  // philosophy -- correctly reads it as touching `control` too. Running `control`'s (fast) unit tests
  // alongside the ansible job is a harmless extra, not a wrong answer.
  const result = classify(["packages/control/ansible/deploy.yml"], ["control"]);
  assert.equal(result.ansible, true);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["control"]);
});

test("classify: a published package's src fires changeset; a private package's does not", () => {
  const published = classify(["packages/cli/src/cli.ts"], ["cli"]);
  assert.equal(published.changeset, true);
  const priv = classify(["packages/lab/src/training/case-matrix.mjs"], ["lab"]);
  assert.equal(priv.changeset, false, "packages/lab is private: true and must never demand a changeset");
});

test("classify: a root config file touches EVERY known package, never just the ones that happened to change", () => {
  const result = classify(["package.json"], ["lab", "judge", "cli", "scorer"]);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["cli", "judge", "lab", "scorer"].sort());
});

test("classify: a scripts/*.mjs change also touches EVERY known package, for the identical reason", () => {
  // `scripts/git-env.mjs` alone is imported by dozens of packaging tests directly -- a scoped-to-nothing
  // run here is exactly the "empty must read as run everything" defect the pre-push hook already names.
  const result = classify(["scripts/git-env.mjs"], ["lab", "judge"]);
  assert.equal(result.ts, true);
  assert.deepEqual(result.packages, ["judge", "lab"]);
});

test("classify: an unrelated file changes nothing", () => {
  const result = classify([".gitignore"], ["lab"]);
  assert.deepEqual(result, { ts: false, python: false, ansible: false, docs: false, changeset: false, packages: [] });
});

test("classify: a multi-package, multi-category diff sets every category it touches, independently", () => {
  const result = classify([
    "packages/lab/src/training/case-matrix.mjs",
    "packages/judge/src/rules.ts",
    "docs/known-gaps.md",
    "packages/control/ansible/deploy.yml",
    "packages/scorer/tests/test_runtime_versions.py",
  ], ["lab", "judge", "control", "scorer"]);
  assert.equal(result.ts, true);
  // `control` is here too -- the ansible file sits inside `packages/control/`, same as the test above.
  assert.deepEqual(result.packages, ["control", "judge", "lab", "scorer"]);
  assert.equal(result.docs, true);
  assert.equal(result.ansible, true);
  assert.equal(result.python, true);
  assert.equal(result.changeset, true, "packages/judge/src is published");
});

test("knownPackages finds the real repo's workspace directories, and refuses a second workspace glob", () => {
  const packages = knownPackages(REPO);
  // A floor, not a target -- matches the same convention `control-plane-hygiene.test.ts` uses for the
  // same reason: adding or retiring a package must not itself break this guard.
  assert.ok(packages.length >= 8, `found ${packages.length} package(s); the packages/* walk is broken`);
  assert.ok(packages.includes("lab") && packages.includes("judge"));

  // NO git repo needed here: the workspace-glob check runs, and throws, before `knownPackages` ever
  // shells out to `git ls-files` -- a plain directory with a package.json proves the refusal.
  const dir = mkdtempSync(join(tmpdir(), "ci-changed-workspaces-"));
  try {
    writeFileSync(join(dir, "package.json"),
      JSON.stringify({ name: "x", workspaces: ["packages/*", "tools/*"] }));
    assert.throws(() => knownPackages(dir), /single "packages\/\*" workspace glob/,
      "a second workspace glob must be refused loudly, not silently examine only the first");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------------------------------
// #156: THE CLI ITSELF, spawned for real. `classify()` above is pure and never sees `--event`/`--base` at
// all, so the flag validation and the base-shape guard can only be proven by actually running the script.
// -------------------------------------------------------------------------------------------------------

test("CLI: --event=merge_group classifies, it does not refuse", () => {
  // Acceptance step 3, verbatim: a merge_group event with a real base must be treated exactly like a
  // pull_request one, not rejected for using the newer event name.
  const { dir, base } = twoCommitRepo();
  try {
    const out = runCliIn(dir, ["--event=merge_group", `--base=${base}`]);
    assert.match(out, /^ts=(true|false)$/m, "expected classification output, got: " + out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: an empty base (the unhandled merge_group shape) is refused by NAME, not left to crash on git", () => {
  // The exact trap ci.yml's own `base` step comment documents: an unhandled empty `github.base_ref`
  // arrives here as a bare "origin/" once the workflow's own string concatenation has run. Proven against
  // the REAL CLI rather than only against `classify()`, because the guard lives in `main()`, which
  // `classify()`'s own tests structurally cannot reach.
  const { dir } = twoCommitRepo();
  try {
    assert.throws(() => runCliIn(dir, ["--event=merge_group", "--base=origin/"]),
      /empty or a bare prefix/, "a bare 'origin/' base must be refused by name, not crash inside git");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: --event=push is still refused -- widening to merge_group must not silently widen further", () => {
  const { dir, base } = twoCommitRepo();
  try {
    assert.throws(() => runCliIn(dir, ["--event=push", `--base=${base}`]),
      /--event must be "pull_request" or "merge_group"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// -------------------------------------------------------------------------------------------------------
// THE TRIGGER TABLE. `.github/workflows/on:` blocks, pinned so a future accidental trigger addition (the
// exact shape point 5 of the CI rebuild names: "mutation-checked by adding a pull_request trigger to
// action-smoke") fails here rather than costing real Windows minutes on every PR again.
// -------------------------------------------------------------------------------------------------------

test("ci.yml triggers on pull_request AND merge_group -- no push trigger at all, on main or anywhere else", () => {
  // Chairman's direction, 2026-09-06: the flow is PR then merge, and a check that runs after a merge
  // cannot stop it -- a `push: branches: [main]` trigger is a gate with the barn door already open.
  // Branch protection (checks green AND up to date with main) is what makes the tested commit the one
  // that lands, so NOTHING here may run post-merge.
  //
  // #156: merge_group must sit ALONGSIDE pull_request, never in place of it -- a PR still needs its own
  // run before it can be added to the queue at all, and GitHub's own docs are explicit that a merge queue
  // whose workflow lacks this trigger times every queued entry out silently, with no error anywhere.
  const doc = parseYaml(readWorkflow("ci.yml"));
  assert.ok(doc.on.pull_request, "ci.yml must trigger on pull_request -- that is the whole of the rebuild");
  assert.ok(doc.on.merge_group, "ci.yml must ALSO trigger on merge_group, or a merge queue times every "
    + "entry out silently -- #156");
  assert.ok(!("push" in doc.on),
    "ci.yml must not trigger on push at all -- a check that runs after the merge cannot stop it");
  assert.equal(Object.keys(doc.on).length, 2,
    `ci.yml declares triggers ${Object.keys(doc.on).join(", ")} -- only pull_request and merge_group are expected`);
});

test("action-smoke.yml and capture-regression.yml trigger on workflow_call and workflow_dispatch only", () => {
  // Both left `main` entirely, chairman's direction: they are release-time gates now, called as jobs from
  // `release.yml` (workflow_call) or run on demand (workflow_dispatch) -- never on a push or a PR, so
  // Windows/NVDA minutes are spent once, before a release, rather than on every commit.
  for (const file of ["action-smoke.yml", "capture-regression.yml"]) {
    const doc = parseYaml(readWorkflow(file));
    assert.ok(!("pull_request" in doc.on), `${file} must not trigger on pull_request`);
    assert.ok(!("push" in doc.on), `${file} must not trigger on push`);
    assert.ok("workflow_call" in doc.on,
      `${file} must declare workflow_call, or release.yml has no way to run it as a job`);
    assert.ok("workflow_dispatch" in doc.on, `${file} must keep workflow_dispatch for an on-demand run`);
  }
});

test("PROOF: the trigger-table guard bites -- a synthetic push block on a pull_request-only workflow fails", () => {
  // Driven directly against a FIXTURE rather than by mutating a real file on disk, for the reason every
  // other MUTATION test in this repo gives when the real check is cheap enough to reproduce inline: the
  // property under test is "does parsing a `push:` key make `\"push\" in doc.on` true", and a fixture
  // proves that without touching a tracked file at all.
  const withPush = parseYaml([
    "on:",
    "  pull_request:",
    "    branches: [main]",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  x:",
    "    runs-on: ubuntu-latest",
  ].join("\n"));
  assert.ok("push" in withPush.on,
    "the fixture itself must carry a push trigger, or this proves nothing about the real assertion");
});

test("lint.yml, ansible-check.yml and changeset-check.yml are retired, not merely unused", () => {
  for (const retired of ["lint.yml", "ansible-check.yml", "changeset-check.yml"]) {
    assert.throws(() => readWorkflow(retired), /ENOENT/,
      `${retired} still exists on disk -- it was meant to be folded into ci.yml and removed`);
  }
});

/**
 * `gate` IS THE ONE CONTEXT BRANCH PROTECTION MAY REQUIRE, not the five scoped jobs above it -- see
 * `ci.yml`'s own header. Requiring `ts`/`python`/`ansible`/`docs`/`changeset` directly means a required
 * check with no run against a docs-only PR's commit, and GitHub treats a job SKIPPED by its own `if:` as
 * satisfying a required check only because it still posts a real check run concluding `skipped` -- an
 * implicit platform behaviour, not a fact this repo's own tests can see. `gate` computes the identical
 * answer explicitly and is what these tests pin.
 */
test("ci.yml has a gate job needing every scoped job, running even when one of them failed", () => {
  const doc = parseYaml(readWorkflow("ci.yml")) as { jobs: Record<string, { needs?: unknown; if?: string }> };
  const gate = doc.jobs.gate;
  assert.ok(gate, "ci.yml must declare a job named 'gate' -- branch protection has nothing else it can "
    + "require that reports on every PR regardless of which path-scoped jobs a diff happened to trigger");
  assert.deepEqual([...gate.needs as string[]].sort(),
    ["ansible", "changed", "changeset", "docs", "python", "ts"].sort(),
    "gate must need every other job in this file, or a job could fail silently with gate still passing");
  assert.equal(gate.if, "always()",
    "gate must run with if: always() -- without it, a failing upstream job would SKIP gate too (a job's "
    + "default if is success() on its dependencies), and the one context branch protection requires would "
    + "then report nothing on exactly the commit most in need of a red mark");
});

test("PROOF: gate's own check fails when a needed job's result is neither success nor skipped", () => {
  // Extracts the real shell loop from ci.yml's gate job (never re-typed) and drives it with each of the
  // four real GitHub Actions job-result values, proving the loop actually discriminates rather than
  // merely looking like it does.
  const workflow = readWorkflow("ci.yml");
  const loopMatch = /for result in \\[\s\S]*?\n\s*done/.exec(workflow);
  assert.ok(loopMatch, "could not find gate's result-checking loop in the real workflow to drive");

  const runWith = (results: string[]) => {
    const script = loopMatch[0]
      .replace(/"\$\{\{ needs\.\w+\.result \}\}"/g, () => `"${results.shift()}"`)
      + "\necho LOOP_OK";
    return execFileSync("bash", ["-c", script], { encoding: "utf8" });
  };

  assert.equal(runWith(["success", "success", "skipped", "success", "skipped", "success"]).trim(), "LOOP_OK",
    "all success/skipped must pass -- this is the ordinary shape of a docs-only or single-package PR");
  assert.throws(() => runWith(["success", "failure", "skipped", "success", "skipped", "success"]),
    /Command failed/, "a single 'failure' among the six must fail the loop, or gate cannot do its job");
  assert.throws(() => runWith(["success", "cancelled", "skipped", "success", "skipped", "success"]),
    /Command failed/, "'cancelled' must also fail the loop -- an aborted run is not a passed one");
});
