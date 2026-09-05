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

function statusFor(progress: Record<string, unknown>, extraArgs: string[] = []) {
  const root = mkdtempSync(resolve(tmpdir(), "a11y-status-"));
  try {
    writeFileSync(resolve(root, "capture-progress.json"), JSON.stringify(progress));
    const output = execFileSync(process.execPath, [STATUS, "--json", ...extraArgs], {
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

// --- `--since`: bound the answer to ONE invocation ------------------------------------------------------
//
// The progress file is keyed on a CORPUS, never on a run, so unbounded it answers "what did this corpus
// last do" where the caller asked "what is the job I named doing". For a COMPOSITE job (`everything`,
// `retrain`) that captures and then spends hours exporting, training and gating, the difference is not
// cosmetic: `running: false, 49 of 49` read as a finished JOB is the misread that destroyed 12 in-flight
// captures on 2026-09-05, when a deploy went out underneath a run whose progress file still described its
// predecessor. This is the `_SYSTEMD_INVOCATION_ID` remedy applied to the progress file instead of the
// journal — see `capture-status.mjs`'s `sinceFromArgv` for the full argument.

function runFinishedAt(startedAt: string) {
  return {
    startedAt,
    updatedAt: startedAt,
    finishedAt: startedAt,
    outcome: "1 captured, 0 failed, 0 skipped, of 1 cases",
    total: 1,
    worker: "http://worker",
    workers: ["http://worker"],
    cases: { "a-case": { status: "captured", startedAt } },
  };
}

const EARLIER = "2026-09-02T15:43:12.291Z";
const LATER = "2026-09-05T18:10:51.000Z";

test("a run that started BEFORE the instant asked about is reported as no run, naming both", () => {
  const out = statusFor(runFinishedAt(EARLIER), [`--since=${LATER}`]);
  assert.equal(out.predates_requested_run, true);
  // Reporting zero counts is not enough on its own: "there is nothing here" and "there is something here
  // and it is not yours" send a reader to different places, so BOTH instants have to survive into the
  // payload or a bounding mistake is indistinguishable from a real absence.
  assert.equal(out.run_started_at, EARLIER);
  assert.equal(out.requested_since, LATER);
  assert.equal(out.total, 0);
  assert.equal(out.verdict, 2);
});

test("a run that started AFTER the instant asked about is reported normally", () => {
  const out = statusFor(runFinishedAt(LATER), [`--since=${EARLIER}`]);
  assert.notEqual(out.predates_requested_run, true);
  assert.equal(out.total, 1);
  assert.equal(out.captured, 1);
});

test("systemd's own UTC rendering is accepted without conversion", () => {
  // The whole reason no date arithmetic happens in Jinja: `lab-status.yml` passes
  // `ActiveEnterTimestamp` straight through. If Date.parse ever stops reading this shape, that playbook
  // silently starts reporting a stranger's run again, and only this assertion would say so.
  const out = statusFor(runFinishedAt(EARLIER), ["--since=Sat 2026-09-05 18:10:51 UTC"]);
  assert.equal(out.predates_requested_run, true);
});

test("systemd's two spellings of 'never been active' mean NO constraint, not a bad value", () => {
  // A unit that has never run renders an EMPTY timestamp; one systemd does not know renders `n/a`. Both
  // reach here because the playbook passes the field through unconditionally rather than deciding in
  // Jinja whether to. Neither is a bounding request, so neither may suppress a real run.
  for (const spelling of ["--since=", "--since=n/a"]) {
    const out = statusFor(runFinishedAt(EARLIER), [spelling]);
    assert.notEqual(out.predates_requested_run, true, `${spelling} must not bound anything`);
    assert.equal(out.total, 1, `${spelling} must report the run on disk`);
  }
});

test("an unreadable instant is REFUSED, never silently ignored", () => {
  // The failure this remedy could otherwise reintroduce through itself. An unparseable `--since` that
  // degraded to "no constraint" would report a stale run as live — exactly what the flag exists to stop.
  // The live case is real: systemd renders the timestamp in the machine's local zone, and Date.parse
  // reads "... UTC" but NOT "... BST", so a lab whose clock leaves UTC must fail loudly here.
  const root = mkdtempSync(resolve(tmpdir(), "a11y-status-"));
  try {
    writeFileSync(resolve(root, "capture-progress.json"), JSON.stringify(runFinishedAt(EARLIER)));
    let stderr = "";
    let status = 0;
    try {
      execFileSync(process.execPath, [STATUS, "--json", "--since=Sat 2026-09-05 18:10:51 BST"],
        { cwd: ROOT, env: { ...process.env, DATASET_ROOT: root }, encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      const e = error as { stderr?: string; status?: number };
      stderr = String(e.stderr ?? "");
      status = Number(e.status ?? 0);
    }
    assert.equal(status, 2, "an unreadable --since must exit 2, not report the run on disk");
    assert.match(stderr, /is not a readable instant/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
