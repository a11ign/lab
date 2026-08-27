/**
 * `eval:gate` must REFUSE when judge quality falls below its thresholds — and the refusal must come from
 * the GATE, not from the run failing for some other reason.
 *
 * `fitness.test.ts` proves the decision, `evaluateFitness`. This is the wiring half the gate register
 * called uncovered: that the 34 fixtures are actually scored through the local judge, that the fitness
 * verdict is computed from what came back, and that `EVAL_GATE` is what turns a bad verdict into a
 * non-zero exit.
 *
 * ## It does not need the Python venv
 *
 * `docs/proving-a-gate.md` step 1 is to disbelieve that, and step 2 is to separate the DECISION from the
 * DATA. `scorerPaths()` reads `A11Y_PYTHON`, so the interpreter is already injectable — a twelve-line
 * stub that reads a capture on stdin and prints a scorer's JSON is enough to drive the whole path
 * without torch, a model, or a GPU.
 *
 * ## What running it measured, which is worth more than the test
 *
 * A scorer reporting NOTHING AT ALL still scores 59% recall on this fixture set, because the
 * deterministic rules supply the rest. The gate's floor is 0.55. So a judge that went completely silent
 * would pass the gate that exists to measure it — see `docs/not-working.md`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const RUN = join(REPO, "packages/lab/src/eval/run.ts");

/** A scorer that reads a capture and reports nothing. The judge's whole contract, in twelve lines. */
function silentScorer(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "a11y-stub-scorer-"));
  const path = join(dir, "stub-scorer.mjs");
  writeFileSync(path, [
    "#!/usr/bin/env node",
    'let input = "";',
    'process.stdin.on("data", (d) => { input += d; });',
    'process.stdin.on("end", () => {',
    "  JSON.parse(input);",
    '  process.stdout.write(JSON.stringify({ records: [{ scores: {}, predictions: {} }] }));',
    "});",
  ].join("\n"));
  chmodSync(path, 0o755);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runEval(env: Record<string, string>): { code: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", RUN, "tut-"], {
      cwd: REPO, encoding: "utf8", timeout: 240_000,
      env: { ...process.env, EVAL_RUNS: "1", ...env },
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

test("the COMMAND refuses when recall is below the floor, and says which threshold", { timeout: 300_000 }, () => {
  const stub = silentScorer();
  try {
    // A floor no rules-only run can meet. The point is not the number: it is that the gate READ a
    // threshold, compared it against a verdict computed from real scored fixtures, and refused.
    const { code, out } = runEval({ A11Y_PYTHON: stub.path, EVAL_GATE: "1", EVAL_MIN_RECALL: "0.99" });
    assert.equal(code, 1, `expected the fitness gate to refuse; got ${code}: ${out.slice(-600)}`);
    assert.match(out, /FITNESS: FAIL/);
    assert.match(out, /recall/i, "the refusal must name what failed, not merely that something did");
    // WHERE it came from. A non-zero exit proves nothing about which check produced it — a missing
    // fixture, a crashed scorer and a failed gate all exit 1.
    assert.match(out, /AGGREGATE/, "and the fixtures must actually have been scored to get there");
  } finally {
    stub.cleanup();
  }
});

test("THE CONTROL: the same run without EVAL_GATE exits 0, so the GATE is what refuses", { timeout: 300_000 }, () => {
  // Without this the assertion above is satisfied by a run that fails for any reason at all — a stub the
  // judge could not talk to, a fixture path that moved. Same scorer, same fixtures, same threshold; the
  // only difference is whether the gate is switched on.
  const stub = silentScorer();
  try {
    const { code, out } = runEval({ A11Y_PYTHON: stub.path, EVAL_MIN_RECALL: "0.99" });
    assert.equal(code, 0, `an ungated run must not fail; got ${code}: ${out.slice(-600)}`);
    assert.ok(!/FITNESS:/.test(out), "and it must not even evaluate fitness when the gate is off");
    assert.match(out, /AGGREGATE/, "while still scoring the fixtures, which is what makes this a control");
  } finally {
    stub.cleanup();
  }
});
