/**
 * #2158: THE GUARD FOR `sandbox-exhaustion.mjs` -- a full `/tmp` must read as a full `/tmp`, on the line
 * the RUNNER prints, not only inside the error object.
 *
 * The row this file closes was filed because 104 suites build their sandboxes under a 16G tmpfs `/tmp` that
 * every session on the agents host shares, and a suite that hits it reports a list of named tests that
 * failed -- the same shape, in the same place, as a real regression. `worker-capture` lost part of a build
 * window to exactly that on 2026-09-23 and only found the cause by reading ABOVE the summary, which is not
 * where anyone looks for a verdict.
 *
 * ## The two mutations the row asked for, and where each one lives
 *
 * 1. **Remove the classifier, keep the helper.** The injected `EDQUOT` must once again surface as a bare
 *    errno with no orientation, and this file must go red. Every assertion below that names
 *    `EXHAUSTION_MARKER` is what notices; `npm run mutate` drives it.
 * 2. **Classify in the thrown message but not in what the runner prints as the verdict.** This is the row
 *    RESTATED, not fixed -- `worker-capture`'s quota lines DID exist and were still missed. So the last
 *    section below does not read an error object at all: it runs a REAL `rstest` over a fixture that dies
 *    inside a REAL `withSandbox`, and reads what that run PRINTED. An orientation that a `grep` over the
 *    runner's output cannot reach fails there however perfect the `Error` is.
 *
 * ## Errors are provoked, never hand-built, wherever the host allows it
 *
 * `EACCES` is a REAL `mkdtempSync` against a REAL directory this file makes unwritable -- the shape #2158
 * measured, carrying every field Node sets, which `new Error("boom")` carries none of (`spawn-failure.test.ts`'s
 * family). `ENOSPC` and `EDQUOT` cannot be provoked: the row forbids filling `/tmp` to prove a point already
 * measured, because this host is shared by every session in the org. Those two are injected, and the EACCES
 * test is what keeps the injected shape honest.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXHAUSTION_CODES, EXHAUSTION_MARKER, describeSandboxExhaustion, exhaustionCause, sandboxExhaustionError,
  withSandbox,
} from "../../../guards/src/sandbox-exhaustion.mjs";
import { localImports, stripComments } from "../../../guards/src/local-import-closure.mjs";
import { readsDuring } from "../../../guards/src/walk-scope.mjs";

const READ_AND_EXECUTE_ONLY = 0o500;
const OWNER_ALL = 0o700;
const BYTES_PER_GIB = 1024 ** 3;

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const FLOOR = fileURLToPath(new URL("../../../guards/src/assert-glob-not-empty.mjs", import.meta.url));
const MODULE = fileURLToPath(new URL("../../../guards/src/sandbox-exhaustion.mjs", import.meta.url));

/** A directory the process owns and cannot write to -- the one way to get a REAL EACCES without root. */
function withLockedBase<T>(fn: (locked: string) => T): T {
  const base = mkdtempSync(join(tmpdir(), "sandbox-exhaustion-locked-"));
  const locked = join(base, "locked");
  mkdirSync(locked);
  chmodSync(locked, READ_AND_EXECUTE_ONLY);
  try {
    return fn(locked);
  } finally {
    chmodSync(locked, OWNER_ALL);
    rmSync(base, { recursive: true, force: true });
  }
}

/** What `withSandbox` threw, or a failure saying it did not throw at all. */
function thrownBy(run: () => unknown): { name: string; message: string; cause: unknown } {
  try {
    run();
  } catch (error) {
    const e = error as { name: string; message: string; cause: unknown };
    return { name: e.name, message: e.message, cause: e.cause };
  }
  throw new Error("the sandbox was meant to fail and did not");
}

/** Node's own error under whatever this module wrapped it in -- the same object when nothing wrapped it. */
function errnoOf(thrown: { message: string; cause: unknown }): string | undefined {
  return ((thrown.cause ?? thrown) as NodeJS.ErrnoException).code;
}

/** A spawn failure's shape: Node sets NO `code` on it, so the fact is only in the child's output. */
function childFailure(stderr: string): unknown {
  return Object.assign(new Error("Command failed: git worktree add -q -b agent/x /tmp/row-claim-worktree-a/wt"),
    { status: 128, stderr });
}

// --- the classification ---------------------------------------------------------------------------------

test("#2158: a REAL EACCES from a REAL mkdtempSync names the root, the free space and the host", () => {
  const thrown = withLockedBase((locked) =>
    thrownBy(() => withSandbox({ prefix: "row-claim-worktree-", base: locked }, () => "never reached")));
  const { name, message } = thrown;

  // POSITIVE CONTROL for everything below: the probe really did produce Node's own EACCES, not a stand-in.
  // Read through the wrapper OR off the bare error, so that a classifier which stopped classifying fails
  // on the orientation it owes rather than here, on the probe that worked perfectly.
  assert.equal(errnoOf(thrown), "EACCES", `the probe must raise a real EACCES: ${message}`);
  assert.equal(name, "SandboxExhaustionError", `the classifier must own this failure: ${message}`);
  assert.ok(message.startsWith(EXHAUSTION_MARKER), message);
  // (a) the sandbox root, (b) its filesystem's free space, (c) the host rather than the code under test.
  assert.match(message, /building the test sandbox \S*row-claim-worktree-/, message);
  assert.match(message, / free of .* on the filesystem holding /, message);
  assert.match(message, /proved nothing about the code under test/, message);
  // and the original is still there, so nothing is hidden behind the orientation.
  assert.match(message, /EACCES: permission denied, mkdtemp/, message);
});

test("#2158: the whole orientation is ONE line -- the defect was lines a grep for the verdict never reached", () => {
  const { message } = withLockedBase((locked) =>
    thrownBy(() => withSandbox({ prefix: "row-claim-log-", base: locked }, () => 0)));
  assert.equal(message.split("\n").length, 1, message);
});

test("#2158: each of the three codes is classified, and every other failure is left alone", () => {
  for (const code of Object.keys(EXHAUSTION_CODES)) {
    assert.equal(exhaustionCause(Object.assign(new Error(`${code}: …`), { code })), code);
  }
  // The complement, which is what makes the line above a classification rather than a rubber stamp: an
  // assertion failure, a timeout, a missing file and a killed child are all REAL reds about the code.
  assert.equal(exhaustionCause(new assert.AssertionError({ message: "1 !== 2" })), null);
  assert.equal(exhaustionCause(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), null);
  assert.equal(exhaustionCause(Object.assign(new Error("no such file"), { code: "ENOENT" })), null);
  assert.equal(exhaustionCause(Object.assign(new Error("killed"), { signal: "SIGKILL", status: null })), null);
  assert.equal(exhaustionCause(undefined), null);
});

test("#2158: a spawned git that died of a full disk is classified from its OUTPUT, where the only fact is", () => {
  // `git init`/`worktree add` inside a sandbox is the shape `withRealWorktree` runs, and Node sets no errno
  // on a non-zero exit -- so `error.code` alone would miss the commonest way a sandbox dies of a full /tmp.
  assert.equal(exhaustionCause(childFailure("error: file write error: No space left on device\n")), "ENOSPC");
  assert.equal(exhaustionCause(childFailure("fatal: write failure: Disk quota exceeded\n")), "EDQUOT");
  assert.equal(exhaustionCause(childFailure("fatal: ENOSPC while writing the index\n")), "ENOSPC");
  // DELIBERATELY NOT MATCHED, and the module says why: "Permission denied" is the one strerror of the three
  // that is routinely about something other than the host -- a hook, a mode, a file the test itself made
  // unreadable -- and calling those "the host, not your change" would reproduce this row pointing the other
  // way. EACCES is still caught in full whenever Node sets `error.code`, which the first test proves.
  assert.equal(exhaustionCause(childFailure("fatal: cannot exec hook: Permission denied\n")), null);
});

test("#2158: the free space is REAL and is read from the deepest path that exists", () => {
  // When `mkdtemp` is what failed there is no root to stat; its filesystem is what the reader needs.
  const missing = join(tmpdir(), "sandbox-exhaustion-absent", "deeper", "still-absent");
  const message = describeSandboxExhaustion(Object.assign(new Error("EDQUOT: disk quota exceeded"),
    { code: "EDQUOT" }), { root: missing, cause: "EDQUOT" });
  assert.ok(message.includes(`on the filesystem holding ${tmpdir()}.`), message);
  // and the numbers are this filesystem's own, not a placeholder: the total matches statfs to the digit.
  const { bsize, blocks } = statfsSync(tmpdir());
  const total = blocks * bsize;
  assert.ok(total >= BYTES_PER_GIB, `this test reads GiB; /tmp measured ${total} bytes`);
  assert.ok(message.includes(`free of ${(total / BYTES_PER_GIB).toFixed(1)} GiB`),
    `${message}\nstatfs total ${total}`);
});

test("#2158: a free-space reading that cannot be TAKEN says so, and never falls back to a zero", () => {
  // The fallback matters more than it looks: this runs in the failure path of the suites it explains, and
  // "0 B free" is the one conclusion a broken reading must not fabricate -- it reads as a full disk.
  const message = describeSandboxExhaustion(new Error("ENOSPC: no space left on device"), {
    root: tmpdir(), cause: "ENOSPC",
    statfs: () => { throw new Error("EACCES: permission denied, statfs"); },
  });
  assert.ok(message.startsWith(EXHAUSTION_MARKER), message);
  assert.match(message, /free space could not be read at .*\(EACCES: permission denied, statfs\)/, message);
  assert.doesNotMatch(message, /0 B free/, message);
  assert.equal(message.split("\n").length, 1, message);
});

// --- the helper -----------------------------------------------------------------------------------------

test("#2158: withSandbox returns the body's value and removes the sandbox afterwards", () => {
  let seen = "";
  const before = readdirSync(tmpdir()).filter((e) => e.startsWith("sandbox-exhaustion-kept-")).length;
  const returned = withSandbox({ prefix: "sandbox-exhaustion-kept-" }, (root) => {
    seen = root;
    writeFileSync(join(root, "file.txt"), "written\n");
    return "the body's value";
  });
  assert.equal(returned, "the body's value");
  assert.notEqual(seen, "");
  assert.equal(readdirSync(tmpdir()).filter((e) => e.startsWith("sandbox-exhaustion-kept-")).length, before,
    `the sandbox ${seen} must be gone -- the leftovers worker-capture had to clear are this row's second-order symptom`);
});

test("#2158: a failure that is NOT exhaustion comes out of withSandbox untouched, object and all", () => {
  const real = new assert.AssertionError({ message: "worktreeStatus read a dirty tree as clean" });
  let caught: unknown = null;
  try {
    withSandbox({ prefix: "sandbox-exhaustion-passthrough-" }, () => { throw real; });
  } catch (error) { caught = error; }
  assert.equal(caught, real, "a real red must arrive as the SAME object -- identity, not a reworded copy");
});

test("#2158: an exhaustion raised by the BODY is classified too, not only one from the mkdtemp", () => {
  // `withRealWorktree` runs `git init`, `commit` and `worktree add` INSIDE the sandbox; a /tmp that fills
  // between the mkdtemp and the commit is the commonest shape, and it never touches the mkdtemp at all.
  const { message } = thrownBy(() => withSandbox({ prefix: "sandbox-exhaustion-body-" }, (root) => {
    throw Object.assign(new Error(`EDQUOT: disk quota exceeded, open '${root}/file.txt'`), { code: "EDQUOT" });
  }));
  assert.ok(message.startsWith(EXHAUSTION_MARKER), message);
  assert.match(message, /sandbox-exhaustion-body-/, message);
});

test("#2158: sandboxExhaustionError is null for everything that is not one of the three", () => {
  assert.equal(sandboxExhaustionError(new Error("plain"), "/tmp/x"), null);
  const built = sandboxExhaustionError(Object.assign(new Error("ENOSPC: no space"), { code: "ENOSPC" }), "/tmp/x");
  assert.equal(built?.name, "SandboxExhaustionError");
  assert.match(built?.message ?? "", /\/tmp\/x/);
});

// --- "no network and no host call" ----------------------------------------------------------------------

const SPAWNING_OR_NETWORK = ["node:child_process", "child_process", "node:net", "node:http", "node:https",
  "node:dgram", "node:tls", "node:worker_threads"];

test("#2158: the classifier imports nothing that can spawn or reach the network, and has no local closure", () => {
  const source = stripComments(readFileSync(MODULE, "utf8"));
  const imported = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imported.sort(), ["node:fs", "node:os", "node:path"],
    "POSITIVE CONTROL and assertion in one: the import list is pinned exactly, so a new import of any kind "
    + "fails here rather than only the ones a denylist happened to name");
  assert.deepEqual(imported.filter((i) => SPAWNING_OR_NETWORK.includes(i)), []);
  // POSITIVE CONTROL for the filter itself, which the emptiness above cannot provide.
  assert.deepEqual(["node:fs", "node:child_process"].filter((i) => SPAWNING_OR_NETWORK.includes(i)),
    ["node:child_process"]);
  // And there is nowhere else to hide it: the module imports no local file, so its closure is itself.
  assert.deepEqual(localImports(MODULE), []);
});

test("#2158: classifying a failure spawns NO child process, observed rather than read off the source", async () => {
  const reads = await readsDuring(() => withLockedBase((locked) =>
    thrownBy(() => withSandbox({ prefix: "row-claim-worktree-", base: locked }, () => 0))));
  assert.deepEqual(reads.filter((r) => /child process|a shell ran|^\(git /.test(r)), [],
    `the classifier must read a filesystem and nothing else:\n${reads.join("\n")}`);
  // POSITIVE CONTROL: the observer really does see a spawn, so the emptiness above is not vacuous.
  const spawned = await readsDuring(() => spawnSync(process.execPath, ["-e", "0"], { encoding: "utf8" }));
  assert.ok(spawned.some((r) => /child process/.test(r)), spawned.join("\n"));
});

// --- MUTATION 2: what the RUNNER prints, which is the half the row is actually about ---------------------

/**
 * A fixture suite that dies inside a REAL `withSandbox`, written OUTSIDE `packages/*` so no real suite run
 * ever collects it, and run through the same floor CI runs. `A11Y_RSTEST_CACHE_DIR` points at a temporary
 * root so this nested run can never write a build cache into the shared checkout's `node_modules`
 * (`runner-is-rstest.test.ts`'s own measured hazard).
 */
const FIXTURE = `import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSandbox } from ${JSON.stringify(MODULE)};

test("a sandbox whose root cannot be written", () => {
  const base = mkdtempSync(join(tmpdir(), "sandbox-exhaustion-fixture-"));
  const locked = join(base, "locked");
  mkdirSync(locked);
  chmodSync(locked, 0o500);
  try {
    withSandbox({ prefix: "row-claim-worktree-", base: locked }, () => 0);
  } finally {
    chmodSync(locked, 0o700);
    rmSync(base, { recursive: true, force: true });
  }
});

test("a sandbox whose setup dies of an injected EDQUOT", () => {
  withSandbox({ prefix: "row-claim-records-" }, () => {
    const error = new Error("EDQUOT: disk quota exceeded, mkdtemp '/tmp/row-claim-records-XXXXXX'");
    error.code = "EDQUOT";
    throw error;
  });
});
`;

function runFixture(): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-exhaustion-fixture-run-"));
  const cacheRoot = mkdtempSync(join(tmpdir(), "sandbox-exhaustion-cache-"));
  try {
    const file = join(dir, "exhausted.test.ts");
    writeFileSync(file, FIXTURE);
    const env: NodeJS.ProcessEnv = { ...process.env, A11Y_RSTEST_CACHE_DIR: cacheRoot };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync("node", [FLOOR, file, "--min=1", "--run", "--runner=rstest"],
      { cwd: REPO, encoding: "utf8", env });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cacheRoot, { recursive: true, force: true });
  }
}

/** Whatever reporter produced this, as plain lines -- rstest colours its output and CI does not strip it. */
function plainLines(output: string): string[] {
  // eslint-disable-next-line no-control-regex
  return output.replace(/\u001b\[[0-9;]*m/g, "").split("\n");
}

/** The index of the first line naming `fragment`, or -1. */
function firstLineNaming(lines: readonly string[], fragment: string): number {
  return lines.findIndex((line) => line.includes(fragment));
}

/**
 * WHICH REPORTER RSTEST USES IS NOT A PROPERTY OF THIS REPOSITORY, and the first version of this test
 * assumed it was. It sliced the run's output at a `## Failures` heading -- which exists in the reporter
 * this file was written against and does NOT exist in the one CI runs, where the failure list is
 * `Summary of all failing tests:` followed by ` FAIL <path> > <test name>`. It passed locally and went red
 * on the acceptance job at `0d22a3abc`, on a correct classifier.
 *
 * `RSTEST_NO_AGENT=1` REPRODUCES CI'S REPORTER LOCALLY, and is how this was re-checked rather than
 * re-pushed: rstest picks its agent-friendly reporter when it detects an agent
 * (`determineAgent`/`RSTEST_NO_AGENT` in `@rstest/core`), and CI, detecting none, uses the default. Run
 * this file both ways before trusting any assertion over a runner's output.
 *
 * So the anchor is the FAILING TEST'S OWN NAME, which every reporter prints because it is the verdict.
 * The orientation must appear AFTER it -- attached to the failure rather than a screen earlier, which is
 * precisely where `worker-capture`'s quota lines were -- and every printed occurrence must carry the whole
 * orientation on that ONE line, so a `grep` for the marker never lands on a fragment.
 */
const MUST_CARRY = [" free of ", "on the filesystem holding ", "proved nothing about the code under test"];

test("#2158 MUTATION 2: the orientation reaches what the RUNNER PRINTS, beside the failing test's name", () => {
  const { status, output } = runFixture();
  assert.equal(status, 1, `the fixture must stay RED -- a full disk is a real failure:\n${output}`);
  assert.doesNotMatch(output, /No test files found/, output);
  const lines = plainLines(output);

  for (const [name, code] of [["a sandbox whose root cannot be written", "EACCES"],
    ["a sandbox whose setup dies of an injected EDQUOT", "EDQUOT"]]) {
    const named = firstLineNaming(lines, name);
    assert.notEqual(named, -1, `the runner must print the failing test's name:\n${output}`);

    const carrying = lines.flatMap((line, index) =>
      (line.includes(EXHAUSTION_MARKER) && line.includes(code) ? [index] : []));
    assert.ok(carrying.length > 0,
      `no printed line carries the marker and ${code} -- the orientation exists only inside the Error, `
      + `which is the defect this row closes restated:\n${output}`);
    assert.ok(carrying.every((index) => index > named),
      `the orientation must print AFTER the failing test's name, not a screen earlier:\n${output}`);
    // ONE LINE: every occurrence carries the whole orientation, so a grep for the marker lands on all of it.
    for (const index of carrying) {
      for (const fragment of MUST_CARRY) {
        assert.ok(lines[index].includes(fragment),
          `line ${index} carries the marker without "${fragment}":\n${lines[index]}`);
      }
    }
  }
});
