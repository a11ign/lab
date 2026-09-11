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
import { readFileSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const HOOK = readFileSync(`${REPO}scripts/git-hooks/pre-push`, "utf8");

test("#911: there is no fast/full split any more -- one path, and $BRANCH is resolved before it is used", () => {
  // The split is GONE, and this test is what would otherwise have kept passing about a shape that no
  // longer exists. `main` ran the gate plus two corpus checks, a board-only diff ran the board guards
  // INSTEAD of lint and typecheck, and every other branch ran the gate plus a changeset gate. #911
  // reduced the gate to three checks, at which point branching cost more than it saved -- and the
  // board-only path had a hole: it never ran the sweep, so it never ran the leak guards, on the one kind
  // of diff made entirely of the prose they scan.
  assert.match(HOOK, /BRANCH="\$\(git rev-parse --abbrev-ref HEAD\)"/);
  const branchLine = HOOK.indexOf('BRANCH="$(git rev-parse --abbrev-ref HEAD)"');
  const gateCall = HOOK.indexOf('run_gate "$BRANCH"');
  assert.ok(branchLine > 0 && gateCall > branchLine,
    "BRANCH must be resolved before the gate reads it -- it is the label the gate reports under");
  assert.ok(!/if \[ "\$BRANCH" = "main" \]; then\n {2}run_gate/.test(HOOK),
    "the gate must not branch on main again -- CI is the gate for every branch, main included");
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
  const npx = npmCliInvocation("npx", ["tsx", "--test", "packages/nvda-speech/src/**/*.test.ts"]);
  const out = execFileSync(npx.command, npx.args, { cwd: REPO, encoding: "utf8", env });
  assert.match(out, /tests 0/);
});

test("MUTATION: without scrubbing NODE_TEST_CONTEXT, the nested run is silently refused -- empty, not an error", () => {
  // Reproduces the exact failure mode the test above exists to avoid: with the parent's test-runner
  // context left INTACT, the child process is refused and returns EMPTY output with exit 0 -- not a
  // thrown error, not a non-zero status. Proves the guard above is guarding something real.
  const npx2 = npmCliInvocation("npx", ["tsx", "--test", "packages/nvda-speech/src/**/*.test.ts"]);
  const out = execFileSync(npx2.command, npx2.args,
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

  // #944: PLANTED IN AN EXPORT OF THE TREE, NEVER IN THE TREE. This wrote the scratch file into
  // `packages/lab/src/packaging/` for as long as lint and typecheck took, and `node --test` runs files
  // concurrently, so a test walking the tree listed it and then read it after `finally` deleted it (#938's
  // `ts / run`, ENOENT). ENOENT was the lucky direction: a walker reading it WHILE it existed saw a `.test.ts`
  // with a deliberate type error. The same two commands now run, unchanged, in a copy of HEAD.
  //
  // TWICE, AND THE FIRST RUN IS THE CONTROL. With the planted file clean, both must pass: that proves the
  // export itself lints and type-checks (its first version did not -- `dist` is gitignored, so a relative
  // `../dist/` import failed `tsc` whatever was planted), and that the tools SEE a file at that path. Only
  // then does the violating version failing mean the violation was caught.
  const exported = treeExport();
  const gate = () => execFileSync("bash", ["-c", `set -u\n${runFn[0]}\nfailed=()\n`
    + `run "lint" npm run --silent lint\n`
    + `run "typecheck" npx tsc --noEmit\n`
    + `printf 'FAILED=%s\\n' "\${failed[@]:-}"`], { cwd: exported, encoding: "utf8" });
  try {
    writeFileSync(join(exported, PLANTED), 'import { test } from "node:test";\ntest("x", () => {});\n');
    const control = gate();
    assert.match(control, /^FAILED=$/m, `the export fails lint or typecheck with a CLEAN file planted:\n${control}`);
    assert.match(control, /ok {6}lint/, `lint did not run cleanly on the export:\n${control}`);
    assert.match(control, /ok {6}typecheck/, `typecheck did not run cleanly on the export:\n${control}`);

    writeFileSync(join(exported, PLANTED),
      'import { test } from "node:test";\nconst unused = 1;\ntest("x", () => { const y: string = 5; });\n');
    const out = gate();
    assert.match(out, /FAILED=lint/, "a real lint error in a tracked package file must be reported FAILED");
    assert.match(out, /FAILED=typecheck/, "a real type error must be reported FAILED");
  } finally {
    rmSync(exported, { recursive: true, force: true });
  }
});

/** Where the planted violation sits, relative to the tree root -- inside `treeExport()`'s copy only. */
const PLANTED = "packages/lab/src/packaging/_scratch-run-fn-proof.test.ts";

/**
 * #944: HEAD, exported to a temp directory, with this checkout's `node_modules` linked in -- a tree lint and
 * `tsc` see exactly as they see this one, and no other test can walk. `git archive` rather than a worktree:
 * it registers nothing in `.git`, so a crashed run leaves only a temp directory behind. `sandboxGitEnv`,
 * because a hook exports `GIT_DIR` and an inherited one would archive whatever it names.
 */
function treeExport(): string {
  const dir = mkdtempSync(join(tmpdir(), "fast-gate-export-"));
  const tar = execFileSync("git", ["archive", "--format=tar", "HEAD"],
    { cwd: REPO, env: sandboxGitEnv(), maxBuffer: 256 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir");
  // Each package's BUILD, linked in too: `dist` is gitignored, and a relative `../dist/` import
  // (`packages/scorer/bin/fetch-encoder.mjs`) fails `tsc` in a tree that lacks it.
  for (const name of readdirSync(join(REPO, "packages"))) {
    const built = join(REPO, "packages", name, "dist");
    if (existsSync(built) && existsSync(join(dir, "packages", name))) symlinkSync(built, join(dir, "packages", name, "dist"), "dir");
  }
  return dir;
}

/**
 * #911 REMOVED THE CHANGESET GATE FROM THIS HOOK, and with it the three #288 tests that drove its block.
 *
 * What they pinned was real and is worth naming rather than losing with the code: `$(cmd)` DISCARDS the
 * command's own exit status, so `[ "$(node scripts/changeset-precise.mjs ...)" = "true" ]` could only ever
 * test the STRING it printed -- and a command that died printing nothing made the hook state a POSITIVE
 * claim ("no file this push touches is one npm actually ships") from a check that had examined nothing.
 *
 * The gate is now CI's `changeset` job alone, which is where it always also ran. The class those tests
 * guarded against is held tree-wide by `scripts/piped-exit-status-guard.mjs` and its own test, which is a
 * rule about every reader rather than about this one call site -- so deleting the instance does not delete
 * the lesson. `git log -S"changeset_precise_status"` is where the three tests themselves live now.
 */
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
