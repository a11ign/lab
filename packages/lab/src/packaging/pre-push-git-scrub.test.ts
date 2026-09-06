/**
 * The pre-push hook's BELT-AND-BRACES defence, independent of `scripts/test-support/git-sandbox.ts`: git
 * exports `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` into the hook's own environment, and `npm test`
 * inherits it -- exactly how a test spawning git with `cwd` alone and an inherited `env` forged 15
 * commits into the real repo on 2026-09-06 (docs/backlog.md, "a closed row created the exposure"). This
 * asserts the scrub line PRESENT, POSITIONED before `npm test` runs, and — driving the real line rather
 * than retyping it — that it actually removes injected GIT_* variables from a shell environment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HOOK_PATH = fileURLToPath(new URL("../../../../scripts/git-hooks/pre-push", import.meta.url));
const hookSource = () => readFileSync(HOOK_PATH, "utf8");

/**
 * Bash `#` line comments blanked to SPACES rather than removed, so every remaining character keeps its
 * original index -- `scrubIndex`/`testMatch.index` below are computed against this text and must stay
 * comparable to each other. Bash has no block comments, so a per-line strip is complete, not an
 * approximation. Without this, this file's OWN header prose ("`npm test` inherits it...") -- which sits
 * ABOVE the real scrub line -- is the first textual match for `npm test`, and the ordering check fails
 * against a hook that is actually correct. The identical reason the JS-side discovery tests in this repo
 * strip `//`/`/* *‍/` comments before matching source (`source-text.ts`'s `stripComments`), one syntax over.
 */
function stripBashComments(source: string): string {
  return source.split("\n").map((line) => line.replace(/#.*$/, (m) => " ".repeat(m.length))).join("\n");
}

/** The exact scrub line(s), extracted rather than retyped -- drives the REAL script. */
function scrubLines(source: string): string {
  const match = /for v in "\$\{!GIT_@\}"; do unset "\$v"; done/.exec(source);
  assert.ok(match, "expected to find the GIT_* scrub line in the pre-push hook");
  return match[0];
}

test("the scrub line is present and appears BEFORE `npm test` runs", () => {
  // MATCHES THE INVOCATION, NOT ITS EXACT PREFIX. The first version of this looked for the literal
  // substring `run "unit tests" npm test`, and the fast/full pre-push split (2026-09-06) changed that
  // call site to `run "unit tests" env A11Y_TEST_CONCURRENCY=4 npm test` -- correct hook, stale matcher:
  // the scrub was still present and still first, and this test reported it MISSING. That is the same
  // shape as `withGitSandbox`'s three tests vanishing from git-spawn-classification's own discovered
  // population one unit earlier today -- a guard whose pattern is stale against the form its subject now
  // takes, read as "the property is gone" when only the guard's own view of it moved. A `\b`-bounded
  // search for the bare invocation survives whatever now precedes it (an `env` assignment today, anything
  // else tomorrow), because the ORDERING is the property under test, not the surrounding text.
  const source = stripBashComments(hookSource());
  const scrubIndex = source.indexOf(scrubLines(source));
  const testMatch = /\bnpm test\b/.exec(source);
  assert.ok(testMatch, "expected to find an `npm test` invocation somewhere in the hook");
  assert.ok(scrubIndex < testMatch.index,
    "the GIT_* scrub must run BEFORE `npm test`, or the hook's own inherited GIT_DIR reaches the test process");
});

test("MUTATION: the ordering check survives the invocation's prefix changing shape again", () => {
  // Proves the matcher above is not merely tolerant of TODAY's prefix by construction -- it must still
  // find `npm test` correctly when wrapped a SECOND time, differently, from how the real hook wraps it.
  const source = stripBashComments(hookSource());
  const rewrapped = source.replace(/\bnpm test\b/, "env A11Y_TEST_CONCURRENCY=4 A11Y_ANOTHER_VAR=x npm test");
  const scrubIndex = rewrapped.indexOf(scrubLines(rewrapped));
  const testMatch = /\bnpm test\b/.exec(rewrapped);
  assert.ok(testMatch, "the ordering check must still find npm test after a second re-wrap");
  assert.ok(scrubIndex < testMatch.index, "and the ordering must still hold after the re-wrap");
});

test("CONTROL: a prose mention of `npm test` in a comment ABOVE the scrub does not fool the ordering check", () => {
  // This file's own header (and the hook's) mention `npm test` in prose before the scrub line appears in
  // real code -- exactly the shape that broke the original version of this test. Reproduced directly:
  // an UNSTRIPPED search finds the comment mention first and reports the scrub as coming AFTER it, which
  // would be a false failure against a correct hook.
  const rawSource = hookSource();
  const rawMatch = /\bnpm test\b/.exec(rawSource);
  assert.ok(rawMatch, "the raw file must still contain a prose mention of npm test, or this control proves nothing");
  const scrubIndexRaw = rawSource.indexOf(scrubLines(rawSource));
  assert.ok(rawMatch.index < scrubIndexRaw,
    "the unstripped comment mention must sit BEFORE the real scrub line -- confirming the ordering bug this "
    + "test's sibling exists to avoid is real and not hypothetical");
});

test("the scrub line, run for real, removes every GIT_* variable from a dirty environment", () => {
  const scrub = scrubLines(hookSource());
  const out = execFileSync("bash", ["-c",
    `export GIT_DIR=/somewhere/.git GIT_WORK_TREE=/somewhere GIT_A_FUTURE_VAR=x; `
    + `${scrub}; env | grep '^GIT_' || echo NONE`],
    { encoding: "utf8" }).trim();
  assert.equal(out, "NONE", `expected every GIT_* variable gone; env still carried: ${out}`);
});

test("MUTATION: without the scrub line, GIT_DIR visibly survives -- proves the test can fail", () => {
  const out = execFileSync("bash", ["-c",
    "export GIT_DIR=/somewhere/.git; env | grep '^GIT_DIR' || echo NONE"], { encoding: "utf8" }).trim();
  assert.equal(out, "GIT_DIR=/somewhere/.git",
    "the reproduction itself must show GIT_DIR surviving without the scrub, or the test above proves nothing");
});
