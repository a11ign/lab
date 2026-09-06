/**
 * The pre-push hook's FAST/FULL split (2026-09-06): `main` runs the full suite, unchanged;
 * `agent/*`/`lead/*` run lint, typecheck, and tests of only the `packages/<name>` the branch touched
 * against `origin/main` -- CI (`.github/workflows/lint.yml`, widened the same day) is what runs the full
 * suite for a branch now. See the hook's own header and `scripts/changed-packages.mjs`'s header for why.
 *
 * DRIVES THE REAL FILES rather than reimplementing their logic, for the reason `pre-commit-hook.test.ts`
 * and `pre-push-git-scrub.test.ts` already state: a second copy of a decision drifts from the first. The
 * full hook cannot be executed end-to-end here (it runs real `npm run lint`/`typecheck`/`test`, which need
 * this checkout's own `node_modules` and take minutes) -- these tests extract and drive the specific,
 * bounded pieces of real logic that decide WHAT gets run, never re-typing the decision itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const HOOK = readFileSync(`${REPO}scripts/git-hooks/pre-push`, "utf8");

test("the hook branches on $BRANCH before deciding fast vs full", () => {
  assert.match(HOOK, /BRANCH="\$\(git rev-parse --abbrev-ref HEAD\)"/);
  const branchLine = HOOK.indexOf('BRANCH="$(git rev-parse --abbrev-ref HEAD)"');
  const ifMain = HOOK.indexOf('if [ "$BRANCH" = "main" ]');
  assert.ok(branchLine > 0 && ifMain > branchLine,
    "BRANCH must be resolved before the fast/full decision reads it");
});

test("both the full suite and the fast gate cap tsx worker concurrency, and neither leaks into package.json's shared script unconditionally", () => {
  const fullSuiteLine = /run "unit tests" env A11Y_TEST_CONCURRENCY=4 npm test/;
  const fastGateLines = /--test-concurrency=4/g;
  assert.match(HOOK, fullSuiteLine, "the main-branch full suite must set A11Y_TEST_CONCURRENCY=4");
  const fastMatches = [...HOOK.matchAll(fastGateLines)];
  assert.ok(fastMatches.length >= 2,
    `expected at least 2 --test-concurrency=4 uses in the fast gate (all-packages and touched-packages `
    + `paths), found ${fastMatches.length}`);

  const pkgJson = readFileSync(`${REPO}package.json`, "utf8");
  assert.match(pkgJson, /A11Y_TEST_CONCURRENCY:\+--test-concurrency=\$A11Y_TEST_CONCURRENCY/,
    "test:ts must only add the flag when the env var is set, so CI (which never sets it) is never capped");
});

test("check-signals and rules:gate are gated to main, not just to the corpus being present", () => {
  assert.match(HOOK, /if \[ "\$BRANCH" = "main" \] && \[ -d runs\/screenreader-dataset\/captures \]/);
  assert.match(HOOK, /if \[ "\$BRANCH" = "main" \] && \[ -f runs\/screenreader-dataset\/screenreader-evidence\.jsonl \]/);
});

test("the fast gate calls changed-packages.mjs, never a second, hand-rolled diff", () => {
  assert.match(HOOK, /node scripts\/changed-packages\.mjs/);
});

test("MUTATION: the touched-package glob-building loop, driven in isolation, builds one glob per package", () => {
  // Extracts the exact loop from the real hook (never re-typed) and runs it in a throwaway shell with a
  // fake `changed`, proving the shell logic around changed-packages.mjs's OUTPUT does what it looks like
  // it does -- the pure parsing itself is `changed-packages.test.ts`'s job, not this one's.
  const loopMatch = /globs=\(\)\n\s*for pkg in \$changed; do globs\+=\("([^"]+)"\); done/.exec(HOOK);
  assert.ok(loopMatch, "could not find the glob-building loop in the real hook to drive");
  const script = `changed="lab judge"\nglobs=()\nfor pkg in $changed; do globs+=("${loopMatch[1]}"); done\n`
    + 'printf "%s\\n" "${globs[@]}"';
  const out = execFileSync("bash", ["-c", script], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(out, ["packages/lab/src/**/*.test.ts", "packages/judge/src/**/*.test.ts"]);
});

/**
 * `NODE_TEST_CONTEXT` IS THE `sweepLog` DEFECT ARRIVING IN THE TEST RUNNER ITSELF.
 *
 * This repo has already met "a caught-and-logged error is not a handled error" once: `postSubmitFields`
 * came back `[]` on all 2,122 captures because a crash was caught and written to `sweepLog`, which nothing
 * ever read -- absence read as a clean, empty result rather than as a failure. This test's first version
 * hit the identical shape one layer down, in code nobody here wrote: node sets `NODE_TEST_CONTEXT` while a
 * `--test` run is in progress, and a NESTED `--test` invocation that inherits it is silently refused --
 * `"node:test run() is being called recursively within a test file. skipping running files"` on stderr,
 * empty stdout, exit 0. No exception, no non-zero status -- a test spawning a test gets NOTHING, and
 * nothing reads exactly like "0 tests found, all fine". The assertion below would have passed vacuously
 * on every run, forever, having executed none of what it claims to prove.
 *
 * The next person writing a test that spawns `--test` will hit this with no error message to search for
 * (the warning goes to the PARENT process's stderr, not the child's captured output) -- which is why this
 * paragraph exists rather than just the one-line fix.
 */
test("a glob matching zero test files does not fail the fast gate -- the nvda-speech shape", () => {
  // nvda-speech has no .test.ts files at all (Python-only). A branch touching only that package must not
  // have its fast gate read as a failure because node's test runner found nothing to run.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const out = execFileSync("npx", ["tsx", "--test", "packages/nvda-speech/src/**/*.test.ts"],
    { cwd: REPO, encoding: "utf8", env });
  assert.match(out, /tests 0/);
});

test("MUTATION: without scrubbing NODE_TEST_CONTEXT, the nested run is silently refused -- empty, not an error", () => {
  // Reproduces the exact failure mode the test above exists to avoid: with the parent's test-runner
  // context left INTACT, the child process is refused and returns EMPTY output with exit 0 -- not a
  // thrown error, not a non-zero status. Proves the guard above is guarding something real.
  const out = execFileSync("npx", ["tsx", "--test", "packages/nvda-speech/src/**/*.test.ts"],
    { cwd: REPO, encoding: "utf8" }); // process.env inherited, NODE_TEST_CONTEXT included -- deliberately not scrubbed
  assert.equal(out, "", "expected the nested run to be silently refused when NODE_TEST_CONTEXT survives");
});

test("MUTATION: the real run() function reports FAILED on a genuine lint/typecheck error, not just on a contrived one", () => {
  // Extracts the ACTUAL run() from the hook (never re-typed) and drives it against REAL npm run lint /
  // tsc --noEmit, with a planted violation in a real package file -- proving the fast gate's two
  // whole-repo checks (which run unconditionally, before the branch/package split) genuinely block a push
  // on a real error, not merely that they look like they would from reading the code. A gate that only
  // ever passes is this repo's most-recorded shape, and this is the one guard replacing the full suite on
  // every branch push, so a false clean here costs the most.
  const runFn = /^run\(\) \{[\s\S]*?\n\}/m.exec(HOOK);
  assert.ok(runFn, "could not find run() in the real hook to drive");

  const target = `${REPO}packages/lab/src/packaging/_scratch-run-fn-proof.test.ts`;
  writeFileSync(target,
    'import { test } from "node:test";\nconst unused = 1;\ntest("x", () => { const y: string = 5; });\n');
  try {
    const script = `set -u\n${runFn[0]}\nfailed=()\n`
      + `run "lint" npm run --silent lint\n`
      + `run "typecheck" npx tsc --noEmit\n`
      + `printf '%s\\n' "\${failed[@]:-}"`;
    const out = execFileSync("bash", ["-c", script], { cwd: REPO, encoding: "utf8" });
    assert.match(out, /lint/, "a real lint error in a tracked package file must be reported FAILED");
    assert.match(out, /typecheck/, "a real type error must be reported FAILED");
  } finally {
    rmSync(target, { force: true });
  }
});

test(".github/workflows/lint.yml runs on agent/** and lead/** pushes, with a cancelling concurrency group", () => {
  const doc = parseYaml(readFileSync(`${REPO}.github/workflows/lint.yml`, "utf8"));
  const branches: string[] = doc.on.push.branches;
  assert.ok(branches.includes("main"));
  assert.ok(branches.some((b) => b === "agent/**"), "agent/** must be able to trigger CI, or the fast "
    + "gate has nowhere to hand off the full suite to");
  assert.ok(branches.some((b) => b === "lead/**"));
  assert.equal(doc.concurrency?.["cancel-in-progress"], true,
    "without cancel-in-progress, every push under push-per-commit queues a stale run behind it");
  assert.match(String(doc.concurrency?.group ?? ""), /github\.ref/,
    "the concurrency group must be per-ref, or an unrelated branch's push cancels this one's run");
});
