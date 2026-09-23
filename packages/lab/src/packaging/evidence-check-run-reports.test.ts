/**
 * `evidence:check` MUST KEEP WHAT IT MEASURED -- #2122.
 *
 * `report.json` is a single fixed path with no run id, no timestamp and no append, so run N+1 overwrote
 * run N. A repeated-read protocol -- the exact shape this repo uses to decide DRIFT versus SAME -- was
 * therefore leaving an apparatus artefact for its LAST read only.
 *
 * Measured on #1908, 2026-09-22/23: ten `evidence:check` reads at pin `8fd25e80c`, all ten SAME. On the
 * lab, **read 10 was the only one with a file**; reads 1-9 survived solely in `a11y-lab`'s systemd journal
 * (`a11y-job-evidence-check.service`), which rotates, and the only durable copy of nine tenths of that
 * row's evidence was prose a session typed into a comment. This repo's house rule is that a reading is
 * trusted because it can be RE-DERIVED from the apparatus; a verdict whose evidence exists only in a
 * rotating journal can only be believed.
 *
 * ## What is asserted here, and what is asserted elsewhere
 *
 * `lab-fetch-paths.test.ts` owns the tree-wide comparison of every fetch entry against its producer, and
 * that is where `evidence-check` and `evidence-check-run` are resolved. This file asserts the two facts
 * that are specific to the fix: that two runs leave two files, and that adding the run-scoped sibling did
 * not move the path `lab-fetch.yml` has always fetched -- the rename that #968 already recorded once for
 * this same file.
 *
 * ## The positive control
 *
 * Every assertion below counts and READS BACK files it just wrote, so none can pass by comparing an empty
 * directory to itself. The mutant they exist to stop is a constant run-scoped name: make `runReportName`
 * ignore either half of the identity and `writeRunReport`'s own collision refusal fires, naming both the
 * path and the identity that repeated. Driven, not asserted by inspection -- `refuses a repeated identity`
 * below is that refusal at the same seam the mutant would hit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import {
  RUN_REPORTS, REPORT, OUT, checkoutCommit, latestReportPath, resultRow, runReportName, writeReports,
  writeRunReport,
} from "../../scripts/evidence-check.mjs";
import { REPO_ROOT } from "../dataset-paths.mjs";

/** The env overrides `dataset-paths.mjs` reads at call time. The lab runs with none, so neither does this. */
for (const name of ["DATASET_ROOT", "DATASET_CAPTURE_ROOT"]) delete process.env[name];

/** A scratch dataset directory, so nothing here writes into the real `runs/`. */
function scratch(): { out: string; runs: string; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "evidence-check-runs-"));
  return { out: join(dir, "evidence-check"), runs: join(dir, "evidence-check", "runs"), clean: () => rmSync(dir, { recursive: true, force: true }) };
}

/** One run's worth of input, shaped by the production `resultRow` rather than hand-typed here. */
const RUN = (worker: string) => ({
  workers: [worker],
  results: [resultRow({
    testCase: { id: "media-autoplay-audio" }, variant: "good", worker,
    comparison: { verdict: "SAME", fields: [] },
  })],
  summary: { compared: 1, attempted: 1, counts: { SAME: 1, DRIFT: 0, CHANGED: 0, REJECTED: 0 },
    inconclusive: false, evidenceChanged: false, recommendation: "safe to ship" },
});

test("#2122: two runs leave TWO run-scoped files, and the first one's content survives the second", () => {
  const { out, runs, clean } = scratch();
  try {
    const first = writeReports({ ...RUN("http://worker-2:7331"), at: new Date("2026-09-22T23:40:00.000Z"), runId: "111", out, runs });
    const second = writeReports({ ...RUN("http://worker-3:7331"), at: new Date("2026-09-22T23:55:00.000Z"), runId: "222", out, runs });

    assert.deepEqual(readdirSync(runs).sort(),
      ["2026-09-22T23-40-00-000Z-111.json", "2026-09-22T23-55-00-000Z-222.json"],
      "two runs, two files. This is the whole row: before the fix the second write landed on the first's "
      + "path and read 1 of a ten-read protocol simply stopped existing.");

    // READ BACK, not counted. A second file proves nothing if the first has been emptied or replaced in
    // place, and "the directory has two entries" is true of a great many broken writers.
    const kept = JSON.parse(readFileSync(first.runReport, "utf8"));
    assert.equal(kept.results[0].worker, "http://worker-2:7331",
      "the FIRST run's file still names the FIRST run's worker -- the two runs were given different ones "
      + "precisely so an overwrite cannot look like a survival");
    assert.equal(kept.runId, "111");
    assert.notEqual(first.runReport, second.runReport);

    // And `report.json` goes on naming the latest, which is the constraint the fetch entry rests on.
    assert.equal(JSON.parse(readFileSync(second.latest, "utf8")).runId, "222",
      "`report.json` is the LATEST run, unchanged in that respect -- `lab-fetch.yml` fetches it by a fixed "
      + "path and this fix adds a sibling rather than renaming it");
    assert.equal(first.latest, second.latest, "both runs wrote the same `report.json`; only the sibling is new");
  } finally {
    clean();
  }
});

test("#2122: a repeated run identity is REFUSED by name -- the control for a constant run-scoped name", () => {
  const { runs, clean } = scratch();
  try {
    const at = new Date("2026-09-22T23:40:00.000Z");
    const path = writeRunReport({ dir: runs, at, runId: "111", report: { first: true } });
    assert.throws(() => writeRunReport({ dir: runs, at, runId: "111", report: { second: true } }),
      (error: Error) => error.message.includes(path) && error.message.includes("111"),
      "a collision must STOP and name the path and the identity. Silently replacing the previous run's "
      + "artefact is the defect this file exists to remove, so doing it here would be doing it anyway.");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { first: true },
      "and the refusal left the first run's file untouched rather than half-written");
  } finally {
    clean();
  }
});

test("#2122: the identity is BOTH halves -- either one alone repeats on the population this exists for", () => {
  const at = new Date("2026-09-22T23:40:00.000Z");
  const later = new Date("2026-09-22T23:40:00.001Z");
  assert.notEqual(runReportName({ at, runId: "111" }), runReportName({ at, runId: "222" }),
    "two dispatches queued back to back share a stamp at anything coarser than milliseconds");
  assert.notEqual(runReportName({ at, runId: "111" }), runReportName({ at: later, runId: "111" }),
    "and a pid alone repeats inside a day on a box that has been up for weeks");
  assert.match(runReportName({ at, runId: "111" }), /^\d{4}-\d{2}-\d{2}T[\d-]+Z-111\.json$/,
    "no `:` and no `.` before the extension: these files are read on whatever machine the operator is "
    + "sitting at, not only on the lab");
});

test("#2122: a run-scoped file carries what a verdict needs to be RE-DERIVED", () => {
  const { out, runs, clean } = scratch();
  try {
    const { runReport } = writeReports({ ...RUN("http://worker-2:7331"), out, runs });
    const report = JSON.parse(readFileSync(runReport, "utf8"));
    assert.deepEqual(report.workers, ["http://worker-2:7331"], "the pool AS DISPATCHED");
    assert.equal(report.results[0].worker, "http://worker-2:7331", "and the box that captured each row (#1948)");
    assert.equal(report.summary.counts.SAME, 1, "the verdict's own counts");
    // The COMMIT, read from real git rather than passed in: "ten reads at pin 8fd25e80c" was a sentence a
    // session typed, and the instrument wrote nothing that could confirm it.
    assert.match(report.commit, /^[0-9a-f]{40}$/, "the commit this checkout was on");
    assert.equal(report.commit, checkoutCommit().commit);
    assert.equal(report.commitError, undefined, "git is readable here, so nothing stands in for the commit");
  } finally {
    clean();
  }
});

test("#2122: the fetched path did NOT move, and the sibling cannot shadow it", () => {
  const plays = parse(readFileSync(resolve(REPO_ROOT, "packages/control/ansible/lab-fetch.yml"), "utf8")) as
    { vars?: { lab_artifacts?: Record<string, string> } }[];
  const map = plays.find((play) => play.vars?.lab_artifacts)?.vars?.lab_artifacts;
  assert.ok(map, "lab-fetch.yml has no `lab_artifacts` map -- its shape changed");
  assert.equal(resolve(REPO_ROOT, map["evidence-check"]), REPORT,
    "`evidence-check` still fetches the path this script writes. Derived on both sides: the playbook's "
    + "own string against the producer's exported constant, never a second hand-typed copy (#968).");

  // The sibling is a DIRECTORY inside `OUT`, so the glob `evidence-check-run` resolves never sees
  // `report.json` -- `lab-fetch.yml` runs `find` over the pattern's own `dirname`.
  assert.equal(RUN_REPORTS, resolve(OUT, "runs"));
  assert.equal(latestReportPath(RUN_REPORTS) === REPORT, false,
    "and `report.json` does not live in the directory the glob searches");
  assert.equal(map["evidence-check-run"].endsWith("/evidence-check/runs/*.json"), true,
    "the glob is scoped to that directory, so nothing it matches is the fetched report");
});
