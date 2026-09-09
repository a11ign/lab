/**
 * #704: the pre-push hook runs #716's 21 tree-wide guards (`npm run guards:sweep`) on every push, no
 * exclusion list, and asserts a BUDGET on each run -- the guards' own CPU (`user`+`sys`) may cost at most
 * DOUBLE what the gate (lint + typecheck + mjs parse check) already costs, in the SAME run. ceo's ruling,
 * 2026-09-09: wall clock on a shared host measures the OTHER sessions running on it, not this hook's work
 * -- three runs of the identical 21-guard sweep with no code change between them read 28.0s, 45.1s and
 * 44.2s wall, while their CPU clustered 23.89-25.41s. So the anchor is CPU, and it is a RATIO against the
 * SAME run's own gate cost, never a fixed number -- a slower host makes both sides slower together.
 *
 * DRIVES THE REAL BLOCK, never re-typed, the same discipline `pre-push-fast-gate.test.ts`'s `run()`
 * extraction and `changesetBlock()` already use. The real CPU-measurement mechanism (`times`, redirected
 * to a file -- piping or command-substituting it forks bash into a subshell whose OWN children read as
 * near-zero, measured directly while building this) is inherently about REAL child-process CPU and cannot
 * be driven deterministically in a unit test, so `snapshot_children_cpu` and `now_ms` are overridden here
 * with fakes that report CONTROLLED values -- proving the ARITHMETIC and the REFUSAL, which is the part a
 * test can make deterministic, while the real timing mechanism is proven by hand in the hook's own commit
 * (a real 21-guard sweep against a real gate, on this host, printed the real numbers and correctly refused
 * when a genuine run exceeded budget).
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
 * definition wins), so the real arithmetic and refusal logic run unmodified against controlled inputs.
 * `run()` is faked too, to a bare `echo "  ok      $1"` -- this test is about the BUDGET, never about
 * whether a real `npm run lint` passes, which `pre-push-fast-gate.test.ts`'s own `run()` test already
 * covers against the genuine function.
 */
function driveBudget(gateSeconds: number, guardsSeconds: number, extraEnv: Record<string, string> = {}): string {
  // `children_cpu_seconds` is invoked via `$(...)` (command substitution) at every real call site, which
  // forks bash into a SUBSHELL -- a plain shell-variable counter increments only inside that subshell and
  // is discarded when it exits, so every call would otherwise see the same starting value. A FILE-based
  // counter survives across the fork, the same reason the real `snapshot_children_cpu` writes to a file
  // rather than being read back through a pipe (see the real block's own header for that incident).
  // The real hook writes its REFUSING/overridden lines to stderr (a bare `git push` still shows them, but
  // an unattended CI wrapper might not) -- merged onto stdout here so `execFileSync`'s single captured
  // stream sees both, in the order they were actually written.
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

test("ACCEPTANCE: guards at 1.5x the gate's own CPU is WITHIN budget -- no refusal, nothing in failed", () => {
  const out = driveBudget(10, 15);
  assert.match(out, /wall 0\.0s, CPU 10\.000s \| guards.*wall 0\.0s, CPU 15\.000s/);
  assert.doesNotMatch(out, /REFUSING/);
  assert.doesNotMatch(out, /FAILED=tree-wide guards budget/);
});

test("MUTATION TARGET: guards at EXACTLY 2x the gate's own CPU is still within budget (the anchor is "
  + "'at most double', not 'strictly less than double')", () => {
  const out = driveBudget(10, 20);
  assert.doesNotMatch(out, /REFUSING/);
  assert.doesNotMatch(out, /FAILED=tree-wide guards budget/);
});

test("ACCEPTANCE: guards over 2x the gate's own CPU REFUSES, naming both real numbers", () => {
  const out = driveBudget(10, 21);
  assert.match(out, /REFUSING -- the tree-wide guards cost 21\.000s CPU/);
  assert.match(out, /double the gate's own 10\.000s \(budget 20\.000s\)/);
  assert.match(out, /FAILED=tree-wide guards budget \(21\.000s CPU > 2x 10\.000s\)/);
});

test("ACCEPTANCE: the real ratio measured on this host (#716, three runs: gate ~13.87s, guards ~24.50s, "
  + "1.77x) stays within budget -- the anchor this row shipped with is not a hair-trigger on the real "
  + "numbers it was set from", () => {
  const out = driveBudget(13.87, 24.50);
  assert.doesNotMatch(out, /REFUSING/);
});

test("MUTATION: A11Y_GUARDS_BUDGET_REASON overrides an over-budget run, prints the reason, and does NOT "
  + "add to failed -- the same override shape every other check in this hook already has", () => {
  const out = driveBudget(10, 30, { A11Y_GUARDS_BUDGET_REASON: "known slow guard, fix filed as its own row" });
  assert.match(out, /overridden: known slow guard, fix filed as its own row/);
  assert.doesNotMatch(out, /FAILED=tree-wide guards budget/);
});

test("MUTATION: without the override reason set, an over-budget run refuses -- the override cannot be "
  + "inherited silently from an unset/empty variable", () => {
  const out = driveBudget(10, 30, { A11Y_GUARDS_BUDGET_REASON: "" });
  assert.match(out, /FAILED=tree-wide guards budget/);
});

test("the header line prints wall AND CPU for both the gate and the guards -- a measured range, never a "
  + "fixed figure, per ceo's own instruction on #704", () => {
  const out = driveBudget(5, 5);
  assert.match(out, /pre-push: gate \(test-branch\) -- wall \d+\.\d+s, CPU 5\.000s \| guards \(#716, 21\) -- wall \d+\.\d+s, CPU 5\.000s/);
});

test("guards:sweep is what the hook actually runs -- never a re-typed list of the 21 files, which would "
  + "drift from #716's own discovery the moment a guard is added or removed", () => {
  const block = extractedBlock();
  assert.match(block, /run "tree-wide guards \(21, #716\)" npm run --silent guards:sweep/);
});
