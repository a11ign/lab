/**
 * #1320, STEP 4 OF THE RSTEST ADOPTION (#1317): `npm run coverage` runs `@rstest/coverage-v8`, not c8, and
 * enforces the SAME threshold number c8 enforced -- `.c8rc.json`'s own `lines`/`statements`, read once by
 * `scripts/coverage.mjs`, never retyped here or there.
 *
 * POSITIVE CONTROL FOR THIS WHOLE FILE: every assertion below fails against the manifest this row started
 * from, where `"coverage": "c8 node packages/guards/src/assert-glob-not-empty.mjs …"` was the script and
 * nothing under `scripts/` ran rstest's coverage provider at all.
 *
 * MUTATION: put c8 back (literally, or by reverting `scripts/coverage.mjs` to spawn it) and `usesC8` below
 * -- exercised first against a real c8 invocation, so the predicate is shown to fire before it is trusted --
 * catches it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyCoverageFailure, KIND } from "../../../../scripts/coverage-failure-classifier.mjs";
import { coverageVerdict, takeProviderExitCode, thresholdMissLines } from "../../../../scripts/coverage.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPTS = (JSON.parse(readFileSync(`${REPO}package.json`, "utf8")) as { scripts: Record<string, string> }).scripts;
const COVERAGE_SOURCE = readFileSync(`${REPO}scripts/coverage.mjs`, "utf8");
const C8RC = JSON.parse(readFileSync(`${REPO}.c8rc.json`, "utf8")) as { lines: number; statements: number };

/** Whether a command line invokes c8 as a program, not merely mentions it in prose. */
const usesC8 = (command: string) => /(^|[\s/])c8(\s|$)/.test(command);

// --- the manifest: the coverage script runs rstest, never c8 -----------------------------------------------

test("#1320 ACCEPTANCE: the coverage npm script does not invoke c8", () => {
  assert.equal(usesC8(SCRIPTS.coverage), false, SCRIPTS.coverage);
});

test("MUTATION: usesC8 really detects a c8 invocation -- the positive control for the assertion above", () => {
  assert.equal(usesC8("c8 node packages/guards/src/assert-glob-not-empty.mjs \"x\" --min=300 --run"), true);
  // A word that merely CONTAINS "c8" (a path segment, a variable) must not false-positive.
  assert.equal(usesC8("node scripts/coverage.mjs"), false);
});

test("#1320: the coverage script is scripts/coverage.mjs, run directly with node", () => {
  assert.equal(SCRIPTS.coverage, "node scripts/coverage.mjs");
});

test("#1320: scripts/coverage.mjs itself imports @rstest/coverage-v8, and spawns no c8 command", () => {
  assert.match(COVERAGE_SOURCE, /from\s+["']@rstest\/coverage-v8["']/);
  const spawnedCommands = [...COVERAGE_SOURCE.matchAll(/step\(\[[^\]]*\]\)/g)].map((m) => m[0]);
  assert.ok(spawnedCommands.length > 0, "POSITIVE CONTROL: at least one spawned step was found to check");
  assert.ok(spawnedCommands.every((line) => !usesC8(line)), spawnedCommands.join("\n"));
});

// --- the threshold: re-derived on rstest's own units, read once from .c8rc.json ------------------------------

test("#1320: .c8rc.json enforces 73%/72% -- rstest's units, floor of achieved, same method as c8's old 78 and "
  + "#1350/F2's own re-derivation (70.94%/70.70% -> 70/70), which #1320 is the deferred switch for", () => {
  // A RATCHET, NOT AN ARBITRARY NUMBER: c8's 78 does not transfer (measured 4.4x fewer total statement units
  // under rstest for the same population, #1350/F2 measured 5.34x for lines alone) -- see .c8rc.json's own
  // comment for the full derivation. This still PINS the number so a future accidental change is caught.
  assert.equal(C8RC.lines, 73);
  assert.equal(C8RC.statements, 72);
});

test("#1320: thresholdMissLines reports nothing at or above .c8rc.json's threshold", () => {
  const atThreshold = { lines: { pct: C8RC.lines }, statements: { pct: C8RC.statements } };
  assert.deepEqual(thresholdMissLines(atThreshold as never, C8RC), []);
  const above = { lines: { pct: C8RC.lines + 1 }, statements: { pct: C8RC.statements + 1 } };
  assert.deepEqual(thresholdMissLines(above as never, C8RC), []);
});

test("#1320: thresholdMissLines names a metric under threshold, in c8's own error wording", () => {
  const totals = { lines: { pct: 71.2 }, statements: { pct: C8RC.statements } };
  assert.deepEqual(thresholdMissLines(totals as never, C8RC),
    [`ERROR: Coverage for lines (71.2%) does not meet threshold (${C8RC.lines}%)`]);
});

test("#1320: MUTATION -- a threshold quietly loosened past .c8rc.json's number would still be caught here", () => {
  // If someone edited scripts/coverage.mjs to compare against a lower number than .c8rc.json's, this call
  // (which uses .c8rc.json itself, exactly as the real script does) would still refuse just-under-threshold
  // figures -- the check lives in the number this file reads, not in a copy of it.
  const totals = { lines: { pct: C8RC.lines - 0.1 }, statements: { pct: C8RC.statements - 0.1 } };
  const misses = thresholdMissLines(totals as never, C8RC);
  assert.equal(misses.length, 2);
});

// --- the coupling: coverage-failure-classifier.mjs (#169) still reads this wording -------------------------

test("#1320: a real threshold miss from scripts/coverage.mjs is classified REGRESSION by #169's own classifier, "
  + "naming the same metric, actual and threshold -- the coupling `.c8rc.json`'s comment on scripts/coverage.mjs "
  + "warns about", () => {
  const totals = { lines: { pct: 71.2 }, statements: { pct: C8RC.statements } };
  const [line] = thresholdMissLines(totals as never, C8RC);
  const verdict = classifyCoverageFailure({ ciOutcome: "success", buildOutcome: "success", coverageLog: line });
  assert.equal(verdict.kind, KIND.REGRESSION, JSON.stringify(verdict));
  assert.deepEqual(verdict.thresholdMisses, [{ metric: "lines", actual: 71.2, threshold: C8RC.lines }]);
});

// --- #3865: scripts/coverage.mjs never exits non-zero without saying why -----------------------------------

const TOTALS_ABOVE = { lines: { pct: C8RC.lines + 1 }, statements: { pct: C8RC.statements + 1 } };
const TOTALS_BELOW = { lines: { pct: C8RC.lines - 1 }, statements: { pct: C8RC.statements - 1 } };

const verdictFor = (reading: Partial<Parameters<typeof coverageVerdict>[0]>) => coverageVerdict({
  mergedReport: true, mergeStatus: 0, providerExitCode: 0, totals: TOTALS_ABOVE as never, c8rc: C8RC, ...reading });

test("#3865: the release's silent exit 1 -- every file passed, and @rstest/coverage-v8 set process.exitCode = 1 for a child "
  + "entry it could not read -- is exit 0, and the provider's exit code is NAMED rather than inherited", () => {
  const verdict = verdictFor({ providerExitCode: 1 });
  assert.equal(verdict.code, 0);
  assert.match(verdict.stderr.join("\n"), /could not process coverage for some files.*set exit code 1/);
});

test("#3865: a child run that exits 1 with zero failed tests and a passing reading says the suite did not pass -- the "
  + "positive control: a non-zero exit this script DOES make carries its reason", () => {
  const verdict = verdictFor({ mergeStatus: 1 });
  assert.equal(verdict.code, 1);
  assert.match(verdict.stderr.join("\n"), /the suite did not pass/);
});

test("#3865: a threshold miss still exits 1 when the provider also complained, in c8's own wording", () => {
  const verdict = verdictFor({ providerExitCode: 1, totals: TOTALS_BELOW as never });
  assert.equal(verdict.code, 1);
  assert.equal(verdict.stderr.filter((line) => line.startsWith("ERROR: Coverage for ")).length, 2);
});

test("#3865: EVERY reading that exits non-zero has a stderr line saying why, and the enumeration reaches non-zero exits", () => {
  const readings = [true, false].flatMap((mergedReport) => [0, 1, 2, null].flatMap((mergeStatus) =>
    [0, 1].flatMap((providerExitCode) => [TOTALS_ABOVE, TOTALS_BELOW].map((totals) =>
      ({ mergedReport, mergeStatus, providerExitCode, totals: mergedReport ? totals as never : null })))));
  const failing = readings.map((reading) => ({ reading, verdict: verdictFor(reading) })).filter(({ verdict }) => verdict.code !== 0);
  // The positive control, counted a second way: a reading exits non-zero when it has no report, a child run that did not
  // pass, or totals under threshold -- never for the provider's exit code alone.
  const expected = readings.filter((reading) => !reading.mergedReport || reading.mergeStatus !== 0 || reading.totals === TOTALS_BELOW);
  assert.equal(failing.length, expected.length);
  assert.equal(expected.length, 30);
  assert.deepEqual(failing.filter(({ verdict }) => verdict.stderr.length === 0).map(({ reading }) => reading), []);
});

test("#3865: takeProviderExitCode returns what the provider left in process.exitCode and clears it, so the script's own "
  + "exit decides", () => {
  const before = process.exitCode;
  try {
    process.exitCode = 1;
    assert.equal(takeProviderExitCode(), 1);
    assert.equal(process.exitCode, undefined);
    assert.equal(takeProviderExitCode(), 0);
  } finally {
    process.exitCode = before;
  }
});

test("#3865: main() exits only through the verdict or after naming the vacuity floor's failure", () => {
  const lines = COVERAGE_SOURCE.split("\n");
  const exits = lines.flatMap((line, index) => (line.includes("process.exit(") && !line.trim().startsWith("*") ? [index] : []));
  assert.equal(exits.length, 2, "the floor's exit and the verdict's");
  const named = exits.filter((index) => lines[index - 1].includes("stderr.write(") || lines[index].includes("if (code !== 0) process.exit(code)"));
  assert.deepEqual(named, exits);
});
