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
