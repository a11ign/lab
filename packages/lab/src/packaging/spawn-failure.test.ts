/**
 * #1293: ONE LINE FOR A FAILED SPAWN, DRIVEN AGAINST WHAT NODE REALLY THROWS.
 *
 * Every failure here is a REAL `execFileSync` of a real child -- never `new Error("boom")`, which carries
 * none of the fields a spawn error has and passes every assertion while telling you nothing about the shape
 * Node produces (#1284's family). The children are `node -e` scripts, so the suite needs nothing but Node.
 *
 * THE FIRST TEST PINS NODE, NOT THE HELPER. The helper's design rests on a measured fact -- a piped
 * failure's `message` already contains the stderr -- and if a Node release changes that, the helper would
 * go on reading the first line and silently stop being the right design. That test is what notices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { describeSpawnFailure } from "../../../../scripts/spawn-failure.mjs";

const EXIT_CODE = 3;
// THE STDERR TEXT TRAVELS BY ENVIRONMENT, NEVER IN THE SCRIPT. The script IS the argv, and the argv is in
// every line this helper produces -- so a script that spelled "refused" would satisfy "the line carries the
// stderr" and fail "the stderr is not repeated" for reasons that have nothing to do with the stderr. The
// first draft of this file did exactly that, and both assertions went red on a correct helper.
const STDERR_TEXT = "first-err\nlast err: refused\n\n";
const WRITES_STDERR = `process.stderr.write(process.env.SPAWN_FAILURE_STDERR); process.exit(${EXIT_CODE})`;
const WRITES_NOTHING = `process.exit(${EXIT_CODE})`;

/** Runs a child that fails, and returns what the `catch` received. */
function realFailure(script: string, options: ExecFileSyncOptions): unknown {
  try {
    execFileSync(process.execPath, ["-e", script],
      { ...options, env: { ...process.env, SPAWN_FAILURE_STDERR: STDERR_TEXT } });
  } catch (error) {
    return error;
  }
  throw new Error(`the child was meant to fail and exited 0: ${script}`);
}

test("THE FIXTURE CANNOT NAME ITSELF: no word of the stderr appears in the argv the helper will print", () => {
  assert.doesNotMatch(WRITES_STDERR, /first-err|refused/);
});

const piped = () => realFailure(WRITES_STDERR, { encoding: "utf8", stdio: "pipe" });

test("NODE'S OWN SHAPE: a piped failure's message already carries the stderr; an inherited one does not", () => {
  const pipedError = piped() as { message: string; stderr: string };
  assert.match(pipedError.message, /^Command failed: .*\nfirst-err\nlast err: refused/s);
  assert.equal(pipedError.stderr, "first-err\nlast err: refused\n\n");

  const inheritedError = realFailure(WRITES_NOTHING, { stdio: "inherit" }) as { message: string; stderr: unknown };
  assert.doesNotMatch(inheritedError.message, /\n/, "an inherited failure's message is the argv line alone");
  assert.equal(inheritedError.stderr, null);
});

test("PIPED: one line, the argv, the exit, and the LAST stderr line -- never the whole stderr again", () => {
  const line = describeSpawnFailure(piped(), { inherited: false });
  assert.doesNotMatch(line, /\n/, `must be ONE line: ${JSON.stringify(line)}`);
  assert.match(line, /^Command failed: .*node/, "the argv names which command died");
  assert.match(line, new RegExp(`exited ${EXIT_CODE}: last err: refused$`));
  assert.doesNotMatch(line, /first-err/, "the message's own copy of stderr must not be carried along");
});

test("INHERITED: the argv and the exit, and the stderr is NOT repeated -- it is already on screen", () => {
  const real = describeSpawnFailure(realFailure(WRITES_NOTHING, { stdio: "inherit" }), { inherited: true });
  assert.match(real, new RegExp(`^Command failed: .*node.* -- exited ${EXIT_CODE}; its stderr is above$`));

  // The flag, not the error's contents, decides: the same PIPED error described as inherited adds nothing.
  const flagged = describeSpawnFailure(piped(), { inherited: true });
  assert.doesNotMatch(flagged, /refused|first-err/, `the stderr was repeated: ${flagged}`);
  assert.match(flagged, /^Command failed: /);
});

test("THE THREE ABSENCES are three different lines: wrote nothing, not captured, never started", () => {
  const wroteNothing = describeSpawnFailure(
    realFailure(WRITES_NOTHING, { encoding: "utf8", stdio: "pipe" }), { inherited: false });
  const notCaptured = describeSpawnFailure(
    realFailure(WRITES_STDERR, { stdio: ["pipe", "pipe", "ignore"] }), { inherited: false });
  const neverStarted = describeSpawnFailure(
    realFailure(WRITES_NOTHING, { cwd: "/definitely/not/a/directory/1293" }), { inherited: false });

  assert.match(wroteNothing, /exited 3: it wrote nothing to stderr$/);
  assert.match(notCaptured, /exited 3: its stderr was not captured$/);
  assert.match(neverStarted, /the command never started \(ENOENT\)$/);
  const absences = [wroteNothing, notCaptured, neverStarted];
  assert.equal(new Set(absences).size, absences.length, "two absences share a line, so a reader cannot tell them apart");
});

test("a child killed by a signal says so, rather than `exited null`", () => {
  const killed = realFailure(`process.kill(process.pid, "SIGTERM")`, { encoding: "utf8", stdio: "pipe" });
  const line = describeSpawnFailure(killed, { inherited: false });
  assert.match(line, /killed by SIGTERM: it wrote nothing to stderr$/);
  assert.doesNotMatch(line, /exited null/);
});

test("a Buffer stderr (no `encoding`) reads the same as a string one", () => {
  const bufferError = realFailure(WRITES_STDERR, { stdio: "pipe" }) as { stderr: unknown };
  assert.ok(Buffer.isBuffer(bufferError.stderr), "the fixture must really produce a Buffer, or this proves nothing");
  assert.match(describeSpawnFailure(bufferError, { inherited: false }), /exited 3: last err: refused$/);
});
