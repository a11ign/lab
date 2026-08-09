import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

// Resolved from THIS FILE, not the cwd: `process.cwd()` is the repo root for `npm test` and nothing else, and
// it broke when M8 moved this file into a package.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const STATUS = resolve(ROOT, "packages/lab/src/training/capture-status.mjs");

function statusFor(progress: Record<string, unknown>) {
  const root = mkdtempSync(resolve(tmpdir(), "a11y-status-"));
  try {
    writeFileSync(resolve(root, "capture-progress.json"), JSON.stringify(progress));
    const output = execFileSync(process.execPath, [STATUS, "--json"], {
      cwd: ROOT,
      env: { ...process.env, DATASET_ROOT: root },
      encoding: "utf8",
    });
    return JSON.parse(output) as Record<string, unknown>;
  } catch (error) {
    if (typeof error === "object" && error && "stdout" in error) {
      const stdout = String(error.stdout);
      if (stdout) return JSON.parse(stdout) as Record<string, unknown>;
    }
    throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function progress(updatedAt: string) {
  return {
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    updatedAt,
    finishedAt: null,
    outcome: null,
    worker: null,
    baseUrl: null,
    captureTimeoutMs: 1_000,
    total: 1,
    workers: [],
    current: [],
    cases: { "case-1": { status: "capturing" } },
  };
}

test("status marks a quiet unfinished run stale and removes its ETA", () => {
  const report = statusFor(progress(new Date(Date.now() - 120_000).toISOString()));
  assert.equal(report.running, false);
  assert.equal(report.stale, true);
  assert.equal(report.eta_minutes, null);
  assert.equal(report.verdict, 3);
  assert.equal(report.next_command, "npm run doctor && npm run training:capture -- --resume --no-cache");
});

test("status keeps a recently updated unfinished run live", () => {
  const report = statusFor(progress(new Date().toISOString()));
  assert.equal(report.running, true);
  assert.equal(report.stale, false);
  assert.equal(report.verdict, 0);
  assert.equal(report.next_command, "npm run training:wait");
});

/**
 * `--json` must always emit JSON.
 *
 * The no-run branch printed English whatever the caller asked for, so `JSON.parse(stdout)` threw in
 * exactly the case an automated caller most needs to handle — "is a run in progress?" answered when there
 * is none. Driven as a subprocess because the defect was in the OUTPUT, not in a pure function, and a unit
 * test of the tally would never have seen it.
 */
test("--json emits parseable JSON even when no run exists", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const script = fileURLToPath(new URL("./capture-status.mjs", import.meta.url));
  // An empty directory has no progress file, which is the no-run case.
  const empty = mkdtempSync(join(tmpdir(), "a11y-status-"));
  // A non-zero exit is EXPECTED here — "no run" is exit 2 — so the output has to be read from the thrown
  // error as well as from the success path. Returning from both branches keeps that explicit.
  const stdout = ((): string => {
    try {
      return execFileSync(process.execPath, [script, "--json"], {
        encoding: "utf8", env: { ...process.env, DATASET_ROOT: empty },
      });
    } catch (error) {
      return String((error as { stdout?: string }).stdout ?? "");
    }
  })();
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.running, false);
  assert.equal(parsed.verdict, 2, "no-run is exit 2, and the payload must say so too");
  assert.equal(parsed.next_command, "npm run training:capture");
  assert.match(String(parsed.progress_file), /capture-progress\.json$/);
});
