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

/** The exact scrub line(s), extracted rather than retyped -- drives the REAL script. */
function scrubLines(source: string): string {
  const match = /for v in "\$\{!GIT_@\}"; do unset "\$v"; done/.exec(source);
  assert.ok(match, "expected to find the GIT_* scrub line in the pre-push hook");
  return match[0];
}

test("the scrub line is present and appears BEFORE `npm test` runs", () => {
  const source = hookSource();
  const scrubIndex = source.indexOf(scrubLines(source));
  const testIndex = source.indexOf('run "unit tests" npm test');
  assert.ok(testIndex > 0, "expected to find the `npm test` invocation");
  assert.ok(scrubIndex < testIndex,
    "the GIT_* scrub must run BEFORE `npm test`, or the hook's own inherited GIT_DIR reaches the test process");
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
