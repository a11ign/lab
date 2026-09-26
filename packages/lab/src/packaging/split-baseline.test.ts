// no-token: percentile -- #2610. Importing split-baseline.mjs reaches its `gh` seam, which only the CLI entry calls; this file calls the pure readings, and it passes with `gh` off PATH and every token variable unset.
/**
 * #2610, child 0 of #69: `scripts/split-baseline.mjs`, the instrument that reads what the package split is
 * claimed to buy BEFORE anything moves, and can be run again AFTER.
 *
 * A baseline is only worth its instrument, so every reading here is pinned to a HAND COUNT over a fixture whose
 * answer is written in this file as a literal -- never derived from the function under test.
 *
 * THE POSITIVE CONTROLS ARE IN THIS FILE, by name, because `assert.deepEqual(x, [])` passes over an empty
 * population (`.claude/rules/guards-and-assertions.md`):
 *   - the selection fixture is asserted to hold 3 test files and 3 rows, so a fixture that stopped matching
 *     the selector's discovery fails as "0 rows" and not as a green "0 == 0";
 *   - the context fixture is asserted to hold transcripts in EVERY bucket, and the out-of-window fixture is
 *     asserted to hold a real, parseable call, so its N = 0 is the WINDOW's doing and not a parse that found nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  percentile, spread, layerSourceFiles, runSelectionFixture, materialise, expandTestGlob, windowOf, perRowNumber, groupOf,
  regionPaths, attribute, rowsNeeded, contextReading, renderContext, whollyInLayer, tsTimings, outsideTally, guardsByPackage, guardPopulation,
  selectionSummary, selfCheckFailures, CONTEXT_FIXTURE, OUT_OF_WINDOW_FIXTURE, SELECTION_FIXTURE, LAYER_PACKAGES,
  DEFAULT_DAYS,
} from "../../../../scripts/split-baseline.mjs";

const SCRIPT = fileURLToPath(new URL("../../../../scripts/split-baseline.mjs", import.meta.url));

function contextFixtureReading() {
  const attributed = attribute(CONTEXT_FIXTURE.transcripts, CONTEXT_FIXTURE.window);
  return { attributed, reading: contextReading(attributed, CONTEXT_FIXTURE.regions) };
}

// ------------------------------------------------------------------ selection

test("selection: the counts over the fixture tree are the hand count -- selected, always-run, total, fallback", () => {
  const { rows } = runSelectionFixture();
  const byFile = Object.fromEntries(rows.map((r) => [r.file, r]));
  // POSITIVE CONTROL: three source files were asked about and three answered, over a tree of 3 test files.
  assert.equal(rows.length, 3, "the fixture must yield one row per source file");
  assert.ok(rows.every((r) => r.of === 3), "the selector's own population of test files in the fixture is 3");

  // core.mjs: core.test.ts imports it; the ONE tree-walking guard (tree-walk.test.ts) always runs; other.test.ts is neither.
  const core = byFile["packages/layer-a/src/core.mjs"];
  assert.deepEqual([core.selected, core.alwaysRun, core.total, core.onlyViaFallback, core.fallbackPackages.length], [1, 1, 2, 0, 0]);
  // helper.mjs is reached by the same test THROUGH core.mjs -- two hops, counted once.
  const helper = byFile["packages/layer-a/src/helper.mjs"];
  assert.deepEqual([helper.selected, helper.alwaysRun, helper.total, helper.onlyViaFallback], [1, 1, 2, 0]);
  // lonely.mjs: nothing imports it, so the selector selects NOTHING and falls back to the whole package -- which is
  // one more test file. selected = 0 must not read as "cheapest change": total is 2, one of them only via fallback.
  const lonely = byFile["packages/layer-a/src/lonely.mjs"];
  assert.deepEqual([lonely.selected, lonely.alwaysRun, lonely.total, lonely.onlyViaFallback, lonely.fallbackPackages], [0, 1, 2, 1, ["layer-a"]]);
});

test("selection: the shipped fixture's own expectations are these same hand counts (the two cannot drift apart silently)", () => {
  assert.deepEqual(SELECTION_FIXTURE.expected["packages/layer-a/src/lonely.mjs"],
    { selected: 0, alwaysRun: 1, total: 2, of: 3, viaFallback: 1, fallback: 1 });
  assert.deepEqual(SELECTION_FIXTURE.expected["packages/layer-a/src/core.mjs"],
    { selected: 1, alwaysRun: 1, total: 2, of: 3, viaFallback: 0, fallback: 0 });
});

test("selection summary: min / median / max per package, and a package with no files reads n/a, never 0", () => {
  const { rows } = runSelectionFixture();
  const [layerA, ghost] = selectionSummary(rows, ["layer-a", "no-such-package"]);
  assert.equal(layerA.files, 3);
  assert.deepEqual(layerA.selected, { median: 1, p90: 1, min: 0, max: 1 });
  assert.deepEqual(layerA.total, { median: 2, p90: 2, min: 2, max: 2 });
  assert.equal(layerA.fallbackFiles, 1);
  assert.equal(ghost.files, 0);
  assert.equal(ghost.selected, null, "an empty package must not report a median of 0");
});

test("layerSourceFiles: modules and Python are source, tests and prose are not, and the exclusion is a NUMBER", () => {
  const tracked = [
    "packages/nvda-worker/src/server.mjs", "packages/nvda-worker/src/server.test.ts", "packages/nvda-worker/README.md",
    "packages/nvda-speech/nvda_speech/labels.py", "packages/nvda-speech/tests/test_symbols.py", "packages/nvda-speech/package.json",
    "packages/lab/src/other.mjs",
  ];
  const { files, excluded } = layerSourceFiles(tracked);
  assert.deepEqual(files, ["packages/nvda-speech/nvda_speech/labels.py", "packages/nvda-worker/src/server.mjs"]);
  assert.equal(excluded, 4, "server.test.ts, README.md, test_symbols.py and package.json; the lab file is not in the layer at all");
});

test("expandTestGlob: the selector's fallback glob is expanded, and a shape it does not know is REFUSED, not guessed", () => {
  const every = ["packages/a/src/x.test.ts", "packages/a/src/deep/y.test.ts", "packages/b/src/z.test.ts"];
  assert.deepEqual(expandTestGlob("packages/a/src/**/*.test.ts", every), ["packages/a/src/x.test.ts", "packages/a/src/deep/y.test.ts"]);
  assert.throws(() => expandTestGlob("packages/a/src/*.test.ts", every), /does not know how to count it/);
});

// ------------------------------------------------------------------ arithmetic

test("percentile: nearest rank, an observed value; an empty population is null and never 0", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([700, 400, 600, 500], 0.5), 500, "rank ceil(0.5*4) = 2 of the sorted values");
  assert.equal(percentile([700, 400, 600, 500], 0.9), 700, "rank ceil(0.9*4) = 4");
  assert.equal(percentile([3000, 1110, 2020], 0.5), 2020);
  assert.equal(spread([]), null);
  assert.deepEqual(spread([5]), { median: 5, p90: 5, min: 5, max: 5 });
});

test("windowOf: 14 days ending 2026-09-26 begins 2026-09-13, and a malformed window is refused", () => {
  assert.deepEqual(windowOf("2026-09-26", DEFAULT_DAYS), { since: "2026-09-13", until: "2026-09-26", days: 14 });
  assert.equal(windowOf("2026-03-01", 2).since, "2026-02-28");
  assert.throws(() => windowOf("yesterday", 14), /not a date/);
  assert.throws(() => windowOf("2026-09-26", 0), /positive whole number/);
});

// ------------------------------------------------------------------ context per call

test("context: tokens per call are the hand count, with cache read, fresh and cache write kept APART", () => {
  const { reading } = contextFixtureReading();
  // layer = row 501's TWO transcripts (a restart is the same session): calls 1110 (10+1000+100), 2020 (20+2000+0),
  // 3000 (0+2000+1000). The duplicated a1 line and the call dated 2026-08-01 are NOT calls in the window.
  assert.equal(reading.layer.sessions, 1);
  assert.equal(reading.layer.transcripts, 2);
  assert.equal(reading.layer.calls, 3, "a repeated message id is one call; a call outside the window is none");
  assert.equal(reading.layer.total?.median, 2020);
  assert.equal(reading.layer.total?.p90, 3000);
  assert.equal(reading.layer.cacheRead?.median, 2000, "cache read [1000, 2000, 2000]");
  assert.equal(reading.layer.fresh?.median, 10, "fresh [0, 10, 20] -- nowhere near the total");
  assert.equal(reading.layer.cacheWrite?.median, 100, "cache write [0, 100, 1000]");
  assert.notEqual(reading.layer.total?.median, reading.layer.fresh?.median);
  // rest = row 502: 400, 500, 600, 700.
  assert.equal(reading.rest.calls, 4);
  assert.equal(reading.rest.total?.median, 500);
  assert.equal(reading.rest.total?.p90, 700);
  assert.deepEqual(reading.rest.models, { m2: 4 });
});

test("context: a transcript naming no worker-<n> session is UNATTRIBUTED and in neither group; nothing is guessed", () => {
  const { attributed, reading } = contextFixtureReading();
  // POSITIVE CONTROL: every bucket of the fixture is populated, so an empty bucket below is a finding.
  for (const bucket of ["layer", "rest", "mixed", "unattributed", "notPerRow", "noRegion"] as const) {
    assert.ok(reading[bucket].calls > 0, `fixture bucket ${bucket} must not be empty`);
  }
  assert.equal(reading.unattributed.transcripts, 1);
  assert.equal(reading.unattributed.sessions, 0, "no session to count");
  // The unattributed call (1+1+1 tokens) is in no group's numbers: layer and rest calls are exactly the hand counts above.
  assert.equal(reading.layer.calls + reading.rest.calls + reading.mixed.calls + reading.noRegion.calls + reading.notPerRow.calls
    + reading.unattributed.calls, 3 + 4 + 1 + 1 + 1 + 1);
  assert.equal(attributed.filter((a) => a.session === null).length, 1);
});

test("context: a STANDING seat is not joined to the row its NUMBER happens to name (worker-5 is not row #5)", () => {
  assert.equal(perRowNumber("worker-5", "-home-agent-repos-wt-2391"), null, "a seat that claimed row 2391 is still worker-5");
  assert.equal(perRowNumber("worker-5", "-home-agent-repos-a11y-witness"), null);
  assert.equal(perRowNumber("worker-2391", "-home-agent-repos-wt-2391"), 2391);
  assert.equal(perRowNumber("worker-2391", "-home-agent-repos-wt-2392"), null, "name and worktree must AGREE");
  assert.equal(perRowNumber("worker-09", "-home-agent-repos-wt-09"), null, "a non-canonical number is not a member");
  assert.equal(perRowNumber("reviewer-2391", "-home-agent-repos-wt-2391"), null);
  assert.equal(perRowNumber(null, "-home-agent-repos-wt-2391"), null);
  const { reading, attributed } = contextFixtureReading();
  assert.equal(reading.notPerRow.sessions, 1, "the fixture's worker-5 in the primary checkout");
  assert.deepEqual(rowsNeeded(attributed), [501, 502, 503, 505], "row 5 is never fetched, and 506 has no call in the window");
});

test("context: an EMPTY window is N = 0 and REFUSES to print a median -- it is not a small number", () => {
  const { transcripts, window, regions } = OUT_OF_WINDOW_FIXTURE;
  // POSITIVE CONTROL: the transcript is real and its call parses; only the window excludes it.
  const wide = attribute(transcripts, { since: "2000-01-01", until: "2100-01-01" });
  assert.equal(wide[0].calls.length, 1, "the fixture's one call is a real, parseable call");
  assert.equal(wide[0].row, 501);

  const reading = contextReading(attribute(transcripts, window), regions);
  assert.equal(reading.layer.sessions, 0);
  assert.equal(reading.layer.calls, 0);
  assert.equal(reading.layer.total, null, "no distribution over no calls");
  const printed = renderContext(reading);
  assert.match(printed, /\| layer \| 0 \| 0 \| 0 \| NO MEDIAN \(N = 0\)/);
  assert.doesNotMatch(printed.split("\n").find((l) => l.startsWith("| layer"))!, /\| 0 \| 0 \| 0 \| 0 \|/, "never a zero median");
});

test("context: the harness's <synthetic> messages are not model calls (usage all zero, they would drag a median to 0)", () => {
  const line = (id: string, model: string, read: number) => JSON.stringify({
    timestamp: "2026-09-20T10:00:00Z",
    message: { id, model, usage: { input_tokens: 0, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: 0 } },
  });
  const text = ["You are `worker-7`", line("s1", "<synthetic>", 0), line("s2", "<synthetic>", 0), line("r1", "real", 900)].join("\n");
  const [only] = attribute([{ dir: "-home-agent-repos-wt-7", text }], { since: "2026-09-13", until: "2026-09-26" });
  assert.equal(only.calls.length, 1);
  assert.equal(only.calls[0].cacheRead, 900);
});

test("groupOf and regionPaths: layer means EVERY path is under a layer package, mixed means some, no paths is noRegion", () => {
  assert.equal(groupOf(["packages/nvda-worker/src/a.mjs", "packages/nvda-speech/x.py"]), "layer");
  assert.equal(groupOf(["packages/nvda-worker/src/a.mjs", "scripts/x.mjs"]), "mixed");
  assert.equal(groupOf(["scripts/x.mjs"]), "rest");
  assert.equal(groupOf([]), "noRegion");
  assert.equal(groupOf(null), "noRegion", "an unreadable row is not a row outside the layer");
  const body = "## What\n\nprose about packages/nvda-worker/src/prose.mjs\n\n## Region\n\n```\nscripts/split-baseline.mjs\ndocs/split-baseline.md\n```\n\n## Done\n";
  assert.deepEqual(regionPaths(body), ["scripts/split-baseline.mjs", "docs/split-baseline.md"], "only the Region section, never the prose");
  assert.deepEqual(regionPaths("no region here"), []);
  assert.deepEqual([...LAYER_PACKAGES], ["nvda-worker", "nvda-speech"]);
});

// ------------------------------------------------------------------ the CI reading

test("whollyInLayer: an empty diff is not wholly anything, and one outside file disqualifies", () => {
  assert.equal(whollyInLayer([]), false);
  assert.equal(whollyInLayer(["packages/nvda-worker/src/a.mjs", "packages/nvda-speech/x.py"]), true);
  assert.equal(whollyInLayer(["packages/nvda-worker/src/a.mjs", ".changeset/x.md"]), false);
});

test("guardsByPackage: counts guards per package, most first, ties by name, and a path outside packages/ is named, not dropped", () => {
  const guards = [{ test: "packages/lab/src/a.test.ts" }, { test: "packages/lab/src/b.test.ts" }, { test: "packages/guards/src/c.test.ts" }, { test: "scripts/d.test.ts" }];
  assert.deepEqual(guardsByPackage(guards), [["lab", 2], ["(outside packages)", 1], ["guards", 1]]);
  assert.deepEqual(guardsByPackage([]), []);
});

test("guardPopulation over the fixture: one guard of three test files, none declaring a scope, all of it in guards-fx", () => {
  const root = materialise(SELECTION_FIXTURE.files);
  try {
    assert.deepEqual(guardPopulation({ repoRoot: root, allPackages: ["layer-a", "guards-fx"] }),
      { tests: 3, guards: 1, declaringScope: 0, byPackage: [["guards-fx", 1]] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("outsideTally: counts PRs (not files) per location outside the layer, most common first, ties by name", () => {
  const prs = [
    ["packages/nvda-worker/src/a.mjs", ".changeset/x.md", ".changeset/y.md"],
    ["packages/nvda-worker/src/b.mjs", ".changeset/z.md", "packages/lab/src/t.ts", "docs/known-gaps.md"],
    ["packages/nvda-speech/x.py"],
  ];
  assert.deepEqual(outsideTally(prs), [[".changeset", 2], ["docs", 1], ["packages/lab", 1]], ".changeset counted once per PR though PR 1 has two files");
  assert.deepEqual(outsideTally([]), []);
});

test("tsTimings: the job GitHub names `ts / run` is found, with its test step; running, skipped or absent is null, never 0", () => {
  const step = { name: "Unit tests of the changed test files (transitively), with a per-package fallback", status: "completed", conclusion: "success",
    started_at: "2026-09-20T10:01:00Z", completed_at: "2026-09-20T10:02:05Z" };
  const done = { name: "ts / run", status: "completed", conclusion: "success", started_at: "2026-09-20T10:00:00Z",
    completed_at: "2026-09-20T10:02:50Z", steps: [{ name: "Run npm run lint", status: "completed", conclusion: "success", started_at: "2026-09-20T10:00:10Z", completed_at: "2026-09-20T10:00:22Z" }, step] };
  // 170 s job, 65 s of it the test step. The reusable-workflow name is the whole point: `ts` alone matched nothing on any PR.
  assert.deepEqual(tsTimings([{ name: "python", status: "completed", conclusion: "success" }, done]), { job: 170, tests: 65 });
  assert.deepEqual(tsTimings([{ ...done, name: "ts" }]), { job: 170, tests: 65 }, "a plain `ts` job is the same job");
  assert.deepEqual(tsTimings([{ ...done, steps: [] }]), { job: 170, tests: null }, "no test step is null, not 0");
  assert.equal(tsTimings([{ ...done, name: "tsx / run" }]), null, "a job merely starting with ts is not the ts job");
  assert.equal(tsTimings([{ ...done, status: "in_progress", completed_at: null }]), null);
  assert.equal(tsTimings([{ ...done, conclusion: "skipped" }]), null);
  assert.equal(tsTimings([{ ...done, conclusion: "cancelled", completed_at: "2026-09-20T10:00:03Z" }]), null, "a cancelled job's 3 s is not the job's duration");
  assert.equal(tsTimings([{ ...done, conclusion: "failure" }]), null, "nor is a red run's");
  assert.equal(tsTimings([{ name: "python" }]), null);
  assert.equal(tsTimings([]), null);
});

// ------------------------------------------------------------------ --self-check

test("--self-check passes in-process and as the acceptance command runs it (no network, no transcripts)", () => {
  assert.deepEqual(selfCheckFailures(), []);
  const out = execFileSync("node", [SCRIPT, "--self-check"], { encoding: "utf8", env: { ...process.env, HOME: "/nonexistent-home" } });
  assert.match(out, /self-check: PASS/);
});
