/**
 * #2457: `test-tmp.mjs` hands a test a temp directory and removes it itself.
 *
 * What is pinned here is the helper's own contract, in one process and in plain `node`. What it does under the real
 * `rstest` runner -- a test that throws, a file that throws while it is collected, a file that never removes what it made --
 * is `test-tmp-leak.test.ts`, which runs fixtures through rstest and reads what they leave behind.
 *
 * `removeTempDirs()` is called on purpose in several tests, and it removes EVERY directory this file made so far. So each
 * test makes what it needs inside its own body and reads nothing another test made.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { removeTempDirs, tempDir } from "../../../guards/src/test-tmp.mjs";

const HELPER = fileURLToPath(new URL("../../../guards/src/test-tmp.mjs", import.meta.url));

/**
 * Paths the child printed. Importing the helper under plain `node` registers its after-hook with `node:test`, which prints a
 * TAP summary at exit, so a line is a path only if it starts with `/`; a signal in the child needs a live handle to be
 * delivered before the empty event loop ends the process, hence the `setInterval` in those bodies.
 *
 * Run `body` (module source) in a plain `node` with the helper imported as `tempDir` and `removeTempDirs`. The child gets a
 * `TMPDIR` of its own that THIS file removes, so what even a killed child leaves is not left on the host.
 */
function inPlainNode(body: string): { status: number | null; signal: NodeJS.Signals | null; made: string[] } {
  const source = `import { tempDir, removeTempDirs } from ${JSON.stringify(HELPER)};\n${body}`;
  const ran = spawnSync(process.execPath, ["--input-type=module", "-e", source],
    { encoding: "utf8", env: { ...process.env, TMPDIR: tempDir("test-tmp-child-") } });
  return { status: ran.status, signal: ran.signal, made: ran.stdout.split("\n").filter((line) => line.startsWith("/")) };
}

test("tempDir makes a real directory under os.tmpdir(), named by the prefix it was given", () => {
  const dir = tempDir("test-tmp-shape-");
  assert.equal(statSync(dir).isDirectory(), true);
  assert.equal(dirname(dir), tmpdir());
  assert.match(basename(dir), /^test-tmp-shape-[A-Za-z0-9]{6}$/, "mkdtempSync's own naming, so adopting it renames nothing");
});

test("tempDir follows TMPDIR, which is what lets a run be measured in a private directory", () => {
  const before = process.env.TMPDIR;
  const root = tempDir("test-tmp-steer-");
  process.env.TMPDIR = root;
  try {
    assert.equal(dirname(tempDir("steered-")), root);
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
});

test("removeTempDirs removes what tempDir made, contents included", () => {
  const owned = tempDir("test-tmp-owned-");
  mkdirSync(join(owned, "deeper"));
  writeFileSync(join(owned, "deeper", "file"), "x");
  removeTempDirs();
  assert.equal(existsSync(owned), false, "the directory and everything in it is gone");
});

test("removeTempDirs removes ONLY what tempDir made: a directory made by mkdtemp in the same TMPDIR survives", () => {
  // The child makes one of each, so the survivor is a directory the helper never heard of, and it is still there afterwards.
  const ran = inPlainNode(`import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
console.log(tempDir("mine-"));
console.log(mkdtempSync(join(tmpdir(), "not-mine-")));
removeTempDirs();`);
  assert.equal(ran.status, 0);
  assert.equal(ran.made.length, 2, "control: both directories were made");
  assert.equal(existsSync(ran.made[0]), false, "the helper's own is gone");
  assert.equal(existsSync(ran.made[1]), true, "a directory the helper did not make is left alone");
});

test("removeTempDirs is idempotent, so the after-hook and the exit listener may both run it", () => {
  const dir = tempDir("test-tmp-twice-");
  removeTempDirs();
  assert.doesNotThrow(() => removeTempDirs());
  assert.equal(existsSync(dir), false);
});

test("a process that ends normally without removing anything itself leaves nothing (the exit listener)", () => {
  const ran = inPlainNode(`console.log(tempDir("normal-"));`);
  assert.equal(ran.status, 0);
  assert.equal(ran.made.length, 1, "control: the child did make a directory");
  assert.equal(existsSync(ran.made[0]), false);
});

test("a process that throws leaves nothing", () => {
  const ran = inPlainNode(`console.log(tempDir("throws-")); throw new Error("on purpose");`);
  assert.notEqual(ran.status, 0, "control: it failed (node:test's own handler picks the code, and 7 is what it gives here)");
  assert.equal(ran.made.length, 1);
  assert.equal(existsSync(ran.made[0]), false);
});

test("a process ended by SIGTERM leaves nothing, and still dies of the signal (rstest ends a failed collection that way)", () => {
  const ran = inPlainNode(`console.log(tempDir("sigterm-")); process.kill(process.pid, "SIGTERM"); setInterval(() => {}, 1000);`);
  assert.equal(ran.signal, "SIGTERM", "the listener removes and re-raises: the process is not kept alive by it");
  assert.equal(ran.made.length, 1);
  assert.equal(existsSync(ran.made[0]), false);
});

test("a process that IS killed with SIGKILL still leaves its directory: no hook survives it, and the host's age rule is the backstop", () => {
  const ran = inPlainNode(`console.log(tempDir("sigkill-")); process.kill(process.pid, "SIGKILL"); setInterval(() => {}, 1000);`);
  assert.equal(ran.signal, "SIGKILL");
  assert.equal(ran.made.length, 1);
  assert.equal(existsSync(ran.made[0]), true,
    "stated rather than implied: the helper does not close the killed-halfway case, and this pins that it says so");
});
