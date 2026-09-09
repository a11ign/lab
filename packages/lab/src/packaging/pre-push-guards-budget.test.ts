/**
 * #704: the pre-push hook runs #716's 21 tree-wide guards (`npm run guards:sweep`) on every push, no
 * exclusion list, and reports the guards' own CPU (`user`+`sys`) as a RATIO against the gate's (lint +
 * typecheck + mjs parse check), in the SAME run. ceo's ruling, 2026-09-09: wall clock on a shared host
 * measures the OTHER sessions running on it, not this hook's work -- three runs of the identical 21-guard
 * sweep with no code change between them read 28.0s, 45.1s and 44.2s wall, while their CPU clustered
 * 23.89-25.41s. So the anchor is CPU, and it is a ratio, never a fixed number -- a slower host makes both
 * sides slower together.
 *
 * GRADUATED, NOT A BARE "REFUSE AT 2x" -- revised the SAME day this row's first version shipped, after its
 * own real end-to-end run refused a push at 2.06x an hour after three quiet measurements averaged 1.77x,
 * with no code change between them. Four observed ratios on one host: ~1.72x, ~1.74x, ~1.84x, 2.06x -- the
 * ratio of two independently noisy CPU measurements crosses a bare 2x line on host contention ALONE, and a
 * hook that refuses pushes on noise is the #706 lesson (nine `A11Y_SKIP_VERIFY=1` pushes in one evening, on
 * a wrong belief about cost) arriving through the very guard built to stop that pattern. So: under 2x is
 * silent; [2x, 3x) WARNS, naming the 2x design target, and does not fail the push; 3x or more REFUSES -- a
 * threshold none of the four observed ratios came near, and a real regression cannot miss.
 *
 * DRIVES THE REAL BLOCK, never re-typed, the same discipline `pre-push-fast-gate.test.ts`'s `run()`
 * extraction and `changesetBlock()` already use. The real CPU-measurement mechanism (`times`, redirected
 * to a file -- piping or command-substituting it forks bash into a subshell whose OWN children read as
 * near-zero, measured directly while building this, the same writer's-status shape as #712) is inherently
 * about REAL child-process CPU and cannot be driven deterministically in a unit test, so
 * `snapshot_children_cpu` and `now_ms` are overridden here with fakes that report CONTROLLED values --
 * proving the ARITHMETIC and the WARN/REFUSE thresholds, which is the part a test can make deterministic,
 * while the real timing mechanism is proven by hand in this row's own commit (a real 21-guard sweep
 * against a real gate, on this host, printed the real numbers).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const HOOK = readFileSync(`${REPO}scripts/git-hooks/pre-push`, "utf8");

function extractedBlock(): string {
  const start = HOOK.indexOf("# BEGIN #704 GUARDS-BUDGET TIMING");
  const end = HOOK.indexOf("# END #704 GUARDS-BUDGET TIMING");
  assert.ok(start > 0 && end > start, "could not locate the #704 guards-budget block in the real hook");
  return HOOK.slice(start, end + "# END #704 GUARDS-BUDGET TIMING".length);
}

test("the extraction found the real block, not an empty string", () => {
  const block = extractedBlock();
  assert.match(block, /run_gate_with_guards_budget\(\)/);
  assert.match(block, /A11Y_GUARDS_BUDGET_REASON/);
});

/**
 * `gateSeconds`/`guardsSeconds` become the DELTA `children_cpu_seconds` will read for each phase --
 * `snapshot_children_cpu`/`now_ms` are redefined AFTER sourcing the real block (a later bash function
 * definition wins), so the real arithmetic and threshold logic run unmodified against controlled inputs.
 * `run()` is faked too, to a bare `echo "  ok      $1"` -- this test is about the RATIO, never about
 * whether a real `npm run lint` passes, which `pre-push-fast-gate.test.ts`'s own `run()` test already
 * covers against the genuine function.
 */
function driveBudget(gateSeconds: number, guardsSeconds: number, extraEnv: Record<string, string> = {}): string {
  // `children_cpu_seconds` is invoked via `$(...)` (command substitution) at every real call site, which
  // forks bash into a SUBSHELL -- a plain shell-variable counter increments only inside that subshell and
  // is discarded when it exits, so every call would otherwise see the same starting value. A FILE-based
  // counter survives across the fork, the same reason the real `snapshot_children_cpu` writes to a file
  // rather than being read back through a pipe (see the real block's own header for that incident).
  // The real hook writes its REFUSING/WARNING/overridden lines to stderr (a bare `git push` still shows
  // them, but an unattended CI wrapper might not) -- merged onto stdout here so `execFileSync`'s single
  // captured stream sees both, in the order they were actually written.
  const script = `set -u\nexec 2>&1\n${extractedBlock()}\n`
    + `run() { echo "  ok      $1"; }\n`
    + `snapshot_children_cpu() { :; }\n`
    // First call (gate start) reports 0; second (gate end) reports gateSeconds; third (guards start)
    // reports gateSeconds again (children CPU is cumulative -- it never resets between phases); fourth
    // (guards end) reports gateSeconds+guardsSeconds.
    + `_cpu_call_counter="$(mktemp)"; echo 0 > "$_cpu_call_counter"\n`
    + `children_cpu_seconds() {\n`
    + `  local n; n=$(($(cat "$_cpu_call_counter") + 1)); echo "$n" > "$_cpu_call_counter"\n`
    + `  case $n in\n`
    + `    1) echo "0.000" ;;\n`
    + `    2) echo "${gateSeconds}" ;;\n`
    + `    3) echo "${gateSeconds}" ;;\n`
    + `    4) echo "${(gateSeconds + guardsSeconds).toFixed(3)}" ;;\n`
    + `  esac\n`
    + `}\n`
    + `now_ms() { echo 0; }\n`
    + `failed=()\n`
    + `run_gate_with_guards_budget "test-branch"\n`
    + `rm -f "$_cpu_call_counter"\n`
    + `printf 'FAILED=%s\\n' "\${failed[@]:-}"`;
  return execFileSync("bash", ["-c", script],
    { cwd: REPO, encoding: "utf8", env: { ...process.env, ...extraEnv } });
}

test("ACCEPTANCE: guards at 1.5x the gate's own CPU is quiet -- no warning, no refusal, nothing in failed", () => {
  const out = driveBudget(10, 15);
  assert.match(out, /wall 0\.0s, CPU 10\.000s \| guards.*wall 0\.0s, CPU 15\.000s \| ratio 1\.50x/);
  assert.doesNotMatch(out, /WARNING/);
  assert.doesNotMatch(out, /REFUSING/);
  assert.doesNotMatch(out, /FAILED=tree-wide guards budget/);
});

test("MUTATION TARGET: guards at just under 2x is still quiet -- the warn band starts AT 2x, not before", () => {
  const out = driveBudget(10, 19.9);
  assert.doesNotMatch(out, /WARNING/);
  assert.doesNotMatch(out, /REFUSING/);
});

test("ACCEPTANCE: guards at EXACTLY 2x the gate's own CPU WARNS but does not refuse -- ceo's ruling, "
  + "2026-09-09, after the row's own first real run refused at 2.06x on host noise alone", () => {
  const out = driveBudget(10, 20);
  assert.match(out, /WARNING -- the tree-wide guards cost 2\.00x the gate's own CPU/);
  assert.match(out, /design\ntarget: 2x, refusal at 3x/);
  assert.doesNotMatch(out, /REFUSING/);
  assert.doesNotMatch(out, /FAILED=tree-wide guards budget/);
});

test("ACCEPTANCE: the real measured ratios on this host (1.72x-2.06x, four runs, no code change) all stay "
  + "at or under the warn band, never reaching refuse -- the anchor this row shipped with is not a "
  + "hair-trigger on the numbers it was measured from", () => {
  for (const [gate, guards] of [[13.82, 25.41], [13.70, 23.89], [14.10, 24.19], [12.975, 26.675]]) {
    const out = driveBudget(gate, guards);
    assert.doesNotMatch(out, /REFUSING/, `gate=${gate} guards=${guards} must not refuse`);
  }
});

test("MUTATION TARGET: guards at just under 3x still only warns, never refuses", () => {
  const out = driveBudget(10, 29.9);
  assert.match(out, /WARNING/);
  assert.doesNotMatch(out, /REFUSING/);
  assert.doesNotMatch(out, /FAILED=tree-wide guards budget/);
});

test("ACCEPTANCE: guards at EXACTLY 3x the gate's own CPU REFUSES, naming both real numbers and the ratio", () => {
  const out = driveBudget(10, 30);
  assert.match(out, /REFUSING -- the tree-wide guards cost 30\.000s CPU \(user\+sys\) this run, 3\.00x/);
  assert.match(out, /the gate's own 10\.000s/);
  assert.match(out, /FAILED=tree-wide guards budget \(3\.00x the gate's own CPU, refusing at 3x\)/);
  assert.doesNotMatch(out, /WARNING/, "a refusal must not also print the warn-band message");
});

test("MUTATION: A11Y_GUARDS_BUDGET_REASON overrides a refusal at 3x+, prints the reason, and does NOT add "
  + "to failed -- the same override shape every other check in this hook already has", () => {
  const out = driveBudget(10, 35, { A11Y_GUARDS_BUDGET_REASON: "known slow guard, fix filed as its own row" });
  assert.match(out, /overridden: known slow guard, fix filed as its own row/);
  assert.doesNotMatch(out, /FAILED=tree-wide guards budget/);
});

test("MUTATION: without the override reason set, a run at 3x+ refuses -- the override cannot be inherited "
  + "silently from an unset/empty variable", () => {
  const out = driveBudget(10, 35, { A11Y_GUARDS_BUDGET_REASON: "" });
  assert.match(out, /FAILED=tree-wide guards budget/);
});

test("the header line prints wall, CPU AND the ratio for both the gate and the guards, every run -- a "
  + "measured range, never a fixed figure, per ceo's own instruction on #704", () => {
  const out = driveBudget(5, 10);
  assert.match(out,
    /pre-push: gate \(test-branch\) -- wall \d+\.\d+s, CPU 5\.000s \| guards \(#716, 21\) -- wall \d+\.\d+s, CPU 10\.000s \| ratio 2\.00x/);
});

test("guards:sweep is what the hook actually runs -- never a re-typed list of the 21 files, which would "
  + "drift from #716's own discovery the moment a guard is added or removed", () => {
  const block = extractedBlock();
  assert.match(block, /run "tree-wide guards \(21, #716\)" npm run --silent guards:sweep/);
});
