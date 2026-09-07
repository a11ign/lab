/**
 * #355: `npm test` passes, exit 0, if the glob it hands to `tsx --test` resolves to zero files --
 *
 *   $ npx tsx --test "packages/lab/src/packaging/nothing-matches-*.test.ts"; echo "EXIT=$?"
 *   EXIT=0
 *
 * and every vacuity guard this repository has lives inside a `.test.ts` file the glob would have loaded
 * -- a guard cannot fire from inside the thing that failed to load. `underFloor` is the pure check this
 * repo's own rule ("do not implement it as another `*.test.ts`") requires to live OUTSIDE that suite,
 * exercised here directly rather than through a shelled-out CLI invocation for every case.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { underFloor } from "../../../../scripts/assert-glob-not-empty.mjs";

const SCRIPT = fileURLToPath(new URL("../../../../scripts/assert-glob-not-empty.mjs", import.meta.url));
const REPO = path.resolve(path.dirname(SCRIPT), "..");

/** A fake resolver, so the pure function is tested without ever touching the real filesystem. */
const fakeGlob = (counts: Record<string, number>) => (pattern: string) =>
  Array.from({ length: counts[pattern] ?? 0 }, (_, i) => `${pattern}#${i}`);

test("a glob resolving to zero files is under any positive floor", () => {
  const offenders = underFloor(["a/*.test.ts"], 1, fakeGlob({ "a/*.test.ts": 0 }));
  assert.deepEqual(offenders, [{ pattern: "a/*.test.ts", matched: 0 }]);
});

test("a glob resolving to exactly the floor is NOT an offender -- the floor is inclusive", () => {
  const offenders = underFloor(["a/*.test.ts"], 5, fakeGlob({ "a/*.test.ts": 5 }));
  assert.deepEqual(offenders, []);
});

test("a glob one below the floor IS an offender, and reports its real count", () => {
  const offenders = underFloor(["a/*.test.ts"], 5, fakeGlob({ "a/*.test.ts": 4 }));
  assert.deepEqual(offenders, [{ pattern: "a/*.test.ts", matched: 4 }]);
});

test("multiple globs are checked independently -- one passing does not excuse another failing", () => {
  const glob = fakeGlob({ "good/*.test.ts": 10, "bad/*.test.ts": 0 });
  const offenders = underFloor(["good/*.test.ts", "bad/*.test.ts"], 1, glob);
  assert.deepEqual(offenders, [{ pattern: "bad/*.test.ts", matched: 0 }]);
});

test("PROOF: this repo's real test glob currently clears a floor safely below its live count", () => {
  // Not vacuous: run against the REAL filesystem (default `globSync`), so a future change that starves
  // this test file's own resolver would still be caught by the CLI test below reading the real repo.
  const offenders = underFloor(["packages/*/src/**/*.test.ts"], 300);
  assert.deepEqual(offenders, [], "packages/*/src/**/*.test.ts should comfortably clear 300 files today");
});

// --- the CLI, driven for real -- this is what `test:ts`/`coverage`/`pre-push` actually invoke ---

function run(args: string[]): { status: number; stderr: string } {
  try {
    execFileSync("node", [SCRIPT, ...args], { cwd: REPO, encoding: "utf8", stdio: "pipe" });
    return { status: 0, stderr: "" };
  } catch (error) {
    const e = error as { status: number; stderr: string };
    return { status: e.status, stderr: e.stderr };
  }
}

test("ACCEPTANCE (#355): the exact vacuous glob from the issue's own open-check is refused, not passed", () => {
  const { status, stderr } = run(["packages/lab/src/packaging/nothing-matches-*.test.ts"]);
  assert.equal(status, 1);
  assert.match(stderr, /matched 0, need at least 1/);
});

test("the real glob, with a floor safely below its live count, exits 0", () => {
  const { status } = run(["packages/*/src/**/*.test.ts", "--min=300"]);
  assert.equal(status, 0);
});

test("an unknown flag is refused, never silently ignored", () => {
  const { status, stderr } = run(["packages/*/src/**/*.test.ts", "--bogus"]);
  assert.equal(status, 2);
  assert.match(stderr, /unknown flag --bogus/);
});

test("no glob argument at all is refused rather than silently checking nothing", () => {
  const { status, stderr } = run(["--min=5"]);
  assert.equal(status, 2);
  assert.match(stderr, /no glob pattern given/);
});

// --- `--run`: the check and the real `tsx --test` invocation share ONE argv, not two hand-typed copies ---
//
// #355's first fix passed `rules:gate` and STILL let `npm test` pass silently on a vacuous glob, because
// `test:ts` wrote the pattern twice -- once for `test:glob-check`, once for the real `tsx --test` call --
// and a mutation touching only the second copy sailed through the (unmutated) first. `--run` closes that:
// the patterns this process just proved non-vacuous are the exact array handed to `tsx --test`.

test("ACCEPTANCE (#355, second cut): --run on a vacuous glob execs NOTHING -- offenders block before exec", () => {
  const { status, stderr } = run(["packages/lab/src/packaging/nothing-matches-*.test.ts", "--run"]);
  assert.equal(status, 1, "must fail closed -- a mutation touching only the executed glob must still be caught "
    + "because there is only ONE glob argv here, not a separately-typed check copy");
  assert.match(stderr, /matched 0, need at least 1/);
});

test("--run on a real, populated glob execs tsx --test and forwards ITS exit code (0)", () => {
  // A DIFFERENT, stable file -- never this test file itself, which would spawn itself recursively.
  const { status } = run(["packages/lab/src/packaging/commands-documented.test.ts", "--min=1", "--run"]);
  assert.equal(status, 0);
});

test("--run forwards a failing tsx --test exit code rather than reporting the check's own success", () => {
  // A fixture that fails on purpose, written OUTSIDE packages/*/src/ so the real `packages/*/src/**/*.test.ts`
  // glob -- and therefore the corpus-floor test above and the real `npm test` -- never sees it.
  const dir = mkdtempSync(join(tmpdir(), "assert-glob-not-empty-"));
  const file = join(dir, "always-fails.test.ts");
  writeFileSync(file, 'import { test } from "node:test";\n'
    + 'import assert from "node:assert/strict";\n'
    + 'test("deliberately false", () => { assert.equal(1, 2); });\n');
  try {
    const { status } = run([file, "--min=1", "--run"]);
    assert.equal(status, 1, "a real tsx --test failure must reach this command's own exit code, not be "
      + "swallowed by the check that ran before it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
