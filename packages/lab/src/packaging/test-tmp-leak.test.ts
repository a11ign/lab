/**
 * #2457: A TEST RUN THAT LEAVES ENTRIES BEHIND FAILS, AND NAMES THE FILE.
 *
 * About 15,000 entries a day reached `/tmp` from tests that `mkdtemp` and never remove, until the host's inodes ran out.
 * `test-tmp.mjs` is the remedy; this is the gate that keeps it applied. Each file below runs on its OWN under the real
 * `rstest`, with `TMPDIR` pointed at a fresh directory this test owns, and the directory must be empty afterwards.
 * A file is a subject on its own so the failure names it and nothing else.
 *
 * THE POSITIVE CONTROLS ARE FIXTURE FILES, written at run time and run through the same function as the real subjects:
 *
 * - `leaky.test.ts` calls `mkdtemp` and never removes it: the guard must flag it BY NAME. Without it, the emptiness
 *   asserted for the real files would pass just as well if the measurement saw nothing at all (`.claude/rules/guards-and-assertions.md`).
 * - `clean.test.ts` uses the helper: the directory it made must have existed under the private `TMPDIR` and be gone,
 *   and the guard stays green. That is the green state shown reachable, and shown to have examined a directory.
 * - `throws.test.ts` throws AFTER making one, and `collect-time.test.ts` throws while its file is still being collected,
 *   where no after-hook ever runs. Both must still leave nothing.
 *
 * `NODE_DISABLE_COMPILE_CACHE=1` keeps rstest's own compile cache (`node-compile-cache`, one shared directory a run) out
 * of the reading. Where that cache writes is its own row (#2457, "What this row is not"), and this guard is about what a
 * TEST leaves.
 *
 * A run killed with `SIGKILL` still leaks: no after-hook survives it. The host's age rule on `/tmp` is the backstop for that,
 * and this file does not claim to close it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tempDir } from "../../../guards/src/test-tmp.mjs";
import { RSTEST_CONFIG } from "../../../guards/src/assert-glob-not-empty.mjs";
// #492: every npx call site resolves npm's own CLI script through this helper (`npm-cli-windows-spawn.test.ts`).
import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const HELPER = join(REPO, "packages/guards/src/test-tmp.mjs");

/**
 * The test files that adopted the helper under #2457, one subject each. `acceptance-exit-code.test.ts` is named by the row
 * as a leaker and measured as one that leaves nothing (only rstest's compile cache); it stays here as a subject.
 */
const ADOPTERS = [
  "packages/lab/src/packaging/corpus-restore-drill.test.ts",
  "packages/lab/src/packaging/promote-model.test.ts",
  "packages/lab/src/packaging/mutation-check.test.ts",
  "packages/lab/src/packaging/acceptance-exit-code.test.ts",
  "packages/cli/src/scan/axe-results.test.ts",
  "packages/lab/src/training/rule-ownership.test.ts",
  "packages/lab/src/training/page-server-holders.test.ts",
  "packages/lab/src/training/corpus-settled.test.ts",
  "packages/lab/src/gates/fleet-hours.test.ts",
];

type Report = { file: string; measured: string; status: number | null; ran: boolean; entries: string[]; output: string };
type RunRecord = { files: { testPath: string }[] };

/** The variables `rstest.config.mjs` reads to pick a reporter, dropped so the child's mode is declared by this file. */
const AGENT_ENV = ["AI_AGENT", "CLAUDECODE", "CLAUDE_CODE", "REPL_ID", "GEMINI_CLI", "CODEX_SANDBOX", "CODEX_THREAD_ID",
  "OPENCODE", "AUGMENT_AGENT", "GOOSE_PROVIDER", "JUNIE_DATA", "JUNIE_SHIM_PATH", "CURSOR_AGENT"];

/**
 * Run `include` alone under `config` with a private `TMPDIR`, and report what is left in it. The rstest cache and run
 * record live in the SAME owned directory but NOT in the measured one, so the reading is what the test left and nothing
 * the runner wrote for itself. `ran` is read off the run record, because an emptiness that comes from a run which never
 * reached the file is the vacuous pass this guard exists to refuse.
 */
function leakReport(request: { include: string; config?: string; extraEnv?: Record<string, string> }): Report {
  const apparatus = tempDir("test-tmp-leak-");
  const measured = join(apparatus, "tmp");
  const recordDir = join(apparatus, "records");
  mkdirSync(measured);
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: measured, NODE_DISABLE_COMPILE_CACHE: "1",
    A11Y_RSTEST_CACHE_DIR: join(apparatus, "cache"), A11Y_RSTEST_RECORD_DIR: recordDir, ...request.extraEnv };
  for (const name of [...AGENT_ENV, "RSTEST_NO_AGENT", "NODE_TEST_CONTEXT"]) delete env[name];
  const npx = npmCliInvocation("npx", ["rstest", "run", "--config", request.config ?? RSTEST_CONFIG, "--include", request.include]);
  const result = spawnSync(npx.command, npx.args, { cwd: REPO, encoding: "utf8", env });
  const records = existsSync(recordDir) ? readdirSync(recordDir).filter((name) => name.endsWith(".json")) : [];
  const ran = records.some((name) => (JSON.parse(readFileSync(join(recordDir, name), "utf8")) as RunRecord).files
    .some((file) => basename(file.testPath) === basename(request.include)));
  return { file: request.include, measured, status: result.status, ran, entries: readdirSync(measured).sort(),
    output: `${result.stdout}${result.stderr}` };
}

/** The guard: a file that could not be run, or left anything behind, throws an error that names it. */
function assertLeavesNothing(report: Report): void {
  assert.ok(report.ran, `${report.file}: the run never reached this file, so an empty TMPDIR proves nothing\n${report.output}`);
  assert.deepEqual(report.entries, [],
    `${report.file} left ${report.entries.length} entr${report.entries.length === 1 ? "y" : "ies"} in a private TMPDIR: ${report.entries.join(", ")}`);
}

for (const file of ADOPTERS) {
  test(`${file} leaves nothing in a private TMPDIR, and passes`, () => {
    const report = leakReport({ include: file });
    assert.equal(report.status, 0, `${file} did not pass, so what it left is not the reading\n${report.output}`);
    assertLeavesNothing(report);
  });
}

const FIXTURES: Record<string, string> = {
  "leaky.test.ts": `import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("makes a directory and never removes it", () => { mkdtempSync(join(tmpdir(), "leaky-")); });
`,
  "clean.test.ts": `import { test } from "node:test";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from ${JSON.stringify(HELPER)};
test("makes a directory through the helper", () => {
  const dir = tempDir("clean-");
  writeFileSync(join(dir, "note"), "x");
  appendFileSync(process.env.FIXTURE_LOG as string, dir + "\\n");
  if (!existsSync(dir)) throw new Error("the directory the helper made is missing while its test runs");
});
`,
  "throws.test.ts": `import { test } from "node:test";
import { tempDir } from ${JSON.stringify(HELPER)};
test("makes a directory and then throws", () => { tempDir("throws-"); throw new Error("on purpose"); });
`,
  "collect-time.test.ts": `import { test } from "node:test";
import { tempDir } from ${JSON.stringify(HELPER)};
tempDir("collect-time-");
throw new Error("on purpose, while the file is still being collected");
test("never registered", () => {});
`,
};

/** A probe directory holding the fixtures and a wrapper config that points the repo's OWN config at them. */
function probe(): { dir: string; config: string } {
  const dir = tempDir("test-tmp-leak-probe-");
  for (const [name, source] of Object.entries(FIXTURES)) writeFileSync(join(dir, name), source);
  const config = join(dir, "wrap.config.mjs");
  writeFileSync(config, `import base from ${JSON.stringify(pathToFileURL(RSTEST_CONFIG).href)};
export default { ...base, root: ${JSON.stringify(dir)}, include: ["*.test.ts"] };
`);
  return { dir, config };
}

const PROBE = probe();
const fixtureReport = (name: string, extraEnv: Record<string, string> = {}): Report =>
  leakReport({ include: join(PROBE.dir, name), config: PROBE.config, extraEnv });

test("POSITIVE CONTROL: a file that mkdtemp's and never removes it is FLAGGED, by name, with what it left", () => {
  const report = fixtureReport("leaky.test.ts");
  assert.ok(report.ran, `the fixture must have been run for this to be a control\n${report.output}`);
  assert.equal(report.entries.length, 1);
  assert.match(report.entries[0], /^leaky-/);
  assert.throws(() => assertLeavesNothing(report), /leaky\.test\.ts left 1 entry in a private TMPDIR: leaky-/);
});

test("the green state is reachable: a file that uses the helper leaves the directory empty, and it HAD made one", () => {
  const log = join(tempDir("test-tmp-leak-log-"), "made.txt");
  const report = fixtureReport("clean.test.ts", { FIXTURE_LOG: log });
  assert.equal(report.status, 0, report.output);
  assert.doesNotThrow(() => assertLeavesNothing(report));
  const made = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(made.length, 1, "the fixture reports the one directory it made");
  assert.match(made[0], /\/clean-[^/]+$/, "and it was the helper's, named by the prefix the fixture gave");
  assert.equal(dirname(made[0]), report.measured, "made inside the private TMPDIR the run was given, not the host's /tmp");
  assert.equal(existsSync(made[0]), false, "and it is gone: the emptiness is a removal, not a directory never made");
});

test("a test that THROWS after making a directory still leaves nothing", () => {
  const report = fixtureReport("throws.test.ts");
  assert.equal(report.status, 1, "control: the fixture really failed, so this is the throwing path");
  assert.doesNotThrow(() => assertLeavesNothing(report));
});

test("a file that throws while it is COLLECTED, where no after-hook ever runs, still leaves nothing", () => {
  const report = fixtureReport("collect-time.test.ts");
  assert.equal(report.status, 1, "control: the fixture really failed at collection");
  assert.match(report.output, /collect-time|on purpose/, "and the failure is the fixture's own");
  assert.doesNotThrow(() => assertLeavesNothing(report));
});
