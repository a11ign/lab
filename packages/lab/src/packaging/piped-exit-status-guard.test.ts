/**
 * `cmd | head` (or `| tail`, `| grep`) reports the STATUS TOOL's exit code, not the piped command's —
 * CLAUDE.md's rule against this ("Never pipe a command whose exit status you intend to read") failed
 * TWICE in one night on 2026-09-07, the second time an hour after the first was diagnosed and warned
 * about (issue #180):
 *
 *     `worker-capture`   node scripts/row-claim.mjs ... | head        -- exit 0 read for a real exit 2
 *     `dispatcher`       node scripts/merge-guard.mjs $n | head -4    -- exit 0 read on every refusal
 *
 * In both cases the piped command was a GUARD being verified, so the pipe manufactured evidence AGAINST
 * working code — this project's standard response to "the guard did not bite" is to suspect the guard,
 * which is exactly backwards when the guard bit and the pipe hid it.
 *
 * DELIBERATELY NARROW, per the issue's own instruction: measure the real population before refusing
 * anything. 38 `| head`/`| tail`/`| grep` sites exist across .sh/.mjs/.yml on 2026-09-07 and NONE of them
 * read `$?` afterward — every one either captures stdout via `$(...)` or reads the pipeline's own boolean
 * result inside an `if`. So this only flags a pipeline ending in a status tool where something AFTER it
 * reads `$?`; a plain `cat file | head -5` with nothing reading its status is not a hazard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { checkPipedExitStatus } from "../../../../scripts/piped-exit-status-guard.mjs";

const CLI = join(import.meta.dirname, "../../../../scripts/piped-exit-status-guard.mjs");

test("the exact shape that cost `dispatcher` an hour is refused", () => {
  const { hazard } = checkPipedExitStatus(
    'node scripts/merge-guard.mjs 148 | head -4; echo EXIT=$?',
  );
  assert.equal(hazard, true);
});

test("a legitimate `| head` with nothing reading $? afterward is allowed", () => {
  const { hazard } = checkPipedExitStatus("cat README.md | head -5");
  assert.equal(hazard, false);
});

test("the reason names the actual pipeline, not just \"hazard\"", () => {
  const { hazard, reason } = checkPipedExitStatus(
    'foo | head -1; echo "EXIT=$?"',
  );
  assert.equal(hazard, true);
  assert.match(reason, /foo \| head -1/);
});

test("`| grep` and `| tail` are caught too, not only `| head`", () => {
  assert.equal(checkPipedExitStatus('foo | grep bar; echo $?').hazard, true);
  assert.equal(checkPipedExitStatus('foo | tail -1; echo $?').hazard, true);
});

test("a status tool used MID-pipeline does not own the exit status, and is not flagged", () => {
  // `grep` here feeds `wc`, which is what actually determines the pipeline's status -- the hazard is
  // specifically about a status tool being the LAST stage.
  const { hazard } = checkPipedExitStatus('foo | grep bar | wc -l; echo $?');
  assert.equal(hazard, false);
});

test("capturing output via $(...) is not a $? read, and is not flagged", () => {
  const { hazard } = checkPipedExitStatus('result=$(foo | head -1)');
  assert.equal(hazard, false);
});

test("reading $? on its own statement, after a `;`, is still caught", () => {
  const { hazard } = checkPipedExitStatus("foo | head -1\necho $?");
  assert.equal(hazard, true);
});

test("`$?` read BEFORE the pipeline (a different command's status) is not this hazard", () => {
  // A heuristic limitation, named rather than hidden: this checks only whether *a* statement reads $?
  // anywhere in the string, so a $? read for an unrelated earlier command is a known false positive this
  // narrow check accepts rather than trying to track which $? belongs to which pipeline.
  const { hazard } = checkPipedExitStatus('true; echo $?; foo | head -1');
  assert.equal(hazard, true, "documents the known limitation -- see comment above");
});

test("mentioning `pipefail` in the same text is treated as the mitigation being present", () => {
  const { hazard } = checkPipedExitStatus(
    'set -o pipefail; node scripts/merge-guard.mjs 148 | head -4; echo EXIT=$?',
  );
  assert.equal(hazard, false);
});

/**
 * The CLI's OWN `refuseUnknownFlags` call must not misread the positional payload as a flag (#349).
 * Found the day this guard shipped: pre-commit feeds it a bare `"---"` (a newly-staged YAML doc marker)
 * as `argv[2]`, and the guard's default `process.argv.slice(2)` scope included that positional in its
 * own flag census -- `"---".startsWith("--")` is true, so it read as an unknown flag and refused every
 * commit touching a YAML file. A pure-function test on `checkPipedExitStatus` cannot see this; it is a
 * property of the CLI entry point's own argv handling, so it has to run the real process.
 */
test("the CLI's positional payload is never misread as one of ITS OWN flags, even when it starts with --", () => {
  const out = execFileSync("node", [CLI, "---"], { encoding: "utf8" });
  assert.match(out, /^ALLOW:/);
});

test("the CLI still refuses a genuine unknown flag of its own", () => {
  assert.throws(() => execFileSync("node", [CLI, "cmd", "--bogus"], { encoding: "utf8", stdio: "pipe" }));
});
