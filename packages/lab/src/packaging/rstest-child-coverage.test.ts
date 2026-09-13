/**
 * #1350, rstest F2: coverage of a script a test runs as a CHILD `node` process, merged into rstest's own report.
 *
 * `@rstest/coverage-v8` collects through an inspector session inside each rstest worker, so a spawned child is never
 * seen and its script reads 0% (7 files on #1315). The merge takes the child's `NODE_V8_COVERAGE` output, converts it
 * with rstest's own provider, and merges it into files the report already lists. These tests drive that with a real
 * spawned child and a real `CoverageProvider`, over a fixture written to a temporary directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoverageProvider } from "@rstest/coverage-v8";
import {
  childCoverageEntries, coverageOptionsFromC8rc, coverageTotals, mergeChildCoverage, rstestCoverageArgs,
} from "../../../../scripts/rstest/merge-child-coverage.mjs";

const FIXTURE = [
  "export function reached(n) { return n > 0 ? 'positive' : 'not positive'; }",
  "export function neverCalled() { return 'unreachable from the child'; }",
  "if (process.argv[2] === 'run') process.stdout.write(reached(1));",
  "",
].join("\n");

/** A root holding the fixture, a raw-coverage directory, and rstest's own zero entry for the fixture. */
async function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "child-coverage-")));
  const script = join(root, "child.mjs");
  writeFileSync(script, FIXTURE);
  const rawDir = join(root, "raw");
  mkdirSync(rawDir);
  const options = coverageOptionsFromC8rc({ include: ["child.mjs"], exclude: [] }, join(root, "report"));
  // What rstest writes for an included file no test loaded: its OWN untested entry, every count 0.
  const [untested] = await new CoverageProvider(options as never, root)
    .generateCoverageForUntestedFiles({ environmentName: "node", files: [script] });
  return { root, script, rawDir, options, report: { [script]: untested } as Record<string, unknown> };
}

/** Spawn the fixture as a child, with or without `NODE_V8_COVERAGE`. */
function runChild(script: string, rawDir: string | null) {
  const env = { ...process.env };
  delete env.NODE_V8_COVERAGE;
  if (rawDir) env.NODE_V8_COVERAGE = rawDir;
  const run = spawnSync(process.execPath, [script, "run"], { encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "positive", "the child ran the fixture");
}

const coveredStatements = (data: { s: Record<string, number> }) => Object.values(data.s).filter((n) => n > 0).length;

test("#1350 ACCEPTANCE: a spawned child's lines appear in the merged report; without the merge they read 0", async () => {
  const w = await workspace();
  try {
    runChild(w.script, w.rawDir);
    const untested = w.report[w.script] as { s: Record<string, number>; fnMap: Record<string, { name: string }> };
    // THE CONTROL, and the defect: rstest's own entry for a file only a child ran reads 0.
    assert.equal(coveredStatements(untested), 0, "rstest alone sees nothing a child covered");

    const { merged, childFiles } = await mergeChildCoverage(
      { report: w.report, entries: childCoverageEntries(w.rawDir, w.root), options: w.options, root: w.root });
    assert.deepEqual(childFiles, [w.script], "the child's file gained coverage");
    const after = merged.fileCoverageFor(w.script).toJSON() as typeof untested & { f: Record<string, number> };
    assert.ok(coveredStatements(after) > 0, "after the merge the child's statements are covered");
    assert.equal(Object.keys(after.s).length, Object.keys(untested.s).length,
      "the SAME statements, counted by rstest's own converter -- c8's units would not match");
    const hits = Object.fromEntries(Object.entries(after.fnMap).map(([id, fn]) => [fn.name, after.f[id]]));
    assert.ok(hits.reached > 0, "the function the child called is covered");
    assert.equal(hits.neverCalled, 0, "and the one it never called is not -- the merge attributes, it does not paint");
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("#1350 CONTROL: a child run WITHOUT NODE_V8_COVERAGE leaves the file at 0 -- the merge invents nothing", async () => {
  const w = await workspace();
  try {
    runChild(w.script, null);
    const entries = childCoverageEntries(w.rawDir, w.root);
    assert.deepEqual(entries, [], "no raw coverage was written, so there is nothing to merge");
    const { merged, childFiles } = await mergeChildCoverage({ report: w.report, entries, options: w.options, root: w.root });
    assert.deepEqual(childFiles, []);
    assert.equal(coveredStatements(merged.fileCoverageFor(w.script).toJSON() as never), 0);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("#1350: a child that ran a file OUTSIDE the report's population adds nothing -- the threshold's population holds", async () => {
  const w = await workspace();
  try {
    const outside = join(w.root, "outside.mjs");
    writeFileSync(outside, FIXTURE);
    runChild(outside, w.rawDir);
    runChild(w.script, w.rawDir);
    const entries = childCoverageEntries(w.rawDir, w.root);
    assert.ok(entries.some((e) => e.filePath === outside), "the outside file WAS covered by a child -- the positive control");
    const { merged } = await mergeChildCoverage({ report: w.report, entries, options: w.options, root: w.root });
    assert.deepEqual(merged.files(), [w.script], "but only files the report already lists are in the merged report");
    assert.ok(coverageTotals(merged).statements.covered > 0);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("#1350: childCoverageEntries keeps repo scripts only -- no node: internals, nothing outside root, no query string", async () => {
  const w = await workspace();
  try {
    writeFileSync(join(w.rawDir, "coverage-1.json"), JSON.stringify({ result: [
      { url: "node:internal/main/run_main_module", functions: [] },
      { url: "file:///elsewhere/other.mjs", functions: [] },
      { url: `file://${w.root}/node_modules/dep/index.js`, functions: [] },
      { url: `file://${w.script}?fresh-import=1`, functions: [] },
    ] }));
    writeFileSync(join(w.rawDir, "not-coverage.txt"), "ignored");
    assert.deepEqual(childCoverageEntries(w.rawDir, w.root).map((e) => e.filePath), [w.script]);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("#1350: the population is `.c8rc.json`'s own, passed on rstest's command line, one flag per pattern", () => {
  const c8rc = JSON.parse(readFileSync(new URL("../../../../.c8rc.json", import.meta.url), "utf8"));
  const options = coverageOptionsFromC8rc(c8rc, "/tmp/report");
  assert.deepEqual(options.include, c8rc.include, "read, never retyped");
  assert.deepEqual(options.exclude, c8rc.exclude);
  const args = rstestCoverageArgs(options);
  assert.equal(args.filter((a) => a === "--coverage.include").length, c8rc.include.length);
  assert.equal(args.filter((a) => a === "--coverage.exclude").length, c8rc.exclude.length);
  assert.ok(args.includes("--coverage.reportOnFailure"), "a host-dependent test failure must not suppress the report");
  assert.deepEqual(args.slice(0, 3), ["--coverage", "--coverage.provider", "v8"]);
});
