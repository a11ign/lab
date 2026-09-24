/**
 * `evidence-check` exits differently for a CRASH and for its CHANGED verdict — #2197.
 *
 * Both used to be `1`: the CHANGED verdict deliberately, a throw because Node exits `1` for an unhandled
 * rejection. `lab-job.yml` then told the operator "the evidence CHANGED ... bump CAPTURE_PROTOCOL_VERSION
 * and recapture" for a run that had thrown on a stale manifest, which is a ~71-minute, 872-capture fleet
 * recapture spent on what `-e job=generate` fixes in seconds (measured 2026-09-23, two runs for #2160).
 *
 * WHAT IS RUN, and what is not. Two of the four codes come from the real script as a child process, end to
 * end: a stale manifest makes it throw, and the code it exits with is what this test reads. The CHANGED
 * verdict cannot be produced end to end without a Windows worker, a page server and NVDA captures — this
 * row's own "Does the acceptance need the fleet" answers no for that reason — so the codes a completed run
 * ends with are driven through the script's REAL `runToExit` and `exitCodeFor` with a REAL `summarise`
 * over the rows, in a child process, because `process.exit` is what is being asserted and it cannot be
 * observed in-process. That half proves the codes are distinct and wired to the verdict; the first half is
 * what proves the script's own entry point goes through `runToExit` at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { npmCliInvocation } from "../../../../scripts/npm-cli-executable.mjs";
import { CASES } from "./case-matrix.mjs";
import { EXIT, exitCodeFor } from "../../scripts/evidence-check.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPT = join(REPO, "packages/lab/scripts/evidence-check.mjs");
const FLEET_TIMEOUT_MS = 120_000;

/** Run a `.mjs` file under the repo's TypeScript loader, which the script needs for `@a11ign/evidence`. */
function runUnderLoader(file: string, args: string[], env: Record<string, string> = {}) {
  const npx = npmCliInvocation("npx", ["tsx", file, ...args]);
  return spawnSync(npx.command, npx.args, {
    cwd: REPO, encoding: "utf8", timeout: FLEET_TIMEOUT_MS,
    env: { ...process.env, ...env },
  });
}

test("the four codes are four different numbers, and `1` is CHANGED", () => {
  assert.deepEqual(EXIT, { SAFE: 0, CHANGED: 1, INCONCLUSIVE: 2, THREW: 3 });
  assert.equal(new Set(Object.values(EXIT)).size, 4,
    "two outcomes share a code: that is the defect #2197 exists to remove");
});

test("a run that THROWS exits with THREW, not with the CHANGED code (real script, stale manifest)", () => {
  const dataset = mkdtempSync(join(tmpdir(), "evidence-check-stale-"));
  try {
    // A manifest that names ONE real case with a field the code no longer gives it, and lists no other:
    // `manifestDrift` then reports it as drifted, which is what threw on the lab. Deriving the id from
    // CASES rather than naming one keeps this true the day a case is renamed, and the assertion on the
    // message below is the positive control that the throw was THIS one and not some other crash.
    const first = CASES[0] as { id: string };
    mkdirSync(join(dataset, "captures"), { recursive: true });
    writeFileSync(join(dataset, "manifest.json"),
      JSON.stringify({ cases: [{ id: first.id, task: "a task the code no longer defines" }] }));

    const run = runUnderLoader(SCRIPT, ["http://127.0.0.1:1", "--sample=1"], { DATASET_ROOT: dataset });

    assert.match(run.stderr, /no longer match CASES/,
      `the run did not fail on the stale manifest, so this exercised some other path.\n${run.stderr}`);
    assert.equal(run.status, EXIT.THREW,
      `a throw exited ${run.status}. 1 is what Node gives an unhandled rejection and is ALSO the CHANGED `
      + "verdict, so an operator cannot tell a crash from an answer");
    assert.notEqual(run.status, EXIT.CHANGED);
  } finally {
    rmSync(dataset, { recursive: true, force: true });
  }
});

/**
 * A driver that ends the way `main` does, through the script's own exports, so the code it exits with is
 * the code a completed run would. `verdicts` is what the comparisons said; `summarise` is the real one.
 */
function writeDriver(dir: string): string {
  const evidenceCheck = pathToFileURL(SCRIPT).href;
  const evidenceDiff = pathToFileURL(join(REPO, "packages/lab/src/capture/evidence-diff.mjs")).href;
  const file = join(dir, "driver.mjs");
  writeFileSync(file, `
    import { runToExit, exitCodeFor } from ${JSON.stringify(evidenceCheck)};
    import { summarise } from ${JSON.stringify(evidenceDiff)};
    const [mode, ...verdicts] = process.argv.slice(2);
    await runToExit(async () => {
      if (mode === "throw") throw new Error("boom: a crash, not a verdict");
      process.exit(exitCodeFor(summarise(verdicts.map((verdict) => ({ comparison: { verdict } })))));
    });
  `);
  return file;
}

test("a completed run exits 1 for CHANGED and a throw exits 3 — both through the script's own exports", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-check-driver-"));
  try {
    const driver = writeDriver(dir);
    const many = (verdict: string) => Array.from({ length: 6 }, () => verdict);
    const codeOf = (...args: string[]) => runUnderLoader(driver, args);

    const changed = codeOf("finish", ...many("SAME"), "CHANGED");
    const threw = codeOf("throw");
    assert.equal(changed.status, EXIT.CHANGED, `a CHANGED verdict exited ${changed.status}\n${changed.stderr}`);
    assert.equal(threw.status, EXIT.THREW, `a throw exited ${threw.status}\n${threw.stderr}`);
    assert.match(threw.stderr, /boom: a crash, not a verdict/,
      "the error must still be printed: the code says THAT it could not answer, the stack says why");
    assert.notEqual(changed.status, threw.status, "the two are distinguishable from outside the process");

    assert.equal(codeOf("finish", ...many("SAME")).status, EXIT.SAFE,
      "positive control: an unchanged sample exits 0, so a driver that always exits non-zero cannot pass");
    assert.equal(codeOf("finish", "SKIPPED", "CHANGED").status, EXIT.INCONCLUSIVE,
      "positive control: a partial read (one capture could not be gated) is INCONCLUSIVE and outranks the "
      + "CHANGED it did see");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exitCodeFor: INCONCLUSIVE outranks CHANGED, and neither is SAFE", () => {
  assert.equal(exitCodeFor({ inconclusive: true, evidenceChanged: true }), EXIT.INCONCLUSIVE);
  assert.equal(exitCodeFor({ inconclusive: false, evidenceChanged: true }), EXIT.CHANGED);
  assert.equal(exitCodeFor({ inconclusive: false, evidenceChanged: false }), EXIT.SAFE);
});
