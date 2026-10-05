// no-token: gh -- runs verify's `ts` step with the runner injected and reads temporary run records; one test spawns rstest on a temporary fixture and no `gh` or network is reached
/**
 * #3574: AFTER A RED LOCAL RUN, VERIFY RE-RUNS THE FAILED FILES BEFORE THE AFFECTED SET, AND NEVER RUNS `--onlyFailures` WITH NOTHING RECORDED.
 *
 * Two behaviours of rstest 0.12.3, read in the installed package, decide the design. (1) `onlyFailures` is ignored when it is
 * combined with `--changed` or with explicit file filters, so the first leg and the affected run are two invocations and not one
 * with two flags. (2) With no failure recorded `--onlyFailures` prints "No failed tests found from the previous run. Running all
 * tests." and runs EVERYTHING, so an unconditional first leg would run the whole suite after every green run, the opposite of the
 * row. So the first leg is a run of exactly the files the last run failed, started only when the last run's record says it
 * failed, and it never uses `--onlyFailures` at all.
 *
 * THE SOURCE is the newest run record of the worktree (#2199), not rstest's sequence cache: that cache is one file shared by every
 * worktree here, keeps a failure for 30 days and holds failures of scratch fixtures (measured 2026-10-05, on the row).
 *
 * POSITIVE CONTROLS, named where each absence is asserted: (1) the detector for an `--onlyFailures` run is shown FIRING on a step that
 * runs it unconditionally, before it is trusted to find none in the real one; (2) the first leg is shown STARTING after a red record,
 * in the same test that shows it NOT starting after a green one; (3) the reader is shown finding the newest of several records, and
 * the real rstest is shown writing the record shape the reader reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AFFECTED_INCLUDE, bodyHash, failuresFirstPlan, newestRunRecord, runFailuresFirst, runRecordDir, runTs, stampVerdict,
} from "../../../../scripts/verify.mjs";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKTREE = basename(ROOT);
const TWO_FAILED = "packages/lab/src/packaging/a.test.ts";
const OTHER_FAILED = "packages/guards/src/b.test.ts";

type Record = { status: string; files: Array<{ testPath: string; status: string }> };
const red = (...failed: string[]): Record => ({ status: "fail", files: [...failed.map((testPath) => ({ testPath, status: "fail" })), { testPath: "packages/lab/src/ok.test.ts", status: "pass" }] });
const green = (): Record => ({ status: "pass", files: [{ testPath: TWO_FAILED, status: "pass" }] });

/** The plan a tree where every named file exists and matches the include would make from `record`. */
const planOf = (record: Record | null, tree: { exists?: (file: string) => boolean; inInclude?: (file: string) => boolean } = {}) =>
  failuresFirstPlan({ last: record === null ? null : { name: `${WORKTREE}-2026-10-05T00-00-00-000Z-1.json`, record },
    exists: tree.exists ?? (() => true), inInclude: tree.inInclude ?? (() => true) });

/** Every command `ts` starts, as one line each, and the status of the rstest runs: `first` is the one that has no `--changed`. */
const recorder = (statuses: { first?: number | null; affected?: number | null } = {}) => {
  const seen: string[] = [];
  const run = async (command: string, args: string[]) => {
    const line = [command, ...args].join(" ");
    seen.push(line);
    if (!line.includes(" rstest run ")) return { status: 0 };
    const asked = line.includes("--changed=") ? statuses.affected : statuses.first;
    return { status: asked === undefined ? 0 : asked };
  };
  return { seen, run };
};
const rstestRuns = (seen: string[]) => seen.filter((line) => line.includes(" rstest run "));
const ranAffected = (line: string) => line.includes("--changed=");
const reaches = () => ({ testFiles: 2, tests: 5, failedFiles: 0, failedTests: 0 });

/** The spelling this row forbids without a record: any rstest run that asks for `--onlyFailures`. */
const asksOnlyFailures = (seen: string[]) => seen.some((line) => line.includes("--onlyFailures"));

// 1. THE DETECTOR FOR THE FORBIDDEN SPELLING, SHOWN FIRING (the positive control for every "never" below).
test("the detector sees an unconditional --onlyFailures first leg, so its silence on the real step means something", async () => {
  const { seen, run } = recorder();
  const unconditional = async () => { await run("rstest", ["run", "--onlyFailures"]); };
  await unconditional();
  assert.equal(asksOnlyFailures(seen), true, "the detector did not fire on a step that runs --onlyFailures unconditionally");
  assert.equal(asksOnlyFailures(["rstest run --changed=origin/main"]), false, "the detector fires on a run that did not ask for it");
});

// 2. AFTER A RECORD WHOSE RUN FAILED TWO FILES: THOSE TWO ALONE, THEN THE AFFECTED SET.
test("after a red record, ts starts the two failed files alone and then the affected set", async () => {
  const { seen, run } = recorder();
  const plan = planOf(red(TWO_FAILED, OTHER_FAILED));
  assert.equal(await runTs({ base: "origin/main" }, run, reaches, () => plan), "pass");
  const [first, affected, ...rest] = rstestRuns(seen);
  assert.deepEqual(rest, [], "more than two rstest runs started");
  assert.ok(first && affected, "the first leg or the affected run did not start: the positive control for the green case below");
  assert.match(first, / --include packages\/lab\/src\/packaging\/a\.test\.ts --include packages\/guards\/src\/b\.test\.ts$/);
  assert.ok(!first.includes("--changed") && !first.includes(AFFECTED_INCLUDE), "the first leg is not the two files alone");
  assert.ok(ranAffected(affected) && affected.includes(`--include ${AFFECTED_INCLUDE} `), "the second run is not the affected set");
  assert.equal(asksOnlyFailures(seen), false);
});

test("the first leg is the first thing ts starts, before docs:coverage, lint and typecheck: it is for seconds to the red", async () => {
  const { seen, run } = recorder();
  await runTs({ base: "origin/main" }, run, reaches, () => planOf(red(TWO_FAILED)));
  assert.match(seen[0] ?? "", / rstest run .*--include packages\/lab\/src\/packaging\/a\.test\.ts$/);
  assert.match(seen[1] ?? "", /docs:coverage/);
});

// 3. AFTER A GREEN OR ABSENT RECORD: THE AFFECTED SET ALONE, AND NEVER --onlyFailures (rstest would run everything).
test("after a green record, an absent one or a red one naming no file, ts starts the affected set alone", async () => {
  // The third case is the one that pins WHICH field decides: a run-level `pass` over a file entry that says `fail` is a green run, so the
  // run's own `status` and not the per-file entries is what "the last run's record says it failed" reads.
  const contradictory = { status: "pass", files: [{ testPath: TWO_FAILED, status: "fail" }] };
  for (const [what, plan] of [["green", planOf(green())], ["absent", planOf(null)], ["red but naming no file", planOf({ status: "fail", files: [] })],
    ["green over a file entry that says fail", planOf(contradictory)]] as const) {
    const { seen, run } = recorder();
    assert.equal(await runTs({ base: "origin/main" }, run, reaches, () => plan), "pass", what);
    const runs = rstestRuns(seen);
    assert.equal(runs.length, 1, `${what}: a first leg started`);
    assert.ok(ranAffected(runs[0] ?? ""), `${what}: the one run is not the affected set`);
    assert.equal(asksOnlyFailures(seen), false, `${what}: --onlyFailures ran with nothing recorded`);
  }
});

// 4. A FAILED FILE THAT NO LONGER EXISTS IS DROPPED, AND SAID ALOUD.
test("a failed file that was deleted, or no longer matches the include, is dropped and named; a plan with none left starts no first leg", async () => {
  const gone = "packages/lab/src/packaging/deleted.test.ts";
  const moved = "scripts/not-an-include.test.ts";
  const plan = planOf(red(TWO_FAILED, gone, moved), { exists: (file) => file !== gone, inInclude: (file) => file !== moved });
  assert.deepEqual(plan.files, [TWO_FAILED]);
  assert.deepEqual(plan.dropped.map(({ file }) => file), [gone, moved]);

  const said: string[] = [];
  const log = console.log;
  console.log = (line: string) => { said.push(String(line)); };
  try {
    const { seen, run } = recorder();
    await runFailuresFirst(plan, run);
    assert.equal(rstestRuns(seen).length, 1, "the positive control: one file is left, so a first leg starts");
    assert.ok(said.some((line) => line.includes(gone) && line.includes("no longer exists")), `the deleted file was not said aloud: ${said.join(" | ")}`);
    assert.ok(said.some((line) => line.includes(moved) && line.includes("no longer matches")));
    assert.ok(!(rstestRuns(seen)[0] ?? "").includes("deleted.test.ts"), "the deleted file was handed to rstest");

    said.length = 0;
    const alone = recorder();
    const nothingLeft = planOf(red(gone), { exists: () => false });
    assert.deepEqual(await runFailuresFirst(nothingLeft, alone.run), { status: 0 });
    assert.deepEqual(alone.seen, [], "a plan with every file dropped started a run, which would be `run everything`");
    assert.ok(said.some((line) => line.includes(gone)));
  } finally {
    console.log = log;
  }
});

// 5. THE FIRST LEG'S RESULT DOES NOT STAND IN FOR THE AFFECTED RUN, AND THE STAMP IS READ ON ITS OWN FIELDS.
const stampWith = (tsStatus: string) => ({ head: "h", dirty: false, bodyHash: bodyHash(null), steps: { ts: { status: tsStatus, ms: 1 } }, wallMs: 1 });
const stampIsGreen = (tsStatus: string) => stampVerdict({ stamp: stampWith(tsStatus), head: "h", body: null, steps: [{ id: "ts", runsWhen: "ts" }] }).green;

test("a first leg that passes does not make the stamp: ts is the affected run's result, read on the stamp's own fields", async () => {
  assert.equal(stampIsGreen("pass"), true, "the positive control: a passing ts is a green stamp");
  const base = { base: "origin/main" };
  const plan = () => planOf(red(TWO_FAILED));

  const affectedRed = recorder({ first: 0, affected: 1 });
  const redStatus = await runTs(base, affectedRed.run, reaches, plan);
  assert.equal(rstestRuns(affectedRed.seen).length, 2, "the affected run did not follow a passing first leg");
  assert.equal(redStatus, "fail");
  assert.equal(stampIsGreen(redStatus), false, "a passing first leg and a red affected run made a green stamp");

  const noSummary = await runTs(base, recorder({ first: 0, affected: 0 }).run, () => null, plan);
  assert.equal(stampIsGreen(noSummary), false, "a passing first leg and an affected run with no record made a green stamp");

  const affectedGreen = await runTs(base, recorder({ first: 0, affected: 0 }).run, reaches, plan);
  assert.equal(stampIsGreen(affectedGreen), true, "the affected run passing did not make the stamp");
});

test("a first leg that still fails ends the step at once, and the affected set is not started", async () => {
  const { seen, run } = recorder({ first: 1 });
  assert.equal(await runTs({ base: "origin/main" }, run, reaches, () => planOf(red(TWO_FAILED))), "fail");
  assert.equal(rstestRuns(seen).length, 1);
  assert.ok(!ranAffected(rstestRuns(seen)[0] ?? ""));
  const crashed = recorder({ first: null });
  assert.equal(await runTs({ base: "origin/main" }, crashed.run, reaches, () => planOf(red(TWO_FAILED))), "fail", "a first leg that did not start counts as green");
});

// 6. THE READER: THE NEWEST RECORD OF THIS WORKTREE, AND THE REAL FORMAT.
const nameAt = (worktree: string, stamp: string, pid = 7) => `${worktree}-2026-10-05T${stamp}Z-${pid}.json`;

test("the newest record of this worktree is the one read, and a worktree whose name extends this one's is not mistaken for it", () => {
  const dir = mkdtempSync(join(tmpdir(), "failures-first-"));
  try {
    const put = (name: string, record: Record) => writeFileSync(join(dir, name), JSON.stringify(record));
    put(nameAt("wt-1865", "10-00-00-000"), red(TWO_FAILED));
    put(nameAt("wt-1865", "11-00-00-000"), green());
    put(nameAt("wt-1865-c", "12-00-00-000"), red(OTHER_FAILED));
    put(nameAt("wt-9999", "13-00-00-000"), red(OTHER_FAILED));
    const mine = newestRunRecord({ dir, worktree: "wt-1865" });
    assert.equal(mine?.name, nameAt("wt-1865", "11-00-00-000"), "not the newest record of the worktree");
    assert.equal(mine?.record.status, "pass", "a later green record did not outrank an earlier red one");
    assert.equal(newestRunRecord({ dir, worktree: "wt-1865-c" })?.record.status, "fail");
    assert.equal(newestRunRecord({ dir, worktree: "wt-none" }), null);
    assert.equal(newestRunRecord({ dir: join(dir, "absent"), worktree: "wt-1865" }), null);

    writeFileSync(join(dir, nameAt("wt-1865", "14-00-00-000")), "{ not json");
    const err = console.error;
    const said: string[] = [];
    console.error = (line: string) => { said.push(String(line)); };
    try {
      assert.equal(newestRunRecord({ dir, worktree: "wt-1865" }), null, "an unreadable record was read as something");
    } finally {
      console.error = err;
    }
    assert.ok(said.some((line) => line.includes("not JSON")), "an unreadable record was not said aloud");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the directory and the name verify reads are the ones the toolchain's rstest config writes", () => {
  // The record path is made by the package (#3578); `scripts/rstest/rstest.config.mjs` is a thin call into it.
  const config = readFileSync(join(ROOT, "packages/toolchain/src/rstest-config.mjs"), "utf8");
  assert.ok(config.includes('join(root, "node_modules", ".cache", "rstest-run-records")'), "the toolchain config moved the record directory");
  assert.ok(config.includes("`${worktree}-${now.toISOString().replaceAll(/[:.]/g, \"-\")}-${pid}.json`"), "the toolchain config changed the record's name");
  assert.equal(runRecordDir({}), join(ROOT, "node_modules", ".cache", "rstest-run-records"));
  assert.equal(runRecordDir({ A11Y_RSTEST_RECORD_DIR: "/x" }), "/x");
});

test("the record rstest really writes for a red run is the one the reader and the plan turn into a first leg", () => {
  const dir = mkdtempSync(join(tmpdir(), "failures-first-real-"));
  try {
    const file = join(dir, "always-fails.test.ts");
    writeFileSync(file, 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("deliberately false", () => { assert.equal(1, 2); });\n');
    const records = join(dir, "records");
    mkdirSync(records);
    // rstest's own entry point, not `pnpm exec`: this file then needs neither the pnpm helper nor the git sandbox (two layer edges fewer).
    const rstest = join(ROOT, "node_modules", "@rstest", "core", "bin", "rstest.js");
    const args = [rstest, "run", "--config", "scripts/rstest/rstest.config.mjs", "--include", file];
    // Started from inside an rstest worker, whose variable would keep the child's config from recording at all.
    const env = { ...process.env, A11Y_RSTEST_RECORD_DIR: records } as NodeJS.ProcessEnv;
    delete env.RSTEST_WORKER_ID;
    assert.throws(() => execFileSync(process.execPath, args, { cwd: ROOT, env, stdio: "pipe" }), "a failing fixture exited 0, so the control is not red");
    const last = newestRunRecord({ dir: records, worktree: WORKTREE });
    assert.equal(last?.record.status, "fail", "the reader found no red record where rstest wrote one");
    const plan = failuresFirstPlan({ last, exists: () => true, inInclude: () => true });
    assert.equal(plan.files.length, 1);
    assert.ok(plan.files[0]?.endsWith("always-fails.test.ts"), String(plan.files[0]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
