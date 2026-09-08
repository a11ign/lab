/**
 * The pre-push hook's FAST/FULL split (2026-09-06): `main` runs the full suite, unchanged;
 * `agent/*`/`lead/*` run lint, typecheck, and tests of only the `packages/<name>` the branch touched
 * against `origin/main`. CI (`.github/workflows/ci.yml`) is what runs the full check for a branch now --
 * not on the push itself (agent/lead pushes stopped triggering CI directly the same day `ci.yml` replaced
 * `lint.yml`), but on the PR that follows it, which every unit's workflow now opens immediately after
 * pushing. See the hook's own header and `scripts/changed-packages.mjs`'s header for why.
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
import { readFileSync, writeFileSync, rmSync, mkdirSync, chmodSync } from "node:fs";
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

test("package.json's shared test:ts script never leaks concurrency-capping into CI unconditionally", () => {
  // 2026-09-07: the hook stopped running package suites at all (both the main-branch full run and the
  // fast gate's touched-package globs are gone -- CI's acceptance job covers them now), so there is no
  // longer a hook-side `A11Y_TEST_CONCURRENCY`/`--test-concurrency` invocation to assert on: the ONE
  // test-spawning call left, `npx tsx --test packages/worker-fleet/src/mjs-parses.test.ts`, is one fixed
  // file, not a variable-sized population that needs capping. What is still real and still worth pinning:
  // `test:ts` itself must only add the flag when the env var is SET, so a caller that never sets it (CI)
  // is never capped by a change to this shared script.
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

test("a board-only diff gets its own narrow branch, calling board-only-check.mjs -- never a second copy "
  + "of the board/docs classification", () => {
  // chairman's direction, 2026-09-06: docs/board/summaries/*.md and docs/board/reported.json are edited
  // far more often than anything else under docs/. `board-only-check.mjs` reuses ci-changed.mjs's own
  // `boardOnly`/`DOC_ROOT_FILES`, the same question ci.yml's `board` job asks -- this only checks the
  // hook DISPATCHES to it and to the same test glob as that job, not that the classification is correct
  // (board-only-check.test.ts and ci-changed.test.ts own that).
  assert.match(HOOK, /node scripts\/board-only-check\.mjs/);
  assert.match(HOOK, /packages\/lab\/src\/packaging\/board-\*\.test\.ts/);
  assert.match(HOOK, /packages\/lab\/src\/packaging\/public-claim\.test\.ts/);
});

test("2026-09-07: both main and the fast gate run the SAME mjs parse check, not a package-scoped glob "
  + "built from `changed`", () => {
  // The touched-package glob-building loop this test used to drive (`globs=(); for pkg in $changed; do
  // globs+=(...); done`) is GONE, along with the package suites it fed -- CI's acceptance job (#353) now
  // covers what those suites checked, on every PR, before this hook could finish. What replaced them is
  // ONE fixed invocation, present in both branches, that does not read `$changed` at all: `mjs-parses.
  // test.ts` is CLAUDE.md's own named check for a `.mjs` file that lint and `tsc --noEmit` cannot see fail.
  assert.ok(!/globs=\(\)/.test(HOOK), "the touched-package glob-building loop should be gone, not merely unused");
  const mjsParseCheck = /run "mjs parse check"\s+npx tsx --test packages\/worker-fleet\/src\/mjs-parses\.test\.ts/g;
  const matches = [...HOOK.matchAll(mjsParseCheck)];
  assert.equal(matches.length, 2, "expected the mjs parse check exactly once in main's gate and once in the "
    + `fast gate, found ${matches.length}`);
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

/**
 * #288: THE CHANGESET GATE WAS THE ONLY CHECK IN THIS HOOK THAT BYPASSED `run()`, so it had no way to say
 * "could not run" -- `[ "$(node scripts/changeset-precise.mjs origin/main)" = "true" ]` discards the
 * command's own exit status and tests only the STRING it printed. Measured live: an unresolvable base ref
 * throws inside `changeset-precise.mjs`'s own `execFileSync`, uncaught, so the process exits non-zero
 * having printed NOTHING -- and empty output reads as `false`, so the hook printed a POSITIVE CLAIM ("no
 * file this push touches is one npm actually ships for a published package") from a check that examined
 * nothing at all.
 *
 * DRIVES THE REAL BLOCK, via a fake `node` on `PATH` standing in for `changeset-precise.mjs`'s two
 * distinct real behaviours (a clean exit with `true`/`false`, and a genuine failure) -- the same
 * discipline the `run()` test above uses, extracting rather than re-typing the hook's own logic.
 */
function changesetBlock() {
  const start = HOOK.indexOf('if [ -n "$changed" ]; then\n    # #288:');
  const end = HOOK.indexOf('rm -f /tmp/a11y-changeset-precise-err.$$\n  fi', start);
  assert.ok(start > 0 && end > start, "could not locate the #288 changeset block in the real hook");
  return HOOK.slice(start, end + 'rm -f /tmp/a11y-changeset-precise-err.$$\n  fi'.length);
}

function withFakeNode(behaviour: "fail" | "true" | "false") {
  const dir = `${REPO}packages/lab/src/packaging/.scratch-fake-node-${behaviour}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const script = behaviour === "fail"
    ? '#!/bin/bash\necho "fatal: bad revision" >&2\nexit 1\n'
    : `#!/bin/bash\nprintf '%s' "${behaviour}"\n`;
  writeFileSync(`${dir}/node`, script);
  chmodSync(`${dir}/node`, 0o755);
  return dir;
}

test("#288: an unresolvable base ref is COULD NOT RUN, not a silent SKIPPED claim", () => {
  const fakeNodeDir = withFakeNode("fail");
  try {
    const script = `set -u\nchanged="lab"\nskipped=()\nfailed=()\n${changesetBlock()}\n`
      + `printf 'SKIPPED=%s\\n' "\${skipped[@]:-}"\nprintf 'FAILED=%s\\n' "\${failed[@]:-}"`;
    const out = execFileSync("bash", ["-c", script],
      { cwd: REPO, encoding: "utf8", env: { ...process.env, PATH: `${fakeNodeDir}:${process.env.PATH}` } });
    assert.match(out, /COULD NOT RUN {2}changeset/, "a genuine failure to answer must print COULD NOT RUN");
    assert.doesNotMatch(out, /no file this push touches is one npm actually ships/,
      "the exact defect this row exists to end: a failure must never be read as the honest SKIPPED claim");
    assert.match(out, /SKIPPED=changeset \(could not run\)/, "kept out of failed, per run()'s own precedent");
    assert.doesNotMatch(out, /FAILED=changeset/, "a could-not-run must never fail the push");
  } finally {
    rmSync(fakeNodeDir, { recursive: true, force: true });
  }
});

test("#288: a real, examined `false` still prints the honest SKIPPED claim, unchanged", () => {
  const fakeNodeDir = withFakeNode("false");
  try {
    const script = `set -u\nchanged="lab"\nskipped=()\nfailed=()\n${changesetBlock()}\n`
      + `printf 'SKIPPED=%s\\n' "\${skipped[@]:-}"`;
    const out = execFileSync("bash", ["-c", script],
      { cwd: REPO, encoding: "utf8", env: { ...process.env, PATH: `${fakeNodeDir}:${process.env.PATH}` } });
    assert.match(out, /SKIPPED=changeset \(no file this push touches is one npm actually ships/,
      "a genuine, examined `false` must keep its real claim -- this row narrows WHEN the claim is made, "
      + "not what it says");
    assert.doesNotMatch(out, /COULD NOT RUN/, "a real answer must never read as a failure to answer");
  } finally {
    rmSync(fakeNodeDir, { recursive: true, force: true });
  }
});

test("MUTATION (#288): reverting to the bare string comparison must reproduce the exact live defect -- "
  + "a failure read as the honest SKIPPED claim", () => {
  const fakeNodeDir = withFakeNode("fail");
  try {
    const naiveScript = `set -u\nchanged="lab"\nskipped=()\nfailed=()\n`
      + `if [ -n "$changed" ] && [ "$(node scripts/changeset-precise.mjs origin/main)" = "true" ]; then\n`
      + `  :\nelse\n  skipped+=("changeset (no file this push touches is one npm actually ships for a published package)")\nfi\n`
      + `printf 'SKIPPED=%s\\n' "\${skipped[@]:-}"`;
    const out = execFileSync("bash", ["-c", naiveScript],
      { cwd: REPO, encoding: "utf8", env: { ...process.env, PATH: `${fakeNodeDir}:${process.env.PATH}` } });
    assert.match(out, /no file this push touches is one npm actually ships/,
      "documents the exact live defect this row exists to end -- the naive comparison cannot see the "
      + "command's own exit status, so a genuine failure prints the SAME sentence as an honest false");
  } finally {
    rmSync(fakeNodeDir, { recursive: true, force: true });
  }
});

test(".github/workflows/ci.yml runs on the PR ONLY, with a cancelling concurrency group", () => {
  // NOT agent/** or lead/** and NOT main -- deliberately, since 2026-09-06 and sharpened again the same
  // day (chairman's direction): a check that runs after a merge cannot stop it, so `push` is not merely
  // scoped to `main`, it is ABSENT altogether now. A branch push gets only this hook's fast gate; the
  // full check runs on the PR that branch's own workflow opens immediately after pushing, and ONLY there
  // -- branch protection (checks green AND up to date with main) is what makes the tested commit the one
  // that lands.
  const doc = parseYaml(readFileSync(`${REPO}.github/workflows/ci.yml`, "utf8"));
  assert.ok(doc.on.pull_request, "ci.yml must trigger on pull_request, or a branch's own PR has no full "
    + "check to hand off to");
  assert.ok(!("push" in doc.on),
    "ci.yml must not trigger on push at all -- a check that runs after the merge cannot stop it");
  assert.equal(doc.concurrency?.["cancel-in-progress"], true,
    "without cancel-in-progress, every push under push-per-commit queues a stale run behind it");
  assert.match(String(doc.concurrency?.group ?? ""), /github\.ref/,
    "the concurrency group must be per-ref, or an unrelated branch's push cancels this one's run");
});
